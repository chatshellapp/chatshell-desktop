#!/bin/bash

# Database Migration Script
# Migrates database to new schema with direct FK relationships for process steps and search results
# 
# Changes:
# - thinking_steps: Added message_id (FK), display_order
# - search_decisions: Added message_id (FK), display_order  
# - tool_calls: Added message_id (FK), display_order
# - code_executions: Added message_id (FK), display_order
# - search_results: Added message_id (FK), display_order
# - Removed message_steps junction table (data migrated)
# - Updated message_contexts to only support fetch_result

set -e

DB_PATH="$HOME/Library/Application Support/app.chatshell.desktop/data.db"
BACKUP_PATH="$HOME/Library/Application Support/app.chatshell.desktop/data.db.backup.$(date +%Y%m%d_%H%M%S)"

echo "=============================================="
echo "Database Migration Script"
echo "=============================================="
echo ""

# Check if database exists
if [ ! -f "$DB_PATH" ]; then
    echo "Error: Database not found at $DB_PATH"
    exit 1
fi

echo "Database: $DB_PATH"
echo "Backup: $BACKUP_PATH"
echo ""

# Create backup
echo "Creating backup..."
cp "$DB_PATH" "$BACKUP_PATH"
echo "Backup created successfully."
echo ""

# Run migration
echo "Starting migration..."

sqlite3 "$DB_PATH" <<'EOF'
-- Enable foreign keys
PRAGMA foreign_keys = OFF;

-- Begin transaction
BEGIN TRANSACTION;

