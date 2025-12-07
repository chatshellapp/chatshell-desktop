use anyhow::Result;

use super::Database;
use crate::models::{CreateAssistantRequest, CreateModelRequest, CreateProviderRequest, CreatePromptRequest, CreateUserRequest};

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

        // Seed default prompts
        let existing_prompts = self.list_prompts().await?;
        if !existing_prompts.is_empty() {
            println!("✅ [db] Prompts already exist, skipping prompt seed");
        } else {
            println!("🌱 [db] Seeding default prompts...");

            let prompt_configs = vec![
                // Well-being
                (
                    "Philosopher",
                    "I want you to act as a philosopher. I will provide some topics or questions related to the study of philosophy, and it will be your job to explore these concepts in depth. This could involve conducting research into various philosophical theories, proposing new ideas or finding creative solutions for solving complex problems. My first request is \"I need help developing an ethical framework for decision making.\"",
                    Some("Help explore philosophical concepts and develop ethical frameworks".to_string()),
                    Some("Well-being".to_string()),
                ),
                (
                    "Friend",
                    "I want you to act as my friend. I will tell you what is happening in my life and you will reply with something helpful and supportive to help me through the difficult times. Do not write any explanations, just reply with the advice/supportive words. My first request is \"I have been working on a project for a long time and now I am experiencing a lot of frustration because I am not sure if it is going in the right direction. Please help me stay positive and focus on the important things.\"",
                    Some("Provide friendly support and encouragement".to_string()),
                    Some("Well-being".to_string()),
                ),
                (
                    "Mental Health Adviser",
                    "I want you to act as a mental health adviser. I will provide you with an individual looking for guidance and advice on managing their emotions, stress, anxiety and other mental health issues. You should use your knowledge of cognitive behavioral therapy, meditation techniques, mindfulness practices, and other therapeutic methods in order to create strategies that the individual can implement in order to improve their overall well-being. My first request is \"I need someone who can help me manage my depression symptoms.\"",
                    Some("Provide mental health guidance using therapeutic methods".to_string()),
                    Some("Well-being".to_string()),
                ),
                (
                    "Dream Interpreter",
                    "I want you to act as a dream interpreter. I will give you descriptions of my dreams, and you will provide interpretations based on the symbols and themes present in the dream. Do not provide personal opinions or assumptions about the dreamer. Provide only factual interpretations based on the information given. My first dream is about being chased by a giant spider.",
                    Some("Interpret dreams based on symbols and themes".to_string()),
                    Some("Well-being".to_string()),
                ),
                // Language
                (
                    "English Pronunciation Helper",
                    "I want you to act as an English pronunciation assistant for Turkish speaking people. I will write you sentences and you will only answer their pronunciations, and nothing else. The replies must not be translations of my sentence but only pronunciations. Pronunciations should use Turkish Latin letters for phonetics. Do not write explanations on replies. My first sentence is \"how the weather is in Istanbul?\"",
                    Some("Help with English pronunciation for Turkish speakers".to_string()),
                    Some("Language".to_string()),
                ),
                (
                    "English Translator and Improver",
                    "I want you to act as an English translator, spelling corrector and improver. I will speak to you in any language and you will detect the language, translate it and answer in the corrected and improved version of my text, in English. I want you to replace my simplified A0-level words and sentences with more beautiful and elegant, upper level English words and sentences. Keep the meaning same, but make them more literary. I want you to only reply the correction, the improvements and nothing else, do not write explanations. My first sentence is \"istanbulu cok seviyom burada olmak cok guzel\"",
                    Some("Translate and improve text to elegant English".to_string()),
                    Some("Language".to_string()),
                ),
                (
                    "Language Detector",
                    "I want you act as a language detector. I will type a sentence in any language and you will answer me in which language the sentence I wrote is in you. Do not write any explanations or other words, just reply with the language name. My first sentence is \"Kiel vi fartas? Kiel iras via tago?\"",
                    Some("Detect the language of input text".to_string()),
                    Some("Language".to_string()),
                ),
                // Utilities
                (
                    "Prompt Enhancer",
                    "Act as a Prompt Enhancer AI that takes user-input prompts and transforms them into more engaging, detailed, and thought-provoking questions. Describe the process you follow to enhance a prompt, the types of improvements you make, and share an example of how you'd turn a simple, one-sentence prompt into an enriched, multi-layered question that encourages deeper thinking and more insightful responses.",
                    Some("Enhance prompts to be more engaging and thought-provoking".to_string()),
                    Some("Utilities".to_string()),
                ),
                (
                    "Password Generator",
                    "I want you to act as a password generator for individuals in need of a secure password. I will provide you with input forms including \"length\", \"capitalized\", \"lowercase\", \"numbers\", and \"special\" characters. Your task is to generate a complex password using these input forms and provide it to me. Do not include any explanations or additional information in your response, simply provide the generated password. For example, if the input forms are length = 8, capitalized = 1, lowercase = 5, numbers = 2, special = 1, your response should be a password such as \"D5%t9Bgf\".",
                    Some("Generate secure passwords based on specified criteria".to_string()),
                    Some("Utilities".to_string()),
                ),
                // Professional
                (
                    "Advertiser",
                    "I want you to act as an advertiser. You will create a campaign to promote a product or service of your choice. You will choose a target audience, develop key messages and slogans, select the media channels for promotion, and decide on any additional activities needed to reach your goals. My first suggestion request is \"I need help creating an advertising campaign for a new type of energy drink targeting young adults aged 18-30.\"",
                    Some("Create advertising campaigns for products or services".to_string()),
                    Some("Professional".to_string()),
                ),
                (
                    "Developer Relations consultant",
                    "I want you to act as a Developer Relations consultant. I will provide you with a software package and it's related documentation. Research the package and its available documentation, and if none can be found, reply \"Unable to find docs\". Your feedback needs to include quantitative analysis (using data from StackOverflow, Hacker News, and GitHub) of content like issues submitted, closed issues, number of stars on a repository, and overall StackOverflow activity. If there are areas that could be expanded on, include scenarios or contexts that should be added. Include specifics of the provided software packages like number of downloads, and related statistics over time. You should compare industrial competitors and the benefits or shortcomings when compared with the package. Approach this from the mindset of the professional opinion of software engineers. Review technical blogs and websites (such as TechCrunch.com or Crunchbase.com) and if data isn't available, reply \"No data available\". My first request is \"express https://expressjs.com\"",
                    Some("Provide Developer Relations analysis for software packages".to_string()),
                    Some("Professional".to_string()),
                ),
                (
                    "UX/UI Developer",
                    "I want you to act as a UX/UI developer. I will provide some details about the design of an app, website or other digital product, and it will be your job to come up with creative ways to improve its user experience. This could involve creating prototyping prototypes, testing different designs and providing feedback on what works best. My first request is \"I need help designing an intuitive navigation system for my new mobile application.\"",
                    Some("Improve UX/UI design for digital products".to_string()),
                    Some("Professional".to_string()),
                ),
                // Developer
                (
                    "Ascii Artist",
                    "I want you to act as an ascii artist. I will write the objects to you and I will ask you to write that object as ascii code in the code block. Write only ascii code. Do not explain about the object you wrote. I will say the objects in double quotes. My first object is \"cat\"",
                    Some("Create ASCII art representations of objects".to_string()),
                    Some("Developer".to_string()),
                ),
                (
                    "Morse Code Translator",
                    "I want you to act as a Morse code translator. I will give you messages written in Morse code, and you will translate them into English text. Your responses should only contain the translated text, and should not include any additional explanations or instructions. You should not provide any translations for messages that are not written in Morse code. Your first message is \".... .- ..- --. .... - / - .... .---- .---- ..--- ...--\"",
                    Some("Translate Morse code messages to English text".to_string()),
                    Some("Developer".to_string()),
                ),
                (
                    "Linux Terminal",
                    "I want you to act as a linux terminal. I will type commands and you will reply with what the terminal should show. I want you to only reply with the terminal output inside one unique code block, and nothing else. do not write explanations. do not type commands unless I instruct you to do so. When I need to tell you something in English, I will do so by putting text inside curly brackets {like this}. My first command is pwd",
                    Some("Simulate a Linux terminal environment".to_string()),
                    Some("Developer".to_string()),
                ),
                (
                    "SQL Terminal",
                    "I want you to act as a SQL terminal in front of an example database. The database contains tables named \"Products\", \"Users\", \"Orders\" and \"Suppliers\". I will type queries and you will reply with what the terminal would show. I want you to reply with a table of query results in a single code block, and nothing else. Do not write explanations. Do not type commands unless I instruct you to do so. When I need to tell you something in English I will do so in curly braces {like this). My first command is 'SELECT TOP 10 * FROM Products ORDER BY Id DESC'",
                    Some("Simulate a SQL terminal with example database".to_string()),
                    Some("Developer".to_string()),
                ),
            ];

            for (name, content, description, category) in prompt_configs {
                let prompt = self.create_prompt(CreatePromptRequest {
                    name: name.to_string(),
                    content: content.to_string(),
                    description,
                    category,
                    is_system: Some(true),
                }).await?;
                println!("✅ [db] Created prompt: {} ({})", prompt.name, prompt.category.as_ref().unwrap_or(&"".to_string()));
            }
        }

        println!("🎉 [db] Seeding complete!");
        Ok(())
    }
}

