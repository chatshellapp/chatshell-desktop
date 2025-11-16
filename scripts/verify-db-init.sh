#!/bin/bash

# Script to verify database initialization

DB_PATH="${1:-chatshell.db}"

echo "🔍 Verifying database initialization..."
echo ""

if [ ! -f "$DB_PATH" ]; then
    echo "⚠️  Database not found at: $DB_PATH"
    echo "   Please run the app first to initialize the database"
    exit 1
fi

echo "📊 Database: $DB_PATH"
echo ""

# Check providers table
echo "=== Providers Table ==="
PROVIDER_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM providers;")
echo "Provider count: $PROVIDER_COUNT"
if [ "$PROVIDER_COUNT" -gt 0 ]; then
    sqlite3 "$DB_PATH" "SELECT id, name, provider_type, is_enabled FROM providers;"
fi
echo ""

# Check models table
echo "=== Models Table ==="
MODEL_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM models;")
echo "Model count: $MODEL_COUNT"
if [ "$MODEL_COUNT" -gt 0 ]; then
    sqlite3 "$DB_PATH" "SELECT id, name, provider_id, is_starred FROM models;"
fi
echo ""

# Check agents table
echo "=== Agents Table ==="
AGENT_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM agents;")
echo "Agent count: $AGENT_COUNT"
if [ "$AGENT_COUNT" -gt 0 ]; then
    sqlite3 "$DB_PATH" "SELECT id, name, model_id, is_starred FROM agents;"
fi
echo ""

# Verify schema
echo "=== Schema Verification ==="
echo "✓ Checking providers table has provider_type column..."
sqlite3 "$DB_PATH" "SELECT provider_type FROM providers LIMIT 1;" 2>&1 > /dev/null && echo "  ✅ OK" || echo "  ❌ FAIL"

echo "✓ Checking models table has provider_id column..."
sqlite3 "$DB_PATH" "SELECT provider_id FROM models LIMIT 1;" 2>&1 > /dev/null && echo "  ✅ OK" || echo "  ❌ FAIL"

echo "✓ Checking models table has is_starred column..."
sqlite3 "$DB_PATH" "SELECT is_starred FROM models LIMIT 1;" 2>&1 > /dev/null && echo "  ✅ OK" || echo "  ❌ FAIL"

echo ""
echo "🎉 Verification complete!"

