// Automatic follow-along for your own audiobooks, done entirely on this PC.
// Each audiobook part is decoded to plain 16 kHz speech audio, then whisper.cpp (an open-source
// speech recognizer bundled with the app) writes down the words with the time they were spoken.
// It listens to the whole book, with several copies of the recognizer working side by side, so the
// timing is exact for every sentence.
// The reader page matches those words to the book's text and saves a small timing map that
// syncs to your other devices. Nothing is uploaded anywhere for this.
use futures_util::StreamExt;
use serde::Serialize;
use std::fs::{File, OpenOptions};
use std::collections::HashMap;
use std::io::{BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymErr;
use symphonia::core::formats::{FormatOptions, SeekMode, SeekTo};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::core::units::Time;
use tauri::{AppHandle, Emitter, Manager};

static STOP: AtomicBool = AtomicBool::new(false);

/// An audio file that has been heard, kept as plain 16 kHz speech audio (the three-minute pieces)
/// until the page has double-checked every sentence start in it.
struct Job {
    dir: PathBuf,
    chunks: Vec<(f64, PathBuf, usize)>, // start in seconds, file, number of samples
}
static JOBS: Mutex<Option<HashMap<String, Job>>> = Mutex::new(None);
const CLIP_MS: u32 = 2600; // how much is listened to for each check
const MODEL_FILE: &str = "ggml-tiny.en.bin";
const MODEL_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin";
const OLD_MODEL: &str = "ggml-base.en.bin"; // the larger model earlier versions used
const MODEL_MIN: u64 = 60_000_000; // the real file is about 75 MB
const RATE: u32 = 16_000;
const CHUNK_SECS: usize = 180; // each copy of the recognizer takes three minutes at a time

/// What the recognizer heard in one audio file: each word with the time it was spoken
/// (milliseconds from the start), and the pauses.
#[derive(Serialize)]
pub struct Heard {
    words: Vec<(u32, String)>,
    gaps: Vec<(u32, u32)>,
    job: String,
}

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
pub fn pk_sync_stop(app: AppHandle, stop: bool) {
    STOP.store(stop, Ordering::SeqCst);
    if stop {
        return;
    }
    // Starting fresh: clear out anything an earlier run left behind.
    let live: Vec<PathBuf> = JOBS
        .lock()
        .ok()
        .and_then(|j| j.as_ref().map(|m| m.values().map(|x| x.dir.clone()).collect()))
        .unwrap_or_default();
    if let Ok(dir) = work_dir(&app) {
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for e in rd.flatten() {
                let p = e.path();
                if p.is_dir() && !live.contains(&p) {
                    let _ = std::fs::remove_dir_all(&p);
                }
            }
        }
    }
}

/// Done with a heard file: delete its speech audio.
#[tauri::command]
pub fn pk_sync_release(job: String) {
    if let Ok(mut j) = JOBS.lock() {
        if let Some(done) = j.as_mut().and_then(|m| m.remove(&job)) {
            let _ = std::fs::remove_dir_all(&done.dir);
        }
    }
}

/// The double-check: for each moment, listen to a couple of seconds starting right there and say
/// which words come first. If they're the sentence's own first words, the sentence starts there.
#[tauri::command]
pub async fn pk_check(app: AppHandle, job: String, starts: Vec<u32>) -> Result<Vec<Vec<String>>, String> {
    let exe = whisper_exe(&app)?;
    let model = model_path(&app)?;
    let (dir, chunks) = {
        let j = JOBS.lock().map_err(|e| e.to_string())?;
        let found = j.as_ref().and_then(|m| m.get(&job)).ok_or_else(|| "That audio isn't loaded any more.".to_string())?;
        (found.dir.clone(), found.chunks.clone())
    };
    tauri::async_runtime::spawn_blocking(move || check_clips(&exe, &model, &dir, &chunks, &starts))
        .await
        .map_err(|e| e.to_string())
}

