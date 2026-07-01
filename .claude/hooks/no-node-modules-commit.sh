#!/usr/bin/env bash
set -euo pipefail

# Reject staged node_modules entries (symlinks slip past the node_modules/ gitignore pattern)
if git diff --cached --diff-filter=A --name-only | grep -qE '(^|/)node_modules$'; then
  echo "ERROR: a path named 'node_modules' is staged for commit — this is almost certainly a symlink that snuck past .gitignore."
  echo "Run: git rm --cached <path>/node_modules"
  echo "Then run 'bun install' from the repo root to recreate a proper node_modules directory."
  exit 1
fi
