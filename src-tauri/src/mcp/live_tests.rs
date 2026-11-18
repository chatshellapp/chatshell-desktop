//! Live end-to-end check of MCP OAuth refresh against the public MCP example
//! server (its mock identity provider approves without a browser). Ignored
//! by default because it needs the network:
//!
//! ```sh
//! cargo test --lib mcp::live_tests -- --ignored --nocapture --test-threads=1
//! ```

use std::sync::{Arc, Mutex};

use anyhow::Result;

use super::manager::{McpConnectionManager, McpTokenStore, TokenUpdate};
use super::{auth_error, oauth};
use crate::models::{McpAuthType, McpConfig, OAuthMetadata, Tool};

const ENDPOINT: &str = "https://example-server.modelcontextprotocol.io/mcp";
const ORIGIN: &str = "https://example-server.modelcontextprotocol.io";
const REDIRECT_URI: &str = "http://127.0.0.1:8915/callback";

struct MemStore {
    tool: Mutex<Tool>,
}

#[async_trait::async_trait]
impl McpTokenStore for MemStore {
    async fn load(&self, _server_id: &str) -> Result<Tool> {
        Ok(self.tool.lock().unwrap().clone())
    }

    async fn save_grant(
        &self,
        _server_id: &str,
        token: TokenUpdate,
        metadata: OAuthMetadata,
    ) -> Result<Tool> {
        let mut tool = self.tool.lock().unwrap();
        match token {
            TokenUpdate::Keep => {}
            TokenUpdate::Set(t) => tool.auth_token = Some(t),
            TokenUpdate::Clear => tool.auth_token = None,
        }
        let mut config = tool.parse_mcp_config().unwrap();
        config.oauth_metadata = Some(metadata);
        tool.config = Some(config.to_json().unwrap());
        tool.updated_at = chrono::Utc::now().to_rfc3339();
        Ok(tool.clone())
    }
}

fn grant_of(tool: &Tool) -> Option<(String, Option<String>)> {
    let json = crate::crypto::decrypt(tool.auth_token.as_ref()?).ok()?;
    let v: serde_json::Value = serde_json::from_str(&json).ok()?;
    Some((
        v["access_token"].as_str()?.to_string(),
        v["refresh_token"].as_str().map(str::to_string),
    ))
}

fn metadata_of(tool: &Tool) -> OAuthMetadata {
    tool.parse_mcp_config().unwrap().oauth_metadata.unwrap()
}

/// Rewrite the stored grant (simulating expiry, revocation, a dead refresh
/// token) and return the updated row.
fn rewrite(store: &MemStore, access: &str, refresh: Option<&str>, expires_at: Option<i64>) -> Tool {
    let mut tool = store.tool.lock().unwrap();
    let json = serde_json::json!({ "access_token": access, "refresh_token": refresh });
    tool.auth_token = Some(crate::crypto::encrypt(&json.to_string()).unwrap());
    let mut config = tool.parse_mcp_config().unwrap();
    config.oauth_metadata.as_mut().unwrap().token_expires_at = expires_at;
    tool.config = Some(config.to_json().unwrap());
    tool.clone()
}

