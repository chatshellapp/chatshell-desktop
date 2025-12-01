-- Migration Script: Convert old attachment schema to three-category schema
-- Run this script manually on your existing database before using the new version
--
-- Usage (macOS): sqlite3 ~/Library/Application\ Support/app.chatshell.desktop/data.db < scripts/migrate-to-three-category-schema.sql
-- Usage (Linux): sqlite3 ~/.config/chatshell-desktop/chatshell.db < scripts/migrate-to-three-category-schema.sql
--
-- Categories:
--   1. User Attachments: files, user_links (user-provided)
--   2. Context Enrichments: search_results, fetch_results (system-fetched)
--   3. Process Steps: thinking_steps, search_decisions, tool_calls, code_executions (AI workflow)

-- Enable foreign keys
PRAGMA foreign_keys = OFF;

-- Start transaction
BEGIN TRANSACTION;

-- ============================================================================
-- Step 1: Create new tables
-- ============================================================================

-- User links table (new)
CREATE TABLE IF NOT EXISTS user_links (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    title TEXT,
    created_at TEXT NOT NULL
);

-- Thinking steps table (new - replaces messages.thinking_content)
CREATE TABLE IF NOT EXISTS thinking_steps (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    source TEXT DEFAULT 'llm',
    created_at TEXT NOT NULL
);

-- Tool calls table (new - for future MCP support)
CREATE TABLE IF NOT EXISTS tool_calls (
    id TEXT PRIMARY KEY,
    tool_name TEXT NOT NULL,
    tool_input TEXT,
    tool_output TEXT,
    status TEXT DEFAULT 'pending',
    error TEXT,
    duration_ms INTEGER,
    created_at TEXT NOT NULL,
    completed_at TEXT
);

-- Code executions table (new - for future code interpreter)
CREATE TABLE IF NOT EXISTS code_executions (
    id TEXT PRIMARY KEY,
    language TEXT NOT NULL,
    code TEXT NOT NULL,
    output TEXT,
    exit_code INTEGER,
    status TEXT DEFAULT 'pending',
    error TEXT,
    duration_ms INTEGER,
    created_at TEXT NOT NULL,
    completed_at TEXT
);

