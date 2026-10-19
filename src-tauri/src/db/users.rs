use anyhow::Result;
use chrono::Utc;
use sqlx::Row;
use uuid::Uuid;

use super::Database;
use crate::models::{CreateUserRequest, User};

impl Database {
    pub async fn create_user(&self, req: CreateUserRequest) -> Result<User> {
        let id = Uuid::now_v7().to_string();
        let now = Utc::now().to_rfc3339();
        let is_self = req.is_self.unwrap_or(false);
        let avatar_type = req.avatar_type.unwrap_or_else(|| "text".to_string());

        sqlx::query(
            "INSERT INTO users (id, username, display_name, email, avatar_type, avatar_bg, 
             avatar_text, avatar_image_path, avatar_image_url, is_self, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)"
        )
        .bind(&id)
        .bind(&req.username)
        .bind(&req.display_name)
        .bind(&req.email)
        .bind(&avatar_type)
        .bind(&req.avatar_bg)
        .bind(&req.avatar_text)
        .bind(&req.avatar_image_path)
        .bind(&req.avatar_image_url)
        .bind(is_self as i32)
        .bind(&now)
        .bind(&now)
        .execute(self.pool.as_ref())
        .await?;

        self.get_user(&id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Failed to retrieve created user"))
    }

    pub async fn get_user(&self, id: &str) -> Result<Option<User>> {
        let row = sqlx::query(
            "SELECT id, username, display_name, email, avatar_type, avatar_bg, avatar_text, 
             avatar_image_path, avatar_image_url, is_self, status, last_seen_at, created_at, updated_at
             FROM users WHERE id = ?"
        )
        .bind(id)
        .fetch_optional(self.pool.as_ref())
        .await?;

        match row {
            Some(row) => {
                let is_self: i32 = row.get("is_self");

                Ok(Some(User {
                    id: row.get("id"),
                    username: row.get("username"),
                    display_name: row.get("display_name"),
                    email: row.get("email"),
                    avatar_type: row.get("avatar_type"),
                    avatar_bg: row.get("avatar_bg"),
                    avatar_text: row.get("avatar_text"),
                    avatar_image_path: row.get("avatar_image_path"),
                    avatar_image_url: row.get("avatar_image_url"),
                    is_self: is_self != 0,
                    status: row.get("status"),
                    last_seen_at: row.get("last_seen_at"),
                    created_at: row.get("created_at"),
                    updated_at: row.get("updated_at"),
                }))
            }
            None => Ok(None),
        }
    }

    pub async fn get_self_user(&self) -> Result<Option<User>> {
        let row = sqlx::query(
            "SELECT id, username, display_name, email, avatar_type, avatar_bg, avatar_text, 
             avatar_image_path, avatar_image_url, is_self, status, last_seen_at, created_at, updated_at
             FROM users WHERE is_self = 1 LIMIT 1"
        )
        .fetch_optional(self.pool.as_ref())
        .await?;

        match row {
            Some(row) => {
                let is_self: i32 = row.get("is_self");

                Ok(Some(User {
                    id: row.get("id"),
                    username: row.get("username"),
                    display_name: row.get("display_name"),
                    email: row.get("email"),
                    avatar_type: row.get("avatar_type"),
                    avatar_bg: row.get("avatar_bg"),
                    avatar_text: row.get("avatar_text"),
                    avatar_image_path: row.get("avatar_image_path"),
                    avatar_image_url: row.get("avatar_image_url"),
                    is_self: is_self != 0,
                    status: row.get("status"),
                    last_seen_at: row.get("last_seen_at"),
                    created_at: row.get("created_at"),
                    updated_at: row.get("updated_at"),
                }))
            }
            None => Ok(None),
        }
    }

