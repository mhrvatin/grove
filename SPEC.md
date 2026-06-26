# Grove — Requirements Specification

Grove is a **project-agnostic worktree dev launcher + dashboard**. It launches a
backend + frontend per git worktree on deterministic ports, runs many worktrees'
apps at once, and gives a web control panel showing what's running where with
start/restart/stop controls and live logs.

It lives in this repo (`tools/grove/`) for rapid co-development but is built to be
extracted: only `node:*`/Bun built-ins, no `@facit` or third-party deps, all
project-specific facts isolated in one `grove.config.ts`.

This file is the **contract** — the authoritative definition of correct behavior,
the same role `docs/SPEC.md` plays for the Facit app. Design *rationale* (why each
choice was made) lives in `docs/superpowers/specs/2026-06-26-grove-design.md`; this
file lists *what must be true*. Behavior that matches a requirement is correct;
behavior that contradicts one is a bug — even if it "works". Change direction by
amending this spec (supersede, don't delete), not by editing code ad hoc.

Requirements use **SHALL** (mandatory), **SHOULD** (important, expected), and
**MAY** (optional). Grove is developer tooling, out of `docs/SPEC.md`'s scope, so it
carries no `// covers:` tags; its tests are colocated `*.test.ts` files.

## Scope & non-goals

In scope: launching/stopping per-worktree dev instances, deterministic port
assignment, stateless discovery, the dashboard, and the log viewer.

**Non-goals (deliberately deferred — do not build without a concrete need):**

- **Accessibility (a11y).** Grove is a single-developer localhost tool used by the
  one person running it on their own machine — there is no screen-reader, keyboard-
  only, or WCAG-contrast obligation. ARIA roles, accessible names for the status
  dots, `role=tablist` on the log tabs, and AA contrast audits are explicitly **not
  goals** and SHALL NOT be treated as bugs. (This is a deliberate scope decision,
  not an oversight — see the design doc's "What we deliberately did not do".)
- **Arbitrary N services.** Grove's domain is exactly two slots: a backend and a
  frontend per worktree. Not a general service list.
- **Auto-start on worktree creation** (a WorktreeCreate hook).
- **Crash auto-restart / log rotation.** Restart is the manual dashboard button;
  logs truncate on each start.
- **Per-worktree isolated databases.** Shared DB; the additive-only migration rule
  makes divergent-schema branches safe in practice.
- **Standalone repo / npm publish.** Already extraction-ready (own `package.json`,
  no internal deps); pay the multi-repo tax only when a second consumer exists. A
  single installable binary, if ever wanted, comes from `bun build --compile` — not
  a language rewrite.

## Status values

| Status | Meaning |
|---|---|
| `Done` | Implemented and live. |
| `Deferred` | Intentionally postponed. |
| `Superseded by <ID>` | Replaced by a newer requirement; retained for provenance, text struck through. |

---

## 1. Configuration (`CFG`)

| ID | Status | Requirement |
|----|--------|-------------|
| CFG-1 | Done | All project-specific knowledge (commands, env, prestart, env-file) SHALL live in one `grove.config.ts`. The `grove-*.ts` scripts SHALL be project-agnostic and reference no Facit-specific facts. |
| CFG-2 | Done | The config SHALL be loaded canonically from the **main repo** (`tools/grove/grove.config.ts`, resolved via the git common dir), never the invoking worktree's checked-out copy, so `grove-up`, `grove-down`, and the dashboard all agree on ports regardless of which worktree or branch invoked them. |
| CFG-3 | Done | The config SHALL define exactly two slots, `backend` and `frontend`, each with `{ portBase, cmd, env }` where `env` is a function `(ports) => Record<string,string>` so a slot's env can reference the other slot's resolved port. |
| CFG-4 | Done | The config MAY define a `prestart` command array (e.g. `['just','migrate']`), run once before launch; omitting it SHALL skip the prestart step. |
| CFG-5 | Done | The config SHALL name an `envFile`; `grove-up` SHALL symlink it into a worktree from the main repo if missing (so secrets track the source and are never copied into git). |
| CFG-6 | Done | Because config is loaded from the main repo (CFG-2), a branch whose changes *require* a config edit cannot be exercised from its own worktree — editing `grove.config.ts` is a main-branch change validated from the main checkout. This trade-off is accepted; port stability is worth it. |

## 2. Port derivation (`PORT`)

| ID | Status | Requirement |
|----|--------|-------------|
| PORT-1 | Done | Ports SHALL be derived deterministically from the worktree name: a hash of the name → an `offset` in `[0, 99]`, added to each slot's `portBase`. Both slots SHALL share the same offset so they move together. Same worktree → same URLs, always. |
| PORT-2 | Done | The default ranges (backend 8080–8179, frontend 5173–5272) SHALL NOT overlap each other or Postgres (5432). |
| PORT-3 | Done | Both `grove-up` and the dashboard SHALL derive ports from the one `portsFor(name, config)` function — there SHALL be no separate port registry to drift. |
| PORT-4 | Done | A hash collision (≈1-in-100) SHALL surface as a clear "port in use" error at `grove-up` rather than a silent port bump; the fix is to rename the branch. The dashboard MAY render both colliding worktrees as "running" (cosmetic; `grove-up` refuses to start the second, so at most one is ever up). |

## 3. Launch — `just grove-up [path-or-name]` (`UP`)

| ID | Status | Requirement |
|----|--------|-------------|
| UP-1 | Done | `just grove-up` with no arg SHALL target the current worktree; with an arg, the first worktree whose path or basename contains the arg as a substring. |
| UP-2 | Done | `grove-up` SHALL ensure `config.envFile` exists in the target worktree (CFG-5) before launching. |
| UP-3 | Done | `grove-up` SHALL precheck both ports and fail with a clear message naming the port if either already has a listener (already up, or a collision). |
| UP-4 | Done | `grove-up` SHALL run `config.prestart` once (if defined) against the shared resources before launching the slots. Prestarts SHALL be safe to repeat (e.g. idempotent migrations). |
| UP-5 | Done | `grove-up` SHALL launch each slot **detached** (surviving terminal close / SIGHUP), `cd`'d into the worktree, with `slot.env(ports)` exported and stdout+stderr redirected to that slot's log file (truncated on each start). |
| UP-6 | Done | `grove-up` SHALL wait ~30s for each port to bind, capture the listening pid, and write `<.grove>/instances/<name>.json`. If a port never binds it SHALL record pid `0` and print a warning pointing at the logs. |

## 4. Teardown — `just grove-down [name | --all]` (`DOWN`)

| ID | Status | Requirement |
|----|--------|-------------|
| DOWN-1 | Done | `grove-down` SHALL read the instance file(s), kill the **listeners** on each recorded port plus the recorded pids (and their direct children), and remove the instance file. `--all` SHALL apply to every instance. |
| DOWN-2 | Done | Before signalling a stored pid, `grove-down` SHALL guard `pid > 0` — a failed-bind instance is recorded with pid `0`, and `kill 0` / `pkill -P 0` target the whole process group. Pid-`0` instances rely on the port-based kill. |
| DOWN-3 | Done | `grove-down` on an already-dead pid or missing instance SHALL be a no-op (just clear the file). |

## 5. Dashboard server — `just grove` / `just grove-stop` (`DASH`)

| ID | Status | Requirement |
|----|--------|-------------|
| DASH-1 | Done | `just grove` SHALL start a `Bun.serve` HTTP dashboard bound to `127.0.0.1` only, detached in the background. It SHALL be idempotent — if already listening on its port, just print the URL. |
| DASH-2 | Done | `just grove-stop` SHALL kill only the dashboard's own listener; it SHALL NOT touch running worktree instances. |
| DASH-3 | Done | The dashboard SHALL render one row per worktree showing: name, the URL as a link, a status dot (the three states — *running*, *failed*, *idle* — are defined by DASH-12), start/restart/stop buttons, and a logs toggle. |
| DASH-4 | Done | Discovery SHALL be stateless: worktrees from `git worktree list`, ports from `portsFor`, liveness from a port probe. Nothing to reconcile. |
| DASH-5 | Done | The dashboard SHALL poll a `GET /rows` fragment (~2s) and update in place, without a full-page reload, flicker, or scroll-position loss. Open log rows SHALL stay open across polls. |
| DASH-5a | Superseded by DASH-11 | ~~State-changing actions (start/restart/stop) SHALL be issued via same-origin `fetch` and drive the same in-place refresh — never a full-page form POST/redirect — so open log rows and scroll position survive an action.~~ |
| DASH-6 | Done | The dashboard SHALL use the full page width. On narrow viewports it SHALL stack each worktree row into a block (so long branch names never overflow) rather than scroll a table horizontally. |
| DASH-7 | Deferred | A richer frontend (build step, multiple files, or a component framework) is deferred. Today the dashboard is a single server-rendered HTML string with a small inline poll script; that is sufficient until the UI outgrows it. |
| DASH-8 | Superseded by DASH-11 | ~~State-changing POSTs (`/up`, `/down`, `/restart`) SHALL return `204 No Content` (not a redirect), since the client issues them via `fetch` (DASH-5) and refreshes the table itself.~~ |
| DASH-9 | Superseded by DASH-12 | ~~A row SHALL show one of three status states, by **both** a coloured dot and a text label (never colour alone): `live` (instance file present **and** a live port probe), `failed` (instance file present but **no** live port — grove-up wrote the record on a no-bind, UP-6), and `stopped` (no instance file). A `failed` row SHALL offer a start action and point the user at the launch log.~~ |
| DASH-10 | Superseded by DASH-11 | ~~After a start or restart is issued, the originating row SHALL show a transient `starting…` pending state (a distinct dot + label, actions disabled) until a subsequent poll observes it `live` or `failed`, or a ceiling (~65s, just past grove-up's worst-case bind wait — 30s per port, BE then FE sequentially, so ~60s for a two-port failure) lapses. This bridges the bind window; statelessness (DASH-4) means it is tracked client-side, not on the server.~~ |
| DASH-11 | Done | State-changing actions (start/restart/stop) SHALL update the table in place — no full-page reload, preserving scroll position and open log drawers (DASH-5, extended from polls to writes). After a start/restart the worktree's row SHALL show a *starting…* pending state until a subsequent `/rows` poll observes it *running* or *failed* (DASH-12). Because a fast-fail launch (e.g. the UP-3 port-in-use precheck) writes no instance file and so never reaches *failed*, a pending row that has neither gone live nor failed within a bind-timeout backstop (> grove-up's worst-case sequential bind wait) SHALL flip to a *start failed* state pointing at the launch log. (No-JS clients degrade to the prior full-reload POST.) |
| DASH-12 | Done | The dashboard SHALL distinguish three row states from stateless discovery: *running* (instance file present **and** a live port probe), *failed* (instance file present **but** the port probe is dead — a bind-timeout per UP-6, recorded with pid `0`, or a crashed slot), and *idle* (no instance file). A *failed* row SHALL be visually distinct from *idle* and SHALL offer restart/stop plus the logs toggle (not a bare "start"), so a failed or crashed start is never indistinguishable from a never-started worktree. |
| DASH-13 | Done | The dashboard header SHALL show a summary: the number of running worktrees and the total worktree count. The running count SHALL reflect the same live status as the row dots (instance file present **and** a live port probe) and SHALL stay current across the `GET /rows` poll. |
| DASH-14 | Done | When there are no worktrees, the dashboard SHALL render a teaching empty state (what grove is and how to start an instance) in place of the table, surviving the poll like a normal row. |

## 6. Log viewer (`LOG`)

| ID | Status | Requirement |
|----|--------|-------------|
| LOG-1 | Done | Each instance SHALL expose three separate logs — `launch` (grove-up's own stdout/stderr, for failed-start inspection), `BE`, and `FE` — never concatenated. `GET /logs/<name>` SHALL return them as distinct fields `{ up, be, fe }`. |
| LOG-2 | Done | The log viewer SHALL show **one** log at a time, switched by tabs, defaulting to BE. The selected tab SHALL survive the row-refresh poll. |
| LOG-2a | Superseded by LOG-2 | ~~The expanded log area shows the BE and FE logs as two side-by-side panes (plus a third launch pane), each independently scrollable.~~ |
| LOG-3 | Done | The BE log is pino one-line JSON (stdout is piped to a file, so pino-pretty's TTY transport is off). The viewer SHALL render each pino line as a human, local-time-stamped line (`HH:mm:ss.SSS LEVEL msg key=val`). Non-pino lines (banners, stack traces, plain text) SHALL pass through unchanged. |
| LOG-4 | Done | Logs SHALL be truncated on each start, with no rotation (logs are for short live-debug sessions). |

## 7. Security / trust boundary (`SEC`)

| ID | Status | Requirement |
|----|--------|-------------|
| SEC-1 | Done | The dashboard SHALL bind to `127.0.0.1` only — the kernel, not convention, keeps it off the LAN. |
| SEC-2 | Done | State-changing POSTs SHALL reject a present-but-cross-site `Origin` (CSRF). A missing `Origin` (non-browser client like curl) SHALL be allowed, since a remote attacker cannot forge it via a victim's browser. |
| SEC-3 | Done | Any `name` path segment SHALL be accepted only if it is the basename of an actual worktree — closing command injection (the name flows into a `just` recipe → shell) and path traversal (it flows into a log file path). |

## 8. Shared state & instance schema (`STATE`)

| ID | Status | Requirement |
|----|--------|-------------|
| STATE-1 | Done | All grove state SHALL live in a shared `.grove/` at the main repo root (`instances/<name>.json`, `logs/<name>-{be,fe,up}.log`, `logs/dashboard.log`), so the dashboard sees every instance regardless of which worktree it runs from. `.grove/` SHALL be gitignored. |
| STATE-2 | Done | The instance record SHALL be `{ name, dir, url, bePort, fePort, bePid, fePid, beLog, feLog }`. The listening **port** (not pid or cmdline) is the canonical identity of a running slot, since slot cmdlines are identical across worktrees. |

## 9. URL lookup — `just grove-url [name]` (`URL`)

| ID | Status | Requirement |
|----|--------|-------------|
| URL-1 | Done | `just grove-url` SHALL print the frontend URL of a worktree (no arg = current worktree; an arg resolves like UP-1). The URL SHALL be derived statelessly from `portsFor` (PORT-1/3), never guessed or scanned, so it is correct even when the server is down. |
| URL-2 | Done | `grove-url` SHALL report liveness from a port probe (DASH-4): when the frontend port has a listener it SHALL print the bare URL and exit `0`; when it does not it SHALL print the URL with a ` (down)` suffix and exit non-zero. This makes it the single sanctioned way for an agent to find the running app and branch on up/down without parsing or guessing ports. |
