#!/bin/bash

# Cleanup script to remove duplicate providers from database
# This script keeps the oldest provider of each type and removes newer duplicates

DB_PATH="${1:-src-tauri/chatshell.db}"

if [ ! -f "$DB_PATH" ]; then
    echo "❌ Database not found at: $DB_PATH"
    echo "Usage: $0 [path/to/chatshell.db]"
    exit 1
fi

echo "📊 Checking for duplicate providers in: $DB_PATH"
echo ""

# Show all providers
echo "Current providers:"
sqlite3 "$DB_PATH" "SELECT id, name, provider_type, created_at FROM providers ORDER BY provider_type, created_at;"
echo ""

# Find duplicates
echo "Duplicate providers (by provider_type):"
sqlite3 "$DB_PATH" "
SELECT provider_type, COUNT(*) as count
FROM providers
GROUP BY provider_type
HAVING count > 1;
"
echo ""

# For each provider_type with duplicates, keep the oldest and delete the rest
echo "🧹 Cleaning up duplicates (keeping oldest of each type)..."

# Get duplicate provider types
DUPLICATE_TYPES=$(sqlite3 "$DB_PATH" "
SELECT DISTINCT provider_type
FROM providers
GROUP BY provider_type
HAVING COUNT(*) > 1;
")

if [ -z "$DUPLICATE_TYPES" ]; then
    echo "✅ No duplicate providers found!"
    exit 0
fi

# For each duplicate type
for TYPE in $DUPLICATE_TYPES; do
    echo ""
    echo "Processing provider_type: $TYPE"
    
    # Get the oldest provider ID for this type
    KEEP_ID=$(sqlite3 "$DB_PATH" "
    SELECT id FROM providers
    WHERE provider_type = '$TYPE'
    ORDER BY created_at ASC
    LIMIT 1;
    ")
    
    echo "  Keeping provider: $KEEP_ID (oldest)"
    
    # Get IDs to delete (all except the oldest)
    DELETE_IDS=$(sqlite3 "$DB_PATH" "
    SELECT id FROM providers
    WHERE provider_type = '$TYPE'
    AND id != '$KEEP_ID';
    ")
    
    for DELETE_ID in $DELETE_IDS; do
        echo "  Deleting provider: $DELETE_ID"
        
        # Check if this provider has models
        MODEL_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM models WHERE provider_id = '$DELETE_ID';")
        
        if [ "$MODEL_COUNT" -gt 0 ]; then
            echo "    Moving $MODEL_COUNT model(s) to kept provider..."
            sqlite3 "$DB_PATH" "UPDATE models SET provider_id = '$KEEP_ID' WHERE provider_id = '$DELETE_ID';"
        fi
        
        # Delete the duplicate provider
        sqlite3 "$DB_PATH" "DELETE FROM providers WHERE id = '$DELETE_ID';"
        echo "    ✅ Deleted"
    done
done

echo ""
echo "🎉 Cleanup complete!"
echo ""
echo "Final providers:"
sqlite3 "$DB_PATH" "SELECT id, name, provider_type, created_at FROM providers ORDER BY provider_type, created_at;"

