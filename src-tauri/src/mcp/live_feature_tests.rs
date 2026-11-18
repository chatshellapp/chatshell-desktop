//! Live end-to-end checks of the MCP client against real servers:
//! `@modelcontextprotocol/server-everything` over STDIO (via npx) and the
//! public example server over Streamable HTTP. Ignored by default (they need
//! node/npx and the network):
//!
//! ```sh
//! cargo test --lib mcp::live_feature_tests -- --ignored --nocapture --test-threads=1
//! ```

use std::sync::Arc;

use chatshell_agent_core::mcp::{
    self as core_mcp, McpCallOptions, McpElicitationAnswer, McpElicitationPrompter,
    McpElicitationRequest, call_tool_with_options, render_call_tool_result,
};
use rmcp::model::CallToolRequestParams;

use super::manager::{McpConnectionManager, McpServerConnection};
use crate::models::{McpConfig, Tool};

const EVERYTHING: &str = "npx -y @modelcontextprotocol/server-everything";

fn stdio_tool(name: &str, command: &str) -> Tool {
    let config = McpConfig::stdio(command.to_string());
    Tool {
        id: uuid::Uuid::now_v7().to_string(),
        name: name.to_string(),
        r#type: "mcp".to_string(),
        endpoint: None,
        config: Some(config.to_json().unwrap()),
        description: None,
        is_enabled: true,
        auth_token: None,
        created_at: chrono::Utc::now().to_rfc3339(),
        updated_at: chrono::Utc::now().to_rfc3339(),
    }
}

/// Answers every form with values that fit its schema; opens no links.
struct AutoForm;
impl McpElicitationPrompter for AutoForm {
    fn prompt(
        &self,
        server: String,
        request: McpElicitationRequest,
        _dismissed: tokio_util::sync::CancellationToken,
    ) -> futures::future::BoxFuture<'static, McpElicitationAnswer> {
        println!("  [elicitation from {server}] {request:?}");
        let answer = match request {
            McpElicitationRequest::Form { schema, .. } => {
                let mut content = serde_json::Map::new();
                if let Some(props) = schema["properties"].as_object() {
                    for (name, def) in props {
                        let value = if let Some(first) =
                            def["enum"].as_array().and_then(|e| e.first())
                        {
                            first.clone()
                        } else if let Some(first) = def["oneOf"].as_array().and_then(|e| e.first())
                        {
                            first["const"].clone()
                        } else {
                            match def["type"].as_str() {
                                Some("boolean") => serde_json::json!(true),
                                Some("integer") => {
                                    serde_json::json!(def["minimum"].as_i64().unwrap_or(1).max(1))
                                }
                                Some("number") => serde_json::json!(
                                    def["minimum"].as_f64().unwrap_or(1.0).max(1.0)
                                ),
                                Some("array") => {
                                    let items = def["items"]["enum"]
                                        .as_array()
                                        .cloned()
                                        .unwrap_or_default();
                                    serde_json::json!(items.into_iter().take(1).collect::<Vec<_>>())
                                }
                                _ => match def["format"].as_str() {
                                    Some("email") => serde_json::json!("ada@example.com"),
                                    Some("uri") => serde_json::json!("https://example.com"),
                                    Some("date") => serde_json::json!("2026-11-17"),
                                    Some("date-time") => serde_json::json!("2026-11-17T12:00:00Z"),
                                    _ => serde_json::json!("Ada"),
                                },
                            }
                        };
                        content.insert(name.clone(), value);
                    }
                }
                McpElicitationAnswer::Accept(serde_json::Value::Object(content))
            }
            McpElicitationRequest::Url { .. } => McpElicitationAnswer::Decline,
        };
        Box::pin(async move { answer })
    }
}

fn manager() -> McpConnectionManager {
    let manager = McpConnectionManager::new();
    manager.set_elicitation_prompter(Arc::new(AutoForm));
    manager
}

