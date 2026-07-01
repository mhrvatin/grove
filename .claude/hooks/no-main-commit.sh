#!/usr/bin/env bash
set -euo pipefail

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
if [ "$branch" = "main" ]; then
  echo "ERROR: Do not commit directly to main. Create a feature branch first (git checkout -b <branch-name>)."
  exit 1
fi