/// The real sign-in: discovery, dynamic registration, PKCE authorize via
/// the mock identity provider, code exchange.
pub(super) async fn sign_in() -> (oauth::OAuthDiscoveryResult, String, oauth::OAuthTokens) {
    let http = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();
    let discovery = oauth::discover(&http, ENDPOINT).await.expect("discovery");
    let registration = discovery
        .registration_endpoint
        .clone()
        .expect("registration endpoint");
    let (client_id, secret) = oauth::register_client(&http, &registration, REDIRECT_URI)
        .await
        .expect("registration");
    let auth = oauth::start_authorization(&discovery, REDIRECT_URI, &client_id, secret.as_deref())
        .expect("authorization url");

    // Consent page -> mock IdP (which would set code=mock-auth-code in JS).
    let page = http
        .get(&auth.auth_url)
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    let marker = "/mock-upstream-idp/authorize?";
    let start = page.find(marker).expect("mock IdP link on consent page");
    let href = &page[start..page[start..].find('"').unwrap() + start];
    let idp_state = href
        .split("state=")
        .nth(1)
        .unwrap()
        .split('&')
        .next()
        .unwrap()
        .to_string();

    let mut url = format!(
        "{ORIGIN}/mock-upstream-idp/callback?state={idp_state}&code=mock-auth-code&userId={}",
        uuid::Uuid::now_v7()
    );
    let (code, state) = loop {
        let resp = http.get(&url).send().await.unwrap();
        let location = resp
            .headers()
            .get(reqwest::header::LOCATION)
            .unwrap_or_else(|| panic!("no redirect from {url}: {}", resp.status()))
            .to_str()
            .unwrap()
            .to_string();
        if location.starts_with(REDIRECT_URI) {
            let parsed = url::Url::parse(&location).unwrap();
            let get = |k: &str| {
                parsed
                    .query_pairs()
                    .find(|(n, _)| n == k)
                    .map(|(_, v)| v.into_owned())
                    .unwrap_or_else(|| panic!("callback missing {k}: {location}"))
            };
            break (get("code"), get("state"));
        }
        url = if location.starts_with("http") {
            location
        } else {
            format!("{ORIGIN}{location}")
        };
    };
    assert_eq!(state, auth.state, "state round-trips");

    let tokens = oauth::exchange_code(
        &discovery,
        REDIRECT_URI,
        &client_id,
        secret.as_deref(),
        &code,
        &state,
        auth.pkce_verifier,
    )
    .await
    .expect("code exchange");
    (discovery, client_id, tokens)
}

