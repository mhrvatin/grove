# Grove task runner

# List available recipes
default:
    @just --list

# Full build gate: tsc --noEmit (launcher) + tsc -p tsconfig.app.json --noEmit (SPA) + vite build
build:
    bun run build

# SPA bundle only, no typecheck — what `grove start` runs on first launch
build-bundle:
    bun run build:bundle

# Run tests. Pass a file path or `-t <substring>`, or omit to run everything.
test *args:
    bun test {{args}}

# Lint and format check. Pass files as args, or omit to check everything.
lint *files:
    #!/usr/bin/env bash
    files="{{files}}"
    if [ -z "$files" ]; then
        bun run biome check .
    else
        bun run biome check --no-errors-on-unmatched $files
    fi

# Lint and format fix. Pass files as args, or omit to fix everything.
lint-fix *files:
    #!/usr/bin/env bash
    files="{{files}}"
    if [ -z "$files" ]; then
        bun run biome check --write .
    else
        bun run biome check --write --no-errors-on-unmatched $files
    fi
