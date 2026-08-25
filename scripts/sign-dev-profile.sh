#!/usr/bin/env bash
# Sign the release app bundle for local development with a provisioning
# profile (Option A): renders the entitlements (Team ID injected from the
# profile or $CHATSHELL_TEAM_ID, never from the repo), embeds the profile,
# and signs with the Apple Development identity.
#
# Usage:
#   scripts/sign-dev-profile.sh [profile.mobileprovision]
#     [identity]
#
# CI: export CHATSHELL_TEAM_ID plus the profile path; the identity is
# whatever certificate was imported into the runner keychain (pass it as
# the second argument, or set CHATSHELL_SIGN_IDENTITY).
#
# Why not Developer ID: the ubiquity-container and keychain-access-groups
# entitlements are only honored when granted by a provisioning profile
# (macOS 26 hard requirement), and Developer ID profiles are
# distribution-only. A stable Apple Development identity keeps the
# signature stable across rebuilds, so the one-time keychain
# authorization and TCC grants persist.
#
# Profile regeneration (when it expires or on a new machine) — requires
# $CHATSHELL_TEAM_ID to be exported (CI never needs this):
#   cd scripts/ProfileGen && xcodegen generate && \
#   xcodebuild -project ProfileGen.xcodeproj -scheme ProfileGen \
#     -configuration Debug build -allowProvisioningUpdates \
#     -allowProvisioningDeviceRegistration
# then pass DerivedData ProfileGen.app/Contents/embedded.provisionprofile
# to this script.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="${ROOT_DIR}/src-tauri/target/release/bundle/macos/ChatShell.app"
IDENTITY="${2:-${CHATSHELL_SIGN_IDENTITY:-Apple Development}}"
PROFILE="${1:-${ROOT_DIR}/scripts/ChatShell_Desktop_Dev.mobileprovision}"
TEMPLATE="${ROOT_DIR}/src-tauri/Entitlements-DevProfile.plist.template"
RENDERED="${ROOT_DIR}/src-tauri/target/Entitlements-DevProfile.generated.plist"

if [ ! -d "${APP}" ]; then
  echo "error: ${APP} not found — run 'pnpm tauri build' first" >&2
  exit 1
fi
if [ ! -f "${PROFILE}" ]; then
  echo "error: provisioning profile not found at ${PROFILE}" >&2
  echo "       regenerate it via scripts/ProfileGen (see header comment) or" >&2
  echo "       pass its path" >&2
  exit 1
fi

TEAM=$("${ROOT_DIR}/scripts/team-id.sh" "${PROFILE}")

sed "s/__TEAM_ID__/${TEAM}/g" "${TEMPLATE}" > "${RENDERED}"
plutil -lint "${RENDERED}" >/dev/null

# Profiles must be embedded as 'embedded.provisionprofile' for the app to
# be launchable with profile-granted entitlements outside Xcode.
cp "${PROFILE}" "${APP}/Contents/embedded.provisionprofile"

codesign --force --deep \
  --entitlements "${RENDERED}" \
  --sign "${IDENTITY}" \
  "${APP}"

echo "Signed ${APP} (team ${TEAM})"
