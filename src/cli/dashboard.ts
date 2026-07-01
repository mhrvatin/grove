// Web control panel for worktree dev instances. Stateless discovery:
// `git worktree list` + .grove/instances/*.json + a port liveness probe.
// Buttons spawn the grove up / grove down subcommands directly (no `just`).
//
// Runs detached in the background (`grove start`); stop with `grove stop`.
// No foreground process means no Ctrl+C to crash the recipe.
// ponytail: localhost-only dev tool over trusted input (worktree names from
// git), so no HTML-escaping / auth. Add both if this ever leaves localhost.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type ApiRow,
  apiRow,
  basename,
  buildRows,
  dashboardActionError,
  formatPinoLog,
  instanceLogSections,
  isActionableName,
  isAllowedName,
  isSameOrigin,
  orphanInstances,
  prunedReaped,
  reapTargets,
} from '../lib/dashboard-utils.ts'
import {
  groveRoot,
  killByPortAndPids,
  listWorktreeDirs,
  loadConfig,
  mainRepoRoot,
  portsInUse,
  readInstances,
  spawnDetached,
} from '../lib/instances.ts'
import { dashboardPortFor } from '../lib/port-utils.ts'

const repoRoot = mainRepoRoot()
const PORT = Number(process.env['DASHBOARD_PORT']) || dashboardPortFor(repoRoot)
const repoName = basename(repoRoot)
// Orphans already reaped (DASH-16) — kept so a reaped orphan's port, if a later
// process rebinds it, is never re-SIGTERM'd. Pruned each poll to names that are
// still orphans (prunedReaped), so it bounds reaping to once per orphan episode.
let reaped = new Set<string>()

async function alive(port: number): Promise<boolean> {
  try {
    await fetch(`http://localhost:${port}`, { signal: AbortSignal.timeout(400) })
    return true
  } catch {
    return false
  }
}

function tail(file: string, lines = 200): string {
  if (!existsSync(file)) return '(no log)'
  return readFileSync(file, 'utf8').split('\n').slice(-lines).join('\n')
}

async function apiRows(): Promise<ApiRow[]> {
  // Load config lazily on the serve path only — `start`/`stop` are config-
  // independent (just a port-kill / detached respawn), so stopping the dashboard
  // must never fail because grove.config.jsonc isn't on main yet. loadConfig caches.
  const config = await loadConfig()
  const worktreeDirs = listWorktreeDirs()
  const instances = readInstances()
  // Auto-reap orphans (DASH-16): an instance whose worktree was removed. On first
  // sighting kill its listeners so the freed ports don't leak — killByPortAndPids
  // is lsof-gated per port (a dead port is a no-op), so this is unconditional and
  // frees a still-live BE even when the FE has already died. The instance file is
  // kept as a visible tombstone (DASH-15), so we record the name (reaped) and
  // never touch its ports again — otherwise a later process that rebinds a freed
  // port (e.g. a fresh vite on 5173) would be killed every poll. prunedReaped then
  // drops names that are no longer orphans (cleared, or worktree recreated), so a
  // worktree removed → recreated → removed reaps fresh on each removal episode.
  // (Relocated here from the old renderRows, which the SPA replaced — DASH-18.)
  const orphans = orphanInstances(worktreeDirs, instances)
  for (const o of reapTargets(reaped, orphans)) {
    killByPortAndPids([o.bePort, o.fePort], [o.bePid, o.fePid])
    reaped.add(o.name)
  }
  reaped = prunedReaped(reaped, orphans)
  const rows = buildRows(worktreeDirs, instances, config)
  // Probe each running worktree's frontend port server-side (a browser can't probe
  // arbitrary loopback ports) and fold running/live/orphaned into a single status
  // per row (DASH-12) for the client.
  return Promise.all(rows.map(async (r) => apiRow(r, r.running && (await alive(r.fePort)))))
}

