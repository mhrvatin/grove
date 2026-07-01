# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What grove is

A **project-agnostic worktree dev launcher + dashboard**. It launches a backend + frontend per git worktree on deterministic ports, runs many worktrees' apps at once, and serves a web control panel (start/restart/stop + live logs). Self-contained: every project-specific fact lives in one `grove.config.jsonc` that the consumer copies into *their* repo; `src/cli/grove.ts` references no project facts.

**`SPEC.md` is the authoritative contract.** It lists requirements as `CFG-*`, `PORT-*`, `UP-*`, `DOWN-*`, `DASH-*`, `LOG-*`, `SEC-*`, `STATE-*`, `URL-*` (SHALL/SHOULD/MAY). Behavior matching a requirement is correct; behavior contradicting one is a bug even if it "works". Change direction by **amending SPEC.md** (supersede, don't delete — strike through and add a `Superseded by <ID>` row), not by editing code ad hoc. Code comments tagged `// ponytail:` flag deliberate trade-offs.

## Commands

```sh
bun install
bun run build          # full gate: tsc --noEmit (launcher) + tsc -p tsconfig.app.json --noEmit (SPA) + vite build
bun run build:bundle   # vite build only — no typecheck; run this and commit dist/ before a version ships (DASH-20)
bun test               # all tests (colocated *.test.ts under src/lib/ and src/web/)
bun test src/lib/port-utils.test.ts # single file
bun test -t "substring"             # tests matching a name
```

CLI entrypoints (single `grove` binary declared in `package.json` `bin`, run with `bun run <file> [args]`):

- `grove up [target]` — launch FE+BE for a worktree (no arg = current)
- `grove down [target | --all]` — stop instances
- `grove url [target]` — print FE URL; exits non-zero + ` (down)` suffix when nothing's listening
- `grove start` — start the dashboard (idempotent; serves the prebuilt SPA from `dist/`, DASH-20)
- `grove stop` — stop the dashboard
- `grove serve` — internal re-launch arg (used by `grove start`; not in `--help`). `target` = current worktree when empty, else first worktree whose path contains the substring.

## Layout

Everything lives under `src/`, split three ways:

- `src/cli/` — `grove.ts` (the single `grove` binary entry), plus `up.ts`, `down.ts`, `url.ts`, `dashboard.ts` (each exports a `run()`/`start()`/`stop()`/`serve()` function called by `grove.ts`). Thin orchestration over `lib/`.
- `src/lib/` — the shared Bun/`node:*` modules + their colocated `*.test.ts`.
- `src/web/` — the React + Vite SPA, including `dashboard.css`.

Vite root + entry (`index.html`), `vite.config.ts`, the two tsconfigs, `grove.config.jsonc`, and `SPEC.md` stay at the repo root; the build outputs to `dist/`.

## Architecture

**Strict I/O / pure-logic split.** `src/lib/instances.ts` is the **only** module that touches the filesystem, git, `lsof`, the process table, or loads the config — everything else stays pure and unit-tested:

- `src/lib/instances-utils.ts` — config/instance types, `resolveWorktreeDir` target resolution, `resolveEnv` (`${be}`/`${fe}` interpolation), `makeInstance`.
- `src/lib/port-utils.ts` — `portsFor` (deterministic name→offset hash) and `urlStatus`.
- `src/lib/dashboard-utils.ts` — the dashboard's pure model: `buildRows`, `apiRow`/`rowStatus`, orphan logic (`orphanInstances`/`reapTargets`/`prunedReaped`), the security guards (`isAllowedName`/`isActionableName`/`isSameOrigin`), and `formatPinoLog`.

The five `src/cli/` files are thin orchestration over those two layers. `src/cli/dashboard.ts` resolves the grove repo root via `groveDir = join(import.meta.dir, '..', '..')` (it lives two levels down) to find the prebuilt `dist/` — distinct from `repoRoot`/`mainRepoRoot()`, which is the *consumer* repo grove drives.

**Determinism & statelessness.** Ports derive from a hash of the worktree name (`portsFor`), so the same worktree always maps to the same URLs — there is no port registry to drift. Discovery is stateless: worktrees from `git worktree list`, ports from `portsFor`, liveness from a port probe. The listening **port** (not pid/cmdline) is the canonical identity of a slot, since slot cmdlines are identical across worktrees.

**Config is loaded from the main repo** (`grove.config.jsonc` at the root resolved via the git common dir), never the invoking worktree's checked-out copy — so every worktree agrees on ports. Consequence (CFG-6): a branch needing a config edit can't be exercised from its own worktree; config changes are main-branch changes.

**Shared state** lives in a gitignored `.grove/` at the main repo root: `instances/<name>.json`, `logs/<name>-{be,fe,up}.log`, `logs/dashboard.log`.

**Dashboard** is a `Bun.serve` (loopback-only, `127.0.0.1`) JSON API (`/api/rows`, `/api/logs/<name>`, POST `/api/{up,down,restart}`) plus a **React + Vite + TypeScript SPA** in `src/web/`, built to `dist/` and served as static assets by the same server (non-`/api` paths fall back to `index.html`). The SPA polls `/api/rows` every 2s and reconciles by worktree-name key (no flicker / scroll loss / closing open log drawers); `src/web/reconcile.ts` holds the pure client-side launch-pending state machine.

## Constraints

- **Launcher CLIs use only `node:*` / Bun built-ins + `commander` — no project deps.** Only the dashboard SPA may use deps (React/Vite, exact-pinned). Grove takes no consumer-project deps.
- **Two slots only** — a backend and a frontend per worktree. Not an arbitrary service list.
- `src/web/types.ts` **mirrors** (does not import) `ApiRow` from `src/lib/dashboard-utils.ts`, to keep `node:path` out of the browser bundle. Keep the shapes in sync by hand. `src/web/` must not import from `src/lib/`.
- Two TS projects: `tsconfig.json` (`src/cli` + `src/lib`, Bun runtime) and `tsconfig.app.json` (`src/web`, DOM + react-jsx). Both extend `@tsconfig/strictest`.
- **Security trust boundary** (`SEC-*`): the dashboard accepts a `name` only if it's a real worktree basename (or an existing instance record, for clearing orphan tombstones) — this closes command-injection / path-traversal since the set is populated from git, never HTTP input. POSTs reject a present-but-cross-site `Origin` (CSRF); a missing `Origin` (curl) is allowed.
- **a11y is an explicit non-goal** — single-developer localhost tool; ARIA/contrast gaps are not bugs (see SPEC §Scope).
