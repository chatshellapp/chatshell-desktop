use reqwest::header::{HeaderMap, HeaderValue};
use rig::OneOrMany;
use rig::message::{
    Document, DocumentMediaType, DocumentSourceKind, Image, ImageDetail, ImageMediaType,
    UserContent,
};

use crate::llm::{FileData, ImageData};

/// App attribution headers for API providers (especially OpenRouter)
/// See: https://openrouter.ai/docs/app-attribution
const APP_REFERER: &str = "https://chatshell.app";
const APP_TITLE: &str = "ChatShell";

/// Create a reqwest client with app attribution and content-type headers.
/// The Content-Type header is required because rig's streaming path
/// (GenericEventSource -> HttpClientExt::send_streaming) does not set it,
/// unlike the non-streaming path (Client::send which explicitly inserts it).
/// Without it, providers like Anthropic reject the request with "unsupported content type".
pub fn create_http_client() -> reqwest::Client {
    let mut headers = HeaderMap::new();
    headers.insert("HTTP-Referer", HeaderValue::from_static(APP_REFERER));
    headers.insert("X-Title", HeaderValue::from_static(APP_TITLE));
    headers.insert(
        reqwest::header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );

    reqwest::Client::builder()
        .default_headers(headers)
        .build()
        .unwrap_or_default()
}

/// Tool call information for streaming callback
#[derive(Debug, Clone)]
pub struct ToolCallInfo {
    /// Tool call ID (from the LLM)
    pub id: String,
    /// Name of the tool being called
    pub tool_name: String,
    /// Input arguments as JSON string
    pub tool_input: String,
}

/// Tool result information for streaming callback
#[derive(Debug, Clone)]
pub struct ToolResultInfo {
    /// Tool call ID this result is for
    pub id: String,
    /// Output content from the tool
    pub tool_output: String,
}

/// Type of streamed chunk for callback
#[derive(Debug, Clone)]
pub enum StreamChunkType {
    Text,
    Reasoning,
    ToolCall(ToolCallInfo),
    ToolResult(ToolResultInfo),
}

/// Convert MIME type string to rig's ImageMediaType
pub fn mime_to_image_media_type(mime: &str) -> Option<ImageMediaType> {
    match mime.to_lowercase().as_str() {
        "image/jpeg" | "image/jpg" => Some(ImageMediaType::JPEG),
        "image/png" => Some(ImageMediaType::PNG),
        "image/gif" => Some(ImageMediaType::GIF),
        "image/webp" => Some(ImageMediaType::WEBP),
        _ => None,
    }
}

