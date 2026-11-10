mod assistants;
mod attachments;
pub(crate) mod capabilities;
pub mod chat;
mod contexts;
mod conversation_settings;
mod conversations;
mod crypto;
pub(crate) mod file_history;
mod logs;
pub mod mcp;
mod messages;
mod model_fetch;
mod model_parameter_presets;
mod models;
mod permission;
mod prompt_history;
mod prompts;
mod providers;
mod resources;
mod search;
mod settings;
mod skills;
mod steps;
mod svg_figure;
mod sync;
mod translation;
mod translation_history;
mod users;
mod visual_output;

use crate::db::Database;
use crate::llm::capabilities::CapabilitiesCache;
use crate::llm::tools::BashSessionManager;
use crate::mcp::McpConnectionManager;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;

// Re-export ModelInfo from llm module
pub use crate::llm::models::ModelInfo;

// Global state to track active generation tasks with cancellation tokens
pub(crate) type GenerationTasks = Arc<RwLock<HashMap<String, CancellationToken>>>;

/// Pending OAuth flow state (keyed by server_id in mcp commands)
pub type PendingOAuthMap = Arc<RwLock<HashMap<String, mcp::PendingOAuthState>>>;

#[derive(Clone)]
pub struct AppState {
    pub db: Database,
    pub generation_tasks: GenerationTasks,
    pub mcp_manager: Arc<McpConnectionManager>,
    pub pending_oauth: PendingOAuthMap,
    pub bash_session_manager: Arc<BashSessionManager>,
    pub capabilities_cache: Arc<CapabilitiesCache>,
    /// Snapshot-sync engine against the iCloud container, when present.
    pub sync_engine: Arc<std::sync::Mutex<Option<crate::sync::SyncEngine>>>,
    /// Tool approval gate: pending UI round trips (keyed by request id).
    pub approval_registry: Arc<crate::llm::permission::ApprovalRegistry>,
    /// Session grants per conversation (RAM only; never synced).
    pub permission_grants: crate::llm::permission::GrantStore,
}

/// One generation per conversation: refuse tree-mutating commands
/// (send / regenerate / branch switch / delete) while a turn streams.
/// Accepting a concurrent send would overwrite the running task's
/// cancellation token and race the active-leaf pointer. The frontend
/// disables the send control while streaming; this keeps the backend
/// from depending on that as its only defense.
pub async fn ensure_no_generation(state: &AppState, conversation_id: &str) -> Result<(), String> {
    let tasks = state.generation_tasks.read().await;
    if tasks.contains_key(conversation_id) {
        return Err("A generation is already running for this conversation".into());
    }
    Ok(())
}

// Re-export all commands
pub use assistants::*;
pub use attachments::*;
pub use capabilities::*;
pub use chat::*;
pub use contexts::*;
pub use conversation_settings::*;
pub use conversations::*;
pub use crypto::*;
pub use logs::*;
pub use mcp::*;
pub use messages::*;
pub use model_fetch::*;
pub use model_parameter_presets::*;
pub use models::*;
pub use permission::*;
pub use prompt_history::*;
pub use prompts::*;
pub use providers::*;
pub use resources::*;
pub use search::*;
pub use settings::*;
pub use skills::*;
pub use steps::*;
pub use svg_figure::*;
pub use sync::*;
pub use translation::*;
pub use translation_history::*;
pub use users::*;
pub use visual_output::*;
