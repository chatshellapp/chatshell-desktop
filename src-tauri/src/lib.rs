mod commands;
mod crypto;
pub mod db;
mod llm;
pub mod models;
mod prompts;
mod scraper;
mod thinking_parser;

use commands::AppState;
use db::Database;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize database
    // For development, use current directory. For production, use app data directory
    let db_path = std::path::PathBuf::from("chatshell.db");
    
    let canonical_path = db_path.canonicalize().unwrap_or_else(|_| db_path.clone());
    println!("Database path: {:?}", canonical_path);

    let db_path_str = db_path.to_str()
        .unwrap_or_else(|| {
            eprintln!("FATAL: Invalid database path");
            std::process::exit(1);
        });
    let db = Database::new(db_path_str)
        .unwrap_or_else(|e| {
            eprintln!("FATAL: Failed to initialize database: {}", e);
            std::process::exit(1);
        });
    
    println!("Database initialized successfully");
    
    // Seed database with default assistants (async operation)
    let rt = tokio::runtime::Runtime::new()
        .unwrap_or_else(|e| {
            eprintln!("FATAL: Failed to create tokio runtime: {}", e);
            std::process::exit(1);
        });
    rt.block_on(async {
        db.seed_default_data().await
            .unwrap_or_else(|e| {
                eprintln!("FATAL: Failed to seed database: {}", e);
                std::process::exit(1);
            });
    });
    
    println!("Database seeded with default assistants");
    
    let app_state = AppState { 
        db,
        generation_tasks: Arc::new(RwLock::new(HashMap::new())),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(app_state)
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
            commands::update_model,
            commands::delete_model,
            // Assistant commands
            commands::create_assistant,
            commands::get_assistant,
            commands::list_assistants,
            commands::update_assistant,
            commands::delete_assistant,
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
            commands::add_conversation_participant,
            commands::list_conversation_participants,
            commands::get_conversation_participant_summary,
            commands::remove_conversation_participant,
            // Message commands
            commands::create_message,
            commands::list_messages_by_conversation,
            commands::clear_messages_by_conversation,
            // External resources commands
            commands::get_message_external_resources,
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
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            eprintln!("FATAL: Error while running tauri application: {}", e);
            std::process::exit(1);
        });
}
