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

        // Models table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS models (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                provider TEXT NOT NULL,
                model_id TEXT NOT NULL,
                description TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
            [],
        )?;

        // Agents table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS agents (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                system_prompt TEXT NOT NULL,
                model_id TEXT NOT NULL,
                avatar_bg TEXT,
                avatar_text TEXT,
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
                agent_id TEXT NOT NULL,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
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

    // Model CRUD operations
    pub fn create_model(&self, req: CreateModelRequest) -> Result<Model> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();

        {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO models (id, name, provider, model_id, description, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    id,
                    req.name,
                    req.provider,
                    req.model_id,
                    req.description,
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
            "SELECT id, name, provider, model_id, description, created_at, updated_at
             FROM models WHERE id = ?1",
        )?;

        let model = stmt
            .query_row(params![id], |row| {
                Ok(Model {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    provider: row.get(2)?,
                    model_id: row.get(3)?,
                    description: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .optional()?;

        Ok(model)
    }

    pub fn list_models(&self) -> Result<Vec<Model>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, provider, model_id, description, created_at, updated_at
             FROM models ORDER BY created_at ASC",
        )?;

        let models = stmt
            .query_map([], |row| {
                Ok(Model {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    provider: row.get(2)?,
                    model_id: row.get(3)?,
                    description: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(models)
    }

    pub fn update_model(&self, id: &str, req: CreateModelRequest) -> Result<Model> {
        let now = Utc::now().to_rfc3339();

        {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "UPDATE models SET name = ?1, provider = ?2, model_id = ?3, description = ?4, updated_at = ?5 WHERE id = ?6",
                params![
                    req.name,
                    req.provider,
                    req.model_id,
                    req.description,
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

    // Agent CRUD operations
    pub fn create_agent(&self, req: CreateAgentRequest) -> Result<Agent> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();
        let is_starred = req.is_starred.unwrap_or(false);

        {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO agents (id, name, system_prompt, model_id, avatar_bg, avatar_text, is_starred, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    id,
                    req.name,
                    req.system_prompt,
                    req.model_id,
                    req.avatar_bg,
                    req.avatar_text,
                    is_starred as i32,
                    now,
                    now
                ],
            )?;
            // Lock released here
        }

        self.get_agent(&id)?
            .ok_or_else(|| anyhow::anyhow!("Failed to retrieve created agent"))
    }

    pub fn get_agent(&self, id: &str) -> Result<Option<Agent>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, system_prompt, model_id, avatar_bg, avatar_text, is_starred, created_at, updated_at
             FROM agents WHERE id = ?1",
        )?;

        let agent = stmt
            .query_row(params![id], |row| {
                Ok(Agent {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    system_prompt: row.get(2)?,
                    model_id: row.get(3)?,
                    avatar_bg: row.get(4)?,
                    avatar_text: row.get(5)?,
                    is_starred: row.get::<_, i32>(6)? != 0,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            })
            .optional()?;

        Ok(agent)
    }

    pub fn list_agents(&self) -> Result<Vec<Agent>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, system_prompt, model_id, avatar_bg, avatar_text, is_starred, created_at, updated_at
             FROM agents ORDER BY created_at DESC",
        )?;

        let agents = stmt
            .query_map([], |row| {
                Ok(Agent {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    system_prompt: row.get(2)?,
                    model_id: row.get(3)?,
                    avatar_bg: row.get(4)?,
                    avatar_text: row.get(5)?,
                    is_starred: row.get::<_, i32>(6)? != 0,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(agents)
    }

    pub fn update_agent(&self, id: &str, req: CreateAgentRequest) -> Result<Agent> {
        let now = Utc::now().to_rfc3339();
        let is_starred = req.is_starred.unwrap_or(false);

        {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "UPDATE agents SET name = ?1, system_prompt = ?2, model_id = ?3, 
                 avatar_bg = ?4, avatar_text = ?5, is_starred = ?6, updated_at = ?7 WHERE id = ?8",
                params![
                    req.name,
                    req.system_prompt,
                    req.model_id,
                    req.avatar_bg,
                    req.avatar_text,
                    is_starred as i32,
                    now,
                    id
                ],
            )?;
            // Lock released here
        }

        self.get_agent(id)?
            .ok_or_else(|| anyhow::anyhow!("Agent not found"))
    }

    pub fn delete_agent(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM agents WHERE id = ?1", params![id])?;
        Ok(())
    }

    // Topic CRUD operations
    pub fn create_topic(&self, req: CreateTopicRequest) -> Result<Topic> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();

        {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO topics (id, agent_id, title, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![id, req.agent_id, req.title, now, now],
            )?;
            // Lock released here
        }

        self.get_topic(&id)?
            .ok_or_else(|| anyhow::anyhow!("Failed to retrieve created topic"))
    }

    pub fn get_topic(&self, id: &str) -> Result<Option<Topic>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, agent_id, title, created_at, updated_at
             FROM topics WHERE id = ?1",
        )?;

        let topic = stmt
            .query_row(params![id], |row| {
                Ok(Topic {
                    id: row.get(0)?,
                    agent_id: row.get(1)?,
                    title: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            })
            .optional()?;

        Ok(topic)
    }

    pub fn list_topics(&self, agent_id: &str) -> Result<Vec<Topic>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, agent_id, title, created_at, updated_at
             FROM topics WHERE agent_id = ?1 ORDER BY updated_at DESC",
        )?;

        let topics = stmt
            .query_map(params![agent_id], |row| {
                Ok(Topic {
                    id: row.get(0)?,
                    agent_id: row.get(1)?,
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

    // Seed database with default agents if empty
    pub fn seed_default_data(&self) -> Result<()> {
        // Check if already seeded
        let models = self.list_models()?;
        if !models.is_empty() {
            return Ok(()); // Already seeded
        }

        println!("🌱 [db] Seeding default models and agents...");

        // Create default models
        let gemma_model = self.create_model(CreateModelRequest {
            name: "Gemma 3 12B".to_string(),
            provider: "ollama".to_string(),
            model_id: "gemma3:12b".to_string(),
            description: Some("Gemma 3 12B - Google's efficient instruction-following model".to_string()),
        })?;
        println!("✅ [db] Created model: {}", gemma_model.name);

        let gpt_oss_model = self.create_model(CreateModelRequest {
            name: "GPT-OSS 20B".to_string(),
            provider: "ollama".to_string(),
            model_id: "gpt-oss:20b".to_string(),
            description: Some("GPT-OSS 20B - Open source GPT-style model for general tasks".to_string()),
        })?;
        println!("✅ [db] Created model: {}", gpt_oss_model.name);

        let deepseek_model = self.create_model(CreateModelRequest {
            name: "DeepSeek R1 14B".to_string(),
            provider: "ollama".to_string(),
            model_id: "deepseek-r1:14b".to_string(),
            description: Some("DeepSeek R1 14B - Advanced reasoning model with thinking process".to_string()),
        })?;
        println!("✅ [db] Created model: {}", deepseek_model.name);

        // Create default agents using these models
        let default_agents = vec![
            CreateAgentRequest {
                name: "Code Assistant".to_string(),
                system_prompt: "You are a helpful coding assistant. Help users with programming tasks, code review, debugging, and technical questions. Provide clear explanations and working code examples.".to_string(),
                model_id: gemma_model.id.clone(),
                avatar_bg: Some("#3b82f6".to_string()),
                avatar_text: Some("💻".to_string()),
                is_starred: Some(true),
            },
            CreateAgentRequest {
                name: "General Assistant".to_string(),
                system_prompt: "You are a helpful, harmless, and honest AI assistant. Provide clear and accurate information to help users with their questions. Think through problems step by step.".to_string(),
                model_id: gpt_oss_model.id.clone(),
                avatar_bg: Some("#10b981".to_string()),
                avatar_text: Some("🤖".to_string()),
                is_starred: Some(false),
            },
            CreateAgentRequest {
                name: "Research Assistant".to_string(),
                system_prompt: "You are a research assistant. Help users find information, analyze data, and summarize findings. Provide detailed analysis with reasoning.".to_string(),
                model_id: deepseek_model.id.clone(),
                avatar_bg: Some("#8b5cf6".to_string()),
                avatar_text: Some("🔍".to_string()),
                is_starred: Some(false),
            },
        ];

        for agent_req in default_agents {
            let agent = self.create_agent(agent_req)?;
            println!("✅ [db] Created agent: {}", agent.name);
        }

        println!("🎉 [db] Seeding complete!");
        Ok(())
    }
}

