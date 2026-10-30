//! Debug-only UI automation endpoint.
//!
//! Tauri has no WebDriver on macOS (WKWebView), so UI tests drive the real
//! webview through this endpoint instead. Started only in debug builds and
//! only when `CHATSHELL_UI_AUTOMATION_PORT` is set; it binds 127.0.0.1.
//!
//! - `POST /eval[?timeout_ms=N]`: the body is the body of an async
//!   JavaScript function. It runs in the main webview; its return value
//!   (JSON-serializable) or thrown error comes back as
//!   `{"ok": bool, "value": ...}`.
//! - `POST /window`: `{"width": w, "height": h}` sets the main window's
//!   logical size.
//! - `GET /health`: `{"ok": true}`.
//!
//! Results travel back from the page as `POST /result` (a `text/plain`
//! JSON body, so no CORS preflight) keyed by a request id.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{Value, json};
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;

const PORT_ENV: &str = "CHATSHELL_UI_AUTOMATION_PORT";
const DEFAULT_TIMEOUT_MS: u64 = 30_000;

type Pending = Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>;

/// Start the endpoint when the port variable is set. No-op otherwise.
pub fn start(app: &AppHandle) {
    let Ok(port) = std::env::var(PORT_ENV) else {
        return;
    };
    let Ok(port) = port.parse::<u16>() else {
        tracing::warn!("[ui-automation] invalid {PORT_ENV}: {port}");
        return;
    };

    let pending: Pending = Arc::new(Mutex::new(HashMap::new()));

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let listener = match TcpListener::bind(("127.0.0.1", port)).await {
            Ok(listener) => listener,
            Err(e) => {
                tracing::warn!("[ui-automation] cannot bind 127.0.0.1:{port}: {e}");
                return;
            }
        };
        tracing::info!("[ui-automation] listening on 127.0.0.1:{port}");
        loop {
            let Ok((stream, _)) = listener.accept().await else {
                continue;
            };
            let app = app.clone();
            let pending = pending.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = handle(stream, app, pending, port).await {
                    tracing::warn!("[ui-automation] request failed: {e}");
                }
            });
        }
    });
}

struct Request {
    method: String,
    path: String,
    query: HashMap<String, String>,
    body: String,
}

async fn read_request(stream: &mut TcpStream) -> std::io::Result<Request> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];
    let header_end = loop {
        let n = stream.read(&mut chunk).await?;
        if n == 0 {
            return Err(std::io::Error::other("connection closed before headers"));
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break pos + 4;
        }
    };
    let head = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let mut lines = head.split("\r\n");
    let mut request_line = lines.next().unwrap_or_default().split_whitespace();
    let method = request_line.next().unwrap_or_default().to_string();
    let target = request_line.next().unwrap_or("/").to_string();
    let content_length = lines
        .filter_map(|line| line.split_once(':'))
        .find(|(name, _)| name.trim().eq_ignore_ascii_case("content-length"))
        .and_then(|(_, value)| value.trim().parse::<usize>().ok())
        .unwrap_or(0);

    let mut body = buf[header_end..].to_vec();
    while body.len() < content_length {
        let n = stream.read(&mut chunk).await?;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..n]);
    }

    let (path, query) = match target.split_once('?') {
        Some((path, query)) => (path.to_string(), query),
        None => (target.clone(), ""),
    };
    let query = query
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    Ok(Request {
        method,
        path,
        query,
        body: String::from_utf8_lossy(&body).to_string(),
    })
}

async fn respond(stream: &mut TcpStream, status: u16, body: &Value) -> std::io::Result<()> {
    let body = body.to_string();
    let reason = if status == 200 { "OK" } else { "Error" };
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(response.as_bytes()).await?;
    stream.flush().await
}

async fn handle(
    mut stream: TcpStream,
    app: AppHandle,
    pending: Pending,
    port: u16,
) -> std::io::Result<()> {
    let request = read_request(&mut stream).await?;
    tracing::debug!("[ui-automation] {} {}", request.method, request.path);
    match (request.method.as_str(), request.path.as_str()) {
        ("POST", "/result") => {
            let payload: Value = serde_json::from_str(&request.body).unwrap_or(Value::Null);
            let id = payload
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if let Some(tx) = pending.lock().ok().and_then(|mut map| map.remove(id)) {
                let _ = tx.send(payload);
            }
            respond(&mut stream, 200, &json!({ "ok": true })).await
        }
        ("GET", "/health") => respond(&mut stream, 200, &json!({ "ok": true })).await,
        ("POST", "/eval") => {
            let timeout_ms = request
                .query
                .get("timeout_ms")
                .and_then(|v| v.parse::<u64>().ok())
                .unwrap_or(DEFAULT_TIMEOUT_MS);
            let result = eval(&app, &pending, &request.body, timeout_ms, port).await;
            respond(&mut stream, 200, &result).await
        }
        ("POST", "/window") => {
            let size: Value = serde_json::from_str(&request.body).unwrap_or(Value::Null);
            let (Some(width), Some(height)) = (
                size.get("width").and_then(Value::as_f64),
                size.get("height").and_then(Value::as_f64),
            ) else {
                return respond(
                    &mut stream,
                    400,
                    &json!({ "ok": false, "value": "width/height" }),
                )
                .await;
            };
            let result = match app.get_webview_window("main") {
                Some(window) => window
                    .set_size(tauri::LogicalSize::new(width, height))
                    .map(|_| json!({ "ok": true }))
                    .unwrap_or_else(|e| json!({ "ok": false, "value": e.to_string() })),
                None => json!({ "ok": false, "value": "no main window" }),
            };
            respond(&mut stream, 200, &result).await
        }
        _ => {
            respond(
                &mut stream,
                404,
                &json!({ "ok": false, "value": "not found" }),
            )
            .await
        }
    }
}

async fn eval(app: &AppHandle, pending: &Pending, body: &str, timeout_ms: u64, port: u16) -> Value {
    let Some(window) = app.get_webview_window("main") else {
        return json!({ "ok": false, "value": "no main window" });
    };
    let id = uuid::Uuid::now_v7().to_string();
    let (tx, rx) = oneshot::channel();
    if let Ok(mut map) = pending.lock() {
        map.insert(id.clone(), tx);
    }

    let id_literal = serde_json::to_string(&id).unwrap_or_default();
    let script = format!(
        r#"(async () => {{
  const report = (ok, value) =>
    fetch('http://127.0.0.1:{port}/result', {{
      method: 'POST',
      headers: {{ 'Content-Type': 'text/plain' }},
      body: JSON.stringify({{ id: {id_literal}, ok, value }}),
    }});
  try {{
    const value = await (async () => {{
{body}
    }})();
    await report(true, value === undefined ? null : value);
  }} catch (error) {{
    await report(false, String((error && error.stack) || error));
  }}
}})();"#
    );
    if let Err(e) = window.eval(&script) {
        if let Ok(mut map) = pending.lock() {
            map.remove(&id);
        }
        return json!({ "ok": false, "value": e.to_string() });
    }

    match tokio::time::timeout(Duration::from_millis(timeout_ms), rx).await {
        Ok(Ok(payload)) => json!({ "ok": payload["ok"], "value": payload["value"] }),
        _ => {
            if let Ok(mut map) = pending.lock() {
                map.remove(&id);
            }
            json!({ "ok": false, "value": format!("timed out after {timeout_ms} ms") })
        }
    }
}
