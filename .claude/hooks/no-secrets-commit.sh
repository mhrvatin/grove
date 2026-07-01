#!/usr/bin/env bash
# pre-commit hook: refuse to commit secret/credential files.
# Policy: never stage .env, credentials, or secrets.
# Robust catch — scans staged files regardless of how they were staged.
set -euo pipefail

files=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null || true)
[ -z "$files" ] && exit 0

bad=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  b=$(basename "$f")
  # Sample/template files are safe and intentionally committed.
  case "$b" in
    .env.example | .env.sample | .env.template | .env.defaults | *.pub) continue ;;
  esac
  # Case-insensitive (-i) so uppercase variants (SECRET.PEM, .ENV) don't slip on
  # case-insensitive filesystems (macOS), matching no-destructive-migration.sh.
  if printf '%s' "$b" | grep -iqE '^\.env($|\.)|\.(pem|key|p12|pfx|p8|ppk|keystore|jks)$|^id_(rsa|dsa|ecdsa|ed25519)($|\.)|^(credentials|secrets|service[-_]account)\.json$|^\.(secrets|npmrc)$'; then
    bad="${bad}  - ${f}
"
  fi
done <<< "$files"

if [ -n "$bad" ]; then
  echo "ERROR: refusing to commit secret/credential file(s):"
  echo "$bad"
  echo "Secrets must never be committed. Unstage (git restore --staged <file>) and add to .gitignore."
  echo "False positive (e.g. a sample)? Rename to *.example, or bypass deliberately only with user approval."
  exit 1
fi
exit 0
