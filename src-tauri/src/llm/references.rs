//! Conversation-scoped resolver for the read tool's host references.
//!
//! Attachments live under the app data directory, which `path_policy`
//! denies to every tool (the agent must not browse other conversations or
//! settings). The model therefore receives `attachment://<hash>.<ext>`
//! references, and this resolver maps them back to files, but only for
//! files attached to a message of the current conversation.

use std::path::{Path, PathBuf};

use chatshell_agent_core::tools::ReferenceResolver;
use chatshell_agent_core::tools::reference::{
    ATTACHMENT_SCHEME, TOOL_OUTPUT_SCHEME, reference_name, reference_scheme,
};
use futures::future::BoxFuture;

use crate::db::Database;

/// Resolves `attachment://` (and, when configured, `tool-output://`)
/// references for one conversation.
pub struct ConversationReferences {
    db: Database,
    conversation_id: String,
    attachments_dir: PathBuf,
    /// This conversation's spilled tool output directory.
    tool_output_dir: Option<PathBuf>,
}

impl ConversationReferences {
    pub fn new(db: Database, conversation_id: String, attachments_dir: PathBuf) -> Self {
        Self {
            db,
            conversation_id,
            attachments_dir,
            tool_output_dir: None,
        }
    }

    /// Also resolve `tool-output://<file>` inside `dir`.
    pub fn with_tool_output_dir(mut self, dir: PathBuf) -> Self {
        self.tool_output_dir = Some(dir);
        self
    }
}

impl ReferenceResolver for ConversationReferences {
    fn resolve(&self, reference: &str) -> BoxFuture<'static, Result<PathBuf, String>> {
        let reference = reference.to_string();
        let db = self.db.clone();
        let conversation_id = self.conversation_id.clone();
        let attachments_dir = self.attachments_dir.clone();
        let tool_output_dir = self.tool_output_dir.clone();
        Box::pin(async move {
            match reference_scheme(&reference) {
                Some(ATTACHMENT_SCHEME) => {
                    resolve_attachment(&db, &conversation_id, &attachments_dir, &reference).await
                }
                Some(TOOL_OUTPUT_SCHEME) => {
                    resolve_tool_output(tool_output_dir.as_deref(), &reference)
                }
                _ => Err(format!(
                    "Unknown reference: {reference}. Only attachment:// and \
                     tool-output:// references given in this conversation can be read."
                )),
            }
        })
    }
}

async fn resolve_attachment(
    db: &Database,
    conversation_id: &str,
    attachments_dir: &Path,
    reference: &str,
) -> Result<PathBuf, String> {
    let name = reference_name(reference, ATTACHMENT_SCHEME)
        .ok_or_else(|| format!("Malformed attachment reference: {reference}"))?;
    let storage_paths = db
        .conversation_attachment_storage_paths(conversation_id)
        .await
        .map_err(|e| format!("Could not look up attachments: {e}"))?;
    let storage_path = storage_paths
        .iter()
        .find(|path| {
            Path::new(path)
                .file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n == name)
        })
        .ok_or_else(|| {
            format!(
                "{reference} is not an attachment of this conversation. Use the \
                 references listed in this conversation's <attachments> blocks."
            )
        })?;
    // Desktop rows are relative to the attachments directory; rows authored
    // on iOS can still carry an absolute sandbox path, which only resolves
    // once the fetch-on-open pass rewrites it.
    let full = attachments_dir.join(storage_path);
    if !full.is_file() {
        return Err(format!(
            "{reference} has not been downloaded to this device yet (it was \
             attached on another device and sync has not fetched it). Ask the \
             user to reopen the conversation once sync finishes."
        ));
    }
    Ok(full)
}

