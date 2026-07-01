#!/usr/bin/env bash
# pre-commit hook: block staged DB migration SQL with destructive statements.
# Policy: production data is sacred — schema changes must be additive/reversible.
# Destructive changes require explicit user approval; only then bypass deliberately
# (e.g. LEFTHOOK=0 git commit ... / git commit --no-verify).
#
# Generalized: scans every staged *.sql under any `migrations/` directory. Narrow
# the grep to your migrations path (e.g. packages/db/migrations) if you prefer.
set -euo pipefail

files=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null | grep -E '(^|/)migrations/.*\.sql$' || true)
[ -z "$files" ] && exit 0

# Unambiguous data-loss verbs only. Plain ALTER ... ADD / CREATE / DROP INDEX are
# additive and intentionally NOT matched, so legit drizzle output passes clean.
# `ALTER TABLE x DROP "col"` (no COLUMN keyword) is also a destructive column drop:
# drizzle always writes a keyword before the quote (DROP COLUMN/CONSTRAINT/INDEX), so
# `DROP "<ident>"` with no keyword only ever comes from a hand-written column drop —
# matching it stays false-positive-free on generated migrations.
# ponytail: an *unquoted* `DROP col` still slips (can't exclude DROP CONSTRAINT/INDEX
# in ERE without lookahead); quote the identifier or write DROP COLUMN to be caught.
pattern='DROP[[:space:]]+TABLE|DROP[[:space:]]+COLUMN|ALTER[[:space:]]+TABLE[^;]*[[:space:]]DROP[[:space:]]+"|RENAME[[:space:]]+(TO|COLUMN)|TRUNCATE|DELETE[[:space:]]+FROM'

hits=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  match=$(git show ":$f" | grep -inE "$pattern" || true)
  [ -n "$match" ] && hits="${hits}${f}:
${match}
"
done <<< "$files"

if [ -n "$hits" ]; then
  echo "ERROR: Destructive SQL in a staged migration (policy: production data is sacred)."
  echo "Migrations must be additive/reversible. DROP/RENAME/TRUNCATE/DELETE need explicit user approval."
  echo
  echo "$hits"
  echo "If explicitly approved, bypass deliberately: LEFTHOOK=0 git commit ...  (or git commit --no-verify)"
  exit 1
fi
exit 0
