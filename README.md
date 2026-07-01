# Grove

A **project-agnostic worktree dev launcher + dashboard**. Grove launches a backend +
frontend per git worktree on deterministic ports, runs many worktrees' apps at once,
and gives a web control panel showing what's running where with start/restart/stop
controls and live logs.

It is self-contained: no external project dependencies. Everything project-specific
lives in one [`grove.config.jsonc`](./grove.config.jsonc). The launcher CLIs run on
`node:*`/Bun built-ins; the dashboard is a React + Vite + TypeScript SPA.

[`SPEC.md`](./SPEC.md) is the authoritative contract — what must be true.

## Install

```sh
bun install
bun run build   # builds the dashboard SPA into dist/
```

## Configure

Copy the shipped `grove.config.jsonc` into the **main repo** you want grove to drive
(at its root) and fill in the placeholders:

- `envFile` — env file grove symlinks into a worktree if missing
- `prestart` — optional command run once before launch (e.g. `["just", "migrate"]`); remove the key to skip
- `backend` / `frontend` — each `{ portBase, cmd, env }`. In `env` values, `${be}` and `${fe}` interpolate to the worktree's resolved backend/frontend ports

Config is loaded canonically from the main repo (resolved via the git common dir), so
every worktree agrees on ports. Bun parses `.jsonc` natively, so comments are fine.

## Commands

| Command | Does |
|---------|------|
| `grove up [target]` | Launch FE+BE for a worktree (no arg = current worktree) |
| `grove down [target]` | Stop a worktree's instances |
| `grove down --all` | Stop all running instances |
| `grove url [target]` | Print a worktree's URL (exits non-zero + `(down)` if nothing's listening) |
| `grove start` | Start the dashboard (idempotent — no-op if already running; builds SPA on first start) |
| `grove stop` | Stop the dashboard |

`target` matches the current worktree when empty, otherwise the first worktree whose
path contains the given name fragment or absolute path.

## Tests

```sh
bun test
```