-- ============================================
-- 1. Migrate thinking_steps
-- ============================================
CREATE TABLE IF NOT EXISTS thinking_steps_new (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT DEFAULT 'llm',
    display_order INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

-- Migrate data from old table with message_id from junction table
INSERT OR IGNORE INTO thinking_steps_new (id, message_id, content, source, display_order, created_at)
SELECT 
    ts.id,
    COALESCE(ms.message_id, ''),
    ts.content,
    ts.source,
    COALESCE(ms.display_order, 0),
    ts.created_at
FROM thinking_steps ts
LEFT JOIN message_steps ms ON ms.step_id = ts.id AND ms.step_type = 'thinking';

-- Drop old table and rename
DROP TABLE IF EXISTS thinking_steps;
ALTER TABLE thinking_steps_new RENAME TO thinking_steps;

-- Create index
CREATE INDEX IF NOT EXISTS idx_thinking_steps_message ON thinking_steps(message_id);

-- ============================================
-- 2. Migrate search_decisions
-- ============================================
CREATE TABLE IF NOT EXISTS search_decisions_new (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    reasoning TEXT NOT NULL,
    search_needed INTEGER NOT NULL,
    search_query TEXT,
    search_result_id TEXT,
    display_order INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
    FOREIGN KEY (search_result_id) REFERENCES search_results(id) ON DELETE SET NULL
);

-- Migrate data
INSERT OR IGNORE INTO search_decisions_new (id, message_id, reasoning, search_needed, search_query, search_result_id, display_order, created_at)
SELECT 
    sd.id,
    COALESCE(ms.message_id, ''),
    sd.reasoning,
    sd.search_needed,
    sd.search_query,
    sd.search_result_id,
    COALESCE(ms.display_order, 0),
    sd.created_at
FROM search_decisions sd
LEFT JOIN message_steps ms ON ms.step_id = sd.id AND ms.step_type = 'search_decision';

-- Drop old table and rename
DROP TABLE IF EXISTS search_decisions;
ALTER TABLE search_decisions_new RENAME TO search_decisions;

-- Create index
CREATE INDEX IF NOT EXISTS idx_search_decisions_message ON search_decisions(message_id);

-- ============================================
-- 3. Migrate tool_calls
-- ============================================
CREATE TABLE IF NOT EXISTS tool_calls_new (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    tool_input TEXT,
    tool_output TEXT,
    status TEXT DEFAULT 'pending',
    error TEXT,
    duration_ms INTEGER,
    display_order INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

-- Migrate data
INSERT OR IGNORE INTO tool_calls_new (id, message_id, tool_name, tool_input, tool_output, status, error, duration_ms, display_order, created_at, completed_at)
SELECT 
    tc.id,
    COALESCE(ms.message_id, ''),
    tc.tool_name,
    tc.tool_input,
    tc.tool_output,
    tc.status,
    tc.error,
    tc.duration_ms,
    COALESCE(ms.display_order, 0),
    tc.created_at,
    tc.completed_at
FROM tool_calls tc
LEFT JOIN message_steps ms ON ms.step_id = tc.id AND ms.step_type = 'tool_call';

-- Drop old table and rename
DROP TABLE IF EXISTS tool_calls;
ALTER TABLE tool_calls_new RENAME TO tool_calls;

-- Create index
CREATE INDEX IF NOT EXISTS idx_tool_calls_message ON tool_calls(message_id);

-- ============================================
-- 4. Migrate code_executions
-- ============================================
CREATE TABLE IF NOT EXISTS code_executions_new (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    language TEXT NOT NULL,
    code TEXT NOT NULL,
    output TEXT,
    exit_code INTEGER,
    status TEXT DEFAULT 'pending',
    error TEXT,
    duration_ms INTEGER,
    display_order INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

-- Migrate data
INSERT OR IGNORE INTO code_executions_new (id, message_id, language, code, output, exit_code, status, error, duration_ms, display_order, created_at, completed_at)
SELECT 
    ce.id,
    COALESCE(ms.message_id, ''),
    ce.language,
    ce.code,
    ce.output,
    ce.exit_code,
    ce.status,
    ce.error,
    ce.duration_ms,
    COALESCE(ms.display_order, 0),
    ce.created_at,
    ce.completed_at
FROM code_executions ce
LEFT JOIN message_steps ms ON ms.step_id = ce.id AND ms.step_type = 'code_execution';

-- Drop old table and rename
DROP TABLE IF EXISTS code_executions;
ALTER TABLE code_executions_new RENAME TO code_executions;

-- Create index
CREATE INDEX IF NOT EXISTS idx_code_executions_message ON code_executions(message_id);

-- ============================================
-- 5. Migrate search_results
-- ============================================
CREATE TABLE IF NOT EXISTS search_results_new (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    query TEXT NOT NULL,
    engine TEXT NOT NULL,
    total_results INTEGER,
    display_order INTEGER DEFAULT 0,
    searched_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

-- Migrate data from old table with message_id from message_contexts
INSERT OR IGNORE INTO search_results_new (id, message_id, query, engine, total_results, display_order, searched_at, created_at)
SELECT 
    sr.id,
    COALESCE(mc.message_id, ''),
    sr.query,
    sr.engine,
    sr.total_results,
    COALESCE(mc.display_order, 0),
    sr.searched_at,
    sr.created_at
FROM search_results sr
LEFT JOIN message_contexts mc ON mc.context_id = sr.id AND mc.context_type = 'search_result';

-- Drop old table and rename
DROP TABLE IF EXISTS search_results;
ALTER TABLE search_results_new RENAME TO search_results;

-- Create index
CREATE INDEX IF NOT EXISTS idx_search_results_message ON search_results(message_id);

-- ============================================
-- 6. Clean up junction tables
-- ============================================

-- Remove message_steps table (no longer needed)
DROP TABLE IF EXISTS message_steps;

-- Remove search_result entries from message_contexts (search_results now have direct FK)
DELETE FROM message_contexts WHERE context_type = 'search_result';

-- ============================================
-- 7. Clean up orphaned records (records with empty message_id)
-- ============================================
DELETE FROM thinking_steps WHERE message_id = '';
DELETE FROM search_decisions WHERE message_id = '';
DELETE FROM tool_calls WHERE message_id = '';
DELETE FROM code_executions WHERE message_id = '';
DELETE FROM search_results WHERE message_id = '';

-- Commit transaction
COMMIT;

-- Re-enable foreign keys
PRAGMA foreign_keys = ON;

-- Verify integrity
PRAGMA integrity_check;

EOF

echo ""
echo "Migration completed successfully!"
echo ""

# Show migration results
echo "Post-migration statistics:"
sqlite3 "$DB_PATH" <<'EOF'
SELECT 'thinking_steps' as table_name, COUNT(*) as count FROM thinking_steps
UNION ALL
SELECT 'search_decisions', COUNT(*) FROM search_decisions
UNION ALL
SELECT 'tool_calls', COUNT(*) FROM tool_calls
UNION ALL
SELECT 'code_executions', COUNT(*) FROM code_executions
UNION ALL
SELECT 'search_results', COUNT(*) FROM search_results
UNION ALL
SELECT 'message_contexts (fetch_result only)', COUNT(*) FROM message_contexts;
EOF

echo ""
echo "=============================================="
echo "Migration Complete!"
echo "=============================================="
echo ""
echo "Backup saved to: $BACKUP_PATH"
echo ""
echo "To restore from backup if needed:"
echo "  cp \"$BACKUP_PATH\" \"$DB_PATH\""

