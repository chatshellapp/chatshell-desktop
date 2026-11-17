//! Classify MCP failures as "the server rejected our credentials".
//!
//! Only transport/protocol failures are classified: connect errors,
//! `list_tools` errors, and the `Err` arm of `call_tool`. Text produced by an
//! MCP tool (successful content or `is_error: true` content) is never passed
//! here: a fetch-style tool can legitimately report "upstream returned HTTP
//! 401" without the MCP server's own credentials being involved.

/// Whether an error message describes an HTTP 401 / rejected-token failure.
pub fn is_auth_error_message(message: &str) -> bool {
    let lower = message.to_lowercase();
    (lower.contains("401") && (lower.contains("unauthorized") || lower.contains("http")))
        || (lower.contains("unauthorized") && lower.contains("error"))
        || lower.contains("token expired")
        || lower.contains("token has expired")
        || lower.contains("invalid_token")
        || lower.contains("authentication required")
        // rmcp's streamable HTTP client: `StreamableHttpError::AuthRequired`
        // displays as "Auth required".
        || lower.contains("auth required")
        || lower.contains("authrequired")
}

/// Classify an `anyhow` error by its whole cause chain. `to_string()` only
/// shows the outermost context ("Failed to connect to MCP server via HTTP"),
/// which hides the 401 underneath.
pub fn is_auth_error(error: &anyhow::Error) -> bool {
    is_auth_error_message(&format!("{error:#}")) || is_auth_error_message(&format!("{error:?}"))
}

/// Classify an rmcp request failure (e.g. `call_tool`'s `Err`).
pub fn is_service_auth_error(error: &rmcp::ServiceError) -> bool {
    let mut text = error.to_string();
    let mut source = std::error::Error::source(error);
    while let Some(cause) = source {
        text.push_str(": ");
        text.push_str(&cause.to_string());
        source = cause.source();
    }
    is_auth_error_message(&text) || is_auth_error_message(&format!("{error:?}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_http_401_and_token_errors() {
        assert!(is_auth_error_message("HTTP 401 Unauthorized"));
        assert!(is_auth_error_message("error: unauthorized"));
        assert!(is_auth_error_message("invalid_token"));
        assert!(is_auth_error_message(
            "Transport [streamable-http] error: Auth required"
        ));
        assert!(!is_auth_error_message("connection refused"));
        assert!(!is_auth_error_message("Transport closed"));
    }

    #[test]
    fn anyhow_chain_is_inspected_not_just_outer_context() {
        let inner = anyhow::anyhow!("Transport fatal Auth required, when send initialize request");
        let wrapped = inner.context("Failed to connect to MCP server via HTTP");
        assert!(!is_auth_error_message(&wrapped.to_string()));
        assert!(is_auth_error(&wrapped));
    }

    #[test]
    fn network_failures_are_not_auth() {
        let err = anyhow::anyhow!("error sending request: connection refused")
            .context("Failed to connect to MCP server via HTTP");
        assert!(!is_auth_error(&err));
    }
}