    pub async fn list_users(&self) -> Result<Vec<User>> {
        let rows = sqlx::query(
            "SELECT id, username, display_name, email, avatar_type, avatar_bg, avatar_text, 
             avatar_image_path, avatar_image_url, is_self, status, last_seen_at, created_at, updated_at
             FROM users ORDER BY is_self DESC, display_name ASC"
        )
        .fetch_all(self.pool.as_ref())
        .await?;

        let users = rows
            .iter()
            .map(|row| {
                let is_self: i32 = row.get("is_self");

                User {
                    id: row.get("id"),
                    username: row.get("username"),
                    display_name: row.get("display_name"),
                    email: row.get("email"),
                    avatar_type: row.get("avatar_type"),
                    avatar_bg: row.get("avatar_bg"),
                    avatar_text: row.get("avatar_text"),
                    avatar_image_path: row.get("avatar_image_path"),
                    avatar_image_url: row.get("avatar_image_url"),
                    is_self: is_self != 0,
                    status: row.get("status"),
                    last_seen_at: row.get("last_seen_at"),
                    created_at: row.get("created_at"),
                    updated_at: row.get("updated_at"),
                }
            })
            .collect();

        Ok(users)
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    async fn test_db() -> (Database, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::new(dir.path().join("t.db").to_str().unwrap())
            .await
            .unwrap();
        (db, dir)
    }

    fn user_req(username: &str, display_name: &str) -> CreateUserRequest {
        CreateUserRequest {
            username: username.to_string(),
            display_name: display_name.to_string(),
            email: None,
            avatar_type: None,
            avatar_bg: None,
            avatar_text: None,
            avatar_image_path: None,
            avatar_image_url: None,
            is_self: None,
        }
    }

    #[tokio::test]
    async fn create_and_get_roundtrip_with_defaults() {
        let (db, _dir) = test_db().await;
        let created = db
            .create_user(CreateUserRequest {
                username: "alice".to_string(),
                display_name: "Alice".to_string(),
                email: Some("alice@example.com".to_string()),
                avatar_type: Some("image".to_string()),
                avatar_bg: Some("#111111".to_string()),
                avatar_text: Some("A".to_string()),
                avatar_image_path: Some("avatars/alice.png".to_string()),
                avatar_image_url: Some("https://example.com/alice.png".to_string()),
                is_self: Some(false),
            })
            .await
            .unwrap();

        assert_eq!(created.username, "alice");
        assert_eq!(created.display_name, "Alice");
        assert_eq!(created.email.as_deref(), Some("alice@example.com"));
        assert_eq!(created.avatar_type, "image");
        assert_eq!(created.avatar_bg.as_deref(), Some("#111111"));
        assert_eq!(created.avatar_text.as_deref(), Some("A"));
        assert_eq!(
            created.avatar_image_path.as_deref(),
            Some("avatars/alice.png")
        );
        assert_eq!(
            created.avatar_image_url.as_deref(),
            Some("https://example.com/alice.png")
        );
        assert!(!created.is_self);
        assert_eq!(created.status, "active");
        assert_eq!(created.last_seen_at, None);
        assert!(!created.created_at.is_empty());

        let fetched = db.get_user(&created.id).await.unwrap().unwrap();
        assert_eq!(fetched.id, created.id);
        assert_eq!(fetched.username, created.username);
        assert_eq!(fetched.email, created.email);
        assert!(!fetched.is_self);
    }

    #[tokio::test]
    async fn create_applies_avatar_and_self_defaults() {
        let (db, _dir) = test_db().await;
        let created = db.create_user(user_req("bob", "Bob")).await.unwrap();
        assert_eq!(created.avatar_type, "text");
        assert!(!created.is_self);
        assert_eq!(created.status, "active");
    }

    #[tokio::test]
    async fn get_missing_returns_none() {
        let (db, _dir) = test_db().await;
        assert!(db.get_user("no-such-id").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn self_user_is_none_on_fresh_db_and_found_once_created() {
        let (db, _dir) = test_db().await;
        assert!(
            db.get_self_user().await.unwrap().is_none(),
            "fresh db has no self user; Database::new does not seed one"
        );

        let created = db
            .create_user(CreateUserRequest {
                username: "self".to_string(),
                display_name: "You".to_string(),
                email: None,
                avatar_type: None,
                avatar_bg: None,
                avatar_text: None,
                avatar_image_path: None,
                avatar_image_url: None,
                is_self: Some(true),
            })
            .await
            .unwrap();

        let found = db.get_self_user().await.unwrap().unwrap();
        assert_eq!(found.id, created.id);
        assert!(found.is_self);
        assert_eq!(found.username, "self");
    }

    #[tokio::test]
    async fn non_self_users_do_not_satisfy_get_self_user() {
        let (db, _dir) = test_db().await;
        db.create_user(user_req("carol", "Carol")).await.unwrap();
        assert!(db.get_self_user().await.unwrap().is_none());
    }

    #[tokio::test]
    async fn list_users_orders_self_first_then_display_name() {
        let (db, _dir) = test_db().await;
        db.create_user(user_req("zed", "Zed")).await.unwrap();
        let mut self_req = user_req("you", "You");
        self_req.is_self = Some(true);
        db.create_user(self_req).await.unwrap();
        db.create_user(user_req("ada", "Ada")).await.unwrap();

        let users = db.list_users().await.unwrap();
        assert_eq!(
            users
                .iter()
                .map(|u| u.username.as_str())
                .collect::<Vec<_>>(),
            vec!["you", "ada", "zed"],
            "is_self DESC, then display_name ASC"
        );
    }

    #[tokio::test]
    async fn duplicate_username_is_rejected() {
        let (db, _dir) = test_db().await;
        db.create_user(user_req("dup", "First")).await.unwrap();
        assert!(
            db.create_user(user_req("dup", "Second")).await.is_err(),
            "username is UNIQUE"
        );
    }
}