fn read_pcm(chunks: &[(f64, PathBuf, usize)], start_ms: u32, len_ms: u32) -> Vec<i16> {
    let s0 = (start_ms as f64 / 1000.0 * RATE as f64) as i64;
    let n = (len_ms as f64 / 1000.0 * RATE as f64) as usize;
    let mut out = vec![0i16; n];
    for (cs, path, len) in chunks {
        let c0 = (cs * RATE as f64).round() as i64;
        let c1 = c0 + *len as i64;
        let (a, b) = (s0.max(c0), (s0 + n as i64).min(c1));
        if a >= b {
            continue;
        }
        if let Ok(mut f) = File::open(path) {
            if f.seek(SeekFrom::Start(44 + (a - c0) as u64 * 2)).is_ok() {
                let mut buf = vec![0u8; ((b - a) * 2) as usize];
                if f.read_exact(&mut buf).is_ok() {
                    for (k, ch) in buf.chunks_exact(2).enumerate() {
                        out[(a - s0) as usize + k] = i16::from_le_bytes([ch[0], ch[1]]);
                    }
                }
            }
        }
    }
    out
}

fn check_clips(exe: &Path, model: &Path, dir: &Path, chunks: &[(f64, PathBuf, usize)], starts: &[u32]) -> Vec<Vec<String>> {
    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
    let workers = (cores / 2).clamp(1, 10);
    let next = AtomicUsize::new(0);
    let results: Vec<Mutex<Vec<String>>> = starts.iter().map(|_| Mutex::new(Vec::new())).collect();
    let never = AtomicBool::new(false);
    std::thread::scope(|sc| {
        for w in 0..workers {
            let (next, results, never) = (&next, &results, &never);
            sc.spawn(move || loop {
                let i = next.fetch_add(1, Ordering::SeqCst);
                if i >= starts.len() || STOP.load(Ordering::SeqCst) {
                    break;
                }
                let pcm = read_pcm(chunks, starts[i], CLIP_MS);
                let wav = dir.join(format!("clip{w}.wav"));
                if write_wav(&wav, &pcm).is_err() {
                    continue;
                }
                // A short window (-ac 300, about six seconds) makes each check about ten times quicker.
                if let Ok(words) = run_whisper(exe, model, &wav, &dir.join(format!("clip{w}")), &["-ac", "300"], 2, never) {
                    if let Ok(mut r) = results[i].lock() {
                        *r = words.into_iter().take(6).map(|(_, t)| t).collect();
                    }
                }
                let _ = std::fs::remove_file(&wav);
            });
        }
    });
    results.into_iter().map(|m| m.into_inner().unwrap_or_default()).collect()
}

/// Download the English speech model once (about 75 MB). Progress goes out as "pk-sync-progress".
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
    let total = resp.content_length().unwrap_or(77_700_000);
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
    if let Some(dir) = path.parent() {
        let _ = std::fs::remove_file(dir.join(OLD_MODEL));
    }
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
pub async fn pk_transcribe(app: AppHandle, file: String, first: Option<f64>) -> Result<Heard, String> {
    safe_file(&file)?;
    let src = work_dir(&app)?.join(&file);
    let app2 = app.clone();
    let tag = file.clone();
    let result = tauri::async_runtime::spawn_blocking(move || transcribe(&app2, &src, &tag, first.unwrap_or(0.0)))
        .await
        .map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(work_dir(&app)?.join(&file));
    result
}

fn transcribe(app: &AppHandle, src: &Path, tag: &str, first: f64) -> Result<Heard, String> {
    let exe = whisper_exe(app)?;
    if !model_ready(app) {
        return Err("The speech model isn't downloaded yet.".to_string());
    }
    let model = model_path(app)?;
    let id = uuid::Uuid::new_v4().to_string();
    let work = work_dir(app)?.join(&id);
    std::fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    match decode_and_recognize(app, &exe, &model, &work, src, tag, first) {
        Ok((mut heard, chunks)) => {
            heard.job = id.clone();
            if let Ok(mut j) = JOBS.lock() {
                j.get_or_insert_with(HashMap::new).insert(id, Job { dir: work, chunks });
            }
            Ok(heard)
        }
        Err(e) => {
            let _ = std::fs::remove_dir_all(&work);
            Err(e)
        }
    }
}

/// One finished stretch of audio, sent to the reader page straight away so it can start lining
/// up the text before the whole book is done.
#[derive(Serialize, Clone)]
struct Piece<'a> {
    tag: &'a str,
    words: &'a [(u32, String)],
    gaps: &'a [(u32, u32)],
}

