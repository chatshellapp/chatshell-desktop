use anyhow::Result;

use super::Database;
use crate::models::{CreateAssistantRequest, CreateModelRequest, CreateProviderRequest, CreateUserRequest};

impl Database {
    pub async fn seed_default_data(&self) -> Result<()> {
        // Ensure self user exists
        let _self_user = match self.get_self_user().await? {
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
                }).await?;
                println!("✅ [db] Created self user: {}", user.display_name);
                user
            }
        };

        // Check if default ollama provider already exists
        let providers = self.list_providers().await?;
        let has_ollama = providers.iter().any(|p| p.provider_type == "ollama");

        let ollama_provider = if has_ollama {
            providers
                .into_iter()
                .find(|p| p.provider_type == "ollama")
                .ok_or_else(|| anyhow::anyhow!("Ollama provider not found despite has_ollama check"))?
        } else {
            println!("🌱 [db] Seeding default Ollama provider...");
            let provider = self.create_provider(CreateProviderRequest {
                name: "Ollama".to_string(),
                provider_type: "ollama".to_string(),
                api_key: None,
                base_url: Some("http://localhost:11434".to_string()),
                description: Some("Local Ollama instance".to_string()),
                is_enabled: Some(true),
            }).await?;
            println!("✅ [db] Created provider: {}", provider.name);
            provider
        };

        // Check if models already exist for this provider
        let existing_models = self.list_models().await?;
        let provider_has_models = existing_models.iter().any(|m| m.provider_id == ollama_provider.id);

        if provider_has_models {
            println!("✅ [db] Models already exist for provider, skipping model seed");
            let assistants = self.list_assistants().await?;
            if assistants.is_empty() {
                println!("⚠️  [db] No assistants found, but models exist. You may need to manually create assistants.");
            }
            return Ok(());
        }

        println!("🌱 [db] Checking for local Ollama models...");

        let base_url = ollama_provider
            .base_url
            .clone()
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

            for ollama_model in ollama_models.iter().take(10) {
                let model = self.create_model(CreateModelRequest {
                    name: ollama_model.name.clone(),
                    provider_id: ollama_provider.id.clone(),
                    model_id: ollama_model.id.clone(),
                    description: ollama_model.description.clone(),
                    is_starred: Some(false),
                }).await?;
                println!("✅ [db] Created model: {}", model.name);
                models.push(model);
            }

            models
        } else {
            println!("🌱 [db] Seeding with default models (Ollama not available)...");

            let gemma_model = self.create_model(CreateModelRequest {
                name: "Gemma 3 12B".to_string(),
                provider_id: ollama_provider.id.clone(),
                model_id: "gemma3:12b".to_string(),
                description: Some("Gemma 3 12B - Google's efficient instruction-following model".to_string()),
                is_starred: Some(false),
            }).await?;
            println!("✅ [db] Created model: {}", gemma_model.name);

            let gpt_oss_model = self.create_model(CreateModelRequest {
                name: "GPT-OSS 20B".to_string(),
                provider_id: ollama_provider.id.clone(),
                model_id: "gpt-oss:20b".to_string(),
                description: Some("GPT-OSS 20B - Open source GPT-style model for general tasks".to_string()),
                is_starred: Some(false),
            }).await?;
            println!("✅ [db] Created model: {}", gpt_oss_model.name);

            let deepseek_model = self.create_model(CreateModelRequest {
                name: "DeepSeek R1 14B".to_string(),
                provider_id: ollama_provider.id.clone(),
                model_id: "deepseek-r1:14b".to_string(),
                description: Some("DeepSeek R1 14B - Advanced reasoning model with thinking process".to_string()),
                is_starred: Some(true),
            }).await?;
            println!("✅ [db] Created model: {}", deepseek_model.name);

            vec![gemma_model, gpt_oss_model, deepseek_model]
        };

        // Check if assistants already exist
        let assistants = self.list_assistants().await?;
        if !assistants.is_empty() {
            println!("✅ [db] Assistants already exist, skipping seed");
            return Ok(());
        }

        println!("🌱 [db] Seeding default assistants...");

        let avatar_configs = vec![
            (
                "Code Assistant",
                "Coding Expert",
                "Help with programming tasks and technical questions",
                "You are a helpful coding assistant. Help users with programming tasks, code review, debugging, and technical questions. Provide clear explanations and working code examples.",
                "#3b82f6",
                "💻",
                "Development",
                true,
            ),
            (
                "General Assistant",
                "General Helper",
                "General purpose AI assistant",
                "You are a helpful, harmless, and honest AI assistant. Provide clear and accurate information to help users with their questions. Think through problems step by step.",
                "#10b981",
                "🤖",
                "General",
                false,
            ),
            (
                "Research Assistant",
                "Research Specialist",
                "Help with research and data analysis",
                "You are a research assistant. Help users find information, analyze data, and summarize findings. Provide detailed analysis with reasoning.",
                "#8b5cf6",
                "🔍",
                "Research",
                false,
            ),
        ];

        for (idx, (name, role, description, system_prompt, avatar_bg, avatar_text, group_name, is_starred)) in avatar_configs.into_iter().enumerate() {
            let model_idx = idx % created_models.len();
            let model = &created_models[model_idx];

            let assistant_req = CreateAssistantRequest {
                name: name.to_string(),
                role: Some(role.to_string()),
                description: Some(description.to_string()),
                system_prompt: system_prompt.to_string(),
                user_prompt: None,
                model_id: model.id.clone(),
                model_params: None,
                avatar_type: Some("text".to_string()),
                avatar_bg: Some(avatar_bg.to_string()),
                avatar_text: Some(avatar_text.to_string()),
                avatar_image_path: None,
                avatar_image_url: None,
                group_name: Some(group_name.to_string()),
                is_starred: Some(is_starred),
            };

            let assistant = self.create_assistant(assistant_req).await?;
            println!("✅ [db] Created assistant: {} (using model: {})", assistant.name, model.name);
        }

        println!("🎉 [db] Seeding complete!");
        Ok(())
    }
}

