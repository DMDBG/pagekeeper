// Send audiobooks from this PC to your iPhone over your home Wi-Fi, with no account storage
// and no size limit. The reader page copies a book's audio files into a sharing folder, and a
// small web server on this PC hands them to Pagekeeper on your phone. Only devices on the same
// network can reach it, and every request needs the 6-digit code shown on the PC.
use serde::Serialize;
use std::fs::{File, OpenOptions};
use std::io::{Seek, SeekFrom, Write};
use std::net::UdpSocket;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};
use tiny_http::{Header, Response, Server, StatusCode};

const PORTS: std::ops::RangeInclusive<u16> = 47811..=47820;
static RUNNING: Mutex<Option<(Arc<Server>, u16)>> = Mutex::new(None);

#[derive(Serialize)]
pub struct ShareInfo {
    ip: String,
    port: u16,
    code: String,
}

fn share_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("pkshare");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// The code stays the same between runs, so the phone only has to be told it once.
fn share_code(app: &AppHandle) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let f = dir.join("wifi-code.txt");
    if let Ok(c) = std::fs::read_to_string(&f) {
        let c = c.trim().to_string();
        if c.len() == 6 && c.chars().all(|x| x.is_ascii_digit()) {
            return Ok(c);
        }
    }
    let b = uuid::Uuid::new_v4().as_u128();
    let c = format!("{:06}", (b % 1_000_000) as u32);
    std::fs::write(&f, &c).map_err(|e| e.to_string())?;
    Ok(c)
}

/// This PC's address on the home network (no data is sent; this just asks Windows which
/// network card it would use).
fn local_ip() -> String {
    UdpSocket::bind("0.0.0.0:0")
        .and_then(|s| {
            s.connect("192.168.0.1:9")?;
            s.local_addr()
        })
        .map(|a| a.ip().to_string())
        .unwrap_or_else(|_| "this PC's address".to_string())
}

fn safe_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > 120 || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.') || name.contains("..") {
        Err("Unknown file.".to_string())
    } else {
        Ok(())
    }
}

fn header(k: &str, v: &str) -> Header {
    Header::from_bytes(k.as_bytes(), v.as_bytes()).expect("valid header")
}

fn serve(server: Arc<Server>, dir: PathBuf, code: String) {
    let mut wrong = 0u32;
    for req in server.incoming_requests() {
        let url = req.url().to_string();
        let (path, query) = url.split_once('?').unwrap_or((url.as_str(), ""));
        let given = query.split('&').find_map(|kv| kv.strip_prefix("c=")).unwrap_or("");
        if wrong >= 30 {
            let _ = req.respond(Response::from_string("Too many wrong codes. Restart sharing on the PC.").with_status_code(403));
            continue;
        }
        if given != code {
            wrong += 1;
            let _ = req.respond(Response::from_string("Wrong code.").with_status_code(403));
            continue;
        }
        if path == "/pk/list" {
            let body = std::fs::read_to_string(dir.join("list.json")).unwrap_or_else(|_| "{\"books\":{}}".to_string());
            let _ = req.respond(Response::from_string(body).with_header(header("Content-Type", "application/json")));
        } else if let Some(name) = path.strip_prefix("/pk/f/") {
            match safe_name(name).ok().and_then(|_| File::open(dir.join(name)).ok()) {
                Some(mut f) => {
                    // Send the size up front (so the phone shows real progress), and let a dropped
                    // download pick up where it stopped ("Range"), with a tag that says it's the same file.
                    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
                    let mtime = f
                        .metadata()
                        .ok()
                        .and_then(|m| m.modified().ok())
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    let etag = format!("\"{len}-{mtime}\"");
                    let from = req
                        .headers()
                        .iter()
                        .find(|h| h.field.equiv("Range"))
                        .and_then(|h| h.value.as_str().strip_prefix("bytes=").map(|r| r.to_string()))
                        .and_then(|r| r.split('-').next().and_then(|n| n.trim().parse::<u64>().ok()))
                        .filter(|n| *n > 0 && *n < len);
                    let mut headers = vec![
                        header("Content-Type", "application/octet-stream"),
                        header("Content-Disposition", &format!("attachment; filename=\"{name}\"")),
                        header("Accept-Ranges", "bytes"),
                        header("ETag", &etag),
                    ];
                    let (status, start) = match from {
                        Some(n) if f.seek(SeekFrom::Start(n)).is_ok() => {
                            headers.push(header("Content-Range", &format!("bytes {n}-{}/{len}", len - 1)));
                            (206, n)
                        }
                        _ => (200, 0),
                    };
                    let resp = Response::new(StatusCode(status), headers, f, Some((len - start) as usize), None)
                        .with_chunked_threshold(usize::MAX);
                    let _ = req.respond(resp);
                }
                None => {
                    let _ = req.respond(Response::from_string("Not shared.").with_status_code(404));
                }
            }
        } else {
            let _ = req.respond(Response::from_string("Pagekeeper").with_status_code(404));
        }
    }
}

