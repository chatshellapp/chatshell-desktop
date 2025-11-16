mod commands;
mod crypto;
mod db;
mod llm;
mod models;
mod scraper;
mod thinking_parser;

use commands::AppState;
use db::Database;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize database
    // For development, use current directory. For production, use app data directory
    let db_path = std::path::PathBuf::from("chatshell.db");
    
    println!("Database path: {:?}", db_path.canonicalize().unwrap_or(db_path.clone()));

    let db = Database::new(db_path.to_str().unwrap()).expect("Failed to initialize database");
    
    println!("Database initialized successfully");
    
    // Seed database with default agents
    db.seed_default_data().expect("Failed to seed database");
    
    println!("Database seeded with default agents");
    
    let app_state = AppState { db };

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
            // Agent commands
            commands::create_agent,
            commands::get_agent,
            commands::list_agents,
            commands::update_agent,
            commands::delete_agent,
            // Topic commands
            commands::create_topic,
            commands::get_topic,
            commands::list_topics,
            commands::update_topic,
            commands::delete_topic,
            // Message commands
            commands::create_message,
            commands::list_messages,
            commands::clear_messages,
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
            // Chat command
            commands::send_message,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
