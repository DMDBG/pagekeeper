// Pagekeeper for Windows: the same reader as the iPhone app, in its own window.
// The reader page (web/) is built into the program, so it opens with no internet.
// These commands let it fetch catalogs and download files directly, and open websites
// in a Pagekeeper browser window whose downloads go straight into the library.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use futures_util::StreamExt;
use serde::Serialize;
use std::io::Write;
use std::path::PathBuf;
use tauri::webview::DownloadEvent;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Serialize, Clone)]
struct FileInfo {
    token: String,
    name: String,
    r#type: String,
    size: u64,
    url: String,
}

#[derive(Serialize)]
struct TextResponse {
    status: u16,
    text: String,
    url: String,
}

fn downloads_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("pkdl");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("Pagekeeper/1.0 (Windows; ebook reader)")
        .build()
        .map_err(|e| e.to_string())
}

fn web_url(s: &str) -> Result<tauri::Url, String> {
    let url = tauri::Url::parse(s).map_err(|_| "That isn't a web address.".to_string())?;
    match url.scheme() {
        "http" | "https" => Ok(url),
        _ => Err("That isn't a web address.".to_string()),
    }
}

fn safe_name(s: &str) -> String {
    let cleaned: String = s
        .chars()
        .map(|c| if "\\/:*?\"<>|".contains(c) || c.is_control() { '_' } else { c })
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').to_string();
    if cleaned.is_empty() { "download".to_string() } else { cleaned }
}

fn decode(s: &str) -> String {
    percent_encoding::percent_decode_str(s).decode_utf8_lossy().to_string()
}

/// File name from Content-Disposition, or else the last part of the address.
fn file_name(resp: &reqwest::Response) -> String {
    if let Some(cd) = resp
        .headers()
        .get(reqwest::header::CONTENT_DISPOSITION)
        .and_then(|v| v.to_str().ok())
    {
        for part in cd.split(';').map(str::trim) {
            if let Some(v) = part.strip_prefix("filename*=") {
                let v = v.trim_matches('"');
                let v = v.split("''").last().unwrap_or(v);
                return safe_name(&decode(v));
            }
        }
        for part in cd.split(';').map(str::trim) {
            if let Some(v) = part.strip_prefix("filename=") {
                return safe_name(v.trim_matches('"'));
            }
        }
    }
    let last = resp
        .url()
        .path_segments()
        .and_then(|mut s| s.next_back())
        .unwrap_or("download");
    safe_name(&decode(last))
}

/// Fetch a catalog page (OPDS, JSON) as text.
#[tauri::command]
async fn pk_text(url: String) -> Result<TextResponse, String> {
    let url = web_url(&url)?;
    let resp = client()?.get(url.as_str()).send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let final_url = resp.url().to_string();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    Ok(TextResponse { status, text, url: final_url })
}

