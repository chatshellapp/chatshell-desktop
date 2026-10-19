//! macOS delivery channel for the WebView fetch tier.
//!
//! WebKit refuses page-initiated `fetch`/`XMLHttpRequest` to custom URL
//! schemes and blocks mixed-content `http://127.0.0.1` targets, so neither
//! the `chatshell-wvf://` protocol nor a local HTTP relay can deliver from
//! an `https` page (verified 2026-10-19: zero requests ever reach the
//! registered `WKURLSchemeHandler`). `WKScriptMessageHandler` sidesteps
//! the network stack entirely: the injected script calls
//! `window.webkit.messageHandlers.<name>.postMessage(...)`, and the sink
//! registered here hands the payload to [`webview_fetch::deliver_message`].
//! Exercised against a real `https` page with a 2 MB payload.

use objc2::ClassType;
use objc2::rc::Retained;
use objc2::runtime::{NSObject, ProtocolObject};
use objc2::{MainThreadOnly, define_class, msg_send};
use objc2_app_kit::{NSView, NSWindow};
use objc2_foundation::{MainThreadMarker, NSObjectProtocol, NSString};
use objc2_web_kit::{WKScriptMessage, WKScriptMessageHandler, WKUserContentController, WKWebView};
use tauri::Manager;

use super::webview_fetch::{HANDLER_NAME, deliver_message};

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "ChatShellWvfMessageSink"]
    #[thread_kind = MainThreadOnly]
    pub struct WvfMessageSink;

    unsafe impl NSObjectProtocol for WvfMessageSink {}

    unsafe impl WKScriptMessageHandler for WvfMessageSink {
        #[unsafe(method(userContentController:didReceiveScriptMessage:))]
        fn did_receive(&self, _controller: &WKUserContentController, message: &WKScriptMessage) {
            // Safety: objc runtime calls are unsafe.
            unsafe {
                if let Ok(body) = message.body().downcast::<NSString>() {
                    deliver_message(&body.to_string());
                } else {
                    tracing::warn!("[webview] Non-string message-handler delivery");
                }
            }
        }
    }
);

impl WvfMessageSink {
    fn new(mtm: MainThreadMarker) -> Retained<Self> {
        let this = mtm.alloc::<WvfMessageSink>();
        // The class does not override `init`, so sending it to the instance
        // is exactly NSObject's implementation.
        // Safety: standard NSObject init on a freshly allocated instance.
        let sink: Option<Retained<Self>> = unsafe { msg_send![this, init] };
        sink.expect("NSObject init failed")
    }
}

thread_local! {
    /// One process-wide sink; each webview's user content controller holds
    /// its own retain once registered. Main-thread only (messages arrive
    /// on the main thread), so a thread-local is the natural home.
    static SINK: Option<Retained<WvfMessageSink>> =
        MainThreadMarker::new().map(WvfMessageSink::new);
}

/// Depth-first search for the WKWebView inside a tauri window: wry wraps
/// the webview in a container view before injecting it as the content view.
fn find_wkwebview(view: &Retained<NSView>) -> Option<Retained<WKWebView>> {
    // Safety: isKindOfClass is a plain class check; the cast below is
    // guarded by it.
    unsafe {
        let is_wk: bool = msg_send![view, isKindOfClass: WKWebView::class()];
        if is_wk {
            return Some(Retained::cast_unchecked::<WKWebView>(view.clone()));
        }
        for subview in view.subviews().iter() {
            if let Some(wk) = find_wkwebview(&subview) {
                return Some(wk);
            }
        }
    }
    None
}

/// Register the message sink on the fetch webview named `label`. Must run
/// on the main thread; the injected script retries briefly if the page
/// delivers before registration lands.
pub(super) fn attach(app: &tauri::AppHandle, label: &str) {
    let app = app.clone();
    let label = label.to_string();
    let dispatched = app.clone().run_on_main_thread(move || {
        let Some(_mtm) = MainThreadMarker::new() else {
            return;
        };
        let Some(window) = app.get_webview_window(&label) else {
            tracing::warn!(
                "[webview] Cannot attach message handler: window {} gone",
                label
            );
            return;
        };
        let Ok(ns_window_ptr) = window.ns_window() else {
            tracing::warn!(
                "[webview] Cannot attach message handler: no NSWindow for {}",
                label
            );
            return;
        };
        // Safety: `ns_window` hands out the real NSWindow pointer, valid
        // while the window exists (we are on the main thread inside the
        // app that owns it).
        let ns_window: &NSWindow = unsafe { &*ns_window_ptr.cast() };
        // Safety: getters on a live NSWindow.
        let Some(content) = ns_window.contentView() else {
            tracing::warn!("[webview] Cannot attach message handler: empty content view");
            return;
        };
        let Some(wk) = find_wkwebview(&content) else {
            tracing::warn!("[webview] Cannot attach message handler: no WKWebView in hierarchy");
            return;
        };
        // Safety: getters on a live WKWebView.
        let ucc = unsafe { wk.configuration().userContentController() };
        SINK.with(|sink| {
            if let Some(sink) = sink {
                let handler = ProtocolObject::from_ref(&**sink);
                // Safety: registering a handler that implements the
                // WKScriptMessageHandler protocol; retained by the ucc.
                unsafe {
                    ucc.addScriptMessageHandler_name(handler, &NSString::from_str(HANDLER_NAME));
                }
            } else {
                tracing::warn!("[webview] Message sink unavailable on main thread");
            }
        });
    });
    if let Err(error) = dispatched {
        tracing::warn!(
            "[webview] Failed to dispatch handler registration: {}",
            error
        );
    }
}
