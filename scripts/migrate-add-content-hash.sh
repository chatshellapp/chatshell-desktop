#!/bin/bash
# Migration script to add content_hash columns and generate hashes for existing data
# Requires: sqlite3, b3sum (Blake3 CLI tool)
#
# Install b3sum: cargo install b3sum  OR  brew install b3sum

set -e

# Configuration
DB_PATH="$HOME/Library/Application Support/app.chatshell.desktop/data.db"
ATTACHMENTS_DIR="$HOME/Library/Application Support/app.chatshell.desktop/attachments"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================"
echo "Content Hash Migration Script"
echo "========================================"
echo ""

# Check prerequisites
if ! command -v sqlite3 &> /dev/null; then
    echo -e "${RED}Error: sqlite3 is not installed${NC}"
    exit 1
fi

if ! command -v b3sum &> /dev/null; then
    echo -e "${RED}Error: b3sum (Blake3 CLI) is not installed${NC}"
    echo ""
    echo "Install it with one of these commands:"
    echo "  cargo install b3sum"
    echo "  brew install b3sum"
    exit 1
fi

# Check if database exists
if [ ! -f "$DB_PATH" ]; then
    echo -e "${RED}Error: Database not found at: $DB_PATH${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} Prerequisites check passed"
echo ""

# Backup database
BACKUP_PATH="${DB_PATH}.backup.$(date +%Y%m%d_%H%M%S)"
echo "Creating backup: $BACKUP_PATH"
cp "$DB_PATH" "$BACKUP_PATH"
echo -e "${GREEN}✓${NC} Backup created"
echo ""

# Step 1: Add columns if they don't exist
echo "Step 1: Adding content_hash columns..."

# Check and add column to files table
HAS_FILES_HASH=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM pragma_table_info('files') WHERE name='content_hash';")
if [ "$HAS_FILES_HASH" -eq 0 ]; then
    sqlite3 "$DB_PATH" "ALTER TABLE files ADD COLUMN content_hash TEXT;"
    echo -e "${GREEN}✓${NC} Added content_hash column to files table"
else
    echo -e "${YELLOW}→${NC} files.content_hash column already exists"
fi

# Check and add column to fetch_results table
HAS_FETCH_HASH=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM pragma_table_info('fetch_results') WHERE name='content_hash';")
if [ "$HAS_FETCH_HASH" -eq 0 ]; then
    sqlite3 "$DB_PATH" "ALTER TABLE fetch_results ADD COLUMN content_hash TEXT;"
    echo -e "${GREEN}✓${NC} Added content_hash column to fetch_results table"
else
    echo -e "${YELLOW}→${NC} fetch_results.content_hash column already exists"
fi

echo ""

# Step 2: Create indexes
echo "Step 2: Creating indexes..."

sqlite3 "$DB_PATH" "CREATE INDEX IF NOT EXISTS idx_files_content_hash ON files(content_hash);"
echo -e "${GREEN}✓${NC} Created index idx_files_content_hash"

sqlite3 "$DB_PATH" "CREATE INDEX IF NOT EXISTS idx_fetch_results_content_hash ON fetch_results(content_hash);"
echo -e "${GREEN}✓${NC} Created index idx_fetch_results_content_hash"

echo ""

# Step 3: Generate hashes for existing files
echo "Step 3: Generating hashes for existing files..."

FILES_COUNT=0
FILES_UPDATED=0
FILES_MISSING=0

# Get all files without content_hash
while IFS='|' read -r id storage_path; do
    ((FILES_COUNT++)) || true
    
    FULL_PATH="$ATTACHMENTS_DIR/$storage_path"
    
    if [ -f "$FULL_PATH" ]; then
        # Compute Blake3 hash
        HASH=$(b3sum "$FULL_PATH" | cut -d' ' -f1)
        
        # Update database
        sqlite3 "$DB_PATH" "UPDATE files SET content_hash = '$HASH' WHERE id = '$id';"
        ((FILES_UPDATED++)) || true
        echo "  ✓ $storage_path -> ${HASH:0:16}..."
    else
        echo -e "  ${YELLOW}⚠${NC} File not found: $storage_path"
        ((FILES_MISSING++)) || true
    fi
done < <(sqlite3 "$DB_PATH" "SELECT id, storage_path FROM files WHERE content_hash IS NULL;")

if [ "$FILES_COUNT" -eq 0 ]; then
    echo -e "${YELLOW}→${NC} No files need hash generation"
else
    echo -e "${GREEN}✓${NC} Processed $FILES_COUNT files: $FILES_UPDATED updated, $FILES_MISSING missing"
fi

echo ""

# Step 4: Generate hashes for existing fetch_results
echo "Step 4: Generating hashes for existing fetch_results..."

FETCH_COUNT=0
FETCH_UPDATED=0
FETCH_MISSING=0

# Get all fetch_results without content_hash
while IFS='|' read -r id storage_path; do
    ((FETCH_COUNT++)) || true
    
    FULL_PATH="$ATTACHMENTS_DIR/$storage_path"
    
    if [ -f "$FULL_PATH" ]; then
        # Compute Blake3 hash
        HASH=$(b3sum "$FULL_PATH" | cut -d' ' -f1)
        
        # Update database
        sqlite3 "$DB_PATH" "UPDATE fetch_results SET content_hash = '$HASH' WHERE id = '$id';"
        ((FETCH_UPDATED++)) || true
        echo "  ✓ $storage_path -> ${HASH:0:16}..."
    else
        echo -e "  ${YELLOW}⚠${NC} File not found: $storage_path"
        ((FETCH_MISSING++)) || true
    fi
done < <(sqlite3 "$DB_PATH" "SELECT id, storage_path FROM fetch_results WHERE content_hash IS NULL;")

if [ "$FETCH_COUNT" -eq 0 ]; then
    echo -e "${YELLOW}→${NC} No fetch_results need hash generation"
else
    echo -e "${GREEN}✓${NC} Processed $FETCH_COUNT fetch_results: $FETCH_UPDATED updated, $FETCH_MISSING missing"
fi

echo ""

# Summary
echo "========================================"
echo "Migration Complete!"
echo "========================================"
echo ""
echo "Summary:"
echo "  - Files: $FILES_UPDATED hashed, $FILES_MISSING missing"
echo "  - Fetch results: $FETCH_UPDATED hashed, $FETCH_MISSING missing"
echo ""
echo "Backup saved to: $BACKUP_PATH"
echo ""

# Verify
echo "Verification:"
NULL_FILES=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM files WHERE content_hash IS NULL;")
NULL_FETCH=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM fetch_results WHERE content_hash IS NULL;")

if [ "$NULL_FILES" -eq 0 ] && [ "$NULL_FETCH" -eq 0 ]; then
    echo -e "${GREEN}✓${NC} All records have content_hash"
else
    echo -e "${YELLOW}⚠${NC} Records without content_hash: files=$NULL_FILES, fetch_results=$NULL_FETCH"
fi

echo ""
echo "Done! You can now run the application."

