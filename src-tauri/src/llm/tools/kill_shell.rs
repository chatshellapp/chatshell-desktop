//! Kill shell tool for LLM agents
//!
//! Terminates the current persistent bash session. A new session will be
//! created automatically on the next `bash` tool call.

use rig::{completion::ToolDefinition, tool::Tool};
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::bash::SharedBashSession;

#[derive(Debug, Clone, Deserialize)]
pub struct KillShellArgs {}

#[derive(Debug, thiserror::Error)]
#[error("KillShell error: {0}")]
pub struct KillShellError(String);

#[derive(Clone, Serialize, Deserialize)]
pub struct KillShellTool {
    #[serde(skip)]
    session: SharedBashSession,
}

impl std::fmt::Debug for KillShellTool {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("KillShellTool").finish()
    }
}

impl KillShellTool {
    pub fn new(session: SharedBashSession) -> Self {
        Self { session }
    }
}

impl Tool for KillShellTool {
    const NAME: &'static str = "kill_shell";

    type Error = KillShellError;
    type Args = KillShellArgs;
    type Output = String;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: "kill_shell".to_string(),
            description: "Terminate the current bash session. All state (environment variables, \
                working directory, background processes) will be lost. A new session will be \
                created automatically on the next bash command."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {},
                "required": []
            }),
        }
    }

    async fn call(&self, _args: Self::Args) -> Result<Self::Output, Self::Error> {
        tracing::info!("🔧 [tool-call] kill_shell");

        let mut guard = self.session.lock().await;

        if let Some(mut session) = guard.take() {
            session.kill().await;
            tracing::info!("🖥️ [kill_shell] Session terminated");
            Ok("Bash session terminated.".to_string())
        } else {
            Ok("No active bash session.".to_string())
        }
    }
}
