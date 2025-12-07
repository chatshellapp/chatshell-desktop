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

