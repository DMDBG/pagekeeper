// Automatic follow-along for your own audiobooks, done entirely on this PC.
// Each audiobook part is decoded to plain 16 kHz speech audio, then whisper.cpp (an open-source
// speech recognizer bundled with the app) writes down every word with the time it was spoken.
// The reader page matches those words to the book's text and saves a small timing map that
// syncs to your other devices. Nothing is uploaded anywhere for this.
use futures_util::StreamExt;
use serde::Serialize;
use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymErr;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use tauri::{AppHandle, Emitter, Manager};

static STOP: AtomicBool = AtomicBool::new(false);
const MODEL_FILE: &str = "ggml-base.en.bin";
const MODEL_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin";
const MODEL_MIN: u64 = 100_000_000; // the real file is about 148 MB
const RATE: u32 = 16_000;
const CHUNK_SECS: usize = 300; // the recognizer works through five minutes at a time

#[derive(Serialize)]
pub struct SyncStatus {
    engine: bool,
    model: bool,
}

#[derive(Serialize, Clone)]
struct Progress<'a> {
    stage: &'a str,
    frac: f64,
}

fn stopped() -> String {
    "Stopped.".to_string()
}

fn model_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("models");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(MODEL_FILE))
}

fn work_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("pksync");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn whisper_exe(app: &AppHandle) -> Result<PathBuf, String> {
    let exe = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("whisper")
        .join("whisper-cli.exe");
    if exe.exists() {
        Ok(exe)
    } else {
        Err("The speech engine is missing from this install. Reinstall Pagekeeper.".to_string())
    }
}

fn model_ready(app: &AppHandle) -> bool {
    model_path(app)
        .ok()
        .and_then(|p| std::fs::metadata(p).ok())
        .map(|m| m.len() > MODEL_MIN)
        .unwrap_or(false)
}

/// Is the speech engine installed, and has the voice model been downloaded?
#[tauri::command]
pub fn pk_sync_status(app: AppHandle) -> SyncStatus {
    SyncStatus { engine: whisper_exe(&app).is_ok(), model: model_ready(&app) }
}

/// Stop (true) or clear the stop before a new job (false).
#[tauri::command]
pub fn pk_sync_stop(stop: bool) {
    STOP.store(stop, Ordering::SeqCst);
}

/// Download the English speech model once (about 148 MB). Progress goes out as "pk-sync-progress".
#[tauri::command]
pub async fn pk_sync_model(app: AppHandle) -> Result<(), String> {
    if model_ready(&app) {
        return Ok(());
    }
    let path = model_path(&app)?;
    let part = path.with_extension("part");
    let client = reqwest::Client::builder()
        .user_agent("Pagekeeper/1.0 (Windows; ebook reader)")
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(MODEL_URL).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("The model download failed ({}).", resp.status().as_u16()));
    }
    let total = resp.content_length().unwrap_or(148_000_000);
    let mut file = File::create(&part).map_err(|e| e.to_string())?;
    let mut stream = resp.bytes_stream();
    let (mut got, mut last) = (0u64, 0.0f64);
    while let Some(chunk) = stream.next().await {
        if STOP.load(Ordering::SeqCst) {
            drop(file);
            let _ = std::fs::remove_file(&part);
            return Err(stopped());
        }
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        got += chunk.len() as u64;
        let frac = got as f64 / total.max(1) as f64;
        if frac - last >= 0.01 {
            last = frac;
            let _ = app.emit("pk-sync-progress", Progress { stage: "model", frac });
        }
    }
    drop(file);
    if got < MODEL_MIN {
        let _ = std::fs::remove_file(&part);
        return Err("The model download was cut short. Try again.".to_string());
    }
    std::fs::rename(&part, &path).map_err(|e| e.to_string())?;
    Ok(())
}

fn safe_file(name: &str) -> Result<(), String> {
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") {
        Err("Unknown file.".to_string())
    } else {
        Ok(())
    }
}

