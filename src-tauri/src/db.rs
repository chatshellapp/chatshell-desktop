use anyhow::Result;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

use crate::models::*;

#[derive(Clone)]
pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

impl Database {
    pub fn new(db_path: &str) -> Result<Self> {
        let conn = Connection::open(db_path)?;
        let db = Database {
            conn: Arc::new(Mutex::new(conn)),
        };
        db.init_schema()?;
        Ok(db)
    }

    fn init_schema(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();

        // Providers table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS providers (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                provider_type TEXT NOT NULL,
                api_key TEXT,
                base_url TEXT,
                description TEXT,
                is_enabled INTEGER DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
            [],
        )?;

        // Models table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS models (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                provider_id TEXT NOT NULL,
                model_id TEXT NOT NULL,
                description TEXT,
                is_starred INTEGER DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
            )",
            [],
        )?;

        // Assistants table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS assistants (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                role TEXT,
                description TEXT,
                system_prompt TEXT NOT NULL,
                user_prompt TEXT,
                model_id TEXT NOT NULL,
                avatar_type TEXT DEFAULT 'text',
                avatar_bg TEXT,
                avatar_text TEXT,
                avatar_image_path TEXT,
                avatar_image_url TEXT,
                group_name TEXT,
                is_starred INTEGER DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (model_id) REFERENCES models(id)
            )",
            [],
        )?;

        // Topics table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS topics (
                id TEXT PRIMARY KEY,
                assistant_id TEXT NOT NULL,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (assistant_id) REFERENCES assistants(id) ON DELETE CASCADE
            )",
            [],
        )?;

        // Knowledge bases table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS knowledge_bases (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                content TEXT,
                url TEXT,
                metadata TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
            [],
        )?;

        // Assistant-KnowledgeBase junction table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS assistant_knowledge_bases (
                id TEXT PRIMARY KEY,
                assistant_id TEXT NOT NULL,
                knowledge_base_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (assistant_id) REFERENCES assistants(id) ON DELETE CASCADE,
                FOREIGN KEY (knowledge_base_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE,
                UNIQUE(assistant_id, knowledge_base_id)
            )",
            [],
        )?;

        // MCPs table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS mcps (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                endpoint TEXT,
                config TEXT,
                description TEXT,
                is_enabled INTEGER DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
            [],
        )?;

        // Assistant-MCP junction table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS assistant_mcps (
                id TEXT PRIMARY KEY,
                assistant_id TEXT NOT NULL,
                mcp_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (assistant_id) REFERENCES assistants(id) ON DELETE CASCADE,
                FOREIGN KEY (mcp_id) REFERENCES mcps(id) ON DELETE CASCADE,
                UNIQUE(assistant_id, mcp_id)
            )",
            [],
        )?;

        // Messages table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                topic_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                thinking_content TEXT,
                scraped_content TEXT,
                scraping_error TEXT,
                tokens INTEGER,
                created_at TEXT NOT NULL,
                FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
            )",
            [],
        )?;

        // Settings table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
            [],
        )?;

        // Enable foreign keys
        conn.execute("PRAGMA foreign_keys = ON", [])?;

        Ok(())
    }

    // Provider CRUD operations
    pub fn create_provider(&self, req: CreateProviderRequest) -> Result<Provider> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();
        let is_enabled = req.is_enabled.unwrap_or(true);

        {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO providers (id, name, provider_type, api_key, base_url, description, is_enabled, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    id,
                    req.name,
                    req.provider_type,
                    req.api_key,
                    req.base_url,
                    req.description,
                    is_enabled as i32,
                    now,
                    now
                ],
            )?;
        }

        self.get_provider(&id)?
            .ok_or_else(|| anyhow::anyhow!("Failed to retrieve created provider"))
    }

    pub fn get_provider(&self, id: &str) -> Result<Option<Provider>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, provider_type, api_key, base_url, description, is_enabled, created_at, updated_at
             FROM providers WHERE id = ?1",
        )?;

        let provider = stmt
            .query_row(params![id], |row| {
                Ok(Provider {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    provider_type: row.get(2)?,
                    api_key: row.get(3)?,
                    base_url: row.get(4)?,
                    description: row.get(5)?,
                    is_enabled: row.get::<_, i32>(6)? != 0,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            })
            .optional()?;

        Ok(provider)
    }

    pub fn list_providers(&self) -> Result<Vec<Provider>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, provider_type, api_key, base_url, description, is_enabled, created_at, updated_at
             FROM providers ORDER BY created_at ASC",
        )?;

        let providers = stmt
            .query_map([], |row| {
                Ok(Provider {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    provider_type: row.get(2)?,
                    api_key: row.get(3)?,
                    base_url: row.get(4)?,
                    description: row.get(5)?,
                    is_enabled: row.get::<_, i32>(6)? != 0,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(providers)
    }

    pub fn update_provider(&self, id: &str, req: CreateProviderRequest) -> Result<Provider> {
        let now = Utc::now().to_rfc3339();
        let is_enabled = req.is_enabled.unwrap_or(true);

        {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "UPDATE providers SET name = ?1, provider_type = ?2, api_key = ?3, base_url = ?4, description = ?5, is_enabled = ?6, updated_at = ?7 WHERE id = ?8",
                params![
                    req.name,
                    req.provider_type,
                    req.api_key,
                    req.base_url,
                    req.description,
                    is_enabled as i32,
                    now,
                    id
                ],
            )?;
        }

        self.get_provider(id)?
            .ok_or_else(|| anyhow::anyhow!("Provider not found"))
    }

    pub fn delete_provider(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM providers WHERE id = ?1", params![id])?;
        Ok(())
    }

    // Model CRUD operations
    pub fn create_model(&self, req: CreateModelRequest) -> Result<Model> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();
        let is_starred = req.is_starred.unwrap_or(false);

        {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO models (id, name, provider_id, model_id, description, is_starred, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    id,
                    req.name,
                    req.provider_id,
                    req.model_id,
                    req.description,
                    is_starred as i32,
                    now,
                    now
                ],
            )?;
        }

        self.get_model(&id)?
            .ok_or_else(|| anyhow::anyhow!("Failed to retrieve created model"))
    }

    pub fn get_model(&self, id: &str) -> Result<Option<Model>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, provider_id, model_id, description, is_starred, created_at, updated_at
             FROM models WHERE id = ?1",
        )?;

        let model = stmt
            .query_row(params![id], |row| {
                Ok(Model {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    provider_id: row.get(2)?,
                    model_id: row.get(3)?,
                    description: row.get(4)?,
                    is_starred: row.get::<_, i32>(5)? != 0,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            })
            .optional()?;

        Ok(model)
    }

    pub fn list_models(&self) -> Result<Vec<Model>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, provider_id, model_id, description, is_starred, created_at, updated_at
             FROM models ORDER BY created_at ASC",
        )?;

        let models = stmt
            .query_map([], |row| {
                Ok(Model {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    provider_id: row.get(2)?,
                    model_id: row.get(3)?,
                    description: row.get(4)?,
                    is_starred: row.get::<_, i32>(5)? != 0,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(models)
    }

    pub fn update_model(&self, id: &str, req: CreateModelRequest) -> Result<Model> {
        let now = Utc::now().to_rfc3339();
        let is_starred = req.is_starred.unwrap_or(false);

        {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "UPDATE models SET name = ?1, provider_id = ?2, model_id = ?3, description = ?4, is_starred = ?5, updated_at = ?6 WHERE id = ?7",
                params![
                    req.name,
                    req.provider_id,
                    req.model_id,
                    req.description,
                    is_starred as i32,
                    now,
                    id
                ],
            )?;
        }

        self.get_model(id)?
            .ok_or_else(|| anyhow::anyhow!("Model not found"))
    }

    pub fn delete_model(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM models WHERE id = ?1", params![id])?;
        Ok(())
    }

    // Assistant CRUD operations
    pub fn create_assistant(&self, req: CreateAssistantRequest) -> Result<Assistant> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();
        let is_starred = req.is_starred.unwrap_or(false);
        let avatar_type = req.avatar_type.unwrap_or_else(|| "text".to_string());

        {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO assistants (id, name, role, description, system_prompt, user_prompt, model_id, 
                 avatar_type, avatar_bg, avatar_text, avatar_image_path, avatar_image_url, 
                 group_name, is_starred, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
                params![
                    id,
                    req.name,
                    req.role,
                    req.description,
                    req.system_prompt,
                    req.user_prompt,
                    req.model_id,
                    avatar_type,
                    req.avatar_bg,
                    req.avatar_text,
                    req.avatar_image_path,
                    req.avatar_image_url,
                    req.group_name,
                    is_starred as i32,
                    now,
                    now
                ],
            )?;
        }

        self.get_assistant(&id)?
            .ok_or_else(|| anyhow::anyhow!("Failed to retrieve created assistant"))
    }

    pub fn get_assistant(&self, id: &str) -> Result<Option<Assistant>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, role, description, system_prompt, user_prompt, model_id, 
             avatar_type, avatar_bg, avatar_text, avatar_image_path, avatar_image_url, 
             group_name, is_starred, created_at, updated_at
             FROM assistants WHERE id = ?1",
        )?;

        let assistant = stmt
            .query_row(params![id], |row| {
                Ok(Assistant {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    role: row.get(2)?,
                    description: row.get(3)?,
                    system_prompt: row.get(4)?,
                    user_prompt: row.get(5)?,
                    model_id: row.get(6)?,
                    avatar_type: row.get(7)?,
                    avatar_bg: row.get(8)?,
                    avatar_text: row.get(9)?,
                    avatar_image_path: row.get(10)?,
                    avatar_image_url: row.get(11)?,
                    group_name: row.get(12)?,
                    is_starred: row.get::<_, i32>(13)? != 0,
                    created_at: row.get(14)?,
                    updated_at: row.get(15)?,
                })
            })
            .optional()?;

        Ok(assistant)
    }

    pub fn list_assistants(&self) -> Result<Vec<Assistant>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, role, description, system_prompt, user_prompt, model_id, 
             avatar_type, avatar_bg, avatar_text, avatar_image_path, avatar_image_url, 
             group_name, is_starred, created_at, updated_at
             FROM assistants ORDER BY created_at DESC",
        )?;

        let assistants = stmt
            .query_map([], |row| {
                Ok(Assistant {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    role: row.get(2)?,
                    description: row.get(3)?,
                    system_prompt: row.get(4)?,
                    user_prompt: row.get(5)?,
                    model_id: row.get(6)?,
                    avatar_type: row.get(7)?,
                    avatar_bg: row.get(8)?,
                    avatar_text: row.get(9)?,
                    avatar_image_path: row.get(10)?,
                    avatar_image_url: row.get(11)?,
                    group_name: row.get(12)?,
                    is_starred: row.get::<_, i32>(13)? != 0,
                    created_at: row.get(14)?,
                    updated_at: row.get(15)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(assistants)
    }

    pub fn update_assistant(&self, id: &str, req: CreateAssistantRequest) -> Result<Assistant> {
        let now = Utc::now().to_rfc3339();
        let is_starred = req.is_starred.unwrap_or(false);
        let avatar_type = req.avatar_type.unwrap_or_else(|| "text".to_string());

        {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "UPDATE assistants SET name = ?1, role = ?2, description = ?3, system_prompt = ?4, 
                 user_prompt = ?5, model_id = ?6, avatar_type = ?7, avatar_bg = ?8, avatar_text = ?9, 
                 avatar_image_path = ?10, avatar_image_url = ?11, group_name = ?12, 
                 is_starred = ?13, updated_at = ?14 WHERE id = ?15",
                params![
                    req.name,
                    req.role,
                    req.description,
                    req.system_prompt,
                    req.user_prompt,
                    req.model_id,
                    avatar_type,
                    req.avatar_bg,
                    req.avatar_text,
                    req.avatar_image_path,
                    req.avatar_image_url,
                    req.group_name,
                    is_starred as i32,
                    now,
                    id
                ],
            )?;
        }

        self.get_assistant(id)?
            .ok_or_else(|| anyhow::anyhow!("Assistant not found"))
    }

    pub fn delete_assistant(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM assistants WHERE id = ?1", params![id])?;
        Ok(())
    }

    // Topic CRUD operations
    pub fn create_topic(&self, req: CreateTopicRequest) -> Result<Topic> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();

        {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO topics (id, assistant_id, title, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![id, req.assistant_id, req.title, now, now],
            )?;
        }

        self.get_topic(&id)?
            .ok_or_else(|| anyhow::anyhow!("Failed to retrieve created topic"))
    }

    pub fn get_topic(&self, id: &str) -> Result<Option<Topic>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, assistant_id, title, created_at, updated_at
             FROM topics WHERE id = ?1",
        )?;

        let topic = stmt
            .query_row(params![id], |row| {
                Ok(Topic {
                    id: row.get(0)?,
                    assistant_id: row.get(1)?,
                    title: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            })
            .optional()?;

        Ok(topic)
    }

    pub fn list_topics(&self, assistant_id: &str) -> Result<Vec<Topic>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, assistant_id, title, created_at, updated_at
             FROM topics WHERE assistant_id = ?1 ORDER BY updated_at DESC",
        )?;

        let topics = stmt
            .query_map(params![assistant_id], |row| {
                Ok(Topic {
                    id: row.get(0)?,
                    assistant_id: row.get(1)?,
                    title: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(topics)
    }

    pub fn update_topic(&self, id: &str, title: &str) -> Result<Topic> {
        let now = Utc::now().to_rfc3339();

        {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "UPDATE topics SET title = ?1, updated_at = ?2 WHERE id = ?3",
                params![title, now, id],
            )?;
            // Lock released here
        }

        self.get_topic(id)?
            .ok_or_else(|| anyhow::anyhow!("Topic not found"))
    }

    pub fn delete_topic(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM topics WHERE id = ?1", params![id])?;
        Ok(())
    }

    // Message CRUD operations
    pub fn create_message(&self, req: CreateMessageRequest) -> Result<Message> {
        println!("🔒 [db] Acquiring lock for create_message...");
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();
        
        {
            let conn = self.conn.lock().unwrap();
            println!("✅ [db] Lock acquired");
            
            println!("💾 [db] Executing INSERT for message (topic_id: {})", req.topic_id);
            conn.execute(
                "INSERT INTO messages (id, topic_id, role, content, thinking_content, tokens, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    id,
                    req.topic_id,
                    req.role,
                    req.content,
                    req.thinking_content,
                    req.tokens,
                    now
                ],
            )?;
            println!("✅ [db] INSERT completed");
            // Lock is automatically released here when `conn` goes out of scope
        }

        println!("🔍 [db] Retrieving created message...");
        let result = self.get_message(&id)?
            .ok_or_else(|| anyhow::anyhow!("Failed to retrieve created message"));
        println!("✅ [db] Message retrieved: {:?}", result.is_ok());
        result
    }

    pub fn get_message(&self, id: &str) -> Result<Option<Message>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, topic_id, role, content, thinking_content, scraped_content, scraping_error, tokens, created_at
             FROM messages WHERE id = ?1",
        )?;

        let message = stmt
            .query_row(params![id], |row| {
                Ok(Message {
                    id: row.get(0)?,
                    topic_id: row.get(1)?,
                    role: row.get(2)?,
                    content: row.get(3)?,
                    thinking_content: row.get(4)?,
                    scraped_content: row.get(5)?,
                    scraping_error: row.get(6)?,
                    tokens: row.get(7)?,
                    created_at: row.get(8)?,
                })
            })
            .optional()?;

        Ok(message)
    }

    pub fn list_messages(&self, topic_id: &str) -> Result<Vec<Message>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, topic_id, role, content, thinking_content, scraped_content, scraping_error, tokens, created_at
             FROM messages WHERE topic_id = ?1 ORDER BY created_at ASC",
        )?;

        let messages = stmt
            .query_map(params![topic_id], |row| {
                Ok(Message {
                    id: row.get(0)?,
                    topic_id: row.get(1)?,
                    role: row.get(2)?,
                    content: row.get(3)?,
                    thinking_content: row.get(4)?,
                    scraped_content: row.get(5)?,
                    scraping_error: row.get(6)?,
                    tokens: row.get(7)?,
                    created_at: row.get(8)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(messages)
    }

    pub fn delete_messages_in_topic(&self, topic_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM messages WHERE topic_id = ?1", params![topic_id])?;
        Ok(())
    }

    // Update message with scraped content
    pub fn update_message_scraping(
        &self,
        id: &str,
        scraped_content: Option<String>,
        scraping_error: Option<String>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE messages SET scraped_content = ?1, scraping_error = ?2 WHERE id = ?3",
            params![scraped_content, scraping_error, id],
        )?;
        Ok(())
    }

    // Settings operations
    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;

        let value = stmt
            .query_row(params![key], |row| row.get(0))
            .optional()?;

        Ok(value)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().to_rfc3339();

        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)",
            params![key, value, now],
        )?;

        Ok(())
    }

    pub fn get_all_settings(&self) -> Result<Vec<Setting>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt =
            conn.prepare("SELECT key, value, updated_at FROM settings ORDER BY key")?;

        let settings = stmt
            .query_map([], |row| {
                Ok(Setting {
                    key: row.get(0)?,
                    value: row.get(1)?,
                    updated_at: row.get(2)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(settings)
    }

    // Seed database with default assistants if empty
    pub fn seed_default_data(&self) -> Result<()> {
        // Check if default ollama provider already exists
        let providers = self.list_providers()?;
        let has_ollama = providers.iter().any(|p| p.provider_type == "ollama");
        
        let ollama_provider = if has_ollama {
            // Use existing ollama provider
            providers.into_iter()
                .find(|p| p.provider_type == "ollama")
                .unwrap()
        } else {
            // Create default Ollama provider
            println!("🌱 [db] Seeding default Ollama provider...");
            let provider = self.create_provider(CreateProviderRequest {
                name: "Ollama Local".to_string(),
                provider_type: "ollama".to_string(),
                api_key: None,
                base_url: Some("http://localhost:11434".to_string()),
                description: Some("Local Ollama instance".to_string()),
                is_enabled: Some(true),
            })?;
            println!("✅ [db] Created provider: {}", provider.name);
            provider
        };

        // Check if models already exist for this provider
        let existing_models = self.list_models()?;
        let provider_has_models = existing_models.iter()
            .any(|m| m.provider_id == ollama_provider.id);
        
        if provider_has_models {
            println!("✅ [db] Models already exist for provider, skipping model seed");
            // Still check and seed assistants if needed
            let assistants = self.list_assistants()?;
            if assistants.is_empty() {
                println!("⚠️  [db] No assistants found, but models exist. You may need to manually create assistants.");
            }
            return Ok(());
        }

        println!("🌱 [db] Seeding default models...");

        // Create default models
        let gemma_model = self.create_model(CreateModelRequest {
            name: "Gemma 3 12B".to_string(),
            provider_id: ollama_provider.id.clone(),
            model_id: "gemma3:12b".to_string(),
            description: Some("Gemma 3 12B - Google's efficient instruction-following model".to_string()),
            is_starred: Some(false),
        })?;
        println!("✅ [db] Created model: {}", gemma_model.name);

        let gpt_oss_model = self.create_model(CreateModelRequest {
            name: "GPT-OSS 20B".to_string(),
            provider_id: ollama_provider.id.clone(),
            model_id: "gpt-oss:20b".to_string(),
            description: Some("GPT-OSS 20B - Open source GPT-style model for general tasks".to_string()),
            is_starred: Some(false),
        })?;
        println!("✅ [db] Created model: {}", gpt_oss_model.name);

        let deepseek_model = self.create_model(CreateModelRequest {
            name: "DeepSeek R1 14B".to_string(),
            provider_id: ollama_provider.id.clone(),
            model_id: "deepseek-r1:14b".to_string(),
            description: Some("DeepSeek R1 14B - Advanced reasoning model with thinking process".to_string()),
            is_starred: Some(true),
        })?;
        println!("✅ [db] Created model: {}", deepseek_model.name);

        // Check if assistants already exist
        let assistants = self.list_assistants()?;
        if !assistants.is_empty() {
            println!("✅ [db] Assistants already exist, skipping seed");
            return Ok(());
        }

        println!("🌱 [db] Seeding default assistants...");

        // Create default assistants using these models
        let default_assistants = vec![
            CreateAssistantRequest {
                name: "Code Assistant".to_string(),
                role: Some("Coding Expert".to_string()),
                description: Some("Help with programming tasks and technical questions".to_string()),
                system_prompt: "You are a helpful coding assistant. Help users with programming tasks, code review, debugging, and technical questions. Provide clear explanations and working code examples.".to_string(),
                user_prompt: None,
                model_id: gemma_model.id.clone(),
                avatar_type: Some("text".to_string()),
                avatar_bg: Some("#3b82f6".to_string()),
                avatar_text: Some("💻".to_string()),
                avatar_image_path: None,
                avatar_image_url: None,
                group_name: Some("Development".to_string()),
                is_starred: Some(true),
            },
            CreateAssistantRequest {
                name: "General Assistant".to_string(),
                role: Some("General Helper".to_string()),
                description: Some("General purpose AI assistant".to_string()),
                system_prompt: "You are a helpful, harmless, and honest AI assistant. Provide clear and accurate information to help users with their questions. Think through problems step by step.".to_string(),
                user_prompt: None,
                model_id: gpt_oss_model.id.clone(),
                avatar_type: Some("text".to_string()),
                avatar_bg: Some("#10b981".to_string()),
                avatar_text: Some("🤖".to_string()),
                avatar_image_path: None,
                avatar_image_url: None,
                group_name: Some("General".to_string()),
                is_starred: Some(false),
            },
            CreateAssistantRequest {
                name: "Research Assistant".to_string(),
                role: Some("Research Specialist".to_string()),
                description: Some("Help with research and data analysis".to_string()),
                system_prompt: "You are a research assistant. Help users find information, analyze data, and summarize findings. Provide detailed analysis with reasoning.".to_string(),
                user_prompt: None,
                model_id: deepseek_model.id.clone(),
                avatar_type: Some("text".to_string()),
                avatar_bg: Some("#8b5cf6".to_string()),
                avatar_text: Some("🔍".to_string()),
                avatar_image_path: None,
                avatar_image_url: None,
                group_name: Some("Research".to_string()),
                is_starred: Some(false),
            },
        ];

        for assistant_req in default_assistants {
            let assistant = self.create_assistant(assistant_req)?;
            println!("✅ [db] Created assistant: {}", assistant.name);
        }

        println!("🎉 [db] Seeding complete!");
        Ok(())
    }
}

