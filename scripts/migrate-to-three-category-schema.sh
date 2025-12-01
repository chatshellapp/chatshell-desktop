#!/bin/bash
# Migration Script: Convert old attachment schema to three-category schema
#
# This script:
# 1. Creates a backup of your database
# 2. Runs the SQL migration
# 3. Verifies the migration was successful
#
# Usage: ./scripts/migrate-to-three-category-schema.sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Database paths (macOS uses Library/Application Support)
DB_DIR="${HOME}/Library/Application Support/app.chatshell.desktop"
DB_FILE="${DB_DIR}/data.db"
BACKUP_FILE="${DB_DIR}/chatshell.db.backup-$(date +%Y%m%d-%H%M%S)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_SCRIPT="${SCRIPT_DIR}/migrate-to-three-category-schema.sql"

echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}  Three-Category Schema Migration${NC}"
echo -e "${YELLOW}========================================${NC}"
echo ""

# Check if database exists
if [ ! -f "$DB_FILE" ]; then
    echo -e "${RED}Error: Database not found at ${DB_FILE}${NC}"
    echo "If you haven't run the app yet, there's nothing to migrate."
    exit 1
fi

# Check if SQL script exists
if [ ! -f "$SQL_SCRIPT" ]; then
    echo -e "${RED}Error: SQL script not found at ${SQL_SCRIPT}${NC}"
    exit 1
fi

# Check if sqlite3 is available
if ! command -v sqlite3 &> /dev/null; then
    echo -e "${RED}Error: sqlite3 is not installed${NC}"
    echo "Please install sqlite3 first."
    exit 1
fi

# Display database info
echo -e "Database location: ${GREEN}${DB_FILE}${NC}"
echo ""

# Show current schema info
echo -e "${YELLOW}Current database state:${NC}"
echo -n "  Messages: "
sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM messages;" 2>/dev/null || echo "N/A"
echo -n "  With thinking_content: "
sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM messages WHERE thinking_content IS NOT NULL AND thinking_content != '';" 2>/dev/null || echo "N/A"
echo -n "  Old attachments: "
sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM message_attachments;" 2>/dev/null || echo "N/A"
echo ""

# Ask for confirmation
read -p "Create backup and run migration? [y/N] " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Migration cancelled."
    exit 0
fi

# Create backup
echo ""
echo -e "${YELLOW}Step 1: Creating backup...${NC}"
cp "$DB_FILE" "$BACKUP_FILE"
echo -e "  Backup created: ${GREEN}${BACKUP_FILE}${NC}"

# Run migration
echo ""
echo -e "${YELLOW}Step 2: Running migration...${NC}"
if sqlite3 "$DB_FILE" < "$SQL_SCRIPT"; then
    echo -e "  ${GREEN}Migration completed successfully!${NC}"
else
    echo -e "  ${RED}Migration failed!${NC}"
    echo ""
    echo "Restoring from backup..."
    cp "$BACKUP_FILE" "$DB_FILE"
    echo -e "  ${GREEN}Database restored from backup.${NC}"
    exit 1
fi

# Verify migration
echo ""
echo -e "${YELLOW}Step 3: Verifying migration...${NC}"
echo ""
echo -e "${YELLOW}New schema state:${NC}"
echo -n "  Messages: "
sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM messages;"
echo -n "  Thinking steps: "
sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM thinking_steps;"
echo -n "  Message contexts: "
sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM message_contexts;"
echo -n "  Message steps: "
sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM message_steps;"
echo -n "  User attachments (files): "
sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM message_attachments;"
echo ""

# Check for any issues
echo -e "${YELLOW}Validation:${NC}"

# Check that messages table no longer has thinking_content column
COLS=$(sqlite3 "$DB_FILE" "PRAGMA table_info(messages);" | grep -c "thinking_content" || true)
if [ "$COLS" -eq 0 ]; then
    echo -e "  ${GREEN}✓${NC} thinking_content column removed from messages"
else
    echo -e "  ${RED}✗${NC} thinking_content column still exists in messages"
fi

# Check that message_attachments only has file type
TYPES=$(sqlite3 "$DB_FILE" "SELECT DISTINCT attachment_type FROM message_attachments;" 2>/dev/null || echo "")
if [ -z "$TYPES" ] || [ "$TYPES" = "file" ]; then
    echo -e "  ${GREEN}✓${NC} message_attachments contains only 'file' type"
else
    echo -e "  ${YELLOW}!${NC} message_attachments contains: $TYPES"
fi

# Check new junction tables exist
if sqlite3 "$DB_FILE" "SELECT 1 FROM message_contexts LIMIT 1;" &>/dev/null; then
    echo -e "  ${GREEN}✓${NC} message_contexts table created"
fi
if sqlite3 "$DB_FILE" "SELECT 1 FROM message_steps LIMIT 1;" &>/dev/null; then
    echo -e "  ${GREEN}✓${NC} message_steps table created"
fi
if sqlite3 "$DB_FILE" "SELECT 1 FROM thinking_steps LIMIT 1;" &>/dev/null; then
    echo -e "  ${GREEN}✓${NC} thinking_steps table created"
fi

# Check fetch_results source_type distribution
SEARCH_COUNT=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM fetch_results WHERE source_type = 'search';" 2>/dev/null || echo "0")
USER_COUNT=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM fetch_results WHERE source_type = 'user_link';" 2>/dev/null || echo "0")
echo -e "  ${GREEN}✓${NC} fetch_results source_type: search=$SEARCH_COUNT, user_link=$USER_COUNT"

# Check for incorrectly labeled fetch_results (source_type='search' but no source_id)
MISMATCHED=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM fetch_results WHERE source_type = 'search' AND (source_id IS NULL OR source_id = '');" 2>/dev/null || echo "0")
if [ "$MISMATCHED" -eq 0 ]; then
    echo -e "  ${GREEN}✓${NC} No mismatched fetch_results (all 'search' types have source_id)"
else
    echo -e "  ${RED}✗${NC} Found $MISMATCHED fetch_results with source_type='search' but no source_id"
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Migration Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "Backup saved at: ${YELLOW}${BACKUP_FILE}${NC}"
echo "You can delete it after verifying everything works correctly."
echo ""

