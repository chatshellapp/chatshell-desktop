mod extractors;
mod fetcher;
mod headless;
mod jina;
mod obscura;
mod processors;
mod spa_detect;
mod types;
mod webview_fetch;
#[cfg(target_os = "macos")]
mod wkwebview_delivery;

// Re-export public types
pub use types::{FetchedWebResource, HTTP_CLIENT, STEALTH_JS, WebFetchMetadata};

// Re-export public functions
pub(crate) use fetcher::MAX_REMOTE_SOURCE_BYTES;
pub use fetcher::{
    FetchConfig, FetchMode, LocalMethod, build_llm_content_with_attachments, fetch_raw_http,
    fetch_urls_with_config, fetch_web_resource_with_config,
};
pub use headless::create_new_browser;

/// Browser tier shared with settings UI: Chromium-family browser presence.
pub use headless::is_chrome_available as chrome_is_available;

/// Browser tier shared with `web_search`: Obscura CLI runner (desktop only).
pub use obscura::{fetch_html as obscura_fetch_html, is_configured as obscura_is_configured};

/// Browser tier shared with `web_search`: system-WebView fetcher.
pub use webview_fetch::{
    SCHEME as WEBVIEW_SCHEME, deliver as webview_deliver, fetch_html as webview_fetch_html,
    is_available as webview_is_available, set_app_handle as webview_set_app_handle,
};
