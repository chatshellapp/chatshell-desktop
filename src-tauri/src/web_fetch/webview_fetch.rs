//! System-WebView browser tier for web fetch and search.
//!
//! Uses the OS webview engine already required by Tauri (WKWebView on macOS,
//! WebView2 on Windows, WebKitGTK on Linux) through hidden `WebviewWindow`s:
//! zero added binary size, no external process, real-engine fidelity. This is
//! the desktop counterpart of the iOS app's WKWebView fetch path.
//!
//! Flow: a hidden webview navigates to the target URL; an initialization
//! script waits for load plus a DOM-quiet window, then delivers
//! `document.documentElement.outerHTML` back to Rust over the platform's
//! delivery channel (see `Delivery`): a `WKScriptMessageHandler` on macOS,
//! a POST to the `chatshell-wvf://` custom protocol registered in `lib.rs`
//! on Windows/Linux.
//!
//! Ordering inside the script tier: challenge pages (Cloudflare interstitials)
//! deliver early; their HTML is detected and ignored, and the same webview
//! re-delivers once the challenge navigates to the real document.
//!
//! Concurrency is bounded (`MAX_CONCURRENT`) because each webview spawns an
//! engine content process; excess callers queue on the semaphore.

use std::collections::HashMap;
use std::sync::LazyLock;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use anyhow::{Context, Result};
use parking_lot::Mutex;
use tauri::Manager;
use tauri::webview::WebviewWindowBuilder;
use tokio::sync::{Semaphore, mpsc};

/// Custom URI scheme that carries rendered HTML from the page back to Rust.
pub const SCHEME: &str = "chatshell-wvf";

const MAX_CONCURRENT: usize = 2;
const DEFAULT_TIMEOUT_SECS: u64 = 25;
/// Hard cap inside the page: deliver whatever exists by then, so slow pages
/// still return before the Rust-side timeout tears the webview down.
const PAGE_DELIVERY_CAP_MS: u64 = 8_000;
/// DOM-quiet window: deliver after this long without DOM mutations.
const DOM_QUIET_MS: u64 = 600;
/// Name of the WKScriptMessageHandler the injected script delivers HTML
/// through on macOS (see `wkwebview_delivery`).
pub(crate) const HANDLER_NAME: &str = "chatshellWvf";

static APP: LazyLock<Mutex<Option<tauri::AppHandle>>> = LazyLock::new(|| Mutex::new(None));
static SLOTS: LazyLock<Mutex<HashMap<String, mpsc::UnboundedSender<String>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static SEM: LazyLock<Semaphore> = LazyLock::new(|| Semaphore::new(MAX_CONCURRENT));
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

/// Substrings that mark a bot-challenge interstitial rather than real content.
const CHALLENGE_INDICATORS: [&str; 5] = [
    "Just a moment",
    "Verifying",
    "checking your browser",
    "Please wait",
    "Checking if the site",
];

/// Store the app handle once at startup (called from `lib.rs` setup).
pub fn set_app_handle(app: tauri::AppHandle) {
    let mut slot = APP.lock();
    if slot.is_none() {
        *slot = Some(app);
    }
}

fn app_handle() -> Option<tauri::AppHandle> {
    APP.lock().clone()
}

/// Whether this tier can run (app handle registered). Cheap.
pub fn is_available() -> bool {
    app_handle().is_some()
}

/// How the injected script hands the rendered HTML back to Rust.
///
/// - `MessageHandler` (macOS): `window.webkit.messageHandlers` postMessage.
///   WebKit refuses page-initiated fetch/XHR to custom URL schemes and
///   blocks mixed-content `http://127.0.0.1` targets, so neither the
///   custom protocol nor a local HTTP relay can deliver from an https
///   page; script message handlers bypass the network stack entirely.
/// - `FetchPost` (Windows/Linux): POST to the custom protocol origin,
///   which WebView2 and WebKitGTK do serve to page fetches.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Delivery {
    MessageHandler,
    FetchPost(String),
}

fn delivery_for_platform() -> Delivery {
    if cfg!(target_os = "macos") {
        Delivery::MessageHandler
    } else {
        Delivery::FetchPost(protocol_base_url())
    }
}