// grove's own install dir (the repo root) — this script lives in src/cli/, so it
// is two levels up. Distinct from repoRoot above (mainRepoRoot = the *consumer*
// repo grove drives). import.meta.dir is this script's dir regardless of the
// detached serve process's cwd, so dist/ resolves the same way.
const groveDir = join(import.meta.dir, '..', '..')

// The dashboard is a React + Vite SPA that ships prebuilt to dist/ at the grove
// repo root (DASH-20) — grove is consumed as an external git dependency, where
// devDependencies like vite are never installed, so dist/ can't be built at
// runtime. Serve its assets straight off disk; any non-/api path that isn't a
// real file falls back to index.html (single-screen app, no client router).
const DIST = join(groveDir, 'dist')

async function serveStatic(pathname: string): Promise<Response> {
  // URL.pathname normalises away any `../`, so this join can't escape DIST.
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1)
  const file = Bun.file(join(DIST, rel))
  // Vite's hashed assets can cache freely; the unhashed index.html shell must
  // always revalidate so a new commit's updated asset hashes aren't missed.
  if (rel !== 'index.html' && (await file.exists())) return new Response(file)
  return new Response(Bun.file(join(DIST, 'index.html')), {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function decodeName(seg: string | undefined): string {
  if (!seg) return ''
  try {
    return decodeURIComponent(seg)
  } catch {
    return '' // malformed percent-encoding → no worktree matches it
  }
}

function up(name: string): void {
  // Fire-and-return; grove up detaches its own processes (and may wait ~30s to
  // bind). Capture output to a per-instance launch log so failed starts are
  // inspectable from the dashboard. ponytail: truncate per start ('w'), no rotation.
  const logsDir = join(groveRoot(), 'logs')
  mkdirSync(logsDir, { recursive: true }) // dir may not exist before grove up's own mkdir
  const fd = openSync(join(logsDir, `${name}-up.log`), 'w')
  // Spawn the grove entrypoint directly (not via `just`) so the dashboard
  // stays project-agnostic — no dependency on the consumer's task runner or
  // recipe names. The child inherits a dup of fd, so close ours immediately to
  // avoid leaking a descriptor per click in this long-lived process.
  Bun.spawn(['bun', 'run', join(import.meta.dir, 'grove.ts'), 'up', name], {
    cwd: repoRoot,
    stdout: fd,
    stderr: fd,
  })
  closeSync(fd)
}

function down(name: string): void {
  // Synchronous so callers (incl. restart) know the ports are freed before reusing them.
  Bun.spawnSync(['bun', 'run', join(import.meta.dir, 'grove.ts'), 'down', name], {
    cwd: repoRoot,
    stdout: 'ignore',
    stderr: 'ignore',
  })
}

export function serve(): void {
  Bun.serve({
    port: PORT,
    // Loopback-only: this is a localhost dev tool with no auth, so the kernel —
    // not just convention — keeps it off the LAN. The POST guards below are the
    // in-process trust boundary for same-host browsers.
    hostname: '127.0.0.1',
    async fetch(req) {
      const url = new URL(req.url)
      // All dynamic routes live under /api so the SPA index fallback below never
      // swallows them. Anything else is a static asset or the SPA shell.
      if (!url.pathname.startsWith('/api/')) return serveStatic(url.pathname)
      // /api/<action>/<seg>. The client encodeURIComponent's the name (worktree
      // names contain `+`), and URL.pathname does NOT decode — so decode it back
      // before any check or path build. A malformed encoding decodes to '' → no match.
      const [, , action, seg] = url.pathname.split('/')
      const name = decodeName(seg)
      if (req.method === 'POST') {
        // Trust boundary: HTTP input flows into `just` → shell. Reject cross-site
        // POSTs (CSRF) and any name that is not a real worktree (injection).
        if (!isSameOrigin(req.headers.get('origin'), PORT)) {
          return new Response('forbidden', { status: 403 })
        }
        // `down` may target an orphan tombstone (instance file, no worktree) to
        // clear it (SEC-3a); up/restart need a real worktree to launch into.
        const known =
          action === 'down'
            ? isActionableName(name, listWorktreeDirs(), readInstances())
            : isAllowedName(name, listWorktreeDirs())
        if (!name || !known) {
          return new Response('unknown worktree', { status: 404 })
        }
        // 204 (not a 303 redirect): the SPA issues these via fetch and reconciles
        // through the 2s poll (DASH-11).
        if (action === 'up') {
          up(name)
          return new Response(null, { status: 204 })
        }
        if (action === 'down') {
          down(name)
          return new Response(null, { status: 204 })
        }
        if (action === 'restart') {
          down(name)
          await Bun.sleep(300) // let the OS release the ports before grove-up's in-use precheck
          up(name)
          return new Response(null, { status: 204 })
        }
        return new Response('unknown action', { status: 404 })
      }
      if (action === 'meta') return Response.json({ repoName })
      if (action === 'rows') return Response.json(await apiRows())
      if (action === 'logs' && name) {
        // Guard name first: it now flows into a filesystem path (path-traversal).
        // Accept orphan instance names too (SEC-3a) so a log drawer left open when
        // a live row transitions to an orphan tombstone keeps resolving its logs.
        if (!isActionableName(name, listWorktreeDirs(), readInstances())) {
          return new Response('unknown worktree', { status: 404 })
        }
        // Return the three logs as separate keyed fields, never concatenated, so
        // the row renders one independently-scrollable pane per log. Paths are
        // built deterministically — a never-launched instance still has a launch
        // log worth showing.
        const sections = instanceLogSections(join(groveRoot(), 'logs'), name)
        const body: Record<string, string> = {}
        // BE is pino one-line JSON (no TTY → no pino-pretty); expand it to a
        // human, timestamped line. launch/FE are already plain text.
        for (const s of sections) {
          const raw = tail(s.path)
          body[s.key] = s.key === 'be' ? formatPinoLog(raw) : raw
        }
        return Response.json(body)
      }
      return new Response('not found', { status: 404 })
    },
  })
  console.log(`dashboard on http://localhost:${PORT}`)
}

export function start(): void {
  // Always prints the URL (DASH-1b) — the port is now a per-repo hash (PORT-5),
  // not a fixed well-known value, so silence on the no-op path would leave the
  // caller with no way to know where their dashboard actually is. start() is
  // fire-and-forget detached, so this catches only the synchronous mkdir/spawn
  // failures; it cannot verify the dashboard actually bound.
  try {
    if (portsInUse([PORT]).length > 0) {
      console.log(`dashboard on http://localhost:${PORT}`) // already running → no-op
      return
    }
    // dist/ ships prebuilt and committed (DASH-20) — grove is consumed as an
    // external git dependency, where vite (a devDependency) is never installed,
    // so start() can no longer build it here. A missing dist/index.html means
    // the repo was packaged wrong, not something to fix by building on the fly.
    if (!existsSync(join(DIST, 'index.html'))) {
      throw new Error(
        `dist/index.html not found at ${groveDir} — grove's dashboard SPA must be prebuilt ` +
          "and committed (run 'bun run build:bundle' and commit dist/ before pinning a version)",
      )
    }
    mkdirSync(join(groveRoot(), 'logs'), { recursive: true })
    const log = join(groveRoot(), 'logs', 'dashboard.log')
    // Re-launch grove.ts in `serve` mode, detached, so closing the terminal (or
    // Ctrl+C) leaves it running. import.meta.dir is this file's directory, so
    // this resolves correctly regardless of the calling process's cwd.
    spawnDetached(['bun', 'run', join(import.meta.dir, 'grove.ts'), 'serve'], {
      cwd: repoRoot,
      env: {},
      logFile: log,
    })
    console.log(`dashboard on http://localhost:${PORT}`)
  } catch (err) {
    console.error(dashboardActionError('start', err))
  }
}

export function stop(): void {
  // Quiet on success; surface only a failure to kill the listener.
  try {
    killByPortAndPids([PORT], [])
  } catch (err) {
    console.error(dashboardActionError('stop', err))
  }
}
