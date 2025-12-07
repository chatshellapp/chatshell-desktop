mod providers;
mod models;
mod assistants;
mod users;
mod conversations;
mod messages;
mod attachments;
mod contexts;
mod steps;
mod resources;
mod settings;
mod crypto;
mod model_fetch;
pub mod chat;

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
pub use providers::*;
pub use models::*;
pub use assistants::*;
pub use users::*;
pub use conversations::*;
pub use messages::*;
pub use attachments::*;
pub use contexts::*;
pub use steps::*;
pub use resources::*;
pub use settings::*;
pub use crypto::*;
pub use model_fetch::*;
pub use chat::*;