/// Build the script injected into every page the fetch webview loads.
/// Pure so tests can assert on it.
pub(crate) fn build_injection_script(id: &str, delivery: &Delivery) -> String {
    let send_body = match delivery {
        Delivery::MessageHandler => format!(
            r#"try {{
  window.webkit.messageHandlers[{name_json}].postMessage(
    JSON.stringify({{ id: ID, html: document.documentElement.outerHTML }})
  );
  sent = true;
  if (quiet) clearTimeout(quiet);
  if (cap) clearTimeout(cap);
}} catch (e) {{
  // The handler is registered on the main thread right after the webview
  // is built; retry briefly in case the page beat the registration.
  if (++tries < 20) setTimeout(send, 50);
}}"#,
            name_json = serde_json::to_string(HANDLER_NAME).unwrap(),
        ),
        Delivery::FetchPost(base) => format!(
            r#"sent = true;
if (quiet) clearTimeout(quiet);
if (cap) clearTimeout(cap);
try {{
  fetch({base_json} + '/done?id=' + ID, {{
    method: 'POST',
    mode: 'no-cors',
    headers: {{ 'Content-Type': 'text/plain' }},
    body: document.documentElement.outerHTML
  }});
}} catch (e) {{
  // The Rust-side timeout tears the webview down either way.
}}"#,
            base_json = serde_json::to_string(base).unwrap(),
        ),
    };

    format!(
        r#"(function() {{
  if (window.__CHATSELL_WVF__) return;
  window.__CHATSELL_WVF__ = 1;
  var ID = {id_json};
  var quiet = null;
  var cap = null;
  var sent = false;
  var tries = 0;
  function send() {{
{send_body}
  }}
  function arm() {{
    if (quiet) clearTimeout(quiet);
    quiet = setTimeout(send, {dom_quiet_ms});
  }}
  cap = setTimeout(send, {cap_ms});
  function wait() {{
    if (document.readyState === 'complete') {{
      arm();
      try {{
        new MutationObserver(arm).observe(document.documentElement, {{
          childList: true,
          subtree: true,
          characterData: true
        }});
      }} catch (e) {{
        // Observer unavailable: the quiet timer and hard cap still fire.
      }}
    }} else {{
      setTimeout(wait, 100);
    }}
  }}
  wait();
}})();
"#,
        id_json = serde_json::to_string(id).unwrap(),
        send_body = send_body,
        dom_quiet_ms = DOM_QUIET_MS,
        cap_ms = PAGE_DELIVERY_CAP_MS,
    )
}

/// Origin the injected script POSTs HTML to on Windows/Linux. Windows serves
/// custom protocols over an http loopback host; Linux uses the bare scheme.
/// (macOS delivers through `wkwebview_delivery` instead.)
pub(crate) fn protocol_base_url() -> String {
    if cfg!(windows) {
        format!("http://{}.localhost", SCHEME)
    } else {
        format!("{}://localhost", SCHEME)
    }
}

fn is_challenge_html(html: &str) -> bool {
    CHALLENGE_INDICATORS.iter().any(|ind| html.contains(ind))
}

/// Fetch a fully rendered page's HTML through a hidden system webview.
pub async fn fetch_html(url: &str) -> Result<String> {
    let app = app_handle().context("webview tier unavailable: no app handle")?;
    let _permit = SEM.acquire().await.expect("semaphore never closed");

    let id = format!(
        "wvf-{}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0),
        NEXT_ID.fetch_add(1, Ordering::Relaxed)
    );
    let label = id.clone();
    let (tx, mut rx) = mpsc::unbounded_channel();
    SLOTS.lock().insert(id.clone(), tx);

    let result = run_fetch(&app, &id, &label, url, &mut rx).await;

    // Always release the slot and tear the webview down.
    SLOTS.lock().remove(&id);
    let app_for_cleanup = app.clone();
    let label_for_cleanup = label.clone();
    let cleanup = move || {
        if let Some(window) = app_for_cleanup.get_webview_window(&label_for_cleanup) {
            let _ = window.clear_all_browsing_data();
            let _ = window.close();
        }
    };
    let _ = app.run_on_main_thread(cleanup);

    result
}

async fn run_fetch(
    app: &tauri::AppHandle,
    id: &str,
    label: &str,
    url: &str,
    rx: &mut mpsc::UnboundedReceiver<String>,
) -> Result<String> {
    let target =
        tauri::WebviewUrl::External(url::Url::parse(url).context("invalid URL for webview fetch")?);
    let delivery = delivery_for_platform();
    let script = build_injection_script(id, &delivery);

    tracing::info!("[webview] Fetching {} via hidden webview", url);

    // Webview creation dispatches to the app's main event loop internally.
    let window = WebviewWindowBuilder::new(app, label, target)
        .visible(false)
        .skip_taskbar(true)
        .initialization_script(script)
        .build()
        .with_context(|| format!("failed to create fetch webview for {}", url))?;

    // Register the macOS message-handler delivery channel before the page's
    // quiet timer can fire (the injected script retries across the race).
    #[cfg(target_os = "macos")]
    super::wkwebview_delivery::attach(app, label);

    let _ = window; // kept alive by the app until cleanup closes it

    let deadline = tokio::time::Instant::now()
        + Duration::from_secs(
            std::env::var("CHATSHELL_WEBVIEW_TIMEOUT_SECS")
                .ok()
                .and_then(|v| v.trim().parse::<u64>().ok())
                .unwrap_or(DEFAULT_TIMEOUT_SECS)
                .max(5),
        );

    // First delivery may be a challenge interstitial; keep waiting while the
    // same webview resolves the challenge and re-delivers real content.
    loop {
        let html = match tokio::time::timeout_at(deadline, rx.recv()).await {
            Ok(Some(html)) => html,
            Ok(None) => anyhow::bail!("webview delivery channel closed"),
            Err(_) => anyhow::bail!("webview fetch timed out"),
        };
        if !html.trim().is_empty() && !is_challenge_html(&html) {
            tracing::info!("[webview] Fetched {} bytes of HTML for {}", html.len(), url);
            return Ok(html);
        }
        tracing::info!("[webview] Ignoring empty/challenge delivery for {}", url);
    }
}
/// Entry point for the `chatshell-wvf` protocol handler in `lib.rs`
/// (Windows/Linux delivery path). Returns the response body the protocol
/// should answer with.
pub fn deliver(uri: &str, body: &[u8]) -> &'static str {
    let Some(id) = extract_id(uri) else {
        tracing::warn!("[webview] Delivery without id: {}", uri);
        return "ignored";
    };
    route_delivery(&id, String::from_utf8_lossy(body).to_string())
}