fn resolve_tool_output(dir: Option<&Path>, reference: &str) -> Result<PathBuf, String> {
    let dir = dir.ok_or_else(|| {
        format!("{reference}: saved tool output is not available in this conversation.")
    })?;
    let name = reference_name(reference, TOOL_OUTPUT_SCHEME)
        .ok_or_else(|| format!("Malformed tool output reference: {reference}"))?;
    let full = dir.join(name);
    if !full.is_file() {
        return Err(format!(
            "{reference} no longer exists: saved tool output is kept for 7 days \
             and only on the device that ran the command. Re-run the command if \
             you need the full output again."
        ));
    }
    Ok(full)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{CreateFileAttachmentRequest, CreateMessageRequest};

    async fn test_db() -> (Database, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::new(dir.path().join("t.db").to_str().unwrap())
            .await
            .unwrap();
        (db, dir)
    }

    async fn seed(db: &Database, conversation_id: &str, storage_path: &str) {
        let now = chrono::Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT OR IGNORE INTO conversations (id, title, created_at, updated_at)
             VALUES (?, 'test', ?, ?)",
        )
        .bind(conversation_id)
        .bind(&now)
        .bind(&now)
        .execute(db.pool())
        .await
        .unwrap();
        let message = db
            .create_message(CreateMessageRequest {
                conversation_id: Some(conversation_id.to_string()),
                parent_id: None,
                sender_type: "user".to_string(),
                sender_id: None,
                content: "hi".to_string(),
                tokens: None,
            })
            .await
            .unwrap();
        let file = db
            .create_file_attachment(CreateFileAttachmentRequest {
                file_name: "notes.txt".to_string(),
                file_size: 5,
                mime_type: "text/plain".to_string(),
                storage_path: storage_path.to_string(),
                content_hash: "hash".to_string(),
            })
            .await
            .unwrap();
        db.link_message_attachment(&message.id, &file.id, None)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn attachments_resolve_only_inside_their_conversation() {
        let (db, dir) = test_db().await;
        let attachments = dir.path().join("attachments");
        std::fs::create_dir_all(attachments.join("files")).unwrap();
        std::fs::write(attachments.join("files/aaa.txt"), "hello").unwrap();
        std::fs::write(attachments.join("files/bbb.txt"), "other").unwrap();
        seed(&db, "conv-a", "files/aaa.txt").await;
        seed(&db, "conv-b", "files/bbb.txt").await;

        let resolver =
            ConversationReferences::new(db.clone(), "conv-a".to_string(), attachments.clone());
        let path = resolver.resolve("attachment://aaa.txt").await.unwrap();
        assert_eq!(path, attachments.join("files/aaa.txt"));

        let err = resolver.resolve("attachment://bbb.txt").await.unwrap_err();
        assert!(
            err.contains("not an attachment of this conversation"),
            "{err}"
        );

        let err = resolver
            .resolve("attachment://../files/bbb.txt")
            .await
            .unwrap_err();
        assert!(err.contains("Malformed"), "{err}");
    }

    #[tokio::test]
    async fn missing_blobs_and_unknown_schemes_explain_themselves() {
        let (db, dir) = test_db().await;
        let attachments = dir.path().join("attachments");
        seed(&db, "conv-a", "files/ccc.txt").await;
        let resolver = ConversationReferences::new(db, "conv-a".to_string(), attachments);

        let err = resolver.resolve("attachment://ccc.txt").await.unwrap_err();
        assert!(err.contains("not been downloaded"), "{err}");

        let err = resolver.resolve("blob://x").await.unwrap_err();
        assert!(err.contains("Unknown reference"), "{err}");

        let err = resolver.resolve("tool-output://x.txt").await.unwrap_err();
        assert!(err.contains("not available"), "{err}");
    }

    #[tokio::test]
    async fn tool_output_resolves_inside_its_directory() {
        let (db, dir) = test_db().await;
        let outputs = dir.path().join("tool-outputs/conv-a");
        std::fs::create_dir_all(&outputs).unwrap();
        std::fs::write(outputs.join("call-1.txt"), "out").unwrap();
        let resolver =
            ConversationReferences::new(db, "conv-a".to_string(), dir.path().join("attachments"))
                .with_tool_output_dir(outputs.clone());

        assert_eq!(
            resolver.resolve("tool-output://call-1.txt").await.unwrap(),
            outputs.join("call-1.txt")
        );
        let err = resolver
            .resolve("tool-output://call-2.txt")
            .await
            .unwrap_err();
        assert!(err.contains("no longer exists"), "{err}");
    }
}
