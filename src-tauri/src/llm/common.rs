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

/// Create a reqwest client with app attribution headers
/// Used for all API calls to include HTTP-Referer and X-Title headers
pub fn create_http_client() -> reqwest::Client {
    let mut headers = HeaderMap::new();
    headers.insert("HTTP-Referer", HeaderValue::from_static(APP_REFERER));
    headers.insert("X-Title", HeaderValue::from_static(APP_TITLE));
    
    reqwest::Client::builder()
        .default_headers(headers)
        .build()
        .unwrap_or_default()
}

/// Type of streamed chunk for callback
#[derive(Debug, Clone)]
pub enum StreamChunkType {
    Text,
    Reasoning,
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
