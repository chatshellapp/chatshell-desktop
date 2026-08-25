mod blob_sync;
pub mod commands;
mod crypto;
pub mod db;
mod keychain;
mod llm;
mod logger;
pub mod mcp;
pub mod models;
mod prompts;
mod search;
pub mod skills;
pub mod storage;
pub mod sync;
#[cfg(target_os = "macos")]
pub mod sync_keychain;
mod thinking_parser;
mod tokenizer;
mod web_fetch;
mod web_search;

use commands::AppState;
use db::Database;
use llm::capabilities::CapabilitiesCache;
use llm::tools::BashSessionManager;
use mcp::McpConnectionManager;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::RwLock;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // macOS GUI apps launched from Finder/Spotlight inherit a minimal PATH
    // (/usr/bin:/bin:/usr/sbin:/sbin) that doesn't include user-installed
    // tools like node/npx. Resolve the full PATH from the user's login shell.
    #[cfg(target_os = "macos")]
    {
        if let Some(path) = mcp::resolve_shell_path() {
            // SAFETY: Called at process start before any threads are spawned.
            unsafe {
                std::env::set_var("PATH", &path);
            }
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // Initialize app data directory
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("FATAL: Failed to get app data directory");
            std::fs::create_dir_all(&app_data_dir)
                .expect("FATAL: Failed to create app data directory");

            // Initialize logger first
            let log_dir = app_data_dir.join("logs");
            if let Err(e) = logger::init_logger(log_dir) {
                tracing::error!("FATAL: Failed to initialize logger: {}", e);
                std::process::exit(1);
            }

            tracing::info!("Application starting");

            // Initialize storage directories
            if let Err(e) = storage::init_storage_dirs(app.handle()) {
                tracing::warn!("Failed to initialize storage directories: {}", e);
            }

            let db_path = app_data_dir.join("data.db");
            tracing::info!("Database path: {:?}", db_path);

            let db_path_str = db_path
                .to_str()
                .expect("FATAL: Invalid database path")
                .to_string();

            // Create tokio runtime for async database initialization
            let rt = tokio::runtime::Runtime::new().expect("FATAL: Failed to create tokio runtime");

            let db = rt.block_on(async {
                Database::new(&db_path_str)
                    .await
                    .expect("FATAL: Failed to initialize database")
            });

            tracing::info!("Database initialized successfully");

            // Export the master encryption key for the sync engine's
            // publish path to write into the cloud container.
            // Safety: single-threaded setup phase, no concurrent env access.
            let master_key_b64 = crate::crypto::get_master_key_b64().ok();

            // Seed database with default data (async operation)
            rt.block_on(async {
                db.seed_default_data()
                    .await
                    .expect("FATAL: Failed to seed database");
            });

            tracing::info!("Database seeded with default data");

            rt.block_on(async {
                db.backfill_fts()
                    .await
                    .expect("FATAL: Failed to backfill FTS search index");
            });

            // Master-key adoption repair: when the iCloud-synchronizable
            // item replaced a different local key, re-encrypt rows that
            // still carry the old key's ciphertext so peers can open them
            // (runs before the first sync pass ships anything).
            rt.block_on(async {
                match db.repair_master_key_ciphertext().await {
                    Ok(n) if n > 0 => {
                        tracing::info!("Re-encrypted {n} row(s) under the adopted master key")
                    }
                    Ok(_) => {}
                    Err(e) => {
                        tracing::warn!("Master-key ciphertext repair failed (will retry next launch): {e:#}")
                    }
                }
            });

            // Load log level from database
            rt.block_on(async {
                match logger::load_log_level_from_db(&db).await {
                    Ok(level) => {
                        if let Err(e) = logger::set_log_level(&level) {
                            tracing::warn!("Failed to set log level from database: {}", e);
                        } else {
                            tracing::info!("Log level set to: {}", level);
                        }
                    }
                    Err(e) => {
                        tracing::warn!("Failed to load log level from database: {}", e);
                    }
                }
            });

            // Load bundled model capabilities data
            let capabilities_cache = {
                let resource_path = app
                    .path()
                    .resolve("resources/models_dev.json", tauri::path::BaseDirectory::Resource)
                    .expect("FATAL: Failed to resolve bundled models_dev.json path");
                rt.block_on(async {
                    match CapabilitiesCache::load_from_file(&resource_path).await {
                        Ok(cache) => Arc::new(cache),
                        Err(e) => {
                            tracing::warn!(
                                "Failed to load model capabilities from {:?}: {}. Using empty cache.",
                                resource_path, e
                            );
                            Arc::new(CapabilitiesCache::new())
                        }
                    }
                })
            };

            // Republish the master key into the iCloud-synchronizable
            // keychain ONLY when this launch minted one or found the
            // transport item missing. Adoption and steady state never
            // write: an unconditional write-back would overwrite the
            // ecosystem key with the local one whenever the item read
            // transiently fails (loser-overwrites-winner).
            #[cfg(target_os = "macos")]
            if crate::crypto::should_publish_master_key()
                && let Some(key_b64) = &master_key_b64
            {
                if let Err(err) = crate::sync_keychain::set_synchronizable_master_key(key_b64) {
                    tracing::warn!("Failed to store sync master key: {err:?}");
                }
            }

            // Snapshot sync against the iCloud container. When Apple hasn't
            // provisioned it yet (or on machines without iCloud), fall back
            // to a local staging dir so publish/sync_now stay exercisable -
            // the engine only needs a writable directory.
            let sync_target = sync::detect_icloud_container()
                .map(|dir| (dir, "iCloud container".to_string()))
                .or_else(|| {
                    let staging = app_data_dir.join("sync-staging");
                    std::fs::create_dir_all(&staging)
                        .ok()
                        .map(|_| (staging, "local staging dir".to_string()))
                });
            let sync_engine = match sync_target
                .map(|(dir, reason)| sync::SyncEngine::new(&db_path, dir).map(|e| (e, reason)))
            {
                Some(Ok((engine, reason))) => {
                    tracing::info!("Snapshot sync enabled ({reason})");
                    Some(engine)
                }
                Some(Err(err)) => {
                    tracing::warn!("Snapshot sync disabled: {err}");
                    None
                }
                None => {
                    tracing::warn!("Snapshot sync disabled: no sync target available");
                    None
                }
            };

            let app_state = AppState {
                db,
                generation_tasks: Arc::new(RwLock::new(HashMap::new())),
                mcp_manager: Arc::new(McpConnectionManager::new()),
                pending_oauth: Arc::new(RwLock::new(HashMap::new())),
                bash_session_manager: Arc::new(BashSessionManager::new()),
                capabilities_cache,
                sync_engine: Arc::new(std::sync::Mutex::new(sync_engine)),
            };

            // Pull remote changes shortly after startup, then keep ticking
            // on an interval so mid-session changes converge without waiting
            // for the next relaunch. Idle passes are near-free (the engine
            // skips publishing unless the pool wrote since the last one).
            {
                let engine = app_state.sync_engine.clone();
                let db = app_state.db.clone();
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    if let Err(err) =
                        sync::run_sync_pass(engine.clone(), db.clone(), handle.clone()).await
                    {
                        tracing::warn!("Sync pass failed: {err:?}");
                    }
                    let mut ticker = tokio::time::interval(sync::SYNC_TICK_INTERVAL);
                    ticker.tick().await; // consume the immediate first tick
                    loop {
                        ticker.tick().await;
                        if let Err(err) =
                            sync::run_sync_pass(engine.clone(), db.clone(), handle.clone()).await
                        {
                            tracing::warn!("Sync pass failed: {err:?}");
                        }
                    }
                });
            }
            // Grab handle before app_state is moved into managed state
            let manager_for_sweep = app_state.bash_session_manager.clone();
            app.manage(app_state);

            // Spawn background task to sweep idle bash sessions every 5 minutes
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(std::time::Duration::from_secs(300));
                loop {
                    interval.tick().await;
                    manager_for_sweep
                        .sweep_idle(std::time::Duration::from_secs(900))
                        .await;
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Provider commands
            commands::create_provider,
            commands::get_provider,
            commands::list_providers,
            commands::update_provider,
            commands::delete_provider,
            // Model commands
            commands::create_model,
            commands::get_model,
            commands::list_models,
            commands::list_all_models,
            commands::update_model,
            commands::delete_model,
            // Model Parameter Preset commands
            commands::list_model_parameter_presets,
            commands::get_model_parameter_preset,
            commands::get_default_model_parameter_preset,
            commands::create_model_parameter_preset,
            commands::update_model_parameter_preset,
            commands::delete_model_parameter_preset,
            // Assistant commands
            commands::create_assistant,
            commands::get_assistant,
            commands::list_assistants,
            commands::update_assistant,
            commands::delete_assistant,
            // Prompt commands
            commands::create_prompt,
            commands::get_prompt,
            commands::list_prompts,
            commands::list_prompts_by_category,
            commands::update_prompt,
            commands::delete_prompt,
            commands::toggle_prompt_star,
            // User commands
            commands::create_user,
            commands::get_user,
            commands::get_self_user,
            commands::list_users,
            // Conversation commands
            commands::create_conversation,
            commands::get_conversation,
            commands::list_conversations,
            commands::update_conversation,
            commands::delete_conversation,
            commands::fork_conversation,
            commands::chat::title::generate_conversation_title_manually,
            commands::add_conversation_participant,
            commands::list_conversation_participants,
            commands::get_conversation_participant_summary,
            commands::remove_conversation_participant,
            // Conversation Settings commands
            commands::get_conversation_settings,
            commands::update_conversation_settings,
            commands::reset_conversation_tools_to_global,
            commands::delete_conversation_settings,
            // Message commands
            commands::create_message,
            commands::list_messages_by_conversation,
            commands::clear_messages_by_conversation,
            commands::delete_messages_from,
            commands::search_chat_history,
            // User Attachments (files)
            commands::get_message_attachments,
            commands::get_file_attachment,
            commands::fetch_conversation_blobs,
            // Context Enrichments (search results, fetch results)
            commands::get_message_contexts,
            commands::get_search_result,
            commands::get_fetch_result,
            commands::get_fetch_results_by_source,
            commands::get_fetch_results_by_message,
            // Process Steps (thinking, decisions, tool calls)
            commands::get_message_steps,
            commands::get_thinking_step,
            commands::get_search_decision,
            // Combined resources
            commands::get_message_resources,
            // Content reading
            commands::read_fetch_content,
            commands::read_file_content,
            commands::read_image_base64,
            commands::get_attachment_url,
            commands::copy_image_to_clipboard,
            // File reading commands (for files selected via dialog)
            commands::read_text_file_from_path,
            commands::read_file_as_base64,
            // Settings commands
            commands::get_setting,
            commands::set_setting,
            commands::get_all_settings,
            commands::set_log_level,
            // Crypto commands
            commands::generate_keypair,
            commands::export_keypair,
            commands::import_keypair,
            commands::is_keychain_available,
            // Model fetching commands
            commands::fetch_openai_models,
            commands::fetch_openrouter_models,
            commands::fetch_ollama_models,
            commands::fetch_provider_models,
            commands::check_provider_api,
            // Chat commands
            commands::send_message,
            commands::stop_generation,
            // Web search commands
            commands::chat::web_search::perform_web_search,
            commands::chat::web_search::extract_search_keywords,
            commands::chat::web_search::get_search_providers,
            // MCP commands
            commands::create_mcp_server,
            commands::list_mcp_servers,
            commands::get_mcp_server,
            commands::update_mcp_server,
            commands::delete_mcp_server,
            commands::toggle_mcp_server,
            commands::set_all_tools_enabled,
            commands::sync_now,
            commands::test_mcp_connection,
            commands::test_mcp_stdio_connection,
            commands::disconnect_mcp_server,
            commands::list_mcp_server_tools,
            commands::get_conversation_mcp_servers,
            commands::start_mcp_oauth,
            commands::complete_mcp_oauth,
            commands::check_mcp_oauth_status,
            commands::revoke_mcp_oauth,
            commands::set_mcp_bearer_token,
            commands::probe_mcp_endpoint,
            // Skill commands
            commands::list_skills,
            commands::get_skill,
            commands::create_skill,
            commands::update_skill,
            commands::delete_skill,
            commands::toggle_skill,
            commands::set_all_skills_enabled,
            commands::scan_skills,
            commands::read_skill_content,
            commands::open_skills_directory,
            commands::get_skill_sources,
            commands::set_skill_source_enabled,
            // Model capabilities commands
            commands::get_model_capabilities,
            commands::refresh_capabilities_cache,
        ])
        .build(tauri::generate_context!())
        .unwrap_or_else(|e| {
            tracing::error!("FATAL: Error while building tauri application: {}", e);
            std::process::exit(1);
        })
        .run(move |app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                tracing::info!("Application exiting, cleaning up bash sessions");
                let state: tauri::State<'_, AppState> = app_handle.state();
                state.bash_session_manager.kill_all_sync();
                // Best-effort final snapshot publish so other devices see
                // the latest local state. New attachment bytes go first:
                // blobs-before-snapshots keeps peer references dangling-free.
                if let Ok(mut guard) = state.sync_engine.lock() {
                    let cloud_dir = guard
                        .as_ref()
                        .map(|engine| engine.cloud_dir().to_path_buf());
                    if let Some(dir) = cloud_dir
                        && let Ok(attach_dir) =
                            crate::storage::get_attachments_dir(app_handle)
                    {
                        let db = state.db.clone();
                        if let Err(err) = tauri::async_runtime::block_on(
                            blob_sync::ensure_referenced_blobs_uploaded(
                                &db,
                                &dir,
                                &attach_dir,
                            ),
                        ) {
                            tracing::warn!("Final blob upload failed: {err:#}");
                        }
                    }
                    if let Some(engine) = guard.as_mut()
                        && let Err(err) = engine.publish()
                    {
                        tracing::warn!("Final snapshot publish failed: {err}");
                    }
                }
            }
        });
}
