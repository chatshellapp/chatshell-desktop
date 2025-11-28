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

    /// Safely acquire database lock, converting poison errors to anyhow::Error
    fn lock_conn(&self) -> Result<std::sync::MutexGuard<'_, Connection>> {
        self.conn.lock().map_err(|e| {
            anyhow::anyhow!("Database lock poisoned: {}", e)
        })
    }

    fn init_schema(&self) -> Result<()> {
        let conn = self.lock_conn()?;

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

        // Users table (for current user and future friends feature)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                display_name TEXT NOT NULL,
                email TEXT UNIQUE,
                avatar_type TEXT DEFAULT 'text',
                avatar_bg TEXT,
                avatar_text TEXT,
                avatar_image_path TEXT,
                avatar_image_url TEXT,
                is_self INTEGER DEFAULT 0,
                status TEXT DEFAULT 'active',
                last_seen_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
            [],
        )?;

        // User relationships table (for friends feature)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS user_relationships (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                related_user_id TEXT NOT NULL,
                relationship_type TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (related_user_id) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE(user_id, related_user_id)
            )",
            [],
        )?;

        // Conversations table (replaces topics for multi-participant support)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
            [],
        )?;

        // Conversation participants table (many-to-many for users, models, and assistants)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS conversation_participants (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                participant_type TEXT NOT NULL,
                participant_id TEXT,
                display_name TEXT,
                role TEXT DEFAULT 'member',
                status TEXT DEFAULT 'active',
                joined_at TEXT NOT NULL,
                left_at TEXT,
                last_read_at TEXT,
                metadata TEXT,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
                UNIQUE(conversation_id, participant_type, participant_id)
            )",
            [],
        )?;

        // Indexes for better query performance
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_conversation_participants_conversation 
             ON conversation_participants(conversation_id)",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_conversation_participants_status 
             ON conversation_participants(conversation_id, status)",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_user_relationships_user 
             ON user_relationships(user_id, relationship_type)",
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

        // Tools table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS tools (
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

        // Assistant-Tool junction table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS assistant_tools (
                id TEXT PRIMARY KEY,
                assistant_id TEXT NOT NULL,
                tool_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (assistant_id) REFERENCES assistants(id) ON DELETE CASCADE,
                FOREIGN KEY (tool_id) REFERENCES tools(id) ON DELETE CASCADE,
                UNIQUE(assistant_id, tool_id)
            )",
            [],
        )?;

        // Messages table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT,
                sender_type TEXT NOT NULL,
                sender_id TEXT,
                content TEXT NOT NULL,
                thinking_content TEXT,
                tokens INTEGER,
                created_at TEXT NOT NULL,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
            )",
            [],
        )?;

        // Index for messages table
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_messages_conversation_created 
             ON messages(conversation_id, created_at DESC)",
            [],
        )?;

        // ========== Attachment Tables (Split Schema) ==========

        // Search results table - stores web search metadata only
        conn.execute(
            "CREATE TABLE IF NOT EXISTS search_results (
                id TEXT PRIMARY KEY,
                query TEXT NOT NULL,
                engine TEXT NOT NULL,
                total_results INTEGER,
                searched_at TEXT NOT NULL,
                created_at TEXT NOT NULL
            )",
            [],
        )?;

        // Fetch results table - stores fetched web resource metadata
        // Content is stored in filesystem at storage_path
        conn.execute(
            "CREATE TABLE IF NOT EXISTS fetch_results (
                id TEXT PRIMARY KEY,
                search_id TEXT,
                url TEXT NOT NULL,
                title TEXT,
                description TEXT,
                storage_path TEXT NOT NULL,
                content_type TEXT NOT NULL,
                original_mime TEXT,
                status TEXT DEFAULT 'pending',
                error TEXT,
                keywords TEXT,
                headings TEXT,
                original_size INTEGER,
                processed_size INTEGER,
                favicon_url TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (search_id) REFERENCES search_results(id) ON DELETE CASCADE
            )",
            [],
        )?;

        // Index for fetch results by search_id
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_fetch_results_search ON fetch_results(search_id)",
            [],
        )?;

        // Files table - stores user uploaded file metadata
        // Content is stored in filesystem at storage_path
        conn.execute(
            "CREATE TABLE IF NOT EXISTS files (
                id TEXT PRIMARY KEY,
                file_name TEXT NOT NULL,
                file_size INTEGER NOT NULL,
                mime_type TEXT NOT NULL,
                storage_path TEXT NOT NULL,
                created_at TEXT NOT NULL
            )",
            [],
        )?;

        // Message-Attachment polymorphic junction table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS message_attachments (
                id TEXT PRIMARY KEY,
                message_id TEXT NOT NULL,
                attachment_type TEXT NOT NULL CHECK(attachment_type IN ('search_result', 'fetch_result', 'file')),
                attachment_id TEXT NOT NULL,
                display_order INTEGER DEFAULT 0,
                created_at TEXT NOT NULL,
                FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
            )",
            [],
        )?;

        // Index for message attachment lookups
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_message_attachments_message ON message_attachments(message_id)",
            [],
        )?;

        // Index for attachment type lookups
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_message_attachments_type ON message_attachments(attachment_type, attachment_id)",
            [],
        )?;

        // Prompts table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS prompts (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                content TEXT NOT NULL,
                description TEXT,
                category TEXT,
                is_system INTEGER DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
            [],
        )?;

        // Message-Prompt junction table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS message_prompts (
                id TEXT PRIMARY KEY,
                message_id TEXT NOT NULL,
                prompt_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
                FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE,
                UNIQUE(message_id, prompt_id)
            )",
            [],
        )?;

        // Message-KnowledgeBase junction table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS message_knowledge_bases (
                id TEXT PRIMARY KEY,
                message_id TEXT NOT NULL,
                knowledge_base_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
                FOREIGN KEY (knowledge_base_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE,
                UNIQUE(message_id, knowledge_base_id)
            )",
            [],
        )?;

        // Message-Tool junction table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS message_tools (
                id TEXT PRIMARY KEY,
                message_id TEXT NOT NULL,
                tool_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
                FOREIGN KEY (tool_id) REFERENCES tools(id) ON DELETE CASCADE,
                UNIQUE(message_id, tool_id)
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
            let conn = self.lock_conn()?;
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
        let conn = self.lock_conn()?;
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
        let conn = self.lock_conn()?;
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
            let conn = self.lock_conn()?;
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
        let conn = self.lock_conn()?;
        conn.execute("DELETE FROM providers WHERE id = ?1", params![id])?;
        Ok(())
    }

    // Model CRUD operations
    pub fn create_model(&self, req: CreateModelRequest) -> Result<Model> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();
        let is_starred = req.is_starred.unwrap_or(false);

        {
            let conn = self.lock_conn()?;
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
        let conn = self.lock_conn()?;
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
        let conn = self.lock_conn()?;
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
            let conn = self.lock_conn()?;
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
        let conn = self.lock_conn()?;
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
            let conn = self.lock_conn()?;
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
        let conn = self.lock_conn()?;
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
        let conn = self.lock_conn()?;
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
            let conn = self.lock_conn()?;
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
        let conn = self.lock_conn()?;
        conn.execute("DELETE FROM assistants WHERE id = ?1", params![id])?;
        Ok(())
    }

    // Conversation CRUD operations
    pub fn create_conversation(&self, req: CreateConversationRequest) -> Result<Conversation> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();

        {
            let conn = self.lock_conn()?;
            conn.execute(
                "INSERT INTO conversations (id, title, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4)",
                params![id, req.title, now, now],
            )?;
        }

        self.get_conversation(&id)?
            .ok_or_else(|| anyhow::anyhow!("Failed to retrieve created conversation"))
    }

    pub fn get_conversation(&self, id: &str) -> Result<Option<Conversation>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT 
                c.id, 
                c.title, 
                c.created_at, 
                c.updated_at,
                (SELECT m.content 
                 FROM messages m 
                 WHERE m.conversation_id = c.id 
                 ORDER BY m.created_at DESC 
                 LIMIT 1) as last_message
             FROM conversations c 
             WHERE c.id = ?1",
        )?;

        let conversation = stmt
            .query_row(params![id], |row| {
                Ok(Conversation {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    created_at: row.get(2)?,
                    updated_at: row.get(3)?,
                    last_message: row.get(4)?,
                })
            })
            .optional()?;

        Ok(conversation)
    }

    pub fn list_conversations(&self) -> Result<Vec<Conversation>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT 
                c.id, 
                c.title, 
                c.created_at, 
                c.updated_at,
                (SELECT m.content 
                 FROM messages m 
                 WHERE m.conversation_id = c.id 
                 ORDER BY m.created_at DESC 
                 LIMIT 1) as last_message
             FROM conversations c 
             ORDER BY c.updated_at DESC",
        )?;

        let conversations = stmt
            .query_map([], |row| {
                Ok(Conversation {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    created_at: row.get(2)?,
                    updated_at: row.get(3)?,
                    last_message: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(conversations)
    }

    pub fn update_conversation(&self, id: &str, title: &str) -> Result<Conversation> {
        let now = Utc::now().to_rfc3339();

        {
            let conn = self.lock_conn()?;
            conn.execute(
                "UPDATE conversations SET title = ?1, updated_at = ?2 WHERE id = ?3",
                params![title, now, id],
            )?;
        }

        self.get_conversation(id)?
            .ok_or_else(|| anyhow::anyhow!("Conversation not found"))
    }

    pub fn delete_conversation(&self, id: &str) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute("DELETE FROM conversations WHERE id = ?1", params![id])?;
        Ok(())
    }

    // User CRUD operations
    pub fn create_user(&self, req: CreateUserRequest) -> Result<User> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();
        let is_self = req.is_self.unwrap_or(false);
        let avatar_type = req.avatar_type.unwrap_or_else(|| "text".to_string());

        {
            let conn = self.lock_conn()?;
            conn.execute(
                "INSERT INTO users (id, username, display_name, email, avatar_type, avatar_bg, 
                 avatar_text, avatar_image_path, avatar_image_url, is_self, status, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'active', ?11, ?12)",
                params![
                    id,
                    req.username,
                    req.display_name,
                    req.email,
                    avatar_type,
                    req.avatar_bg,
                    req.avatar_text,
                    req.avatar_image_path,
                    req.avatar_image_url,
                    is_self as i32,
                    now,
                    now
                ],
            )?;
        }

        self.get_user(&id)?
            .ok_or_else(|| anyhow::anyhow!("Failed to retrieve created user"))
    }

    pub fn get_user(&self, id: &str) -> Result<Option<User>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, username, display_name, email, avatar_type, avatar_bg, avatar_text, 
             avatar_image_path, avatar_image_url, is_self, status, last_seen_at, created_at, updated_at
             FROM users WHERE id = ?1",
        )?;

        let user = stmt
            .query_row(params![id], |row| {
                Ok(User {
                    id: row.get(0)?,
                    username: row.get(1)?,
                    display_name: row.get(2)?,
                    email: row.get(3)?,
                    avatar_type: row.get(4)?,
                    avatar_bg: row.get(5)?,
                    avatar_text: row.get(6)?,
                    avatar_image_path: row.get(7)?,
                    avatar_image_url: row.get(8)?,
                    is_self: row.get::<_, i32>(9)? != 0,
                    status: row.get(10)?,
                    last_seen_at: row.get(11)?,
                    created_at: row.get(12)?,
                    updated_at: row.get(13)?,
                })
            })
            .optional()?;

        Ok(user)
    }

    pub fn get_self_user(&self) -> Result<Option<User>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, username, display_name, email, avatar_type, avatar_bg, avatar_text, 
             avatar_image_path, avatar_image_url, is_self, status, last_seen_at, created_at, updated_at
             FROM users WHERE is_self = 1 LIMIT 1",
        )?;

        let user = stmt
            .query_row([], |row| {
                Ok(User {
                    id: row.get(0)?,
                    username: row.get(1)?,
                    display_name: row.get(2)?,
                    email: row.get(3)?,
                    avatar_type: row.get(4)?,
                    avatar_bg: row.get(5)?,
                    avatar_text: row.get(6)?,
                    avatar_image_path: row.get(7)?,
                    avatar_image_url: row.get(8)?,
                    is_self: row.get::<_, i32>(9)? != 0,
                    status: row.get(10)?,
                    last_seen_at: row.get(11)?,
                    created_at: row.get(12)?,
                    updated_at: row.get(13)?,
                })
            })
            .optional()?;

        Ok(user)
    }

    pub fn list_users(&self) -> Result<Vec<User>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, username, display_name, email, avatar_type, avatar_bg, avatar_text, 
             avatar_image_path, avatar_image_url, is_self, status, last_seen_at, created_at, updated_at
             FROM users ORDER BY is_self DESC, display_name ASC",
        )?;

        let users = stmt
            .query_map([], |row| {
                Ok(User {
                    id: row.get(0)?,
                    username: row.get(1)?,
                    display_name: row.get(2)?,
                    email: row.get(3)?,
                    avatar_type: row.get(4)?,
                    avatar_bg: row.get(5)?,
                    avatar_text: row.get(6)?,
                    avatar_image_path: row.get(7)?,
                    avatar_image_url: row.get(8)?,
                    is_self: row.get::<_, i32>(9)? != 0,
                    status: row.get(10)?,
                    last_seen_at: row.get(11)?,
                    created_at: row.get(12)?,
                    updated_at: row.get(13)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(users)
    }

    // Conversation Participant CRUD operations
    pub fn add_conversation_participant(&self, req: CreateConversationParticipantRequest) -> Result<ConversationParticipant> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();

        {
            let conn = self.lock_conn()?;
            conn.execute(
                "INSERT INTO conversation_participants 
                 (id, conversation_id, participant_type, participant_id, display_name, role, status, joined_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'member', 'active', ?6)",
                params![id, req.conversation_id, req.participant_type, req.participant_id, req.display_name, now],
            )?;
        }

        self.get_conversation_participant(&id)?
            .ok_or_else(|| anyhow::anyhow!("Failed to retrieve created participant"))
    }

    pub fn get_conversation_participant(&self, id: &str) -> Result<Option<ConversationParticipant>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, conversation_id, participant_type, participant_id, display_name, 
             role, status, joined_at, left_at, last_read_at, metadata
             FROM conversation_participants WHERE id = ?1",
        )?;

        let participant = stmt
            .query_row(params![id], |row| {
                Ok(ConversationParticipant {
                    id: row.get(0)?,
                    conversation_id: row.get(1)?,
                    participant_type: row.get(2)?,
                    participant_id: row.get(3)?,
                    display_name: row.get(4)?,
                    role: row.get(5)?,
                    status: row.get(6)?,
                    joined_at: row.get(7)?,
                    left_at: row.get(8)?,
                    last_read_at: row.get(9)?,
                    metadata: row.get(10)?,
                })
            })
            .optional()?;

        Ok(participant)
    }

    pub fn list_conversation_participants(&self, conversation_id: &str) -> Result<Vec<ConversationParticipant>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, conversation_id, participant_type, participant_id, display_name, 
             role, status, joined_at, left_at, last_read_at, metadata
             FROM conversation_participants WHERE conversation_id = ?1 ORDER BY joined_at",
        )?;

        let participants = stmt
            .query_map(params![conversation_id], |row| {
                Ok(ConversationParticipant {
                    id: row.get(0)?,
                    conversation_id: row.get(1)?,
                    participant_type: row.get(2)?,
                    participant_id: row.get(3)?,
                    display_name: row.get(4)?,
                    role: row.get(5)?,
                    status: row.get(6)?,
                    joined_at: row.get(7)?,
                    left_at: row.get(8)?,
                    last_read_at: row.get(9)?,
                    metadata: row.get(10)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(participants)
    }

    pub fn get_conversation_participant_summary(
        &self,
        conversation_id: &str,
        current_user_id: &str,
    ) -> Result<Vec<ParticipantSummary>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT DISTINCT
                cp.participant_type,
                cp.participant_id,
                COALESCE(cp.display_name, u.display_name, a.name, m.name, 'Unknown') as display_name,
                COALESCE(
                    CASE cp.participant_type
                        WHEN 'user' THEN u.avatar_type
                        WHEN 'assistant' THEN a.avatar_type
                        ELSE 'text'
                    END, 'text'
                ) as avatar_type,
                CASE cp.participant_type
                    WHEN 'user' THEN u.avatar_bg
                    WHEN 'assistant' THEN a.avatar_bg
                    ELSE NULL
                END as avatar_bg,
                CASE cp.participant_type
                    WHEN 'user' THEN u.avatar_text
                    WHEN 'assistant' THEN a.avatar_text
                    ELSE NULL
                END as avatar_text,
                CASE cp.participant_type
                    WHEN 'user' THEN u.avatar_image_path
                    WHEN 'assistant' THEN a.avatar_image_path
                    ELSE NULL
                END as avatar_image_path,
                CASE cp.participant_type
                    WHEN 'user' THEN u.avatar_image_url
                    WHEN 'assistant' THEN a.avatar_image_url
                    ELSE NULL
                END as avatar_image_url
             FROM conversation_participants cp
             LEFT JOIN users u ON cp.participant_type = 'user' AND cp.participant_id = u.id
             LEFT JOIN assistants a ON cp.participant_type = 'assistant' AND cp.participant_id = a.id
             LEFT JOIN models m ON cp.participant_type = 'model' AND cp.participant_id = m.id
             WHERE cp.conversation_id = ?1 
               AND cp.status = 'active'
               AND NOT (cp.participant_type = 'user' AND cp.participant_id = ?2)
             ORDER BY cp.joined_at",
        )?;

        let summaries = stmt
            .query_map(params![conversation_id, current_user_id], |row| {
                Ok(ParticipantSummary {
                    participant_type: row.get(0)?,
                    participant_id: row.get(1)?,
                    display_name: row.get(2)?,
                    avatar_type: row.get(3)?,
                    avatar_bg: row.get(4)?,
                    avatar_text: row.get(5)?,
                    avatar_image_path: row.get(6)?,
                    avatar_image_url: row.get(7)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(summaries)
    }

    pub fn remove_conversation_participant(&self, id: &str) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute("DELETE FROM conversation_participants WHERE id = ?1", params![id])?;
        Ok(())
    }

    // Message CRUD operations
    pub fn create_message(&self, req: CreateMessageRequest) -> Result<Message> {
        println!("🔒 [db] Acquiring lock for create_message...");
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();
        
        {
            let conn = self.lock_conn()?;
            println!("✅ [db] Lock acquired");
            
            let target_id = req.conversation_id.as_ref()
                .map(|s| s.as_str())
                .unwrap_or("unknown");
            println!("💾 [db] Executing INSERT for message (conversation_id: {})", target_id);
            conn.execute(
                "INSERT INTO messages (id, conversation_id, sender_type, sender_id, content, thinking_content, tokens, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    id,
                    req.conversation_id,
                    req.sender_type,
                    req.sender_id,
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
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, conversation_id, sender_type, sender_id, content, thinking_content, tokens, created_at
             FROM messages WHERE id = ?1",
        )?;

        let message = stmt
            .query_row(params![id], |row| {
                Ok(Message {
                    id: row.get(0)?,
                    conversation_id: row.get(1)?,
                    sender_type: row.get(2)?,
                    sender_id: row.get(3)?,
                    content: row.get(4)?,
                    thinking_content: row.get(5)?,
                    tokens: row.get(6)?,
                    created_at: row.get(7)?,
                })
            })
            .optional()?;

        Ok(message)
    }

    pub fn list_messages_by_conversation(&self, conversation_id: &str) -> Result<Vec<Message>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, conversation_id, sender_type, sender_id, content, thinking_content, tokens, created_at
             FROM messages WHERE conversation_id = ?1 ORDER BY created_at ASC",
        )?;

        let messages = stmt
            .query_map(params![conversation_id], |row| {
                Ok(Message {
                    id: row.get(0)?,
                    conversation_id: row.get(1)?,
                    sender_type: row.get(2)?,
                    sender_id: row.get(3)?,
                    content: row.get(4)?,
                    thinking_content: row.get(5)?,
                    tokens: row.get(6)?,
                    created_at: row.get(7)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(messages)
    }

    pub fn delete_messages_in_conversation(&self, conversation_id: &str) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute("DELETE FROM messages WHERE conversation_id = ?1", params![conversation_id])?;
        Ok(())
    }

    // ========== Search Result Operations ==========

    pub fn create_search_result(&self, req: CreateSearchResultRequest) -> Result<SearchResult> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();

        {
            let conn = self.lock_conn()?;
            conn.execute(
                "INSERT INTO search_results (id, query, engine, total_results, searched_at, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![id, req.query, req.engine, req.total_results, req.searched_at, now],
            )?;
        }

        self.get_search_result(&id)
    }

    pub fn get_search_result(&self, id: &str) -> Result<SearchResult> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, query, engine, total_results, searched_at, created_at
             FROM search_results WHERE id = ?1"
        )?;

        stmt.query_row(params![id], |row| {
            Ok(SearchResult {
                id: row.get(0)?,
                query: row.get(1)?,
                engine: row.get(2)?,
                total_results: row.get(3)?,
                searched_at: row.get(4)?,
                created_at: row.get(5)?,
            })
        }).map_err(|e| anyhow::anyhow!("Search result not found: {}", e))
    }

    pub fn delete_search_result(&self, id: &str) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute("DELETE FROM search_results WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn update_search_result_total(&self, id: &str, total_results: i64) -> Result<SearchResult> {
        {
            let conn = self.lock_conn()?;
            conn.execute(
                "UPDATE search_results SET total_results = ?1 WHERE id = ?2",
                params![total_results, id],
            )?;
        }
        self.get_search_result(id)
    }

    // ========== Fetch Result Operations ==========

    pub fn create_fetch_result(&self, req: CreateFetchResultRequest) -> Result<FetchResult> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();
        let status = req.status.unwrap_or_else(|| "pending".to_string());

        {
            let conn = self.lock_conn()?;
            conn.execute(
                "INSERT INTO fetch_results 
                 (id, search_id, url, title, description, storage_path, content_type, original_mime,
                  status, error, keywords, headings, original_size, processed_size, favicon_url, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
                params![
                    id,
                    req.search_id,
                    req.url,
                    req.title,
                    req.description,
                    req.storage_path,
                    req.content_type,
                    req.original_mime,
                    status,
                    req.error,
                    req.keywords,
                    req.headings,
                    req.original_size,
                    req.processed_size,
                    req.favicon_url,
                    now,
                    now
                ],
            )?;
        }

        self.get_fetch_result(&id)
    }

    pub fn get_fetch_result(&self, id: &str) -> Result<FetchResult> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, search_id, url, title, description, storage_path, content_type, original_mime,
                    status, error, keywords, headings, original_size, processed_size, favicon_url, created_at, updated_at
             FROM fetch_results WHERE id = ?1"
        )?;

        stmt.query_row(params![id], |row| {
            Ok(FetchResult {
                id: row.get(0)?,
                search_id: row.get(1)?,
                url: row.get(2)?,
                title: row.get(3)?,
                description: row.get(4)?,
                storage_path: row.get(5)?,
                content_type: row.get(6)?,
                original_mime: row.get(7)?,
                status: row.get::<_, Option<String>>(8)?.unwrap_or_else(|| "pending".to_string()),
                error: row.get(9)?,
                keywords: row.get(10)?,
                headings: row.get(11)?,
                original_size: row.get(12)?,
                processed_size: row.get(13)?,
                favicon_url: row.get(14)?,
                created_at: row.get(15)?,
                updated_at: row.get(16)?,
            })
        }).map_err(|e| anyhow::anyhow!("Fetch result not found: {}", e))
    }

    pub fn get_fetch_results_by_search(&self, search_id: &str) -> Result<Vec<FetchResult>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, search_id, url, title, description, storage_path, content_type, original_mime,
                    status, error, keywords, headings, original_size, processed_size, favicon_url, created_at, updated_at
             FROM fetch_results WHERE search_id = ?1
             ORDER BY created_at"
        )?;

        let results = stmt.query_map(params![search_id], |row| {
            Ok(FetchResult {
                id: row.get(0)?,
                search_id: row.get(1)?,
                url: row.get(2)?,
                title: row.get(3)?,
                description: row.get(4)?,
                storage_path: row.get(5)?,
                content_type: row.get(6)?,
                original_mime: row.get(7)?,
                status: row.get::<_, Option<String>>(8)?.unwrap_or_else(|| "pending".to_string()),
                error: row.get(9)?,
                keywords: row.get(10)?,
                headings: row.get(11)?,
                original_size: row.get(12)?,
                processed_size: row.get(13)?,
                favicon_url: row.get(14)?,
                created_at: row.get(15)?,
                updated_at: row.get(16)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        Ok(results)
    }

    pub fn update_fetch_result_status(&self, id: &str, status: &str, error: Option<&str>) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        let conn = self.lock_conn()?;
        conn.execute(
            "UPDATE fetch_results SET status = ?1, error = ?2, updated_at = ?3 WHERE id = ?4",
            params![status, error, now, id],
        )?;
        Ok(())
    }

    pub fn delete_fetch_result(&self, id: &str) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute("DELETE FROM fetch_results WHERE id = ?1", params![id])?;
        Ok(())
    }

    // ========== File Attachment Operations ==========

    pub fn create_file_attachment(&self, req: CreateFileAttachmentRequest) -> Result<FileAttachment> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();

        {
            let conn = self.lock_conn()?;
            conn.execute(
                "INSERT INTO files (id, file_name, file_size, mime_type, storage_path, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![id, req.file_name, req.file_size, req.mime_type, req.storage_path, now],
            )?;
        }

        self.get_file_attachment(&id)
    }

    pub fn get_file_attachment(&self, id: &str) -> Result<FileAttachment> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, file_name, file_size, mime_type, storage_path, created_at
             FROM files WHERE id = ?1"
        )?;

        stmt.query_row(params![id], |row| {
            Ok(FileAttachment {
                id: row.get(0)?,
                file_name: row.get(1)?,
                file_size: row.get(2)?,
                mime_type: row.get(3)?,
                storage_path: row.get(4)?,
                created_at: row.get(5)?,
            })
        }).map_err(|e| anyhow::anyhow!("File attachment not found: {}", e))
    }

    pub fn delete_file_attachment(&self, id: &str) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute("DELETE FROM files WHERE id = ?1", params![id])?;
        Ok(())
    }

    // ========== Message Attachment Link Operations ==========

    pub fn link_message_attachment(
        &self,
        message_id: &str,
        attachment_type: AttachmentType,
        attachment_id: &str,
        display_order: Option<i32>,
    ) -> Result<()> {
        let conn = self.lock_conn()?;
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();
        let order = display_order.unwrap_or(0);

        conn.execute(
            "INSERT OR IGNORE INTO message_attachments
             (id, message_id, attachment_type, attachment_id, display_order, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, message_id, attachment_type.to_string(), attachment_id, order, now],
        )?;

        Ok(())
    }

    pub fn get_message_attachments(&self, message_id: &str) -> Result<Vec<Attachment>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT attachment_type, attachment_id, display_order
             FROM message_attachments
             WHERE message_id = ?1
             ORDER BY display_order, created_at"
        )?;

        let links: Vec<(String, String)> = stmt.query_map(params![message_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?.collect::<Result<Vec<_>, _>>()?;

        drop(stmt);
        drop(conn);

        let mut attachments = Vec::new();
        for (attachment_type, attachment_id) in links {
            let attachment = match attachment_type.as_str() {
                "search_result" => {
                    self.get_search_result(&attachment_id)
                        .map(Attachment::SearchResult)
                        .ok()
                }
                "fetch_result" => {
                    self.get_fetch_result(&attachment_id)
                        .map(Attachment::FetchResult)
                        .ok()
                }
                "file" => {
                    self.get_file_attachment(&attachment_id)
                        .map(Attachment::File)
                        .ok()
                }
                _ => None,
            };
            if let Some(a) = attachment {
                attachments.push(a);
            }
        }

        Ok(attachments)
    }

    pub fn unlink_message_attachment(
        &self,
        message_id: &str,
        attachment_type: AttachmentType,
        attachment_id: &str,
    ) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute(
            "DELETE FROM message_attachments WHERE message_id = ?1 AND attachment_type = ?2 AND attachment_id = ?3",
            params![message_id, attachment_type.to_string(), attachment_id],
        )?;
        Ok(())
    }

    // Settings operations
    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;

        let value = stmt
            .query_row(params![key], |row| row.get(0))
            .optional()?;

        Ok(value)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.lock_conn()?;
        let now = Utc::now().to_rfc3339();

        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)",
            params![key, value, now],
        )?;

        Ok(())
    }

    pub fn get_all_settings(&self) -> Result<Vec<Setting>> {
        let conn = self.lock_conn()?;
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
    pub async fn seed_default_data(&self) -> Result<()> {
        // Ensure self user exists
        let self_user = match self.get_self_user()? {
            Some(user) => {
                println!("✅ [db] Self user already exists: {}", user.display_name);
                user
            }
            None => {
                println!("🌱 [db] Creating default self user...");
                let user = self.create_user(CreateUserRequest {
                    username: "self".to_string(),
                    display_name: "You".to_string(),
                    email: None,
                    avatar_type: Some("text".to_string()),
                    avatar_bg: Some("#6366f1".to_string()),
                    avatar_text: Some("👤".to_string()),
                    avatar_image_path: None,
                    avatar_image_url: None,
                    is_self: Some(true),
                })?;
                println!("✅ [db] Created self user: {}", user.display_name);
                user
            }
        };

        // Check if default ollama provider already exists
        let providers = self.list_providers()?;
        let has_ollama = providers.iter().any(|p| p.provider_type == "ollama");
        
        let ollama_provider = if has_ollama {
            // Use existing ollama provider
            providers.into_iter()
                .find(|p| p.provider_type == "ollama")
                .ok_or_else(|| anyhow::anyhow!("Ollama provider not found despite has_ollama check"))?
        } else {
            // Create default Ollama provider
            println!("🌱 [db] Seeding default Ollama provider...");
            let provider = self.create_provider(CreateProviderRequest {
                name: "Ollama".to_string(),
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

        println!("🌱 [db] Checking for local Ollama models...");

        // Try to fetch models from local Ollama
        let base_url = ollama_provider.base_url.clone()
            .unwrap_or_else(|| "http://localhost:11434".to_string());
        
        let ollama_models = match crate::llm::models::fetch_ollama_models(base_url).await {
            Ok(models) if !models.is_empty() => {
                println!("✅ [db] Found {} local Ollama models", models.len());
                models
            }
            Ok(_) => {
                println!("⚠️  [db] No models found in local Ollama");
                vec![]
            }
            Err(e) => {
                println!("⚠️  [db] Could not connect to local Ollama: {}", e);
                vec![]
            }
        };

        let created_models = if !ollama_models.is_empty() {
            println!("🌱 [db] Creating models from local Ollama...");
            let mut models = Vec::new();
            
            for ollama_model in ollama_models.iter().take(10) {  // Limit to first 10 models
                let model = self.create_model(CreateModelRequest {
                    name: ollama_model.name.clone(),
                    provider_id: ollama_provider.id.clone(),
                    model_id: ollama_model.id.clone(),
                    description: ollama_model.description.clone(),
                    is_starred: Some(false),
                })?;
                println!("✅ [db] Created model: {}", model.name);
                models.push(model);
            }
            
            models
        } else {
            println!("🌱 [db] Seeding with default models (Ollama not available)...");
            
            // Fallback to hardcoded default models if Ollama is not available
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
            
            vec![gemma_model, gpt_oss_model, deepseek_model]
        };

        // Check if assistants already exist
        let assistants = self.list_assistants()?;
        if !assistants.is_empty() {
            println!("✅ [db] Assistants already exist, skipping seed");
            return Ok(());
        }

        println!("🌱 [db] Seeding default assistants...");

        // Create default assistants using created models
        let avatar_configs = vec![
            ("Code Assistant", "Coding Expert", "Help with programming tasks and technical questions", 
             "You are a helpful coding assistant. Help users with programming tasks, code review, debugging, and technical questions. Provide clear explanations and working code examples.", 
             "#3b82f6", "💻", "Development", true),
            ("General Assistant", "General Helper", "General purpose AI assistant", 
             "You are a helpful, harmless, and honest AI assistant. Provide clear and accurate information to help users with their questions. Think through problems step by step.", 
             "#10b981", "🤖", "General", false),
            ("Research Assistant", "Research Specialist", "Help with research and data analysis", 
             "You are a research assistant. Help users find information, analyze data, and summarize findings. Provide detailed analysis with reasoning.", 
             "#8b5cf6", "🔍", "Research", false),
        ];

        for (idx, (name, role, description, system_prompt, avatar_bg, avatar_text, group_name, is_starred)) in avatar_configs.into_iter().enumerate() {
            // Use models in round-robin fashion
            let model_idx = idx % created_models.len();
            let model = &created_models[model_idx];
            
            let assistant_req = CreateAssistantRequest {
                name: name.to_string(),
                role: Some(role.to_string()),
                description: Some(description.to_string()),
                system_prompt: system_prompt.to_string(),
                user_prompt: None,
                model_id: model.id.clone(),
                avatar_type: Some("text".to_string()),
                avatar_bg: Some(avatar_bg.to_string()),
                avatar_text: Some(avatar_text.to_string()),
                avatar_image_path: None,
                avatar_image_url: None,
                group_name: Some(group_name.to_string()),
                is_starred: Some(is_starred),
            };
            
            let assistant = self.create_assistant(assistant_req)?;
            println!("✅ [db] Created assistant: {} (using model: {})", assistant.name, model.name);
        }

        println!("🎉 [db] Seeding complete!");
        Ok(())
    }
}

