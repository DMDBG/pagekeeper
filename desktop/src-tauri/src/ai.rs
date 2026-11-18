// Web requests for AI recaps (Gemini, Groq, OpenRouter, Mistral, Ollama). They go through the app
// rather than the reader page, so services that don't accept requests from web pages still work.
// Only secure (https) addresses, or Ollama running on this PC.
use serde::Serialize;
use std::time::Duration;

#[derive(Serialize)]
pub struct HttpOut {
    status: u16,
    text: String,
}

fn allowed(url: &str) -> bool {
    let u = url.to_ascii_lowercase();
    u.starts_with("https://") || u.starts_with("http://localhost:") || u.starts_with("http://127.0.0.1:")
}

#[tauri::command]
pub async fn pk_http(method: String, url: String, headers: Vec<(String, String)>, body: Option<String>) -> Result<HttpOut, String> {
    if !allowed(&url) {
        return Err("That address isn't allowed.".to_string());
    }
    let client = reqwest::Client::builder()
        .user_agent("Pagekeeper/1.0 (ebook reader)")
        .timeout(Duration::from_secs(600)) // a local model can take a while on a long chapter
        .build()
        .map_err(|e| e.to_string())?;
    let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
    let mut req = client.request(method, &url);
    for (k, v) in headers {
        req = req.header(k, v);
    }
    if let Some(b) = body {
        req = req.body(b);
    }
    let resp = req.send().await.map_err(|e| {
        if e.is_connect() && url.contains("localhost") {
            "Couldn't reach Ollama on this PC. Is it running?".to_string()
        } else {
            e.to_string()
        }
    })?;
    let status = resp.status().as_u16();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    Ok(HttpOut { status, text })
}