/// Start receiving an audio file from the reader page. Returns its working name.
#[tauri::command]
pub fn pk_put_begin(app: AppHandle, ext: String) -> Result<String, String> {
    let ext: String = ext.chars().filter(|c| c.is_ascii_alphanumeric()).take(5).collect();
    let name = format!("{}.{}", uuid::Uuid::new_v4(), if ext.is_empty() { "bin" } else { &ext });
    File::create(work_dir(&app)?.join(&name)).map_err(|e| e.to_string())?;
    Ok(name)
}

/// Add the next piece of that file (sent as raw bytes, with the name in the "x-file" header).
#[tauri::command]
pub fn pk_put_chunk(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let name = request
        .headers()
        .get("x-file")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| "Missing file name.".to_string())?
        .to_string();
    safe_file(&name)?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected the file's bytes.".to_string());
    };
    let mut f = OpenOptions::new()
        .append(true)
        .open(work_dir(&app)?.join(&name))
        .map_err(|e| e.to_string())?;
    f.write_all(bytes).map_err(|e| e.to_string())
}

/// Turn one received audio file into words with their times (milliseconds from the start).
#[tauri::command]
pub async fn pk_transcribe(app: AppHandle, file: String) -> Result<Vec<(u32, String)>, String> {
    safe_file(&file)?;
    let src = work_dir(&app)?.join(&file);
    let app2 = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || transcribe(&app2, &src))
        .await
        .map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(work_dir(&app)?.join(&file));
    result
}

fn transcribe(app: &AppHandle, src: &Path) -> Result<Vec<(u32, String)>, String> {
    let exe = whisper_exe(app)?;
    if !model_ready(app) {
        return Err("The speech model isn't downloaded yet.".to_string());
    }
    let model = model_path(app)?;
    let work = work_dir(app)?.join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let out = decode_and_recognize(app, &exe, &model, &work, src);
    let _ = std::fs::remove_dir_all(&work);
    out
}

fn decode_and_recognize(app: &AppHandle, exe: &Path, model: &Path, work: &Path, src: &Path) -> Result<Vec<(u32, String)>, String> {
    let file = File::open(src).map_err(|e| e.to_string())?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(e) = src.extension().and_then(|e| e.to_str()) {
        hint.with_extension(e);
    }
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(|_| "This audio file type can't be read for syncing.".to_string())?;
    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| "No audio found in this file.".to_string())?;
    let tid = track.id;
    let sr = track.codec_params.sample_rate.unwrap_or(44_100).max(1) as u64;
    let total_secs = track.codec_params.n_frames.map(|n| n as f64 / sr as f64).unwrap_or(0.0);
    let mut dec = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|_| "This audio format can't be read for syncing.".to_string())?;

    let mut words: Vec<(u32, String)> = Vec::new();
    let mut pcm: Vec<i16> = Vec::with_capacity(CHUNK_SECS * RATE as usize);
    let mut chunk_start = 0.0f64;
    // Mix to mono and step down to 16 kHz by averaging; plenty for speech recognition.
    let (mut acc, mut cnt, mut pos) = (0f32, 0u32, 0u64);
    loop {
        if STOP.load(Ordering::SeqCst) {
            return Err(stopped());
        }
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymErr::IoError(_)) | Err(SymErr::ResetRequired) => break,
            Err(e) => return Err(e.to_string()),
        };
        if packet.track_id() != tid {
            continue;
        }
        let decoded = match dec.decode(&packet) {
            Ok(d) => d,
            Err(SymErr::DecodeError(_)) => continue,
            Err(SymErr::IoError(_)) => break,
            Err(e) => return Err(e.to_string()),
        };
        let spec = *decoded.spec();
        let ch = spec.channels.count().max(1);
        let mut sb = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
        sb.copy_interleaved_ref(decoded);
        for frame in sb.samples().chunks(ch) {
            acc += frame.iter().sum::<f32>() / ch as f32;
            cnt += 1;
            pos += RATE as u64;
            if pos >= sr {
                pos -= sr;
                let v = (acc / cnt.max(1) as f32).clamp(-1.0, 1.0);
                pcm.push((v * 32767.0) as i16);
                acc = 0.0;
                cnt = 0;
            }
        }
        if pcm.len() >= CHUNK_SECS * RATE as usize {
            recognize(exe, model, work, &pcm, chunk_start, &mut words)?;
            chunk_start += pcm.len() as f64 / RATE as f64;
            pcm.clear();
            if total_secs > 0.0 {
                let _ = app.emit("pk-sync-progress", Progress { stage: "listen", frac: (chunk_start / total_secs).min(1.0) });
            }
        }
    }
    if pcm.len() > RATE as usize / 2 {
        recognize(exe, model, work, &pcm, chunk_start, &mut words)?;
    }
    let _ = app.emit("pk-sync-progress", Progress { stage: "listen", frac: 1.0 });
    Ok(words)
}

