pub mod commands;
mod crypto;
pub mod db;
mod llm;
pub mod models;
mod prompts;
pub mod storage;
mod thinking_parser;
mod web_fetch;
mod web_search;

use commands::AppState;
use db::Database;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::RwLock;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // Initialize storage directories
            if let Err(e) = storage::init_storage_dirs(app.handle()) {
                eprintln!("Warning: Failed to initialize storage directories: {}", e);
            }

            // Initialize database in app data directory
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("FATAL: Failed to get app data directory");
            std::fs::create_dir_all(&app_data_dir)
                .expect("FATAL: Failed to create app data directory");

            let db_path = app_data_dir.join("data.db");
            println!("📂 [db] Database path: {:?}", db_path);

            let db_path_str = db_path.to_str().expect("FATAL: Invalid database path").to_string();
            
            // Create tokio runtime for async database initialization
            let rt = tokio::runtime::Runtime::new().expect("FATAL: Failed to create tokio runtime");
            
            let db = rt.block_on(async {
                Database::new(&db_path_str).await.expect("FATAL: Failed to initialize database")
            });

            println!("✅ [db] Database initialized successfully");

            // Seed database with default data (async operation)
            rt.block_on(async {
                db.seed_default_data()
                    .await
                    .expect("FATAL: Failed to seed database");
            });

            println!("✅ [db] Database seeded with default data");

            let app_state = AppState {
                db,
                generation_tasks: Arc::new(RwLock::new(HashMap::new())),
            };
            app.manage(app_state);

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
            commands::soft_delete_model,
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
            commands::chat::title::generate_conversation_title_manually,
            commands::add_conversation_participant,
            commands::list_conversation_participants,
            commands::get_conversation_participant_summary,
            commands::remove_conversation_participant,
            // Message commands
            commands::create_message,
            commands::list_messages_by_conversation,
            commands::clear_messages_by_conversation,
            // User Attachments (files)
            commands::get_message_attachments,
            commands::get_file_attachment,
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
            // File reading commands (for files selected via dialog)
            commands::read_text_file_from_path,
            commands::read_file_as_base64,
            // Settings commands
            commands::get_setting,
            commands::set_setting,
            commands::get_all_settings,
            // Crypto commands
            commands::generate_keypair,
            commands::export_keypair,
            commands::import_keypair,
            // Model fetching commands
            commands::fetch_openai_models,
            commands::fetch_openrouter_models,
            commands::fetch_ollama_models,
            // Chat commands
            commands::send_message,
            commands::stop_generation,
            // Web search commands
            commands::chat::web_search::perform_web_search,
            commands::chat::web_search::extract_search_keywords,
            commands::chat::web_search::get_search_providers,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            eprintln!("FATAL: Error while running tauri application: {}", e);
            std::process::exit(1);
        });
}
