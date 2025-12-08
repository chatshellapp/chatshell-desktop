use anyhow::Result;
use headless_chrome::{Browser, LaunchOptions};
use std::time::Duration;

use super::processors::process_html_with_readability;
use super::types::{FetchedWebResource, STEALTH_JS};
use crate::web_fetch::extractors::extract_favicon_url;

/// Create a new headless browser instance
pub fn create_new_browser() -> Result<Browser> {
    tracing::info!("🌐 [headless] Creating new browser instance...");

    let launch_options = LaunchOptions::default_builder()
        .headless(true)
        .window_size(Some((1920, 1080)))
        .idle_browser_timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| anyhow::anyhow!("Failed to build launch options: {}", e))?;

    let browser = Browser::new(launch_options)
        .map_err(|e| anyhow::anyhow!("Failed to launch browser: {}", e))?;

    tracing::info!("✅ [headless] Browser instance created");
    Ok(browser)
}

/// Fetch webpage content using headless Chrome browser
/// This is used as a fallback when direct HTTP fetch fails (e.g., 403 errors from bot protection)
pub fn fetch_with_headless_browser(url: &str) -> Result<String> {
    tracing::info!("🔄 [headless] Fetching with headless browser: {}", url);

    let browser = create_new_browser()?;

    let tab = browser
        .new_tab()
        .map_err(|e| anyhow::anyhow!("Failed to create tab: {}", e))?;

    // Set realistic User-Agent before navigation
    tab.set_user_agent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Some("en-US,en;q=0.9"),
        Some("macOS"),
    ).map_err(|e| anyhow::anyhow!("Failed to set user agent: {}", e))?;

    // Navigate to a blank page first to inject stealth JS
    tab.navigate_to("about:blank")
        .map_err(|e| anyhow::anyhow!("Failed to navigate to blank: {}", e))?;
    tab.wait_until_navigated()
        .map_err(|e| anyhow::anyhow!("Blank navigation timeout: {}", e))?;

    // Inject stealth JavaScript to hide headless detection
    tab.evaluate(&*STEALTH_JS, false)
        .map_err(|e| anyhow::anyhow!("Failed to inject stealth JS: {}", e))?;

    tracing::info!("🛡️ [headless] Stealth mode enabled, navigating to target...");

    // Navigate to the actual URL
    tab.navigate_to(url)
        .map_err(|e| anyhow::anyhow!("Failed to navigate: {}", e))?;

    // Wait for navigation to complete
    tab.wait_until_navigated()
        .map_err(|e| anyhow::anyhow!("Navigation timeout: {}", e))?;

    // Wait for Cloudflare challenge to complete (usually takes 5-10 seconds)
    tracing::info!("⏳ [headless] Waiting for page to load (Cloudflare check)...");
    std::thread::sleep(Duration::from_secs(8));

    // Check if we're still on the challenge page
    let mut html = tab
        .get_content()
        .map_err(|e| anyhow::anyhow!("Failed to get page content: {}", e))?;

    // If still showing challenge, wait more and retry
    let challenge_indicators = [
        "Just a moment",
        "Verifying",
        "checking your browser",
        "Please wait",
        "Checking if the site",
    ];
    let mut retries = 0;
    while retries < 3 && challenge_indicators.iter().any(|ind| html.contains(ind)) {
        tracing::info!(
            "⏳ [headless] Still on challenge page, waiting more... (retry {})",
            retries + 1
        );
        std::thread::sleep(Duration::from_secs(5));
        html = tab
            .get_content()
            .map_err(|e| anyhow::anyhow!("Failed to get page content: {}", e))?;
        retries += 1;
    }

    if challenge_indicators.iter().any(|ind| html.contains(ind)) {
        return Err(anyhow::anyhow!(
            "Cloudflare challenge could not be bypassed after {} retries",
            retries
        ));
    }

    tracing::info!("✅ [headless] Successfully fetched {} bytes", html.len());

    Ok(html)
}

/// Async wrapper for headless browser fallback
/// Runs the blocking headless browser operation in a separate thread
pub async fn fetch_with_headless_fallback(
    url: &str,
    max_chars: Option<usize>,
) -> FetchedWebResource {
    let url_owned = url.to_string();

    // Run headless browser in blocking thread to avoid blocking async runtime
    let html_result =
        tokio::task::spawn_blocking(move || fetch_with_headless_browser(&url_owned)).await;

    match html_result {
        Ok(Ok(html)) => {
            // Successfully got HTML from headless browser
            let favicon_url = extract_favicon_url(url, Some(&html));
            process_html_with_readability(
                url,
                &html,
                "text/html".to_string(),
                max_chars,
                favicon_url,
            )
        }
        Ok(Err(e)) => {
            // Headless browser fetch failed
            FetchedWebResource::error(
                url,
                "text/html".to_string(),
                format!("Headless browser fetch failed: {}", e),
                None,
            )
        }
        Err(e) => {
            // Task join error
            FetchedWebResource::error(
                url,
                "text/html".to_string(),
                format!("Headless browser task failed: {}", e),
                None,
            )
        }
    }
}
