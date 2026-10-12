//! Desktop vision-model responder for the read tool's image questions.
//!
//! Implements the agent-core [`ImageQuestionResponder`] seam: the read tool
//! hands over image bytes plus a question, this responder performs a
//! one-shot completion against the resolved auxiliary vision model, and the
//! answer returns as text. Holds a fully resolved model snapshot (captured
//! per turn when the agent is built), so the call needs no runtime lookups.

use chatshell_agent_core::tools::image_question::{ImageInput, ImageQuestionResponder};
use futures::future::BoxFuture;

use crate::llm::{ChatMessage, ImageData, call_provider};

/// System prompt for one-shot image analysis.
const IMAGE_QUESTION_SYSTEM_PROMPT: &str = "You analyze images on behalf of a chat assistant. \
Answer the user's question about the image accurately and concisely, in the same language as the \
question. Describe only what is visible; state uncertainty explicitly instead of guessing. \
If the image cannot be interpreted (corrupt, blank, unsupported), say so.";

/// One-shot vision call backed by a resolved auxiliary vision model.
pub struct VisionQuestionResponder {
    provider_type: String,
    model_id: String,
    api_key: Option<String>,
    base_url: Option<String>,
    api_style: Option<String>,
}

impl VisionQuestionResponder {
    /// Build from a fully resolved model (see `commands::chat::aux_models`).
    pub fn new(
        provider_type: String,
        model_id: String,
        api_key: Option<String>,
        base_url: Option<String>,
        api_style: Option<String>,
    ) -> Self {
        Self {
            provider_type,
            model_id,
            api_key,
            base_url,
            api_style,
        }
    }
}

impl ImageQuestionResponder for VisionQuestionResponder {
    fn answer(
        &self,
        image: ImageInput,
        question: String,
    ) -> BoxFuture<'static, Result<String, String>> {
        let provider_type = self.provider_type.clone();
        let model_id = self.model_id.clone();
        let api_key = self.api_key.clone();
        let base_url = self.base_url.clone();
        let api_style = self.api_style.clone();

        Box::pin(async move {
            let base64 =
                base64::Engine::encode(&base64::engine::general_purpose::STANDARD, image.bytes);
            let response = call_provider(
                &provider_type,
                model_id,
                vec![
                    ChatMessage {
                        role: "system".to_string(),
                        content: IMAGE_QUESTION_SYSTEM_PROMPT.to_string(),
                        images: vec![],
                        files: vec![],
                        tool_calls: vec![],
                        tool_call_id: None,
                        tool_result_call_id: None,
                        reasoning_content: None,
                    },
                    ChatMessage {
                        role: "user".to_string(),
                        content: question,
                        images: vec![ImageData {
                            base64,
                            media_type: image.mime_type,
                        }],
                        files: vec![],
                        tool_calls: vec![],
                        tool_call_id: None,
                        tool_result_call_id: None,
                        reasoning_content: None,
                    },
                ],
                api_key,
                base_url,
                api_style,
            )
            .await
            .map_err(|e| e.to_string())?;
            Ok(response.content)
        })
    }
}
