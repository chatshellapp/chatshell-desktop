//! MCP OAuth 2.0/2.1 authorization flow.
//!
//! Implements discovery (RFC 9728 Protected Resource Metadata, RFC 8414 AS Metadata),
//! PKCE (S256), token exchange, and callback server for HTTP-based MCP servers.

use anyhow::{Context, Result};
use oauth2::{
    basic::BasicClient, AuthUrl, AuthorizationCode, ClientId, ClientSecret, PkceCodeChallenge,
    PkceCodeVerifier, RedirectUrl, Scope, TokenResponse, TokenUrl,
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
pub async fn discover(client: &reqwest::Client, mcp_endpoint: &str) -> Result<OAuthDiscoveryResult> {
    let resource_uri = normalize_resource_uri(mcp_endpoint)?;

    // 1. Probe unauthenticated request to get 401 + WWW-Authenticate
    let resp = client
        .get(mcp_endpoint)
        .send()
        .await
        .context("Failed to probe MCP endpoint")?;

    let resource_metadata_url = if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        let params = parse_www_authenticate(resp.headers())?;
        params
            .resource_metadata
            .ok_or_else(|| anyhow::anyhow!("401 response missing resource_metadata in WWW-Authenticate"))?
    } else {
        // Fallback: well-known URI (RFC 9728)
        let base = Url::parse(mcp_endpoint).context("Invalid MCP endpoint URL")?;
        let path = base.path().trim_end_matches('/');
        let well_known = if path.is_empty() || path == "/" {
            format!("{}/.well-known/oauth-protected-resource", base.origin().ascii_serialization())
        } else {
            format!(
                "{}/.well-known/oauth-protected-resource{}",
                base.origin().ascii_serialization(),
                path
            )
        };
        well_known
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

    let scopes = if as_metadata.scopes_supported.as_ref().map(|s| s.is_empty()).unwrap_or(true) {
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

    // Parse Bearer key="value", key2="value2"
    for part in value.split(',') {
        let part = part.trim();
        if part.eq_ignore_ascii_case("Bearer") {
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
        if let Ok(resp) = client.get(url).send().await {
            if resp.status().is_success() {
                if let Ok(meta) = resp.json().await {
                    return Ok(meta);
                }
            }
        }
    }
    anyhow::bail!("Could not fetch Authorization Server Metadata from {}", issuer)
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
    let token_url = TokenUrl::new(discovery.token_endpoint.clone())
        .context("Invalid token endpoint")?;
    let redirect_url = RedirectUrl::new(redirect_uri.to_string()).context("Invalid redirect URI")?;

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
    http_client: &reqwest::Client,
) -> Result<OAuthTokens> {
    let auth_url = AuthUrl::new(discovery.authorization_endpoint.clone())
        .context("Invalid authorization endpoint")?;
    let token_url = TokenUrl::new(discovery.token_endpoint.clone())
        .context("Invalid token endpoint")?;
    let redirect_url = RedirectUrl::new(redirect_uri.to_string()).context("Invalid redirect URI")?;

    let mut client = BasicClient::new(ClientId::new(client_id.to_string()))
        .set_auth_uri(auth_url)
        .set_token_uri(token_url)
        .set_redirect_uri(redirect_url);

    if let Some(secret) = client_secret {
        client = client.set_client_secret(ClientSecret::new(secret.to_string()));
    }

    let token_response = client
        .exchange_code(AuthorizationCode::new(code.to_string()))
        .set_pkce_verifier(pkce_verifier)
        .add_extra_param("resource", &discovery.resource_uri)
        .request_async(http_client)
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
pub async fn run_callback_server(
) -> Result<(u16, oneshot::Receiver<(String, String)>)> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .context("Failed to bind callback server")?;
    let port = listener
        .local_addr()
        .context("No local addr")?
        .port();

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
            Some(urlencoding::decode(v).unwrap_or(std::borrow::Cow::Borrowed(v)).into_owned())
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
    let n = stream.read(&mut buf).await.context("Read callback request")?;
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