async fn call(
    conn: &McpServerConnection,
    name: &str,
    args: serde_json::Value,
) -> Result<(String, bool, usize), String> {
    let mut params = CallToolRequestParams::new(name.to_string());
    params.arguments = args.as_object().cloned();
    let progress = conn.progress_dispatcher();
    let handler = conn.handler();
    let seen = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let counter = seen.clone();
    let result = call_tool_with_options(
        &conn.client,
        params,
        McpCallOptions::from_settings(Some(60), Some(true), Some(120)),
        Some(&progress),
        Some(&handler),
        move |_| {
            counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        },
    )
    .await
    .map_err(|e| e.to_string())?;
    let rendered = render_call_tool_result(&result);
    Ok((
        rendered.text,
        rendered.is_error,
        seen.load(std::sync::atomic::Ordering::SeqCst),
    ))
}

fn short(text: &str) -> String {
    let flat = text.replace('\n', " ");
    if flat.chars().count() > 160 {
        format!("{}…", flat.chars().take(160).collect::<String>())
    } else {
        flat
    }
}

#[tokio::test]
#[ignore = "needs node/npx: runs @modelcontextprotocol/server-everything"]
async fn probe_server_everything() {
    let manager = manager();
    let tool = stdio_tool("everything", EVERYTHING);
    let conn = manager.connect(&tool).await.expect("connect via STDIO");
    let info = conn.client.peer_info().unwrap();
    println!(
        "server: {:?} protocol {} caps {}",
        info.server_info.as_ref().map(|i| (&i.name, &i.version)),
        info.protocol_version,
        serde_json::to_string(&info.capabilities).unwrap()
    );
    println!("tools ({}):", conn.mcp_tools.len());
    for t in &conn.mcp_tools {
        println!(
            "  {} annotations={} output_schema={} input={}",
            t.name,
            t.annotations
                .as_ref()
                .map(|a| serde_json::to_string(a).unwrap())
                .unwrap_or_default(),
            t.output_schema.is_some(),
            short(&serde_json::to_string(&t.input_schema).unwrap())
        );
    }
    println!(
        "resources ({}), templates ({})",
        conn.resources.len(),
        conn.resource_templates.len()
    );
    let prompts = core_mcp::list_all_prompts_bounded(&conn.client, "everything")
        .await
        .unwrap();
    println!("prompts ({}):", prompts.len());
    for p in &prompts {
        println!(
            "  {} args={:?}",
            p.name,
            p.arguments
                .iter()
                .map(|a| (&a.name, a.required))
                .collect::<Vec<_>>()
        );
    }
}