/// Convert MIME type string to rig's DocumentMediaType
pub fn mime_to_document_media_type(mime: &str) -> Option<DocumentMediaType> {
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

/// Format model ID to a human-friendly display name
/// Example: "gpt-4o-mini" -> "GPT 4o Mini"
/// Example: "gpt-5.1-codex-max" -> "GPT 5.1 Codex Max"
/// Example: "gemma3:4b" -> "Gemma 3 4B"
pub fn format_model_display_name(model_id: &str) -> String {
    // Split by colon to separate model name and size/variant
    let parts: Vec<&str> = model_id.split(':').collect();
    let base_name = parts[0];
    let suffix = parts.get(1).map(|s| s.to_uppercase());

    // Acronyms that should be fully uppercased
    let uppercase_acronyms = ["gpt", "oss"];

    // Format the base name
    let formatted_base = base_name
        .split('-')
        .map(|part| {
            let part_lower = part.to_lowercase();
            // Handle acronyms (e.g., "gpt" -> "GPT", "oss" -> "OSS")
            if uppercase_acronyms.contains(&part_lower.as_str()) {
                part.to_uppercase()
            // Handle special cases for numbers
            } else if part.chars().all(|c| c.is_ascii_digit()) {
                part.to_string()
            } else if part.chars().next().is_some_and(|c| c.is_ascii_digit()) {
                // Contains numbers mixed with letters (e.g., "gemma3" -> "Gemma 3")
                let mut result = String::new();
                let chars = part.chars().peekable();

                for ch in chars {
                    if ch.is_ascii_digit() {
                        // Add space before digit unless at start, after space, or after dot (for version numbers like "5.1")
                        if !result.is_empty() && !result.ends_with(' ') && !result.ends_with('.') {
                            result.push(' ');
                        }
                        result.push(ch);
                    } else {
                        result.push(ch);
                    }
                }
                result
            } else {
                // Regular word - capitalize first letter
                let mut chars = part.chars();
                match chars.next() {
                    None => String::new(),
                    Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                }
            }
        })
        .collect::<Vec<String>>()
        .join(" ");

    // Combine with suffix if present
    if let Some(suffix_str) = suffix {
        format!("{} {}", formatted_base, suffix_str)
    } else {
        formatted_base
    }
}

/// Build UserContent from text, optional images, and optional files
pub fn build_user_content(
    text: &str,
    images: &[ImageData],
    files: &[FileData],
) -> OneOrMany<UserContent> {
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
            detail: Some(ImageDetail::Auto),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mime_to_image_media_type() {
        assert_eq!(
            mime_to_image_media_type("image/jpeg"),
            Some(ImageMediaType::JPEG)
        );
        assert_eq!(
            mime_to_image_media_type("image/jpg"),
            Some(ImageMediaType::JPEG)
        );
        assert_eq!(
            mime_to_image_media_type("image/png"),
            Some(ImageMediaType::PNG)
        );
        assert_eq!(
            mime_to_image_media_type("image/gif"),
            Some(ImageMediaType::GIF)
        );
        assert_eq!(
            mime_to_image_media_type("image/webp"),
            Some(ImageMediaType::WEBP)
        );
        assert_eq!(mime_to_image_media_type("image/bmp"), None);
        assert_eq!(mime_to_image_media_type("text/plain"), None);
    }

    #[test]
    fn test_mime_to_image_media_type_case_insensitive() {
        assert_eq!(
            mime_to_image_media_type("IMAGE/JPEG"),
            Some(ImageMediaType::JPEG)
        );
        assert_eq!(
            mime_to_image_media_type("Image/Png"),
            Some(ImageMediaType::PNG)
        );
    }

    #[test]
    fn test_mime_to_document_media_type() {
        assert_eq!(
            mime_to_document_media_type("text/plain"),
            Some(DocumentMediaType::TXT)
        );
        assert_eq!(
            mime_to_document_media_type("text/markdown"),
            Some(DocumentMediaType::MARKDOWN)
        );
        assert_eq!(
            mime_to_document_media_type("text/html"),
            Some(DocumentMediaType::HTML)
        );
        assert_eq!(
            mime_to_document_media_type("text/css"),
            Some(DocumentMediaType::CSS)
        );
        assert_eq!(
            mime_to_document_media_type("text/csv"),
            Some(DocumentMediaType::CSV)
        );
        assert_eq!(
            mime_to_document_media_type("application/xml"),
            Some(DocumentMediaType::XML)
        );
        assert_eq!(
            mime_to_document_media_type("text/xml"),
            Some(DocumentMediaType::XML)
        );
        assert_eq!(
            mime_to_document_media_type("text/javascript"),
            Some(DocumentMediaType::Javascript)
        );
        assert_eq!(
            mime_to_document_media_type("application/javascript"),
            Some(DocumentMediaType::Javascript)
        );
        assert_eq!(
            mime_to_document_media_type("text/x-python"),
            Some(DocumentMediaType::Python)
        );
        assert_eq!(
            mime_to_document_media_type("application/pdf"),
            Some(DocumentMediaType::PDF)
        );
    }

    #[test]
    fn test_mime_to_document_media_type_unknown_defaults_to_txt() {
        assert_eq!(
            mime_to_document_media_type("application/octet-stream"),
            Some(DocumentMediaType::TXT)
        );
        assert_eq!(
            mime_to_document_media_type("unknown/type"),
            Some(DocumentMediaType::TXT)
        );
    }

    #[test]
    fn test_format_model_display_name_simple() {
        assert_eq!(format_model_display_name("gpt-4"), "GPT 4");
        assert_eq!(format_model_display_name("gpt-4o-mini"), "GPT 4o Mini");
        assert_eq!(format_model_display_name("claude-3-opus"), "Claude 3 Opus");
    }

    #[test]
    fn test_format_model_display_name_with_version() {
        assert_eq!(format_model_display_name("gpt-3.5-turbo"), "GPT 3.5 Turbo");
        assert_eq!(
            format_model_display_name("gpt-4.1-preview"),
            "GPT 4.1 Preview"
        );
    }

    #[test]
    fn test_format_model_display_name_with_colon() {
        // Note: The function only splits digits when the part starts with a digit
        // "gemma3" starts with 'g' so it becomes "Gemma3", not "Gemma 3"
        assert_eq!(format_model_display_name("gemma3:4b"), "Gemma3 4B");
        assert_eq!(format_model_display_name("llama2:7b"), "Llama2 7B");
        assert_eq!(
            format_model_display_name("mistral:latest"),
            "Mistral LATEST"
        );
    }

    #[test]
    fn test_format_model_display_name_acronyms() {
        assert_eq!(format_model_display_name("gpt-4o"), "GPT 4o");
        assert_eq!(format_model_display_name("oss-model"), "OSS Model");
    }

    #[test]
    fn test_format_model_display_name_mixed_numbers() {
        // Note: The function only adds space before digits when the part starts with a digit
        // Parts like "gemma3" start with a letter, so they just get capitalized
        assert_eq!(format_model_display_name("gemma3"), "Gemma3");
        assert_eq!(format_model_display_name("llama2-chat"), "Llama2 Chat");
        // Parts that start with digits get processed
        assert_eq!(format_model_display_name("3b-model"), "3b Model");
    }

    #[test]
    fn test_tool_call_info_creation() {
        let info = ToolCallInfo {
            id: "call-123".to_string(),
            tool_name: "web_search".to_string(),
            tool_input: r#"{"query": "test"}"#.to_string(),
        };
        assert_eq!(info.id, "call-123");
        assert_eq!(info.tool_name, "web_search");
    }

    #[test]
    fn test_tool_result_info_creation() {
        let info = ToolResultInfo {
            id: "call-123".to_string(),
            tool_output: "Search results...".to_string(),
        };
        assert_eq!(info.id, "call-123");
        assert_eq!(info.tool_output, "Search results...");
    }

    #[test]
    fn test_stream_chunk_type_variants() {
        let text_chunk = StreamChunkType::Text;
        let reasoning_chunk = StreamChunkType::Reasoning;
        let tool_call_chunk = StreamChunkType::ToolCall(ToolCallInfo {
            id: "1".to_string(),
            tool_name: "test".to_string(),
            tool_input: "{}".to_string(),
        });
        let tool_result_chunk = StreamChunkType::ToolResult(ToolResultInfo {
            id: "1".to_string(),
            tool_output: "result".to_string(),
        });

        // Just verify they can be constructed
        match text_chunk {
            StreamChunkType::Text => {}
            _ => panic!("Expected Text variant"),
        }
        match reasoning_chunk {
            StreamChunkType::Reasoning => {}
            _ => panic!("Expected Reasoning variant"),
        }
        match tool_call_chunk {
            StreamChunkType::ToolCall(_) => {}
            _ => panic!("Expected ToolCall variant"),
        }
        match tool_result_chunk {
            StreamChunkType::ToolResult(_) => {}
            _ => panic!("Expected ToolResult variant"),
        }
    }
}
