//! MCP OAuth 2.0/2.1 authorization flow.
//!
//! Implements discovery (RFC 9728 Protected Resource Metadata, RFC 8414 AS Metadata),
//! PKCE (S256), token exchange, and callback server for HTTP-based MCP servers.

use anyhow::{Context, Result};
use oauth2::{
    AuthUrl, AuthorizationCode, ClientId, ClientSecret, PkceCodeChallenge, PkceCodeVerifier,
    RedirectUrl, Scope, TokenResponse, TokenUrl, basic::BasicClient,
};
use serde::{Deserialize, Serialize};
use tokio::sync::oneshot;
use url::Url;

/// RFC 9728 Protected Resource Metadata
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ProtectedResourceMetadata {
    #[serde(default)]
    pub authorization_servers: Vec<String>,
    #[serde(default)]
    pub scopes_supported: Vec<String>,
}

/// RFC 8414 Authorization Server Metadata
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AuthorizationServerMetadata {
    pub issuer: String,
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    #[serde(default)]
    pub registration_endpoint: Option<String>,
    #[serde(default)]
    pub scopes_supported: Option<Vec<String>>,
    #[serde(default)]
    pub code_challenge_methods_supported: Option<Vec<String>>,
}

/// RFC 7591 Dynamic Client Registration request body
#[derive(Debug, Serialize)]
struct RegistrationRequest {
    redirect_uris: Vec<String>,
    client_name: String,
    token_endpoint_auth_method: String,
    grant_types: Vec<String>,
    response_types: Vec<String>,
}

/// RFC 7591 registration response (subset we need)
#[derive(Debug, Deserialize)]
struct RegistrationResponse {
    client_id: String,
    #[serde(default)]
    client_secret: Option<String>,
}

/// Result of OAuth discovery for an MCP server endpoint
#[derive(Debug, Clone)]
pub struct OAuthDiscoveryResult {
    pub resource_metadata_url: String,
    pub authorization_server_url: String,
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub registration_endpoint: Option<String>,
    pub scopes_supported: Vec<String>,
    pub resource_uri: String,
}

/// Parsed WWW-Authenticate Bearer parameters
#[derive(Debug, Default)]
struct WwwAuthenticateParams {
    resource_metadata: Option<String>,
    scope: Option<String>,
}

/// Probe MCP endpoint and discover OAuth metadata (RFC 9728, RFC 8414)
pub async fn discover(
    client: &reqwest::Client,
    mcp_endpoint: &str,
) -> Result<OAuthDiscoveryResult> {
    let resource_uri = normalize_resource_uri(mcp_endpoint)?;

    // 1. Probe unauthenticated request to get 401 + WWW-Authenticate
    let resp = client
        .get(mcp_endpoint)
        .send()
        .await
        .context("Failed to probe MCP endpoint")?;

    let resource_metadata_url = if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        let params = parse_www_authenticate(resp.headers())?;
        params.resource_metadata.ok_or_else(|| {
            anyhow::anyhow!("401 response missing resource_metadata in WWW-Authenticate")
        })?
    } else {
        // Fallback: well-known URI (RFC 9728)
        let base = Url::parse(mcp_endpoint).context("Invalid MCP endpoint URL")?;
        let path = base.path().trim_end_matches('/');

        if path.is_empty() || path == "/" {
            format!(
                "{}/.well-known/oauth-protected-resource",
                base.origin().ascii_serialization()
            )
        } else {
            format!(
                "{}/.well-known/oauth-protected-resource{}",
                base.origin().ascii_serialization(),
                path
            )
        }
    };

    // 2. Fetch Protected Resource Metadata
    let prm: ProtectedResourceMetadata = client
        .get(&resource_metadata_url)
        .send()
        .await
        .context("Failed to fetch Protected Resource Metadata")?
        .json()
        .await
        .context("Invalid Protected Resource Metadata JSON")?;

    let as_url = prm
        .authorization_servers
        .first()
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("No authorization_servers in resource metadata"))?;

    let scopes_from_prm = prm.scopes_supported;

    // 3. Fetch Authorization Server Metadata (try RFC 8414 then OIDC)
    let as_metadata = fetch_as_metadata(client, &as_url).await?;

    let scopes = if as_metadata
        .scopes_supported
        .as_ref()
        .map(|s| s.is_empty())
        .unwrap_or(true)
    {
        scopes_from_prm
    } else {
        as_metadata.scopes_supported.unwrap_or_default()
    };

    Ok(OAuthDiscoveryResult {
        resource_metadata_url,
        authorization_server_url: as_url.clone(),
        authorization_endpoint: as_metadata.authorization_endpoint,
        token_endpoint: as_metadata.token_endpoint,
        registration_endpoint: as_metadata.registration_endpoint,
        scopes_supported: scopes,
        resource_uri,
    })
}

