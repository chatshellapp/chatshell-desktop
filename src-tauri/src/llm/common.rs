use anyhow::Result;
use futures::StreamExt;
use rig::completion::{CompletionModel, CompletionRequest, Message};
use rig::message::{AssistantContent, UserContent, Image, Document, DocumentSourceKind, ImageMediaType, DocumentMediaType};
use rig::streaming::StreamedAssistantContent;
use rig::OneOrMany;
use tokio_util::sync::CancellationToken;

use crate::llm::{ChatRequest, ChatResponse, ImageData, FileData};
use crate::thinking_parser;

/// Convert MIME type string to rig's ImageMediaType
fn mime_to_image_media_type(mime: &str) -> Option<ImageMediaType> {
    match mime.to_lowercase().as_str() {
        "image/jpeg" | "image/jpg" => Some(ImageMediaType::JPEG),
        "image/png" => Some(ImageMediaType::PNG),
        "image/gif" => Some(ImageMediaType::GIF),
        "image/webp" => Some(ImageMediaType::WEBP),
        _ => None,
    }
}

/// Convert MIME type string to rig's DocumentMediaType
fn mime_to_document_media_type(mime: &str) -> Option<DocumentMediaType> {
    match mime.to_lowercase().as_str() {
        "text/plain" => Some(DocumentMediaType::TXT),
        "text/markdown" => Some(DocumentMediaType::MARKDOWN),
        "text/html" => Some(DocumentMediaType::HTML),
        "text/css" => Some(DocumentMediaType::CSS),
        "text/csv" => Some(DocumentMediaType::CSV),
        "application/xml" | "text/xml" => Some(DocumentMediaType::XML),
        "text/javascript" | "application/javascript" => Some(DocumentMediaType::Javascript),
        "text/x-python" => Some(DocumentMediaType::Python),
        "application/pdf" => Some(DocumentMediaType::PDF),
        _ => Some(DocumentMediaType::TXT), // Default to TXT for unknown text types
    }
}

/// Build UserContent from text, optional images, and optional files
fn build_user_content(text: &str, images: &[ImageData], files: &[FileData]) -> OneOrMany<UserContent> {
    let mut contents: Vec<UserContent> = Vec::new();
    
    // Add text content first
    contents.push(UserContent::Text(text.into()));
    
    // Add file/document contents
    for file in files {
        // Format file content with XML structure
        let file_content = format!(
            "<document>\n<filename>{}</filename>\n<content>\n{}\n</content>\n</document>",
            file.name, file.content
        );
        let document = Document {
            data: DocumentSourceKind::String(file_content),
            media_type: mime_to_document_media_type(&file.media_type),
            additional_params: None,
        };
        contents.push(UserContent::Document(document));
    }
    
    // Add image contents
    for img in images {
        let image = Image {
            data: DocumentSourceKind::Base64(img.base64.clone()),
            media_type: mime_to_image_media_type(&img.media_type),
            detail: None,
            additional_params: None,
        };
        contents.push(UserContent::Image(image));
    }
    
    if contents.len() == 1 {
        OneOrMany::one(contents.remove(0))
    } else {
        OneOrMany::many(contents).unwrap_or_else(|_| OneOrMany::one(UserContent::Text(text.into())))
    }
}

/// Common streaming handler for all LLM providers
/// This eliminates code duplication across openai, openrouter, and ollama
pub async fn chat_stream_common<M: CompletionModel>(
    model: M,
    request: ChatRequest,
    cancel_token: CancellationToken,
    mut callback: impl FnMut(String) -> bool + Send,
    log_prefix: &str,
) -> Result<ChatResponse> {
    println!("🤖 [{}] Model created: {}", log_prefix, request.model);
    
    // Convert messages to rig's Message format
    let mut chat_history = Vec::new();
    
    for (i, msg) in request.messages.iter().enumerate() {
        if i < request.messages.len() - 1 {
            // Earlier messages are history
            let rig_msg = match msg.role.as_str() {
                "user" => Message::User {
                    content: build_user_content(&msg.content, &msg.images, &msg.files),
                },
                "assistant" => Message::Assistant {
                    id: None,
                    content: OneOrMany::one(AssistantContent::Text(msg.content.clone().into())),
                },
                _ => Message::User {
                    content: build_user_content(&msg.content, &msg.images, &msg.files),
                },
            };
            chat_history.push(rig_msg);
        }
    }
    
    // Last message is the current prompt (may include images and files)
    let prompt_msg = request.messages.last()
        .ok_or_else(|| anyhow::anyhow!("No messages in request"))?;
    
    println!("📝 [{}] Building prompt with {} images, {} files", 
             log_prefix, prompt_msg.images.len(), prompt_msg.files.len());
    
    let prompt = Message::User {
        content: build_user_content(&prompt_msg.content, &prompt_msg.images, &prompt_msg.files),
    };
    
    println!("📝 [{}] Prompt: {} chars, history: {} messages", 
             log_prefix,
             prompt_msg.content.len(), 
             chat_history.len());
    
    // Build completion request
    let completion_request = CompletionRequest {
        preamble: None,
        chat_history: {
            let mut all_messages = chat_history;
            all_messages.push(prompt);
            OneOrMany::many(all_messages)
                .map_err(|e| anyhow::anyhow!("Failed to create message list: {:?}", e))?
        },
        documents: vec![],
        tools: vec![],
        temperature: None,
        max_tokens: None,
        tool_choice: None,
        additional_params: None,
    };
    
    println!("📤 [{}] Starting streaming request...", log_prefix);
    
    // Create stream
    let mut stream = model.stream(completion_request).await?;
    
    let mut full_content = String::new();
    let mut cancelled = false;
    
    println!("📥 [{}] Processing stream...", log_prefix);
    
    // Process stream with cancellation support
    while let Some(result) = stream.next().await {
        if cancel_token.is_cancelled() {
            println!("🛑 [{}] Cancellation detected, stopping stream", log_prefix);
            cancelled = true;
            drop(stream);
            break;
        }
        
        match result {
            Ok(StreamedAssistantContent::Text(text)) => {
                let text_str = &text.text;
                if !text_str.is_empty() {
                    full_content.push_str(text_str);
                    
                    // Call callback and check if it signals cancellation
                    if !callback(text_str.to_string()) {
                        println!("🛑 [{}] Callback signaled cancellation", log_prefix);
                        cancelled = true;
                        break;
                    }
                }
            }
            Ok(_) => {
                // Ignore tool calls, reasoning, and final responses
            }
            Err(e) => {
                eprintln!("❌ [{}] Stream error: {}", log_prefix, e);
                return Err(e.into());
            }
        }
    }
    
    if cancelled {
        println!("⚠️ [{}] Stream was cancelled", log_prefix);
    } else {
        println!("✅ [{}] Stream completed successfully", log_prefix);
    }
    
    // Parse thinking content
    let parsed = thinking_parser::parse_thinking_content(&full_content);
    
    println!("📊 [{}] Parsed content: {} chars, thinking: {}", 
             log_prefix,
             parsed.content.len(), 
             parsed.thinking_content.is_some());
    
    Ok(ChatResponse {
        content: parsed.content,
        thinking_content: parsed.thinking_content,
        tokens: None,
    })
}