#[tokio::test]
#[ignore = "network: hits example-server.modelcontextprotocol.io"]
async fn live_example_server_refresh_round_trip() {
    let guard = crate::crypto::keys_test_guard();
    crate::crypto::set_keys_for_tests([0x5a; 32], None);

    let (discovery, client_id, tokens) = sign_in().await;
    println!(
        "signed in: client {client_id}, expires_in {:?}, refresh token {}",
        tokens.expires_in_secs,
        if tokens.refresh_token.is_some() {
            "issued"
        } else {
            "NOT issued"
        }
    );
    let refresh = tokens
        .refresh_token
        .clone()
        .expect("server issues a refresh token");

    let mut config = McpConfig::http();
    config.auth_type = Some(McpAuthType::Oauth);
    config.oauth_metadata = Some(OAuthMetadata {
        authorization_server_url: discovery.authorization_server_url.clone(),
        client_id: Some(client_id.clone()),
        scopes: Some(discovery.scopes_supported.clone()),
        token_expires_at: tokens
            .expires_in_secs
            .map(|s| chrono::Utc::now().timestamp() + s as i64),
        token_endpoint: Some(discovery.token_endpoint.clone()),
        is_authorized: true,
    });
    let token_json =
        serde_json::json!({ "access_token": tokens.access_token, "refresh_token": refresh });
    let tool = Tool {
        id: uuid::Uuid::now_v7().to_string(),
        name: "Example".into(),
        r#type: "mcp".into(),
        endpoint: Some(ENDPOINT.into()),
        config: Some(config.to_json().unwrap()),
        description: None,
        is_enabled: true,
        auth_token: Some(crate::crypto::encrypt(&token_json.to_string()).unwrap()),
        created_at: chrono::Utc::now().to_rfc3339(),
        updated_at: chrono::Utc::now().to_rfc3339(),
    };
    let store = Arc::new(MemStore {
        tool: Mutex::new(tool.clone()),
    });
    let manager = McpConnectionManager::new();
    manager.set_token_store(store.clone());

    // 1. Fresh sign-in connects.
    let conn = manager
        .connect(&tool)
        .await
        .map_err(|e| format!("{e:#}"))
        .expect("connect");
    println!(
        "1. connected with fresh token: {} tools",
        conn.mcp_tools.len()
    );
    assert!(!conn.mcp_tools.is_empty());

    // 2. Proactive: stored expiry in the past -> refresh, then connect.
    let before = grant_of(&store.tool.lock().unwrap()).unwrap();
    let expired = rewrite(
        &store,
        &before.0,
        before.1.as_deref(),
        Some(chrono::Utc::now().timestamp() - 10),
    );
    manager.disconnect(&tool.id).await;
    manager
        .connect(&expired)
        .await
        .map_err(|e| format!("{e:#}"))
        .expect("connect after proactive refresh");
    let after = grant_of(&store.tool.lock().unwrap()).unwrap();
    assert_ne!(after.0, before.0, "access token replaced");
    println!(
        "2. proactive refresh ok; refresh token {}; new expiry {:?}",
        if after.1 != before.1 {
            "rotated"
        } else {
            "kept"
        },
        metadata_of(&store.tool.lock().unwrap()).token_expires_at
    );

    // 3. Reactive: no stored expiry, server rejects the access token -> one
    //    refresh, reconnect.
    let current = grant_of(&store.tool.lock().unwrap()).unwrap();
    let rejected = rewrite(&store, "not-a-valid-token", current.1.as_deref(), None);
    manager.disconnect(&tool.id).await;
    manager
        .connect(&rejected)
        .await
        .map_err(|e| format!("{e:#}"))
        .expect("connect after reactive refresh");
    let after = grant_of(&store.tool.lock().unwrap()).unwrap();
    assert_ne!(after.0, "not-a-valid-token");
    println!("3. reactive refresh after a real 401 ok");

    // 4. Mid-run: revoke the live access token, then call a tool on the
    //    cached connection -> AuthRequired + notifier, not a generic error.
    let live = manager
        .get_or_connect(&store.tool.lock().unwrap().clone())
        .await
        .unwrap();
    let access = grant_of(&store.tool.lock().unwrap()).unwrap().0;
    let revocation = reqwest::Client::new()
        .post(format!("{ORIGIN}//revoke"))
        .header(
            reqwest::header::CONTENT_TYPE,
            "application/x-www-form-urlencoded",
        )
        .body(
            url::form_urlencoded::Serializer::new(String::new())
                .extend_pairs([
                    ("token", access.as_str()),
                    ("client_id", client_id.as_str()),
                ])
                .finish(),
        )
        .send()
        .await
        .unwrap();
    println!("4. revoke access token: HTTP {}", revocation.status());
    let mut params = rmcp::model::CallToolRequestParams::new(live.mcp_tools[0].name.to_string());
    params.arguments = Some(serde_json::Map::new());
    match live.client.call_tool(params).await {
        Ok(result) => println!(
            "   call after revocation still succeeded (is_error={:?}); server does not enforce revocation on the session",
            result.is_error
        ),
        Err(e) => {
            println!("   call after revocation failed: {e}");
            println!(
                "   classified as auth failure: {}",
                auth_error::is_service_auth_error(&e)
            );
        }
    }

    // 5. Dead refresh token: invalid_grant -> needs-auth, grant cleared.
    let dead = rewrite(
        &store,
        "not-a-valid-token",
        Some("not-a-valid-refresh-token"),
        None,
    );
    manager.disconnect(&tool.id).await;
    let err = manager
        .connect(&dead)
        .await
        .err()
        .expect("dead refresh token must fail");
    println!("5. dead refresh token: {err:#}");
    assert!(auth_error::is_auth_error(&err), "classified needs-auth");
    let cleared = store.tool.lock().unwrap().clone();
    if grant_of(&cleared).is_none() {
        println!("   grant cleared (definitive rejection)");
        assert!(!metadata_of(&cleared).is_authorized);
    } else {
        println!("   grant kept (server's refresh error was not definitive)");
    }

    drop(guard);
}