/// Dynamic Client Registration (RFC 7591). Registers a public client with the AS
/// and returns (client_id, client_secret). Use when discovery has registration_endpoint.
pub async fn register_client(
    client: &reqwest::Client,
    registration_endpoint: &str,
    redirect_uri: &str,
) -> Result<(String, Option<String>)> {
    let body = RegistrationRequest {
        redirect_uris: vec![redirect_uri.to_string()],
        client_name: "ChatShell Desktop".to_string(),
        token_endpoint_auth_method: "none".to_string(),
        grant_types: vec!["authorization_code".to_string()],
        response_types: vec!["code".to_string()],
    };
    let resp = client
        .post(registration_endpoint)
        .json(&body)
        .send()
        .await
        .context("Dynamic Client Registration request failed")?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body_text = resp.text().await.unwrap_or_default();
        anyhow::bail!(
            "Registration failed ({}): {}",
            status,
            body_text.trim().chars().take(500).collect::<String>()
        );
    }

    let reg: RegistrationResponse = resp
        .json()
        .await
        .context("Invalid registration response JSON")?;
    Ok((reg.client_id, reg.client_secret))
}

fn normalize_resource_uri(endpoint: &str) -> Result<String> {
    let u = Url::parse(endpoint).context("Invalid endpoint URL")?;
    let mut s = format!("{}://{}", u.scheme(), u.host_str().unwrap_or(""));
    if let Some(p) = u.port() {
        s.push_str(&format!(":{}", p));
    }
    let path = u.path().trim_end_matches('/');
    if !path.is_empty() && path != "/" {
        s.push_str(path);
    }
    Ok(s.to_lowercase())
}

fn parse_www_authenticate(headers: &reqwest::header::HeaderMap) -> Result<WwwAuthenticateParams> {
    let mut params = WwwAuthenticateParams::default();
    let value = headers
        .get(reqwest::header::WWW_AUTHENTICATE)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| anyhow::anyhow!("Missing WWW-Authenticate header"))?;

    // Parse `Bearer key="value", key2="value2"`. RFC 9728 puts the first
    // parameter directly after the scheme token, space-separated; later
    // parameters are comma-separated.
    for part in value.split(',') {
        let mut part = part.trim();
        if let Some(rest) = part.get(6..)
            && part[..6].eq_ignore_ascii_case("Bearer")
            && rest.starts_with(char::is_whitespace)
        {
            part = rest.trim_start();
        }
        if part.is_empty() || part.eq_ignore_ascii_case("Bearer") {
            continue;
        }
        if let Some((k, v)) = part.split_once('=') {
            let k = k.trim();
            let v = v.trim().trim_matches('"');
            match k {
                "resource_metadata" => params.resource_metadata = Some(v.to_string()),
                "scope" => params.scope = Some(v.to_string()),
                _ => {}
            }
        }
    }
    Ok(params)
}

async fn fetch_as_metadata(
    client: &reqwest::Client,
    issuer: &str,
) -> Result<AuthorizationServerMetadata> {
    let base = issuer.trim_end_matches('/');
    let endpoints = [
        format!("{}/.well-known/oauth-authorization-server", base),
        format!("{}/.well-known/openid-configuration", base),
    ];
    for url in &endpoints {
        if let Ok(resp) = client.get(url).send().await
            && resp.status().is_success()
            && let Ok(meta) = resp.json().await
        {
            return Ok(meta);
        }
    }
    anyhow::bail!(
        "Could not fetch Authorization Server Metadata from {}",
        issuer
    )
}

/// PKCE and auth URL for starting authorization
#[derive(Debug)]
pub struct OAuthAuthState {
    pub auth_url: String,
    pub redirect_uri: String,
    pub pkce_verifier: PkceCodeVerifier,
    pub state: String,
}

/// Start OAuth authorization: build auth URL and PKCE verifier
pub fn start_authorization(
    discovery: &OAuthDiscoveryResult,
    redirect_uri: &str,
    client_id: &str,
    client_secret: Option<&str>,
) -> Result<OAuthAuthState> {
    let auth_url = AuthUrl::new(discovery.authorization_endpoint.clone())
        .context("Invalid authorization endpoint")?;
    let token_url =
        TokenUrl::new(discovery.token_endpoint.clone()).context("Invalid token endpoint")?;
    let redirect_url =
        RedirectUrl::new(redirect_uri.to_string()).context("Invalid redirect URI")?;

    let mut client = BasicClient::new(ClientId::new(client_id.to_string()))
        .set_auth_uri(auth_url)
        .set_token_uri(token_url)
        .set_redirect_uri(redirect_url);

    if let Some(secret) = client_secret {
        client = client.set_client_secret(ClientSecret::new(secret.to_string()));
    }

    let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();

    let mut auth_request = client
        .authorize_url(oauth2::CsrfToken::new_random)
        .set_pkce_challenge(pkce_challenge)
        .add_extra_param("resource", &discovery.resource_uri);

    for scope in &discovery.scopes_supported {
        auth_request = auth_request.add_scope(Scope::new(scope.clone()));
    }

    let (auth_url, state) = auth_request.url();

    Ok(OAuthAuthState {
        auth_url: auth_url.to_string(),
        redirect_uri: redirect_uri.to_string(),
        pkce_verifier,
        state: state.secret().clone(),
    })
}

/// Exchange authorization code for tokens
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthTokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in_secs: Option<u64>,
}