/// Run one tool through desktop's `mcp_tool_use` (scanning, deadlines,
/// rendering, MRTR) the way the agent does.
async fn tool_use(
    conn: &McpServerConnection,
    server: &str,
    tool: &str,
    args: serde_json::Value,
) -> Result<String, String> {
    use crate::llm::tools::{McpClientEntry, McpToolUseTool};
    use rig::agent::tool::Tool as _;
    let entry = McpClientEntry {
        server_name: server.to_string(),
        peer: conn.client.clone(),
        call_options: conn.call_options,
        progress: conn.progress_dispatcher(),
        handler: conn.handler(),
    };
    let mut map = std::collections::HashMap::new();
    map.insert(format!("{server}/{tool}"), entry);
    let tool_use = McpToolUseTool::new(Arc::new(tokio::sync::RwLock::new(map)));
    tool_use
        .call(
            &mut rig::agent::tool::ToolContext::default(),
            serde_json::from_value(serde_json::json!({
                "server": server, "tool": tool, "arguments": args
            }))
            .unwrap(),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tokio::test]
#[ignore = "needs node/npx: runs @modelcontextprotocol/server-everything"]
async fn server_everything_features() {
    let manager = manager();
    let tool = stdio_tool("everything", EVERYTHING);
    let root = std::env::temp_dir().join("chatshell-live-root");
    std::fs::create_dir_all(&root).unwrap();
    manager.set_server_root(&tool.id, root.clone());
    let conn = manager.connect(&tool).await.expect("connect via STDIO");
    let mut report: Vec<(String, bool, String)> = Vec::new();
    let mut check = |name: &str, ok: bool, detail: String| {
        println!(
            "{} {name}: {}",
            if ok { "PASS" } else { "FAIL" },
            short(&detail)
        );
        report.push((name.to_string(), ok, detail));
    };

    // FR-1: every tool listed (the server returns them in one page).
    check(
        "tools listed",
        conn.mcp_tools.len() == 16,
        format!("{} tools", conn.mcp_tools.len()),
    );

    // Plain text through mcp_tool_use.
    let echo = tool_use(
        &conn,
        "everything",
        "echo",
        serde_json::json!({"message": "hi there"}),
    )
    .await;
    check(
        "echo via mcp_tool_use",
        echo.as_deref().is_ok_and(|t| t.contains("hi there")),
        format!("{echo:?}"),
    );

    let sum = call(&conn, "get-sum", serde_json::json!({"a": 2, "b": 40})).await;
    check(
        "get-sum",
        sum.as_ref().is_ok_and(|(t, e, _)| t.contains("42") && !e),
        format!("{sum:?}"),
    );

    // FR-2: structuredContent (outputSchema declared).
    let structured = call(
        &conn,
        "get-structured-content",
        serde_json::json!({"location": "Chicago"}),
    )
    .await;
    check(
        "structuredContent rendered once",
        structured
            .as_ref()
            .is_ok_and(|(t, _, _)| t.contains("temperature") || t.contains("Temperature")),
        format!("{structured:?}"),
    );

    // Images and resource links / embedded resources.
    let image = call(&conn, "get-tiny-image", serde_json::json!({})).await;
    check(
        "image as data URI",
        image
            .as_ref()
            .is_ok_and(|(t, _, _)| t.contains("data:image/png;base64,")),
        format!("{image:?}"),
    );
    let links = call(&conn, "get-resource-links", serde_json::json!({"count": 2})).await;
    check(
        "resource links",
        links
            .as_ref()
            .is_ok_and(|(t, _, _)| t.contains("[resource link]")),
        format!("{links:?}"),
    );
    let reference = call(
        &conn,
        "get-resource-reference",
        serde_json::json!({"resourceId": 1}),
    )
    .await;
    check(
        "embedded resource",
        reference.as_ref().is_ok_and(|(t, _, _)| !t.is_empty()),
        format!("{reference:?}"),
    );

    // FR-6: progress resets the deadline (2 s idle, ~3 s operation).
    let mut params = CallToolRequestParams::new("trigger-long-running-operation".to_string());
    params.arguments = serde_json::json!({"duration": 3, "steps": 6})
        .as_object()
        .cloned();
    let seen = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let counter = seen.clone();
    let progress = conn.progress_dispatcher();
    let started = std::time::Instant::now();
    let long = call_tool_with_options(
        &conn.client,
        params,
        McpCallOptions::from_settings(Some(2), Some(true), Some(30)),
        Some(&progress),
        Some(&conn.handler()),
        move |_| {
            counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        },
    )
    .await;
    let n = seen.load(std::sync::atomic::Ordering::SeqCst);
    check(
        "progress keeps a 2 s deadline alive",
        long.is_ok() && n >= 3,
        format!(
            "ok={} progress events={n} elapsed={:?}",
            long.is_ok(),
            started.elapsed()
        ),
    );

    // FR-4: without progress reset the same call times out (and is cancelled).
    let mut params = CallToolRequestParams::new("trigger-long-running-operation".to_string());
    params.arguments = serde_json::json!({"duration": 4, "steps": 4})
        .as_object()
        .cloned();
    let timed = call_tool_with_options(
        &conn.client,
        params,
        McpCallOptions::from_settings(Some(1), Some(false), None),
        None,
        Some(&conn.handler()),
        |_| {},
    )
    .await;
    check(
        "deadline without reset times out",
        matches!(timed, Err(rmcp::service::ServiceError::Timeout { .. })),
        format!("{timed:?}"),
    );
    // The connection survives the timeout.
    let after = call(&conn, "echo", serde_json::json!({"message": "still here"})).await;
    check(
        "connection usable after timeout",
        after
            .as_ref()
            .is_ok_and(|(t, _, _)| t.contains("still here")),
        format!("{after:?}"),
    );

    // FR-12: form elicitation answered by the prompter, validated, returned.
    let elicit = call(&conn, "trigger-elicitation-request", serde_json::json!({})).await;
    check(
        "form elicitation accepted",
        elicit
            .as_ref()
            .is_ok_and(|(t, _, _)| t.to_lowercase().contains("accept")),
        format!("{elicit:?}"),
    );
    let url = call(
        &conn,
        "trigger-url-elicitation",
        serde_json::json!({"url": "https://example.com/verify"}),
    )
    .await;
    check(
        "URL elicitation declined (never opened automatically)",
        url.as_ref()
            .is_ok_and(|(t, _, _)| t.to_lowercase().contains("decline")),
        format!("{url:?}"),
    );

    // FR-14: roots answer with this run's root.
    let roots = call(&conn, "get-roots-list", serde_json::json!({})).await;
    let root_uri = url::Url::from_directory_path(&root).unwrap().to_string();
    check(
        "roots/list returns the run root",
        roots
            .as_ref()
            .is_ok_and(|(t, _, _)| t.contains(root_uri.trim_end_matches('/'))),
        format!("expected {root_uri}; got {roots:?}"),
    );

    // FR-8: resources listed and read through mcp_resource_read.
    check(
        "resources listed",
        !conn.resources.is_empty() && !conn.resource_templates.is_empty(),
        format!(
            "{} resources, {} templates",
            conn.resources.len(),
            conn.resource_templates.len()
        ),
    );
    for resource in conn.resources.iter().take(7) {
        let read = core_mcp::read_resource_with_options(
            &conn.client,
            &resource.uri,
            McpCallOptions::default(),
            Some(&conn.handler()),
        )
        .await;
        let spill = tempfile::tempdir().unwrap();
        let target = chatshell_agent_core::tools::SpillTarget {
            dir: spill.path().to_path_buf(),
            reference_scheme: Some("tool-output".into()),
        };
        let rendered = read
            .as_ref()
            .map(|r| core_mcp::render_read_resource_result(r, Some(&target)))
            .map_err(|e| e.to_string());
        let ok = rendered
            .as_ref()
            .is_ok_and(|t| t.starts_with("<resource") || t.contains("saved to tool-output://"));
        check(
            &format!("read {}", resource.uri),
            ok,
            format!("{rendered:?}"),
        );
    }

    // Binary contents are spilled, never inlined.
    let blob_uri = "demo://resource/dynamic/blob/1";
    let blob = core_mcp::read_resource_with_options(
        &conn.client,
        blob_uri,
        McpCallOptions::default(),
        Some(&conn.handler()),
    )
    .await;
    let spill = tempfile::tempdir().unwrap();
    let target = chatshell_agent_core::tools::SpillTarget {
        dir: spill.path().to_path_buf(),
        reference_scheme: Some("tool-output".into()),
    };
    let rendered = blob
        .as_ref()
        .map(|r| core_mcp::render_read_resource_result(r, Some(&target)))
        .map_err(|e| e.to_string());
    let files = std::fs::read_dir(spill.path())
        .map(|d| d.count())
        .unwrap_or(0);
    check(
        "blob resource spilled to tool-output",
        rendered
            .as_ref()
            .is_ok_and(|t| t.contains("saved to tool-output://mcp-resource-"))
            && files == 1,
        format!("{rendered:?} files={files}"),
    );

    // FR-13: prompts listed and rendered with arguments.
    let simple = core_mcp::get_prompt_text(
        &conn.client,
        "simple-prompt",
        Default::default(),
        Some(&conn.handler()),
    )
    .await;
    check(
        "simple-prompt",
        simple.as_ref().is_ok_and(|t| !t.is_empty()),
        format!("{simple:?}"),
    );
    let mut args = std::collections::BTreeMap::new();
    args.insert("city".to_string(), "Lisbon".to_string());
    let with_args =
        core_mcp::get_prompt_text(&conn.client, "args-prompt", args, Some(&conn.handler())).await;
    check(
        "args-prompt with city",
        with_args.as_ref().is_ok_and(|t| t.contains("Lisbon")),
        format!("{with_args:?}"),
    );
    let mut bad = std::collections::BTreeMap::new();
    bad.insert("city".to_string(), "~/.ssh/id_rsa".to_string());
    let blocked =
        core_mcp::get_prompt_text(&conn.client, "args-prompt", bad, Some(&conn.handler())).await;
    check(
        "blocked path in prompt args refused",
        blocked.is_err(),
        format!("{blocked:?}"),
    );

    // INV-1: blocked arguments never reach the server.
    let scanned = tool_use(
        &conn,
        "everything",
        "echo",
        serde_json::json!({"message": "~/.ssh/id_rsa"}),
    )
    .await;
    check(
        "blocked path in tool args refused",
        scanned.is_err(),
        format!("{scanned:?}"),
    );

    // FR-3: definition sync keeps annotations and outputSchema.
    let dir = tempfile::tempdir().unwrap();
    let out = super::sync_tool_definitions(dir.path(), "everything", &conn.mcp_tools).unwrap();
    let def: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(out.join("get-structured-content.json")).unwrap(),
    )
    .unwrap();
    check(
        "definition files carry annotations + outputSchema",
        def["annotations"]["readOnlyHint"] == true && def.get("outputSchema").is_some(),
        def.to_string(),
    );

    // Logging notifications (FR-11) are accepted without a setLevel request.
    let logging = call(&conn, "toggle-simulated-logging", serde_json::json!({})).await;
    check("logging toggle", logging.is_ok(), format!("{logging:?}"));

    let failed: Vec<_> = report
        .iter()
        .filter(|(_, ok, _)| !ok)
        .map(|(n, _, _)| n.clone())
        .collect();
    println!(
        "\n{} checks, {} failed: {failed:?}",
        report.len(),
        failed.len()
    );
    assert!(failed.is_empty(), "failed: {failed:?}");
}