/// Start sharing (if it isn't already) and say how the phone can reach this PC.
#[tauri::command]
pub fn pk_share_start(app: AppHandle) -> Result<ShareInfo, String> {
    let code = share_code(&app)?;
    let mut run = RUNNING.lock().map_err(|e| e.to_string())?;
    if let Some((_, port)) = run.as_ref() {
        return Ok(ShareInfo { ip: local_ip(), port: *port, code });
    }
    let dir = share_dir(&app)?;
    let mut last = String::new();
    for port in PORTS {
        match Server::http(("0.0.0.0", port)) {
            Ok(s) => {
                let s = Arc::new(s);
                let (s2, d2, c2) = (s.clone(), dir.clone(), code.clone());
                std::thread::spawn(move || serve(s2, d2, c2));
                *run = Some((s, port));
                return Ok(ShareInfo { ip: local_ip(), port, code });
            }
            Err(e) => last = e.to_string(),
        }
    }
    Err(format!("Couldn't start Wi-Fi sharing: {last}"))
}

/// Stop sharing and delete the shared copies.
#[tauri::command]
pub fn pk_share_stop(app: AppHandle) -> Result<(), String> {
    if let Ok(mut run) = RUNNING.lock() {
        if let Some((s, _)) = run.take() {
            s.unblock();
        }
    }
    let dir = share_dir(&app)?;
    let _ = std::fs::remove_dir_all(&dir);
    Ok(())
}

/// Is this file already shared, at this size? (So sharing a book again doesn't copy it again.)
#[tauri::command]
pub fn pk_share_has(app: AppHandle, name: String, size: u64) -> Result<bool, String> {
    safe_name(&name)?;
    Ok(std::fs::metadata(share_dir(&app)?.join(&name)).map(|m| m.len() == size).unwrap_or(false))
}

/// Start (or restart) a shared file.
#[tauri::command]
pub fn pk_share_begin(app: AppHandle, name: String) -> Result<(), String> {
    safe_name(&name)?;
    File::create(share_dir(&app)?.join(&name)).map(|_| ()).map_err(|e| e.to_string())
}

/// Add the next piece of a shared file (raw bytes, name in the "x-file" header).
#[tauri::command]
pub fn pk_share_chunk(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let name = request
        .headers()
        .get("x-file")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| "Missing file name.".to_string())?
        .to_string();
    safe_name(&name)?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected the file's bytes.".to_string());
    };
    let mut f = OpenOptions::new().append(true).open(share_dir(&app)?.join(&name)).map_err(|e| e.to_string())?;
    f.write_all(bytes).map_err(|e| e.to_string())
}

/// The list of shared books and their audio parts, as the phone sees it.
#[tauri::command]
pub fn pk_share_list(app: AppHandle, json: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&json).map_err(|e| e.to_string())?;
    std::fs::write(share_dir(&app)?.join("list.json"), json).map_err(|e| e.to_string())
}