pub async fn exchange_code(
    discovery: &OAuthDiscoveryResult,
    redirect_uri: &str,
    client_id: &str,
    client_secret: Option<&str>,
    code: &str,
    _state: &str,
    pkce_verifier: PkceCodeVerifier,
) -> Result<OAuthTokens> {
    let auth_url = AuthUrl::new(discovery.authorization_endpoint.clone())
        .context("Invalid authorization endpoint")?;
    let token_url =
        TokenUrl::new(discovery.token_endpoint.clone()).context("Invalid token endpoint")?;
    let redirect_url =
        RedirectUrl::new(redirect_uri.to_string()).context("Invalid redirect URI")?;

    let mut client = BasicClient::new(ClientId::new(client_id.to_string()))
        .set_auth_uri(auth_url)
        .set_token_uri(token_url)
        .set_redirect_uri(redirect_url);

    if let Some(secret) = client_secret {
        client = client.set_client_secret(ClientSecret::new(secret.to_string()));
    }

    // Use oauth2's own re-exported reqwest (0.12) to avoid version mismatch
    // with our direct reqwest 0.13 dependency.
    let oauth_http_client = oauth2::reqwest::Client::new();

    let token_response = client
        .exchange_code(AuthorizationCode::new(code.to_string()))
        .set_pkce_verifier(pkce_verifier)
        .add_extra_param("resource", &discovery.resource_uri)
        .request_async(&oauth_http_client)
        .await
        .context("Token exchange failed")?;

    let expires_in = token_response.expires_in().map(|d| d.as_secs());

    Ok(OAuthTokens {
        access_token: token_response.access_token().secret().to_string(),
        refresh_token: token_response
            .refresh_token()
            .map(|t| t.secret().to_string()),
        expires_in_secs: expires_in,
    })
}

/// Callback server: binds to 127.0.0.1:0, returns (port, receiver for (code, state))
pub async fn run_callback_server() -> Result<(u16, oneshot::Receiver<(String, String)>)> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .context("Failed to bind callback server")?;
    let port = listener.local_addr().context("No local addr")?.port();

    let (tx, rx) = oneshot::channel();

    tokio::spawn(async move {
        if let Ok((stream, _)) = listener.accept().await {
            let _ = handle_callback_request(stream, tx).await;
        }
    });

    Ok((port, rx))
}

const SUCCESS_HTML: &str = r#"<!DOCTYPE html><html><head><meta charset="utf-8"><title>Authorization complete</title></head><body><p>Authorization complete. You can close this window.</p></body></html>"#;

fn parse_query_param(query: &str, name: &str) -> Option<String> {
    query.split('&').find_map(|pair| {
        let (k, v) = pair.split_once('=')?;
        if k == name {
            Some(
                urlencoding::decode(v)
                    .unwrap_or(std::borrow::Cow::Borrowed(v))
                    .into_owned(),
            )
        } else {
            None
        }
    })
}