/// Sign in to the example server (headless mock IdP) and build its row.
async fn example_server_tool(prefer_2026: bool) -> Tool {
    let (discovery, client_id, tokens) = super::live_tests::sign_in().await;
    let mut config = McpConfig::http();
    config.auth_type = Some(crate::models::McpAuthType::Oauth);
    config.prefer_2026_protocol = prefer_2026.then_some(true);
    config.oauth_metadata = Some(crate::models::OAuthMetadata {
        authorization_server_url: discovery.authorization_server_url.clone(),
        client_id: Some(client_id),
        scopes: Some(discovery.scopes_supported.clone()),
        token_expires_at: tokens
            .expires_in_secs
            .map(|s| chrono::Utc::now().timestamp() + s as i64),
        token_endpoint: Some(discovery.token_endpoint.clone()),
        is_authorized: true,
    });
    let token_json = serde_json::json!({
        "access_token": tokens.access_token,
        "refresh_token": tokens.refresh_token,
    });
    Tool {
        id: uuid::Uuid::now_v7().to_string(),
        name: "example".into(),
        r#type: "mcp".into(),
        endpoint: Some("https://example-server.modelcontextprotocol.io/mcp".into()),
        config: Some(config.to_json().unwrap()),
        description: None,
        is_enabled: true,
        auth_token: Some(crate::crypto::encrypt(&token_json.to_string()).unwrap()),
        created_at: chrono::Utc::now().to_rfc3339(),
        updated_at: chrono::Utc::now().to_rfc3339(),
    }
}