-- Message contexts junction table (new)
CREATE TABLE IF NOT EXISTS message_contexts (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    context_type TEXT NOT NULL CHECK(context_type IN ('search_result', 'fetch_result')),
    context_id TEXT NOT NULL,
    display_order INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_message_contexts_message ON message_contexts(message_id);

-- Message steps junction table (new)
CREATE TABLE IF NOT EXISTS message_steps (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    step_type TEXT NOT NULL CHECK(step_type IN ('thinking', 'search_decision', 'tool_call', 'code_execution')),
    step_id TEXT NOT NULL,
    display_order INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_message_steps_message ON message_steps(message_id);

-- ============================================================================
-- Step 2: Add search_result_id column to search_decisions (if not exists)
-- ============================================================================

-- Check if search_result_id column exists, if not add it
-- SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so we use a workaround
CREATE TABLE IF NOT EXISTS _temp_check_column (dummy TEXT);
DROP TABLE _temp_check_column;

-- Add column (will fail silently if already exists due to ALTER TABLE behavior)
ALTER TABLE search_decisions ADD COLUMN search_result_id TEXT REFERENCES search_results(id);

-- ============================================================================
-- Step 3: Update fetch_results to use source_type/source_id
-- ============================================================================

-- Add new columns to fetch_results
-- Default to 'user_link' since we'll update search-initiated ones below
ALTER TABLE fetch_results ADD COLUMN source_type TEXT NOT NULL DEFAULT 'user_link';
ALTER TABLE fetch_results ADD COLUMN source_id TEXT;

-- Migrate data: copy search_id to source_id and set correct source_type
-- If search_id exists, it's from a search; otherwise it's a user-provided URL
UPDATE fetch_results 
SET source_id = search_id, 
    source_type = 'search' 
WHERE search_id IS NOT NULL;

-- Note: fetch_results with search_id = NULL are user-provided URLs (source_type = 'user_link')
-- Note: We keep search_id for now to avoid breaking anything, can be dropped later

-- Fix existing data: if source_id is NULL but source_type is 'search', fix it to 'user_link'
-- This handles databases that already ran a partial migration with incorrect source_type
UPDATE fetch_results 
SET source_type = 'user_link' 
WHERE (source_id IS NULL OR source_id = '') AND source_type = 'search';

-- ============================================================================
-- Step 4: Migrate message_attachments data to new junction tables
-- ============================================================================

-- Migrate search_result and fetch_result links to message_contexts
INSERT INTO message_contexts (id, message_id, context_type, context_id, display_order, created_at)
SELECT 
    id,
    message_id,
    attachment_type,
    attachment_id,
    display_order,
    created_at
FROM message_attachments
WHERE attachment_type IN ('search_result', 'fetch_result');

-- Migrate search_decision links to message_steps
INSERT INTO message_steps (id, message_id, step_type, step_id, display_order, created_at)
SELECT 
    id,
    message_id,
    attachment_type,  -- 'search_decision' becomes the step_type
    attachment_id,
    display_order,
    created_at
FROM message_attachments
WHERE attachment_type = 'search_decision';

-- ============================================================================
-- Step 5: Migrate thinking_content from messages to thinking_steps
-- ============================================================================

-- Create thinking_steps entries for all messages with thinking_content
INSERT INTO thinking_steps (id, content, source, created_at)
SELECT 
    -- Generate a UUID-like ID based on message id (deterministic for re-runs)
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || 
    substr(lower(hex(randomblob(2))),2) || '-' || 
    substr('89ab', abs(random()) % 4 + 1, 1) || 
    substr(lower(hex(randomblob(2))),2) || '-' || 
    lower(hex(randomblob(6))),
    thinking_content,
    'llm',
    created_at
FROM messages
WHERE thinking_content IS NOT NULL AND thinking_content != '';

-- Link thinking_steps to messages via message_steps
-- Note: We need to match by content since we just generated new IDs
INSERT INTO message_steps (id, message_id, step_type, step_id, display_order, created_at)
SELECT 
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || 
    substr(lower(hex(randomblob(2))),2) || '-' || 
    substr('89ab', abs(random()) % 4 + 1, 1) || 
    substr(lower(hex(randomblob(2))),2) || '-' || 
    lower(hex(randomblob(6))),
    m.id,
    'thinking',
    ts.id,
    0,  -- thinking steps should be shown first
    m.created_at
FROM messages m
INNER JOIN thinking_steps ts ON ts.content = m.thinking_content
WHERE m.thinking_content IS NOT NULL AND m.thinking_content != '';

-- ============================================================================
-- Step 6: Update message_attachments to only allow file and user_link types
-- ============================================================================

-- First, delete migrated entries (search_result, fetch_result, search_decision)
DELETE FROM message_attachments
WHERE attachment_type IN ('search_result', 'fetch_result', 'search_decision');

-- Recreate the table with new constraints (SQLite doesn't support modifying CHECK constraints)
CREATE TABLE message_attachments_new (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    attachment_type TEXT NOT NULL CHECK(attachment_type IN ('file', 'user_link')),
    attachment_id TEXT NOT NULL,
    display_order INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

-- Copy remaining data (only 'file' entries)
INSERT INTO message_attachments_new 
SELECT * FROM message_attachments WHERE attachment_type = 'file';

-- Drop old table and rename new one
DROP TABLE message_attachments;
ALTER TABLE message_attachments_new RENAME TO message_attachments;

-- Recreate index
CREATE INDEX IF NOT EXISTS idx_message_attachments_message ON message_attachments(message_id);

-- ============================================================================
-- Step 7: Optional - Remove thinking_content column from messages
-- ============================================================================

-- Note: SQLite doesn't support DROP COLUMN directly (before version 3.35.0)
-- We'll create a new table without the column and migrate data

CREATE TABLE messages_new (
    id TEXT PRIMARY KEY,
    conversation_id TEXT,
    sender_type TEXT NOT NULL,
    sender_id TEXT,
    content TEXT NOT NULL,
    tokens INTEGER,
    created_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

INSERT INTO messages_new (id, conversation_id, sender_type, sender_id, content, tokens, created_at)
SELECT id, conversation_id, sender_type, sender_id, content, tokens, created_at
FROM messages;

DROP TABLE messages;
ALTER TABLE messages_new RENAME TO messages;

-- Recreate index
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created 
ON messages(conversation_id, created_at DESC);

-- Commit transaction
COMMIT;

-- Re-enable foreign keys
PRAGMA foreign_keys = ON;

-- ============================================================================
-- Verification queries (run these to check migration success)
-- ============================================================================

-- Check counts
SELECT 'message_contexts count: ' || COUNT(*) FROM message_contexts;
SELECT 'message_steps count: ' || COUNT(*) FROM message_steps;
SELECT 'thinking_steps count: ' || COUNT(*) FROM thinking_steps;
SELECT 'message_attachments count (should only be files): ' || COUNT(*) FROM message_attachments;

-- Check message_attachments types (should only show 'file')
SELECT DISTINCT attachment_type FROM message_attachments;

-- Check message_contexts types
SELECT DISTINCT context_type FROM message_contexts;

-- Check message_steps types
SELECT DISTINCT step_type FROM message_steps;

SELECT '✅ Migration complete!';

