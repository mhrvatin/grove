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
| `grove start` | Start the dashboard (idempotent — no-op if already running; serves the prebuilt SPA), then ensure the hub is running |
| `grove stop` | Stop the dashboard (the hub keeps running) |
| `grove hub start` | Start the hub (idempotent) |
| `grove hub stop` | Stop the hub |

`target` matches the current worktree when empty, otherwise the first worktree whose
path contains the given name fragment or absolute path.

## Hub

Each repo's dashboard gets its own port, derived from the repo path (4000–4099). To
avoid remembering them, `grove start` also starts a hub on a fixed port:

- `http://localhost:5050` lists every running grove dashboard on the machine.
- `http://localhost:5050/<repo>` redirects to that repo's dashboard, for example
  `localhost:5050/facit`. If two running repos share a name, it lists both.

Set `GROVE_HUB_PORT` to use another port. The hub finds dashboards by probing
4000–4099 on each request, so a dashboard started with a `DASHBOARD_PORT` outside that
range is not listed.

## Tests

```sh
bun test
```
