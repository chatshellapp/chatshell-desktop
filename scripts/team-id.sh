#!/usr/bin/env bash
# Print the Apple Developer Team ID, never stored in the repo.
#
# Resolution order:
#   1. $CHATSHELL_TEAM_ID            — CI path (GitHub Actions secret);
#                                       also the explicit local override.
#   2. provisioning profile argument — `team-id.sh <profile.mobileprovision>`
#                                       extracts TeamIdentifier from the
#                                       profile (unambiguous: it is issued
#                                       for this app's bundle id).
#   3. single local certificate      — if exactly one Apple Development
#                                       certificate is installed, use its OU.
#                                       With several teams' certificates the
#                                       script refuses to guess.
set -euo pipefail

if [ -n "${CHATSHELL_TEAM_ID:-}" ]; then
  echo "$CHATSHELL_TEAM_ID"
  exit 0
fi

if [ $# -ge 1 ] && [ -f "$1" ]; then
  TEAM=$(security cms -D -i "$1" 2>/dev/null \
    | plutil -extract TeamIdentifier.0 raw -o - - 2>/dev/null || true)
  if [ -n "$TEAM" ]; then
    echo "$TEAM"
    exit 0
  fi
fi

N=$(security find-certificate -a -c "Apple Development" 2>/dev/null | grep -c "Apple Development")
if [ "$N" -eq 1 ]; then
  TEAM=$(security find-certificate -c "Apple Development" -p \
    | openssl x509 -noout -subject \
    | sed -n 's/.*OU *= *\([^,]*\).*/\1/p')
  echo "$TEAM"
  exit 0
fi

echo "error: cannot determine the Team ID automatically ($N Apple Development" >&2
echo "       certificates installed). Pass a provisioning profile path or set" >&2
echo "       CHATSHELL_TEAM_ID." >&2
exit 1
