#!/usr/bin/env bash
# Prepare the isolated UI-test profile used by
#   pnpm tauri dev --config scripts/ui-automation/tauri.uitest.conf.json
# The test identifier gets its own data folder; this script fills it.
#
#   prepare-profile.sh real [SOURCE_DIR]  snapshot of the real profile
#   prepare-profile.sh seed DB_PATH       a generated seed database
#
# Sync is written disabled (and onboarded, so no prompt appears). The real
# data folder is only ever read: the database through a read-only VACUUM
# INTO, attachments through cp. Quit the test app before running this.
set -euo pipefail

REAL_DIR="$HOME/Library/Application Support/app.chatshell.desktop"
TEST_DIR="$HOME/Library/Application Support/app.chatshell.desktop.uitest"

mode="${1:-}"
case "$mode" in
  real) source_dir="${2:-$REAL_DIR}" ;;
  seed) seed_db="${2:?usage: prepare-profile.sh seed DB_PATH}" ;;
  *)
    echo "usage: prepare-profile.sh real [SOURCE_DIR] | seed DB_PATH" >&2
    exit 2
    ;;
esac

if [[ "$TEST_DIR" == "$REAL_DIR" ]]; then
  echo "refusing: test folder equals the real data folder" >&2
  exit 1
fi
if pgrep -f "app.chatshell.desktop.uitest" >/dev/null 2>&1; then
  echo "quit the UI-test app first" >&2
  exit 1
fi

rm -rf "$TEST_DIR"
mkdir -p "$TEST_DIR"

if [[ "$mode" == "real" ]]; then
  sqlite3 "file:$source_dir/data.db?mode=ro" "VACUUM INTO '$TEST_DIR/data.db';"
  if [[ -d "$source_dir/attachments" ]]; then
    cp -R "$source_dir/attachments" "$TEST_DIR/attachments"
  fi
  if [[ -f "$source_dir/models_dev.json" ]]; then
    cp "$source_dir/models_dev.json" "$TEST_DIR/models_dev.json"
  fi
else
  cp "$seed_db" "$TEST_DIR/data.db"
fi

cat > "$TEST_DIR/sync-settings.json" <<'JSON'
{
  "enabled": false,
  "onboarded": true,
  "declined_count": 2,
  "needs_unlock": false,
  "last_pass_error": null,
  "unlock_attempts": 0,
  "unlock_window_start": 0
}
JSON

echo "prepared $mode profile at: $TEST_DIR"