/// Download a file into the app's cache, reporting progress as "pk-progress" events.
#[tauri::command]
async fn pk_file(app: AppHandle, url: String, id: Option<String>) -> Result<FileInfo, String> {
    let url = web_url(&url)?;
    let resp = client()?.get(url.as_str()).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("The site said {}.", resp.status().as_u16()));
    }
    let total = resp.content_length();
    let mime = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_string();
    let name = file_name(&resp);
    let final_url = resp.url().to_string();
    let token = uuid::Uuid::new_v4().to_string();
    let dir = downloads_dir(&app)?.join(&token);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut file = std::fs::File::create(dir.join(&name)).map_err(|e| e.to_string())?;

    let mut stream = resp.bytes_stream();
    let mut got: u64 = 0;
    let mut last = 0.0_f64;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        got += chunk.len() as u64;
        if let (Some(id), Some(total)) = (&id, total) {
            let frac = got as f64 / total.max(1) as f64;
            if frac - last >= 0.02 {
                last = frac;
                let _ = app.emit("pk-progress", serde_json::json!({ "id": id, "frac": frac }));
            }
        }
    }
    Ok(FileInfo { token, name, r#type: mime, size: got, url: final_url })
}

fn token_dir(app: &AppHandle, token: &str) -> Result<PathBuf, String> {
    if token.is_empty() || token.contains('/') || token.contains('\\') || token.contains("..") {
        return Err("Unknown download.".to_string());
    }
    Ok(downloads_dir(app)?.join(token))
}

/// Hand a finished download to the page as raw bytes.
#[tauri::command]
fn pk_read(app: AppHandle, token: String) -> Result<tauri::ipc::Response, String> {
    let dir = token_dir(&app, &token)?;
    let entry = std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .next()
        .ok_or_else(|| "The download went missing.".to_string())?
        .map_err(|e| e.to_string())?;
    let bytes = std::fs::read(entry.path()).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// The page has imported the file; delete our copy.
#[tauri::command]
fn pk_done(app: AppHandle, token: String) -> Result<(), String> {
    let dir = token_dir(&app, &token)?;
    let _ = std::fs::remove_dir_all(dir);
    Ok(())
}

/// Open a website in Pagekeeper's browser window. Downloads there go to the library.
#[tauri::command]
async fn pk_browse(app: AppHandle, url: String) -> Result<(), String> {
    let url = web_url(&url)?;
    if let Some(win) = app.get_webview_window("browser") {
        win.navigate(url).map_err(|e| e.to_string())?;
        let _ = win.unminimize();
        let _ = win.set_focus();
        return Ok(());
    }
    let handle = app.clone();
    WebviewWindowBuilder::new(&app, "browser", WebviewUrl::External(url))
        .title("Pagekeeper · Browse")
        .inner_size(1100.0, 820.0)
        .on_download(move |_webview, event| {
            match event {
                DownloadEvent::Requested { destination, .. } => {
                    let name = destination
                        .file_name()
                        .map(|n| safe_name(&n.to_string_lossy()))
                        .unwrap_or_else(|| "download".to_string());
                    if let Ok(base) = downloads_dir(&handle) {
                        let dir = base.join(uuid::Uuid::new_v4().to_string());
                        if std::fs::create_dir_all(&dir).is_ok() {
                            *destination = dir.join(name);
                        }
                    }
                }
                DownloadEvent::Finished { url, path, success } => {
                    if let (true, Some(path)) = (success, path) {
                        let token = path
                            .parent()
                            .and_then(|p| p.file_name())
                            .map(|t| t.to_string_lossy().to_string())
                            .unwrap_or_default();
                        let name = path
                            .file_name()
                            .map(|n| n.to_string_lossy().to_string())
                            .unwrap_or_default();
                        let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                        let _ = handle.emit_to(
                            "main",
                            "pk-received",
                            FileInfo { token, name, r#type: String::new(), size, url: url.to_string() },
                        );
                        if let Some(main) = handle.get_webview_window("main") {
                            let _ = main.set_focus();
                        }
                    }
                }
                _ => {}
            }
            true
        })
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// The pop-out text: a borderless, always-on-top window you can drag anywhere.
#[tauri::command]
async fn pk_caption(app: AppHandle, show: bool) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("caption") {
        if show {
            let _ = win.show();
        } else {
            let _ = win.close();
        }
        return Ok(());
    }
    if !show {
        return Ok(());
    }
    WebviewWindowBuilder::new(&app, "caption", WebviewUrl::App("caption.html".into()))
        .title("Pagekeeper text")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(true)
        .focused(false)
        .inner_size(560.0, 150.0)
        .min_inner_size(180.0, 56.0)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .on_window_event(|window, event| {
            // Closing the main window quits Pagekeeper, pop-out and browser windows included.
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { .. } = event {
                    window.app_handle().exit(0);
                }
            }
        })
        .setup(|app| {
            // Clear leftovers from the last run.
            if let Ok(dir) = app.path().app_cache_dir() {
                let _ = std::fs::remove_dir_all(dir.join("pkdl"));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![pk_text, pk_file, pk_read, pk_done, pk_browse, pk_caption])
        .run(tauri::generate_context!())
        .expect("error while running Pagekeeper");
}