fn decode_and_recognize(app: &AppHandle, exe: &Path, model: &Path, work: &Path, src: &Path, tag: &str, first: f64) -> Result<(Heard, Vec<(f64, PathBuf, usize)>), String> {
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
    let tb = track.codec_params.time_base;
    let sr = track.codec_params.sample_rate.unwrap_or(44_100).max(1) as u64;
    let total_secs = track.codec_params.n_frames.map(|n| n as f64 / sr as f64).unwrap_or(0.0);
    let mut dec = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|_| "This audio format can't be read for syncing.".to_string())?;

    // Start where you're listening: jump there first, go to the end, then come back and do the beginning.
    let mut wrapped = true;
    if first > 1.0 && tb.is_some() && format.seek(SeekMode::Accurate, SeekTo::Time { time: Time::from(first), track_id: Some(tid) }).is_ok() {
        dec.reset();
        wrapped = false;
    }

    // Several copies of the recognizer work at once, each on its own stretch of the audio:
    // on a PC with many cores that's much faster than one copy using them all.
    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
    let workers = (cores / 4).clamp(1, 5);
    let threads = (cores / workers).clamp(1, 4);
    let abort = Arc::new(AtomicBool::new(false));
    let (job_tx, job_rx) = mpsc::sync_channel::<(usize, f64, PathBuf)>(workers);
    let job_rx = Arc::new(Mutex::new(job_rx));
    let (res_tx, res_rx) = mpsc::channel::<(usize, Result<Vec<(u32, String)>, String>)>();
    let mut pool = Vec::new();
    for _ in 0..workers {
        let (rx, tx, abort) = (job_rx.clone(), res_tx.clone(), abort.clone());
        let (exe, model, work) = (exe.to_path_buf(), model.to_path_buf(), work.to_path_buf());
        pool.push(std::thread::spawn(move || loop {
            let job = match rx.lock() {
                Ok(r) => r.recv(),
                Err(_) => break,
            };
            let Ok((i, start, wav)) = job else { break };
            let out = recognize(&exe, &model, &work, &wav, i, start, threads, &abort);
            if tx.send((i, out)).is_err() {
                break;
            }
        }));
    }
    drop(res_tx);

    let mut results: Vec<Option<Vec<(u32, String)>>> = Vec::new();
    let mut starts: Vec<f64> = Vec::new();
    let mut piece_gaps: Vec<Vec<(u32, u32)>> = Vec::new();
    let mut kept: Vec<(f64, PathBuf, usize)> = Vec::new();
    let (mut sent, mut done) = (0usize, 0usize);
    let expected = if total_secs > 0.0 { (total_secs / CHUNK_SECS as f64).ceil() as usize } else { 0 };
    let collect = |r: (usize, Result<Vec<(u32, String)>, String>), done: &mut usize, results: &mut Vec<Option<Vec<(u32, String)>>>, piece_gaps: &Vec<Vec<(u32, u32)>>| -> Result<(), String> {
        let (i, words) = r;
        let words = words?;
        if results.len() <= i {
            results.resize(i + 1, None);
        }
        let empty: Vec<(u32, u32)> = Vec::new();
        let _ = app.emit("pk-sync-chunk", Piece { tag, words: &words, gaps: piece_gaps.get(i).unwrap_or(&empty) });
        results[i] = Some(words);
        *done += 1;
        let _ = app.emit("pk-sync-progress", Progress { stage: "listen", frac: (*done as f64 / expected.max(*done + 1) as f64).min(0.99) });
        Ok(())
    };
    let fail = |e: String, abort: &Arc<AtomicBool>| -> String {
        abort.store(true, Ordering::SeqCst);
        e
    };

    let mut pcm: Vec<i16> = Vec::with_capacity(CHUNK_SECS * RATE as usize);
    let mut chunk_start = 0.0f64;
    let (mut need_start, mut first_at, mut stop_at) = (true, 0.0f64, None::<f64>);
    // Mix to mono and step down to 16 kHz by averaging; plenty for speech recognition.
    let (mut acc, mut cnt, mut pos) = (0f32, 0u32, 0u64);
    loop {
        if STOP.load(Ordering::SeqCst) {
            return Err(fail(stopped(), &abort));
        }
        let mut ended = false;
        match format.next_packet() {
            Ok(packet) if packet.track_id() == tid => {
                if need_start {
                    // where this stretch begins in the file (after a jump, from the packet's own time)
                    if let Some(tb) = tb {
                        let t = tb.calc_time(packet.ts());
                        chunk_start = t.seconds as f64 + t.frac;
                    }
                    if !wrapped && stop_at.is_none() {
                        first_at = chunk_start;
                    }
                    need_start = false;
                }
                match dec.decode(&packet) {
                    Ok(decoded) => {
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
                    }
                    Err(SymErr::DecodeError(_)) => {}
                    Err(SymErr::IoError(_)) => ended = true,
                    Err(e) => return Err(fail(e.to_string(), &abort)),
                }
            }
            Ok(_) => {}
            Err(SymErr::IoError(_)) | Err(SymErr::ResetRequired) => ended = true,
            Err(e) => return Err(fail(e.to_string(), &abort)),
        }
        // On the second pass, stop where the first one began.
        let mut finish = ended;
        if let Some(s) = stop_at {
            if chunk_start + pcm.len() as f64 / RATE as f64 >= s {
                pcm.truncate(((s - chunk_start).max(0.0) * RATE as f64) as usize);
                finish = true;
            }
        }
        let full = pcm.len() >= CHUNK_SECS * RATE as usize;
        if full || (finish && pcm.len() > RATE as usize / 2) {
            let mut g = Vec::new();
            find_pauses(&pcm, chunk_start, &mut g);
            piece_gaps.push(g);
            starts.push(chunk_start);
            let wav = work.join(format!("chunk{sent}.wav"));
            write_wav(&wav, &pcm).map_err(|e| fail(e, &abort))?;
            kept.push((chunk_start, wav.clone(), pcm.len()));
            // Wait for a free worker, collecting finished pieces meanwhile.
            let mut job = Some((sent, chunk_start, wav));
            while let Some(j) = job.take() {
                match job_tx.try_send(j) {
                    Ok(()) => {}
                    Err(mpsc::TrySendError::Full(j)) => {
                        job = Some(j);
                        match res_rx.recv_timeout(Duration::from_millis(200)) {
                            Ok(r) => collect(r, &mut done, &mut results, &piece_gaps).map_err(|e| fail(e, &abort))?,
                            Err(mpsc::RecvTimeoutError::Timeout) => {}
                            Err(_) => return Err(fail("The speech engine stopped unexpectedly.".to_string(), &abort)),
                        }
                        if STOP.load(Ordering::SeqCst) {
                            return Err(fail(stopped(), &abort));
                        }
                    }
                    Err(_) => return Err(fail("The speech engine stopped unexpectedly.".to_string(), &abort)),
                }
            }
            sent += 1;
            chunk_start += pcm.len() as f64 / RATE as f64;
            pcm.clear();
        } else if finish {
            pcm.clear();
        }
        while let Ok(r) = res_rx.try_recv() {
            collect(r, &mut done, &mut results, &piece_gaps).map_err(|e| fail(e, &abort))?;
        }
        if finish {
            if !wrapped {
                wrapped = true;
                // Now the beginning of the file, up to where we started.
                if first_at > 1.0 && format.seek(SeekMode::Accurate, SeekTo::Time { time: Time::from(0.0), track_id: Some(tid) }).is_ok() {
                    dec.reset();
                    stop_at = Some(first_at);
                    need_start = true;
                    chunk_start = 0.0;
                    acc = 0.0;
                    cnt = 0;
                    pos = 0;
                    continue;
                }
            }
            break;
        }
    }
    drop(job_tx);
    while done < sent {
        if STOP.load(Ordering::SeqCst) {
            return Err(fail(stopped(), &abort));
        }
        match res_rx.recv_timeout(Duration::from_millis(200)) {
            Ok(r) => collect(r, &mut done, &mut results, &piece_gaps).map_err(|e| fail(e, &abort))?,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(_) => break,
        }
    }
    for h in pool {
        let _ = h.join();
    }
    let _ = app.emit("pk-sync-progress", Progress { stage: "listen", frac: 1.0 });
    // Put the stretches back in the order they come in the file.
    let mut order: Vec<usize> = (0..starts.len()).collect();
    order.sort_by(|a, b| starts[*a].partial_cmp(&starts[*b]).unwrap_or(std::cmp::Ordering::Equal));
    let mut words = Vec::new();
    let mut gaps = Vec::new();
    for i in order {
        if let Some(Some(w)) = results.get_mut(i).map(|x| x.take()) {
            words.extend(w);
        }
        if let Some(g) = piece_gaps.get(i) {
            gaps.extend_from_slice(g);
        }
    }
    Ok((Heard { words, gaps, job: String::new() }, kept))
}