/// Entry point for the macOS `WKScriptMessageHandler` delivery path; the
/// payload is the JSON the injected script builds.
#[cfg(target_os = "macos")]
pub(crate) fn deliver_message(payload: &str) -> &'static str {
    match serde_json::from_str::<DeliveredPage>(payload) {
        Ok(page) => route_delivery(&page.id, page.html),
        Err(error) => {
            tracing::warn!("[webview] Malformed message-handler delivery: {}", error);
            "ignored"
        }
    }
}

#[cfg(target_os = "macos")]
#[derive(serde::Deserialize)]
struct DeliveredPage {
    id: String,
    html: String,
}

/// Push delivered HTML into the waiting fetch. The sender stays registered:
/// challenge pages re-deliver later.
fn route_delivery(id: &str, html: String) -> &'static str {
    let slots = SLOTS.lock();
    if let Some(tx) = slots.get(id) {
        let _ = tx.send(html);
        "ok"
    } else {
        tracing::warn!("[webview] Delivery for unknown id: {}", id);
        "unknown"
    }
}

fn extract_id(uri: &str) -> Option<String> {
    uri.split("id=")
        .nth(1)
        .map(|rest| rest.split('&').next().unwrap_or_default().to_string())
        .filter(|id| !id.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_injection_script_fetch_post_carries_id_and_base() {
        let js = build_injection_script(
            "wvf-123",
            &Delivery::FetchPost("chatshell-wvf://localhost".to_string()),
        );
        assert!(js.contains("\"wvf-123\""));
        assert!(js.contains("chatshell-wvf://localhost"));
        assert!(js.contains("outerHTML"));
        assert!(js.contains("MutationObserver"));
        // Runs only once per document.
        assert!(js.contains("__CHATSELL_WVF__"));
    }

    #[test]
    fn test_injection_script_message_handler_delivers_without_network() {
        let js = build_injection_script("wvf-123", &Delivery::MessageHandler);
        assert!(js.contains("\"wvf-123\""));
        assert!(js.contains(HANDLER_NAME));
        assert!(js.contains("postMessage"));
        assert!(js.contains("JSON.stringify"));
        assert!(js.contains("outerHTML"));
        assert!(js.contains("MutationObserver"));
        // No network transport may remain in the macOS variant.
        assert!(!js.contains("fetch("));
        // The registration race is covered by bounded retries.
        assert!(js.contains("tries < 20"));
    }

    #[test]
    fn test_protocol_base_url_matches_platform() {
        let base = protocol_base_url();
        if cfg!(windows) {
            assert_eq!(base, "http://chatshell-wvf.localhost");
        } else {
            assert_eq!(base, "chatshell-wvf://localhost");
        }
    }

    #[test]
    fn test_extract_id() {
        assert_eq!(
            extract_id("chatshell-wvf://localhost/done?id=wvf-1-2"),
            Some("wvf-1-2".to_string())
        );
        assert_eq!(extract_id("chatshell-wvf://localhost/done"), None);
        assert_eq!(extract_id("chatshell-wvf://localhost/done?id="), None);
        assert_eq!(
            extract_id("chatshell-wvf://localhost/done?id=a&x=1"),
            Some("a".to_string())
        );
    }

    #[test]
    fn test_challenge_detection() {
        assert!(is_challenge_html(
            "<html><title>Just a moment...</title></html>"
        ));
        assert!(!is_challenge_html("<html><body>real content</body></html>"));
    }

    #[tokio::test]
    async fn test_fetch_html_requires_app_handle() {
        // No app handle in test binaries: the tier reports unavailability
        // instead of panicking.
        if !is_available() {
            assert!(fetch_html("https://example.com").await.is_err());
        }
    }
}
