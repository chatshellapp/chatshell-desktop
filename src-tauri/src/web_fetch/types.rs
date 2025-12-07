use chrono::Utc;
use lazy_static::lazy_static;
use regex::Regex;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Metadata for web fetch results
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebFetchMetadata {
    pub keywords: Option<String>,
    pub headings: Vec<String>,
    pub fetched_at: String,
    pub original_length: Option<usize>,
    pub truncated: bool,
    pub favicon_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FetchedWebResource {
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub mime_type: String,
    pub content_format: String, // MIME type of converted content (e.g., "text/markdown")
    pub content: String,
    pub extraction_error: Option<String>,
    pub metadata: WebFetchMetadata,
}

impl FetchedWebResource {
    /// Create an error response with default metadata
    pub fn error(
        url: &str,
        mime_type: String,
        error: String,
        favicon_url: Option<String>,
    ) -> Self {
        FetchedWebResource {
            url: url.to_string(),
            title: None,
            description: None,
            mime_type: mime_type.clone(),
            content_format: mime_type,
            content: String::new(),
            extraction_error: Some(error),
            metadata: WebFetchMetadata {
                keywords: None,
                headings: vec![],
                fetched_at: Utc::now().to_rfc3339(),
                original_length: None,
                truncated: false,
                favicon_url,
            },
        }
    }
}

lazy_static! {
    /// Shared HTTP client with connection pooling
    pub static ref HTTP_CLIENT: Client = Client::builder()
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(10))
        .user_agent("Mozilla/5.0 (compatible; ChatShell/1.0)")
        .build()
        .expect("Failed to create HTTP client");

    pub static ref URL_REGEX: Regex = Regex::new(
        r"https?://(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&/=]*)"
    ).expect("Invalid URL regex pattern");

    /// Regex to match complete img tags
    pub static ref IMG_TAG_REGEX: Regex = Regex::new(
        r#"(?i)<img\s[^>]*?/?>"#
    ).expect("Invalid img tag regex");

    /// Regex to extract src attribute from img tag
    pub static ref IMG_SRC_REGEX: Regex = Regex::new(
        r#"(?i)src\s*=\s*["']([^"']+)["']"#
    ).expect("Invalid src regex");

    /// Regex to extract alt attribute from img tag
    pub static ref IMG_ALT_REGEX: Regex = Regex::new(
        r#"(?i)alt\s*=\s*["']([^"']*)["']"#
    ).expect("Invalid alt regex");

    /// Stealth JavaScript to hide headless browser detection
    pub static ref STEALTH_JS: String = r#"
        // Override webdriver property
        Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined,
        });
        
        // Override plugins to look like a real browser
        Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4, 5],
        });
        
        // Override languages
        Object.defineProperty(navigator, 'languages', {
            get: () => ['en-US', 'en'],
        });
        
        // Add chrome runtime (missing in headless)
        window.chrome = {
            runtime: {},
        };
        
        // Override permissions query
        if (window.navigator.permissions) {
            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters) => (
                parameters.name === 'notifications' ?
                    Promise.resolve({ state: Notification.permission }) :
                    originalQuery(parameters)
            );
        }
    "#.to_string();
}