async fn handle_callback_request(
    mut stream: tokio::net::TcpStream,
    tx: oneshot::Sender<(String, String)>,
) -> Result<()> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let mut buf = vec![0u8; 4096];
    let n = stream
        .read(&mut buf)
        .await
        .context("Read callback request")?;
    let request = String::from_utf8_lossy(&buf[..n]);
    let first_line = request.lines().next().unwrap_or("");
    // "GET /callback?code=...&state=... HTTP/1.1"
    let path_query = first_line.split_whitespace().nth(1).unwrap_or("");
    let query = path_query.split('?').nth(1).unwrap_or("");
    let code = parse_query_param(query, "code").unwrap_or_default();
    let state = parse_query_param(query, "state").unwrap_or_default();

    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        SUCCESS_HTML.len(),
        SUCCESS_HTML
    );
    stream.write_all(response.as_bytes()).await?;
    stream.flush().await?;
    let _ = tx.send((code, state));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    // ---- loopback HTTP stub (single server, request-count bounded) ----

    struct CapturedRequest {
        method: String,
        path: String,
        headers: Vec<(String, String)>,
        body: String,
    }

    impl CapturedRequest {
        fn header(&self, name: &str) -> Option<&str> {
            self.headers
                .iter()
                .find(|(k, _)| k.eq_ignore_ascii_case(name))
                .map(|(_, v)| v.as_str())
        }
    }

    struct StubResponse {
        status: u16,
        headers: Vec<(String, String)>,
        body: Vec<u8>,
    }

    impl StubResponse {
        fn json(body: impl Into<String>) -> Self {
            Self {
                status: 200,
                headers: vec![("Content-Type".to_string(), "application/json".to_string())],
                body: body.into().into_bytes(),
            }
        }

        fn status(status: u16) -> Self {
            Self {
                status,
                headers: Vec::new(),
                body: Vec::new(),
            }
        }

        fn header(mut self, name: &str, value: impl Into<String>) -> Self {
            self.headers.push((name.to_string(), value.into()));
            self
        }

        fn body(mut self, body: impl Into<String>) -> Self {
            self.body = body.into().into_bytes();
            self
        }
    }

    fn reason_phrase(status: u16) -> &'static str {
        match status {
            200 => "OK",
            400 => "Bad Request",
            401 => "Unauthorized",
            404 => "Not Found",
            _ => "Status",
        }
    }

    async fn read_request(stream: &mut tokio::net::TcpStream) -> std::io::Result<CapturedRequest> {
        let mut buf = Vec::new();
        let mut chunk = [0u8; 1024];
        let header_end = loop {
            let n = stream.read(&mut chunk).await?;
            if n == 0 {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::UnexpectedEof,
                    "connection closed before headers",
                ));
            }
            buf.extend_from_slice(&chunk[..n]);
            if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                break pos;
            }
        };

        let head = String::from_utf8_lossy(&buf[..header_end]).to_string();
        let content_length = head
            .lines()
            .find_map(|l| {
                let (k, v) = l.split_once(':')?;
                if k.trim().eq_ignore_ascii_case("content-length") {
                    v.trim().parse::<usize>().ok()
                } else {
                    None
                }
            })
            .unwrap_or(0);
        while buf.len() < header_end + 4 + content_length {
            let n = stream.read(&mut chunk).await?;
            if n == 0 {
                break;
            }
            buf.extend_from_slice(&chunk[..n]);
        }
        let body_end = (header_end + 4 + content_length).min(buf.len());
        let body = String::from_utf8_lossy(&buf[header_end + 4..body_end]).into_owned();

        let mut lines = head.lines();
        let mut parts = lines.next().unwrap_or("").split_whitespace();
        let method = parts.next().unwrap_or("").to_string();
        let target = parts.next().unwrap_or("").to_string();
        let (path, _) = target.split_once('?').unwrap_or((target.as_str(), ""));
        let headers = lines
            .filter_map(|l| {
                let (k, v) = l.split_once(':')?;
                Some((k.trim().to_string(), v.trim().to_string()))
            })
            .collect();
        Ok(CapturedRequest {
            method,
            path: path.to_string(),
            headers,
            body,
        })
    }

    /// Spawn a loopback server that serves exactly `requests` sequential
    /// connections. The route closure receives the server's own base URL (so
    /// responses can reference it) and the captured request. Every served
    /// request is recorded in the returned log.
    async fn spawn_stub<F>(requests: usize, route: F) -> (String, Arc<Mutex<Vec<CapturedRequest>>>)
    where
        F: Fn(&str, &CapturedRequest) -> StubResponse + Send + 'static,
    {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let log: Arc<Mutex<Vec<CapturedRequest>>> = Arc::new(Mutex::new(Vec::new()));
        let log_for_task = Arc::clone(&log);
        tokio::spawn(async move {
            let base = format!("http://{addr}");
            for _ in 0..requests {
                let Ok((mut socket, _)) = listener.accept().await else {
                    break;
                };
                let Ok(request) = read_request(&mut socket).await else {
                    continue;
                };
                let response = route(&base, &request);
                log_for_task.lock().unwrap().push(request);
                let mut head = format!(
                    "HTTP/1.1 {} {}\r\n",
                    response.status,
                    reason_phrase(response.status)
                );
                for (name, value) in &response.headers {
                    head.push_str(&format!("{name}: {value}\r\n"));
                }
                head.push_str(&format!(
                    "Content-Length: {}\r\nConnection: close\r\n\r\n",
                    response.body.len()
                ));
                let _ = socket.write_all(head.as_bytes()).await;
                let _ = socket.write_all(&response.body).await;
                let _ = socket.flush().await;
            }
        });
        (format!("http://{addr}"), log)
    }

    fn discovery_fixture() -> OAuthDiscoveryResult {
        OAuthDiscoveryResult {
            resource_metadata_url: "https://res.example.com/.well-known/oauth-protected-resource"
                .to_string(),
            authorization_server_url: "https://as.example.com".to_string(),
            authorization_endpoint: "https://as.example.com/authorize".to_string(),
            token_endpoint: "https://as.example.com/token".to_string(),
            registration_endpoint: Some("https://as.example.com/register".to_string()),
            scopes_supported: vec!["mcp:read".to_string(), "mcp:write".to_string()],
            resource_uri: "https://res.example.com".to_string(),
        }
    }

    fn prm_json(base: &str, scopes: &[&str]) -> String {
        serde_json::json!({
            "resource": base,
            "authorization_servers": [base],
            "scopes_supported": scopes,
        })
        .to_string()
    }

    fn as_metadata_json(base: &str, scopes: Option<&[&str]>) -> String {
        let mut value = serde_json::json!({
            "issuer": base,
            "authorization_endpoint": format!("{base}/authorize"),
            "token_endpoint": format!("{base}/token"),
            "registration_endpoint": format!("{base}/register"),
        });
        if let Some(scopes) = scopes {
            value["scopes_supported"] = serde_json::json!(scopes);
        }
        value.to_string()
    }

    fn query_values(url: &Url, name: &str) -> Vec<String> {
        url.query_pairs()
            .filter(|(k, _)| k == name)
            .map(|(_, v)| v.into_owned())
            .collect()
    }

    // ---- normalize_resource_uri ----

    #[test]
    fn normalize_resource_uri_lowercases_and_strips_trailing_slash() {
        assert_eq!(
            normalize_resource_uri("HTTPS://Resource.Example.COM/MCP/").unwrap(),
            "https://resource.example.com/mcp"
        );
        assert_eq!(
            normalize_resource_uri("http://127.0.0.1:8080/api/").unwrap(),
            "http://127.0.0.1:8080/api"
        );
    }

    #[test]
    fn normalize_resource_uri_elides_default_ports_and_root_paths() {
        assert_eq!(
            normalize_resource_uri("https://example.com:443/x").unwrap(),
            "https://example.com/x"
        );
        assert_eq!(
            normalize_resource_uri("https://example.com/").unwrap(),
            "https://example.com"
        );
        assert_eq!(
            normalize_resource_uri("https://example.com").unwrap(),
            "https://example.com"
        );
        assert_eq!(
            normalize_resource_uri("https://example.com/api//").unwrap(),
            "https://example.com/api"
        );
    }

    #[test]
    fn normalize_resource_uri_rejects_invalid_urls() {
        assert!(normalize_resource_uri("not a url").is_err());
        assert!(normalize_resource_uri("example.com/path").is_err());
    }

    // ---- parse_www_authenticate ----

    fn headers_with_www_authenticate(value: &str) -> reqwest::header::HeaderMap {
        let mut map = reqwest::header::HeaderMap::new();
        map.insert(
            reqwest::header::WWW_AUTHENTICATE,
            reqwest::header::HeaderValue::from_str(value).unwrap(),
        );
        map
    }

    #[test]
    fn parse_www_authenticate_extracts_resource_metadata_and_scope() {
        let params = parse_www_authenticate(&headers_with_www_authenticate(
            r#"Bearer, resource_metadata="https://res.example.com/.well-known/oauth-protected-resource", scope="mcp:read mcp:write""#,
        ))
        .unwrap();
        assert_eq!(
            params.resource_metadata.as_deref(),
            Some("https://res.example.com/.well-known/oauth-protected-resource")
        );
        assert_eq!(params.scope.as_deref(), Some("mcp:read mcp:write"));
    }

    #[test]
    fn parse_www_authenticate_parses_space_separated_first_param() {
        // RFC 9728 form: the first parameter follows the scheme token
        // space-separated. Regression pin: this used to be silently dropped
        // because the parser only ever split on commas.
        let params = parse_www_authenticate(&headers_with_www_authenticate(
            r#"Bearer resource_metadata="https://res.example.com/prm", scope=mcp:read"#,
        ))
        .unwrap();
        assert_eq!(
            params.resource_metadata.as_deref(),
            Some("https://res.example.com/prm")
        );
        assert_eq!(params.scope.as_deref(), Some("mcp:read"));
    }

    #[test]
    fn parse_www_authenticate_accepts_bare_and_case_insensitive_bearer() {
        let params = parse_www_authenticate(&headers_with_www_authenticate("Bearer")).unwrap();
        assert_eq!(params.resource_metadata, None);
        assert_eq!(params.scope, None);

        let params = parse_www_authenticate(&headers_with_www_authenticate(
            r#"bEaReR, resource_metadata="https://res.example.com/prm""#,
        ))
        .unwrap();
        assert_eq!(
            params.resource_metadata.as_deref(),
            Some("https://res.example.com/prm")
        );
    }

    #[test]
    fn parse_www_authenticate_ignores_unknown_keys_and_accepts_unquoted_values() {
        let params = parse_www_authenticate(&headers_with_www_authenticate(
            r#"Bearer error="invalid_token", unknown=1, resource_metadata=https://res.example.com/prm, scope=mcp:read"#,
        ))
        .unwrap();
        assert_eq!(
            params.resource_metadata.as_deref(),
            Some("https://res.example.com/prm")
        );
        assert_eq!(params.scope.as_deref(), Some("mcp:read"));
    }

    #[test]
    fn parse_www_authenticate_errors_when_header_missing() {
        let err = parse_www_authenticate(&reqwest::header::HeaderMap::new()).unwrap_err();
        assert_eq!(err.to_string(), "Missing WWW-Authenticate header");
    }

    // ---- start_authorization ----

    #[test]
    fn start_authorization_builds_pkce_auth_url_with_resource_and_scopes() {
        let discovery = discovery_fixture();
        let state = start_authorization(
            &discovery,
            "http://127.0.0.1:8915/callback",
            "client-abc",
            Some("sekret"),
        )
        .unwrap();

        let url = Url::parse(&state.auth_url).unwrap();
        assert_eq!(url.host_str(), Some("as.example.com"));
        assert_eq!(url.path(), "/authorize");
        assert_eq!(
            query_values(&url, "client_id"),
            vec!["client-abc".to_string()]
        );
        assert_eq!(
            query_values(&url, "response_type"),
            vec!["code".to_string()]
        );
        assert_eq!(
            query_values(&url, "redirect_uri"),
            vec!["http://127.0.0.1:8915/callback".to_string()]
        );
        assert_eq!(
            query_values(&url, "resource"),
            vec!["https://res.example.com".to_string()]
        );
        assert_eq!(
            query_values(&url, "scope"),
            vec!["mcp:read mcp:write".to_string()]
        );
        assert_eq!(
            query_values(&url, "code_challenge_method"),
            vec!["S256".to_string()]
        );

        // S256 challenge = base64url(sha256(verifier)) without padding: 43 chars.
        let challenges = query_values(&url, "code_challenge");
        assert_eq!(challenges.len(), 1);
        assert_eq!(challenges[0].len(), 43);
        assert!(
            challenges[0]
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'),
            "challenge must be base64url: {}",
            challenges[0]
        );
        assert_eq!(state.pkce_verifier.secret().len(), 43);
        assert_eq!(state.redirect_uri, "http://127.0.0.1:8915/callback");
        assert!(!state.state.is_empty());
    }

    #[test]
    fn start_authorization_generates_fresh_state_and_verifier_per_call() {
        let discovery = discovery_fixture();
        let first =
            start_authorization(&discovery, "http://127.0.0.1:8915/callback", "c", None).unwrap();
        let second =
            start_authorization(&discovery, "http://127.0.0.1:8915/callback", "c", None).unwrap();
        assert_ne!(first.state, second.state);
        assert_ne!(first.pkce_verifier.secret(), second.pkce_verifier.secret());
    }

    #[test]
    fn start_authorization_omits_scope_param_when_no_scopes_supported() {
        let mut discovery = discovery_fixture();
        discovery.scopes_supported = Vec::new();
        let state =
            start_authorization(&discovery, "http://127.0.0.1:8915/callback", "c", None).unwrap();
        let url = Url::parse(&state.auth_url).unwrap();
        assert!(!url.query_pairs().any(|(k, _)| k == "scope"));
    }

    #[test]
    fn start_authorization_rejects_invalid_authorization_endpoint() {
        let mut discovery = discovery_fixture();
        discovery.authorization_endpoint = "not a url".to_string();
        let err = start_authorization(&discovery, "http://127.0.0.1:8915/callback", "c", None)
            .unwrap_err();
        assert!(
            err.to_string().contains("Invalid authorization endpoint"),
            "got: {err}"
        );
    }

    // ---- discover ----

    #[tokio::test]
    async fn discover_follows_401_resource_metadata_to_as_metadata() {
        let (base, _log) = spawn_stub(3, |base, req| match req.path.as_str() {
            "/mcp" => StubResponse::status(401).header(
                "WWW-Authenticate",
                format!("Bearer, resource_metadata=\"{base}/prm\""),
            ),
            "/prm" => StubResponse::json(prm_json(base, &["prm:read", "prm:write"])),
            "/.well-known/oauth-authorization-server" => {
                StubResponse::json(as_metadata_json(base, Some(&["as:scope"])))
            }
            _ => StubResponse::status(404),
        })
        .await;

        let client = reqwest::Client::new();
        let result = discover(&client, &format!("{base}/mcp")).await.unwrap();

        assert_eq!(result.resource_metadata_url, format!("{base}/prm"));
        assert_eq!(result.authorization_server_url, base);
        assert_eq!(result.authorization_endpoint, format!("{base}/authorize"));
        assert_eq!(result.token_endpoint, format!("{base}/token"));
        assert_eq!(
            result.registration_endpoint,
            Some(format!("{base}/register"))
        );
        // AS scopes win over PRM scopes when the AS advertises any.
        assert_eq!(result.scopes_supported, vec!["as:scope".to_string()]);
        assert_eq!(result.resource_uri, format!("{base}/mcp"));
    }

    #[tokio::test]
    async fn discover_keeps_prm_scopes_when_as_has_no_scopes() {
        let (base, _log) = spawn_stub(3, |base, req| match req.path.as_str() {
            "/mcp" => StubResponse::status(401).header(
                "WWW-Authenticate",
                format!("Bearer, resource_metadata=\"{base}/prm\""),
            ),
            "/prm" => StubResponse::json(prm_json(base, &["prm:read", "prm:write"])),
            "/.well-known/oauth-authorization-server" => {
                StubResponse::json(as_metadata_json(base, None))
            }
            _ => StubResponse::status(404),
        })
        .await;

        let client = reqwest::Client::new();
        let result = discover(&client, &format!("{base}/mcp")).await.unwrap();
        assert_eq!(
            result.scopes_supported,
            vec!["prm:read".to_string(), "prm:write".to_string()]
        );
    }

    #[tokio::test]
    async fn discover_keeps_prm_scopes_when_as_scopes_are_empty() {
        let (base, _log) = spawn_stub(3, |base, req| match req.path.as_str() {
            "/mcp" => StubResponse::status(401).header(
                "WWW-Authenticate",
                format!("Bearer, resource_metadata=\"{base}/prm\""),
            ),
            "/prm" => StubResponse::json(prm_json(base, &["prm:read"])),
            "/.well-known/oauth-authorization-server" => {
                StubResponse::json(as_metadata_json(base, Some(&[])))
            }
            _ => StubResponse::status(404),
        })
        .await;

        let client = reqwest::Client::new();
        let result = discover(&client, &format!("{base}/mcp")).await.unwrap();
        assert_eq!(result.scopes_supported, vec!["prm:read".to_string()]);
    }

    #[tokio::test]
    async fn discover_derives_well_known_with_path_for_non_401_subpath_endpoint() {
        let (base, _log) = spawn_stub(3, |base, req| match req.path.as_str() {
            "/mcp" => StubResponse::json("{}"),
            "/.well-known/oauth-protected-resource/mcp" => StubResponse::json(prm_json(base, &[])),
            "/.well-known/oauth-authorization-server" => {
                StubResponse::json(as_metadata_json(base, Some(&["as:scope"])))
            }
            _ => StubResponse::status(404),
        })
        .await;

        let client = reqwest::Client::new();
        let result = discover(&client, &format!("{base}/mcp")).await.unwrap();
        assert_eq!(
            result.resource_metadata_url,
            format!("{base}/.well-known/oauth-protected-resource/mcp")
        );
        assert_eq!(result.scopes_supported, vec!["as:scope".to_string()]);
    }

    #[tokio::test]
    async fn discover_derives_well_known_at_root_for_non_401_root_endpoint() {
        let (base, _log) = spawn_stub(3, |base, req| match req.path.as_str() {
            "/" => StubResponse::json("{}"),
            "/.well-known/oauth-protected-resource" => StubResponse::json(prm_json(base, &[])),
            "/.well-known/oauth-authorization-server" => {
                StubResponse::json(as_metadata_json(base, Some(&["as:scope"])))
            }
            _ => StubResponse::status(404),
        })
        .await;

        let client = reqwest::Client::new();
        let result = discover(&client, &base).await.unwrap();
        assert_eq!(
            result.resource_metadata_url,
            format!("{base}/.well-known/oauth-protected-resource")
        );
    }

    #[tokio::test]
    async fn discover_errors_when_401_lacks_resource_metadata() {
        let (base, _log) = spawn_stub(1, |_base, req| match req.path.as_str() {
            "/mcp" => StubResponse::status(401).header("WWW-Authenticate", "Bearer"),
            _ => StubResponse::status(404),
        })
        .await;

        let client = reqwest::Client::new();
        let err = discover(&client, &format!("{base}/mcp")).await.unwrap_err();
        assert!(
            err.to_string()
                .contains("missing resource_metadata in WWW-Authenticate"),
            "got: {err}"
        );
    }

    // ---- fetch_as_metadata ----

    #[tokio::test]
    async fn fetch_as_metadata_uses_rfc8414_well_known_endpoint() {
        let (base, log) = spawn_stub(1, |base, req| match req.path.as_str() {
            "/.well-known/oauth-authorization-server" => {
                StubResponse::json(as_metadata_json(base, Some(&["as:scope"])))
            }
            _ => StubResponse::status(404),
        })
        .await;

        let client = reqwest::Client::new();
        let meta = fetch_as_metadata(&client, &base).await.unwrap();
        assert_eq!(meta.issuer, base);
        assert_eq!(meta.authorization_endpoint, format!("{base}/authorize"));
        assert_eq!(meta.token_endpoint, format!("{base}/token"));
        assert_eq!(meta.scopes_supported, Some(vec!["as:scope".to_string()]));
        // Only the first well-known endpoint was probed.
        assert_eq!(log.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn fetch_as_metadata_falls_back_to_openid_configuration() {
        let (base, log) = spawn_stub(2, |base, req| match req.path.as_str() {
            "/.well-known/openid-configuration" => StubResponse::json(as_metadata_json(base, None)),
            _ => StubResponse::status(404),
        })
        .await;

        let client = reqwest::Client::new();
        let meta = fetch_as_metadata(&client, &base).await.unwrap();
        assert_eq!(meta.authorization_endpoint, format!("{base}/authorize"));
        assert_eq!(meta.scopes_supported, None);
        let paths: Vec<String> = log.lock().unwrap().iter().map(|r| r.path.clone()).collect();
        assert_eq!(
            paths,
            vec![
                "/.well-known/oauth-authorization-server".to_string(),
                "/.well-known/openid-configuration".to_string(),
            ]
        );
    }

    #[tokio::test]
    async fn fetch_as_metadata_errors_when_both_well_known_endpoints_fail() {
        let (base, _log) = spawn_stub(2, |_base, _req| StubResponse::status(404)).await;

        let client = reqwest::Client::new();
        let err = fetch_as_metadata(&client, &base).await.unwrap_err();
        assert!(
            err.to_string()
                .contains("Could not fetch Authorization Server Metadata"),
            "got: {err}"
        );
    }

    // ---- register_client ----

    #[tokio::test]
    async fn register_client_posts_expected_fields_and_parses_response() {
        let (base, log) = spawn_stub(1, |_base, req| {
            match (req.method.as_str(), req.path.as_str()) {
                ("POST", "/register") => {
                    StubResponse::json(r#"{"client_id": "client-abc", "client_secret": "sekret"}"#)
                }
                _ => StubResponse::status(404),
            }
        })
        .await;

        let client = reqwest::Client::new();
        let (client_id, client_secret) = register_client(
            &client,
            &format!("{base}/register"),
            "http://127.0.0.1:8915/callback",
        )
        .await
        .unwrap();

        assert_eq!(client_id, "client-abc");
        assert_eq!(client_secret, Some("sekret".to_string()));

        let requests = log.lock().unwrap();
        assert_eq!(requests.len(), 1);
        let request = &requests[0];
        assert_eq!(request.method, "POST");
        assert_eq!(request.path, "/register");
        assert!(
            request
                .header("content-type")
                .is_some_and(|v| v.starts_with("application/json")),
            "content-type: {:?}",
            request.header("content-type")
        );
        let body: serde_json::Value = serde_json::from_str(&request.body).unwrap();
        assert_eq!(body["client_name"], "ChatShell Desktop");
        assert_eq!(body["token_endpoint_auth_method"], "none");
        assert_eq!(
            body["grant_types"],
            serde_json::json!(["authorization_code"])
        );
        assert_eq!(body["response_types"], serde_json::json!(["code"]));
        assert_eq!(
            body["redirect_uris"],
            serde_json::json!(["http://127.0.0.1:8915/callback"])
        );
    }

    #[tokio::test]
    async fn register_client_errors_with_status_and_truncated_body() {
        let (base, _log) = spawn_stub(1, |_base, req| {
            match (req.method.as_str(), req.path.as_str()) {
                ("POST", "/register") => StubResponse::status(400)
                    .body(format!("invalid redirect uri: {}", "x".repeat(600))),
                _ => StubResponse::status(404),
            }
        })
        .await;

        let client = reqwest::Client::new();
        let err = register_client(
            &client,
            &format!("{base}/register"),
            "http://127.0.0.1:8915/callback",
        )
        .await
        .unwrap_err();
        let message = err.to_string();
        assert!(message.contains("Registration failed"), "got: {message}");
        assert!(message.contains("400"), "got: {message}");
        // The failure body is truncated to 500 chars.
        let truncated: String = "invalid redirect uri: "
            .chars()
            .chain(std::iter::repeat('x').take(600))
            .collect::<String>()
            .chars()
            .take(500)
            .collect();
        assert!(message.contains(&truncated), "got {} chars", message.len());
        assert!(
            !message.contains(&format!("invalid redirect uri: {}", "x".repeat(600))),
            "full body should not be echoed"
        );
    }

    // ---- exchange_code ----

    fn decode_form(body: &str) -> std::collections::HashMap<String, String> {
        body.split('&')
            .filter_map(|pair| {
                let (k, v) = pair.split_once('=')?;
                Some((
                    urlencoding::decode(k).unwrap().into_owned(),
                    urlencoding::decode(v).unwrap().into_owned(),
                ))
            })
            .collect()
    }

    #[tokio::test]
    async fn exchange_code_posts_form_fields_and_parses_tokens() {
        let (base, log) = spawn_stub(1, |_base, req| {
            match (req.method.as_str(), req.path.as_str()) {
                ("POST", "/token") => StubResponse::json(
                    r#"{
                    "access_token": "at-xyz",
                    "token_type": "Bearer",
                    "expires_in": 3600,
                    "refresh_token": "rt-abc"
                }"#,
                ),
                _ => StubResponse::status(404),
            }
        })
        .await;

        let mut discovery = discovery_fixture();
        discovery.authorization_endpoint = format!("{base}/authorize");
        discovery.token_endpoint = format!("{base}/token");
        discovery.resource_uri = "https://res.example.com".to_string();

        let (_challenge, verifier) = PkceCodeChallenge::new_random_sha256();
        let verifier_secret = verifier.secret().clone();
        let tokens = exchange_code(
            &discovery,
            "http://127.0.0.1:8915/callback",
            "client-abc",
            None,
            "auth-code-123",
            "state-xyz",
            verifier,
        )
        .await
        .unwrap();

        assert_eq!(tokens.access_token, "at-xyz");
        assert_eq!(tokens.refresh_token.as_deref(), Some("rt-abc"));
        assert_eq!(tokens.expires_in_secs, Some(3600));

        let requests = log.lock().unwrap();
        assert_eq!(requests.len(), 1);
        let request = &requests[0];
        assert_eq!(request.method, "POST");
        assert_eq!(request.path, "/token");
        assert!(
            request
                .header("content-type")
                .is_some_and(|v| v.starts_with("application/x-www-form-urlencoded")),
            "content-type: {:?}",
            request.header("content-type")
        );
        let form = decode_form(&request.body);
        assert_eq!(
            form.get("grant_type").map(String::as_str),
            Some("authorization_code")
        );
        assert_eq!(form.get("code").map(String::as_str), Some("auth-code-123"));
        assert_eq!(
            form.get("redirect_uri").map(String::as_str),
            Some("http://127.0.0.1:8915/callback")
        );
        assert_eq!(
            form.get("client_id").map(String::as_str),
            Some("client-abc")
        );
        assert_eq!(
            form.get("code_verifier").map(String::as_str),
            Some(verifier_secret.as_str())
        );
        assert_eq!(
            form.get("resource").map(String::as_str),
            Some("https://res.example.com")
        );
    }

    #[tokio::test]
    async fn exchange_code_errors_on_error_response() {
        let (base, _log) = spawn_stub(1, |_base, req| {
            match (req.method.as_str(), req.path.as_str()) {
                ("POST", "/token") => {
                    StubResponse::status(400).body(r#"{"error": "invalid_grant"}"#)
                }
                _ => StubResponse::status(404),
            }
        })
        .await;

        let mut discovery = discovery_fixture();
        discovery.authorization_endpoint = format!("{base}/authorize");
        discovery.token_endpoint = format!("{base}/token");

        let (_challenge, verifier) = PkceCodeChallenge::new_random_sha256();
        let err = exchange_code(
            &discovery,
            "http://127.0.0.1:8915/callback",
            "client-abc",
            None,
            "auth-code-123",
            "state-xyz",
            verifier,
        )
        .await
        .unwrap_err();
        assert!(
            err.to_string().contains("Token exchange failed"),
            "got: {err}"
        );
    }

    // ---- callback server ----

    #[tokio::test]
    async fn callback_server_responds_and_delivers_code_and_state() {
        let (port, rx) = run_callback_server().await.unwrap();
        let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .unwrap();
        let request = format!(
            "GET /callback?code=auth%2Bcode&state=st-123 HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
        );
        stream.write_all(request.as_bytes()).await.unwrap();

        let mut response = Vec::new();
        stream.read_to_end(&mut response).await.unwrap();
        let response = String::from_utf8_lossy(&response);
        assert!(response.starts_with("HTTP/1.1 200 OK"), "got: {response}");
        assert!(
            response.contains("Authorization complete"),
            "got: {response}"
        );

        let (code, state) = rx.await.unwrap();
        assert_eq!(code, "auth+code");
        assert_eq!(state, "st-123");
    }
}