fn write_wav(path: &Path, pcm: &[i16]) -> Result<(), String> {
    let f = File::create(path).map_err(|e| e.to_string())?;
    let mut w = BufWriter::new(f);
    let data = (pcm.len() * 2) as u32;
    let mut h: Vec<u8> = Vec::with_capacity(44);
    h.extend_from_slice(b"RIFF");
    h.extend_from_slice(&(36 + data).to_le_bytes());
    h.extend_from_slice(b"WAVEfmt ");
    h.extend_from_slice(&16u32.to_le_bytes());
    h.extend_from_slice(&1u16.to_le_bytes()); // PCM
    h.extend_from_slice(&1u16.to_le_bytes()); // mono
    h.extend_from_slice(&RATE.to_le_bytes());
    h.extend_from_slice(&(RATE * 2).to_le_bytes());
    h.extend_from_slice(&2u16.to_le_bytes());
    h.extend_from_slice(&16u16.to_le_bytes());
    h.extend_from_slice(b"data");
    h.extend_from_slice(&data.to_le_bytes());
    w.write_all(&h).map_err(|e| e.to_string())?;
    for s in pcm {
        w.write_all(&s.to_le_bytes()).map_err(|e| e.to_string())?;
    }
    w.flush().map_err(|e| e.to_string())
}

fn recognize(exe: &Path, model: &Path, work: &Path, pcm: &[i16], start: f64, words: &mut Vec<(u32, String)>) -> Result<(), String> {
    let wav = work.join("chunk.wav");
    let json = work.join("chunk.json");
    let _ = std::fs::remove_file(&json);
    write_wav(&wav, pcm)?;
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .saturating_sub(1)
        .clamp(1, 8);
    let mut cmd = Command::new(exe);
    cmd.arg("-m").arg(model)
        .arg("-f").arg(&wav)
        .args(["-l", "en", "-ml", "1", "-sow", "-oj", "-np", "-t", &threads.to_string()])
        .arg("-of").arg(work.join("chunk"))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if let Some(dir) = exe.parent() {
        cmd.current_dir(dir);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // no console window
    }
    let mut child = cmd.spawn().map_err(|e| format!("Couldn't start the speech engine: {e}"))?;
    loop {
        if STOP.load(Ordering::SeqCst) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(stopped());
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return Err("The speech engine stopped with an error.".to_string());
                }
                break;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(200)),
            Err(e) => return Err(e.to_string()),
        }
    }
    let bytes = std::fs::read(&json).map_err(|_| "The speech engine didn't write any words.".to_string())?;
    let v: serde_json::Value = serde_json::from_str(&String::from_utf8_lossy(&bytes)).map_err(|e| e.to_string())?;
    if let Some(segs) = v["transcription"].as_array() {
        for seg in segs {
            let text = seg["text"].as_str().unwrap_or("").trim();
            if text.is_empty() {
                continue;
            }
            let from = seg["offsets"]["from"].as_f64().unwrap_or(0.0);
            words.push(((start * 1000.0 + from) as u32, text.to_string()));
        }
    }
    Ok(())
}