/// The pauses in a stretch of audio: quiet for 0.15 s or more, as [start, end] in milliseconds
/// from the start of the file. Narrators pause between sentences, so a sentence starts where a pause ends.
fn find_pauses(pcm: &[i16], start: f64, out: &mut Vec<(u32, u32)>) {
    const FR: usize = 160; // 10 ms
    let db: Vec<f32> = pcm
        .chunks(FR)
        .filter(|c| c.len() == FR)
        .map(|c| 10.0 * ((c.iter().map(|&v| (v as f64) * (v as f64)).sum::<f64>() / FR as f64) + 1.0).log10() as f32)
        .collect();
    if db.len() < 100 {
        return;
    }
    let mut sorted = db.clone();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let (floor, loud) = (sorted[db.len() / 10], sorted[db.len() * 9 / 10]);
    let th = floor + (loud - floor) * 0.3;
    let base = start * 1000.0;
    let mut run: Option<usize> = None;
    for f in 0..=db.len() {
        let quiet = f < db.len() && db[f] < th;
        match (quiet, run) {
            (true, None) => run = Some(f),
            (false, Some(r)) => {
                if f - r >= 15 {
                    out.push(((base + r as f64 * 10.0) as u32, (base + f as f64 * 10.0) as u32));
                }
                run = None;
            }
            _ => {}
        }
    }
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

/// Run the recognizer on one stretch of audio; words come back with their time in the whole file.
fn recognize(exe: &Path, model: &Path, work: &Path, wav: &Path, i: usize, start: f64, threads: usize, abort: &AtomicBool) -> Result<Vec<(u32, String)>, String> {
    let words = run_whisper(exe, model, wav, &work.join(format!("chunk{i}")), &[], threads, abort)?;
    Ok(words.into_iter().map(|(from, t)| ((start * 1000.0 + from) as u32, t)).collect())
}

/// Run the recognizer on a wav file: each word with when it starts (milliseconds into the file).
fn run_whisper(exe: &Path, model: &Path, wav: &Path, base: &Path, extra: &[&str], threads: usize, abort: &AtomicBool) -> Result<Vec<(f64, String)>, String> {
    let json = base.with_extension("json");
    let _ = std::fs::remove_file(&json);
    let mut cmd = Command::new(exe);
    cmd.arg("-m").arg(model)
        .arg("-f").arg(wav)
        // -bs 1 -bo 1 -nf: take the first good guess for each word instead of comparing several.
        .args(["-l", "en", "-ml", "1", "-sow", "-oj", "-np", "-bs", "1", "-bo", "1", "-nf", "-t", &threads.to_string()])
        .args(extra)
        .arg("-of").arg(base)
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
        if STOP.load(Ordering::SeqCst) || abort.load(Ordering::SeqCst) {
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
            Ok(None) => std::thread::sleep(Duration::from_millis(100)),
            Err(e) => return Err(e.to_string()),
        }
    }
    let bytes = std::fs::read(&json).map_err(|_| "The speech engine didn't write any words.".to_string())?;
    let _ = std::fs::remove_file(&json);
    let v: serde_json::Value = serde_json::from_str(&String::from_utf8_lossy(&bytes)).map_err(|e| e.to_string())?;
    let mut words = Vec::new();
    if let Some(items) = v["transcription"].as_array() {
        for seg in items {
            let text = seg["text"].as_str().unwrap_or("").trim();
            if text.is_empty() {
                continue;
            }
            let from = seg["offsets"]["from"].as_f64().unwrap_or(0.0);
            words.push((from, text.to_string()));
        }
    }
    Ok(words)
}