async fn probe_example(prefer_2026: bool) {
    let manager = manager();
    let tool = example_server_tool(prefer_2026).await;
    let conn = manager
        .connect(&tool)
        .await
        .map_err(|e| format!("{e:#}"))
        .expect("connect over Streamable HTTP with OAuth");
    let info = conn.client.peer_info().unwrap();
    println!(
        "[prefer_2026={prefer_2026}] server {:?} protocol {} caps {}",
        info.server_info.as_ref().map(|i| (&i.name, &i.version)),
        info.protocol_version,
        serde_json::to_string(&info.capabilities).unwrap()
    );
    println!("tools ({}):", conn.mcp_tools.len());
    for t in &conn.mcp_tools {
        println!(
            "  {} annotations={} output_schema={} input={}",
            t.name,
            t.annotations
                .as_ref()
                .map(|a| serde_json::to_string(a).unwrap())
                .unwrap_or_default(),
            t.output_schema.is_some(),
            short(&serde_json::to_string(&t.input_schema).unwrap())
        );
    }
    println!(
        "resources ({}), templates ({})",
        conn.resources.len(),
        conn.resource_templates.len()
    );
    for r in conn.resources.iter().take(5) {
        println!("  {} ({:?})", r.uri, r.mime_type);
    }
    let prompts = core_mcp::list_all_prompts_bounded(&conn.client, "example").await;
    println!(
        "prompts: {:?}",
        prompts.map(|p| p.into_iter().map(|p| p.name).collect::<Vec<_>>())
    );
}

