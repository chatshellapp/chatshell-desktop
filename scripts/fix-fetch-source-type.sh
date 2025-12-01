#!/bin/bash
# Quick fix script for fetch_results source_type issue
#
# This script fixes existing databases where all fetch_results incorrectly have
# source_type='search' even for user-provided URLs.
#
# Usage: ./scripts/fix-fetch-source-type.sh

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Database path
DB_FILE="${HOME}/Library/Application Support/app.chatshell.desktop/data.db"

echo -e "${YELLOW}Fix fetch_results source_type${NC}"
echo ""

if [ ! -f "$DB_FILE" ]; then
    echo -e "${RED}Database not found at $DB_FILE${NC}"
    exit 1
fi

# Show current state
echo "Current state:"
echo -n "  source_type='search': "
sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM fetch_results WHERE source_type = 'search';"
echo -n "  source_type='user_link': "
sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM fetch_results WHERE source_type = 'user_link';"
echo -n "  Mismatched (search but no source_id): "
sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM fetch_results WHERE source_type = 'search' AND (source_id IS NULL OR source_id = '');"
echo ""

# Ask confirmation
read -p "Fix mismatched records? [y/N] " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

# Apply fix
echo "Applying fix..."
sqlite3 "$DB_FILE" "UPDATE fetch_results SET source_type = 'user_link' WHERE (source_id IS NULL OR source_id = '') AND source_type = 'search';"

# Show result
echo ""
echo -e "${GREEN}Fixed!${NC} New state:"
echo -n "  source_type='search': "
sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM fetch_results WHERE source_type = 'search';"
echo -n "  source_type='user_link': "
sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM fetch_results WHERE source_type = 'user_link';"
echo ""

