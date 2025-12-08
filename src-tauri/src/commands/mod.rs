mod assistants;
mod attachments;
pub mod chat;
mod contexts;
mod conversations;
mod crypto;
mod messages;
mod model_fetch;
mod model_parameter_presets;
mod models;
mod prompts;
mod providers;
mod resources;
mod settings;
mod steps;
mod users;

use crate::db::Database;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;

// Re-export ModelInfo from llm module
pub use crate::llm::models::ModelInfo;

// Global state to track active generation tasks with cancellation tokens
pub(crate) type GenerationTasks = Arc<RwLock<HashMap<String, CancellationToken>>>;

#[derive(Clone)]
pub struct AppState {
    pub db: Database,
    pub generation_tasks: GenerationTasks,
}

// Re-export all commands
pub use assistants::*;
pub use attachments::*;
pub use chat::*;
pub use contexts::*;
pub use conversations::*;
pub use crypto::*;
pub use messages::*;
pub use model_fetch::*;
pub use model_parameter_presets::*;
pub use models::*;
pub use prompts::*;
pub use providers::*;
pub use resources::*;
pub use settings::*;
pub use steps::*;
pub use users::*;