#[tokio::test]
#[ignore = "network: hits example-server.modelcontextprotocol.io"]
async fn probe_example_server() {
    let _guard = crate::crypto::keys_test_guard();
    crate::crypto::set_keys_for_tests([0x5a; 32], None);
    probe_example(false).await;
    probe_example(true).await;
}

#[tokio::test]
#[ignore = "network: hits example-server.modelcontextprotocol.io"]
async fn example_server_features() {
    let _guard = crate::crypto::keys_test_guard();
    crate::crypto::set_keys_for_tests([0x5a; 32], None);
    let manager = manager();
    let tool = example_server_tool(false).await;
    let conn = manager
        .connect(&tool)
        .await
        .map_err(|e| format!("{e:#}"))
        .expect("connect over Streamable HTTP with OAuth");
    let mut report: Vec<(String, bool)> = Vec::new();
    let mut check = |name: &str, ok: bool, detail: String| {
        println!(
            "{} {name}: {}",
            if ok { "PASS" } else { "FAIL" },
            short(&detail)
        );
        report.push((name.to_string(), ok));
    };

    check(
        "tools listed",
        conn.mcp_tools.len() == 9,
        format!("{}", conn.mcp_tools.len()),
    );
    // FR-1 applied to resources: the server pages its 110 resources.
    check(
        "all resource pages followed",
        conn.resources.len() == 110,
        format!("{}", conn.resources.len()),
    );

    let echo = tool_use(
        &conn,
        "example",
        "echo",
        serde_json::json!({"message": "over HTTP"}),
    )
    .await;
    check(
        "echo via mcp_tool_use",
        echo.as_deref().is_ok_and(|t| t.contains("over HTTP")),
        format!("{echo:?}"),
    );
    let add = call(&conn, "add", serde_json::json!({"a": 19, "b": 23})).await;
    check(
        "add",
        add.as_ref().is_ok_and(|(t, _, _)| t.contains("42")),
        format!("{add:?}"),
    );

    let long = call(
        &conn,
        "longRunningOperation",
        serde_json::json!({"duration": 3, "steps": 3}),
    )
    .await;
    check(
        "progress over HTTP",
        long.as_ref().is_ok_and(|(_, _, progress)| *progress >= 2),
        format!("{long:?}"),
    );

    let image = call(&conn, "getTinyImage", serde_json::json!({})).await;
    check(
        "image",
        image
            .as_ref()
            .is_ok_and(|(t, _, _)| t.contains("data:image/png;base64,")),
        format!("{image:?}"),
    );
    let annotated = call(
        &conn,
        "annotatedMessage",
        serde_json::json!({"messageType": "success", "includeImage": false}),
    )
    .await;
    check(
        "annotated message",
        annotated.as_ref().is_ok_and(|(t, _, _)| !t.is_empty()),
        format!("{annotated:?}"),
    );
    let reference = call(
        &conn,
        "getResourceReference",
        serde_json::json!({"resourceId": 1}),
    )
    .await;
    check(
        "embedded resource",
        reference
            .as_ref()
            .is_ok_and(|(t, _, _)| t.contains("test://static/resource/1")),
        format!("{reference:?}"),
    );

    let elicit = call(&conn, "elicitInputs", serde_json::json!({})).await;
    check(
        "form elicitation accepted",
        elicit
            .as_ref()
            .is_ok_and(|(t, e, _)| !e && t.to_lowercase().contains("accept")),
        format!("{elicit:?}"),
    );

    // Sampling is not offered (OQ-2), so the capability is not advertised and
    // the server must not ask; this server's sampleLLM then never answers.
    // The call must fail closed at its deadline (and be cancelled), not hang.
    let mut params = CallToolRequestParams::new("sampleLLM".to_string());
    params.arguments = serde_json::json!({"prompt": "hi", "maxTokens": 10})
        .as_object()
        .cloned();
    let started = std::time::Instant::now();
    let sample = call_tool_with_options(
        &conn.client,
        params,
        McpCallOptions::from_settings(Some(8), Some(false), None),
        None,
        Some(&conn.handler()),
        |_| {},
    )
    .await;
    check(
        "sampling: no capability advertised, call bounded by its deadline",
        matches!(sample, Err(rmcp::service::ServiceError::Timeout { .. }))
            && started.elapsed().as_secs() < 12
            && conn.client.peer_info().is_some(),
        format!("{sample:?} in {:?}", started.elapsed()),
    );
    let after = call(
        &conn,
        "echo",
        serde_json::json!({"message": "after sampling"}),
    )
    .await;
    check(
        "connection usable after the sampling timeout",
        after
            .as_ref()
            .is_ok_and(|(t, _, _)| t.contains("after sampling")),
        format!("{after:?}"),
    );

    // Resources: text inline, binary spilled.
    for uri in ["test://static/resource/1", "test://static/resource/2"] {
        let read = core_mcp::read_resource_with_options(
            &conn.client,
            uri,
            McpCallOptions::default(),
            Some(&conn.handler()),
        )
        .await;
        let spill = tempfile::tempdir().unwrap();
        let target = chatshell_agent_core::tools::SpillTarget {
            dir: spill.path().to_path_buf(),
            reference_scheme: Some("tool-output".into()),
        };
        let rendered = read
            .as_ref()
            .map(|r| core_mcp::render_read_resource_result(r, Some(&target)))
            .map_err(|e| e.to_string());
        let ok = if uri.ends_with('1') {
            rendered.as_ref().is_ok_and(|t| t.starts_with("<resource"))
        } else {
            rendered
                .as_ref()
                .is_ok_and(|t| t.contains("saved to tool-output://"))
        };
        check(&format!("read {uri}"), ok, format!("{rendered:?}"));
    }

    // Prompts.
    let prompts = core_mcp::list_all_prompts_bounded(&conn.client, "example")
        .await
        .unwrap();
    for prompt in &prompts {
        let mut args = std::collections::BTreeMap::new();
        for a in &prompt.arguments {
            let value = match (prompt.name.as_str(), a.name.as_str()) {
                (_, "resourceId") => "3",
                (_, "temperature") => "0.7",
                (_, "style") => "concise",
                _ => "x",
            };
            args.insert(a.name.clone(), value.to_string());
        }
        let text =
            core_mcp::get_prompt_text(&conn.client, &prompt.name, args, Some(&conn.handler()))
                .await;
        check(
            &format!("prompt {}", prompt.name),
            text.as_ref().is_ok_and(|t| !t.is_empty()),
            format!("{text:?}"),
        );
    }

    let failed: Vec<_> = report
        .iter()
        .filter(|(_, ok)| !ok)
        .map(|(n, _)| n.clone())
        .collect();
    println!(
        "\n{} checks, {} failed: {failed:?}",
        report.len(),
        failed.len()
    );
    assert!(failed.is_empty(), "failed: {failed:?}");
}
