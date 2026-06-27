#!/usr/bin/env bun
// Web control panel for worktree dev instances. Stateless discovery:
// `git worktree list` + .grove/instances/*.json + a port liveness probe.
// Buttons spawn the grove-up / grove-down entrypoints directly (no `just`).
//
// Runs detached in the background (`just grove`); stop with `just grove-stop`.
// No foreground process means no Ctrl+C to crash the recipe.
// ponytail: localhost-only dev tool over trusted input (worktree names from
// git), so no HTML-escaping / auth. Add both if this ever leaves localhost.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildRows,
  dashboardActionError,
  fillPageTemplate,
  formatPinoLog,
  groveSummary,
  instanceLogSections,
  isActionableName,
  isAllowedName,
  isSameOrigin,
  orphanInstances,
  prunedReaped,
  reapTargets,
  rowStatus,
} from './grove-dashboard-utils.ts'
import {
  groveRoot,
  killByPortAndPids,
  listWorktreeDirs,
  loadConfig,
  mainRepoRoot,
  portsInUse,
  readInstances,
  spawnDetached,
} from './grove-instances.ts'

const PORT = Number(process.env['DASHBOARD_PORT']) || 4000
const repoRoot = mainRepoRoot()
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

async function renderRows(): Promise<string> {
  // Load config lazily on the serve path only — `start`/`stop` are config-
  // independent (just a port-kill / detached respawn), so stopping the dashboard
  // must never fail because grove.config.ts isn't on main yet. loadConfig caches.
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
  const orphans = orphanInstances(worktreeDirs, instances)
  for (const o of reapTargets(reaped, orphans)) {
    killByPortAndPids([o.bePort, o.fePort], [o.bePid, o.fePid])
    reaped.add(o.name)
  }
  reaped = prunedReaped(reaped, orphans)
  const rows = buildRows(worktreeDirs, instances, config)
  // Empty-state teaches the tool. Rendered as a tbody row so it survives the
  // /rows poll the same way real rows do (no separate code path to keep in sync).
  if (rows.length === 0) {
    return `<tr><td colspan=4><div class=empty><svg class=mark><use href=#leaf></use></svg>
      <h2>No worktrees yet</h2>
      <p>Create a git worktree, then run <code>just grove-up</code> to plant it here.</p>
      </div></td></tr>`
  }
  const cells = await Promise.all(
    rows.map(async (r) => {
      // Three-state status (DASH-12): a worktree with an instance file but a dead
      // port probe is *failed* (UP-6 pid-0 bind-timeout, or a crashed slot), not
      // idle — so a failed start never looks like a never-started one.
      const status = rowStatus(r.running, r.running && (await alive(r.fePort)), r.orphaned)
      const dot = `<span class=dot></span>`
      // Strip the scheme for display — the running worktree's address is the
      // signal; `localhost:5173` reads cleaner than the full URL. href stays whole.
      const host = r.url.replace(/^https?:\/\//, '')
      const link = `<a class=url href="${r.url}" target=_blank rel=noopener>${host} <svg class=ic><use href=#ext></use></svg></a>
        <div class=ports>api <b>${r.bePort}</b> · web <b>${r.fePort}</b></div>`
      // data-act/data-wt let the client intercept the submit (fetch, no reload —
      // DASH-11) while the action attr stays a working no-JS fallback (303 → /).
      const form = (action: string, cls: string, icon: string, label: string) =>
        `<form method=post action="/${action}/${r.name}" data-act="${action}" data-wt="${r.name}"><button class="btn ${cls}"><svg class=ic><use href=#${icon}></use></svg>${label}</button></form>`
      // Show logs toggles an inline log row attached to this worktree (same tab),
      // tracked client-side so it survives the 2s poll. Never a new page.
      const logsBtn = `<button type=button class="btn ghost" aria-expanded=false onclick="toggleLogs('${r.name}')">logs</button>`
      // Orphan tombstone (DASH-15): its worktree is gone, so neither start nor
      // restart applies — only clear, which runs the stop/down path to remove the
      // stale instance record. Failed/live both expose restart (retry) + stop
      // (clears a pid-0 file); only a truly idle worktree gets the bare "start".
      const actions =
        status === 'orphaned'
          ? form('down', 'danger', 'stop', 'clear')
          : status === 'idle'
            ? `${form('up', 'primary', 'play', 'start')}${logsBtn}`
            : `${form('restart', '', 'restart', 'restart')}${form('down', 'danger', 'stop', 'stop')}${logsBtn}`
      // The phase line carries the failed/starting/removed label. Server renders the
      // failed/removed text; the client fills "starting…" (and the fast-fail
      // backstop) into the empty span for idle rows it just acted on.
      const phase =
        status === 'failed'
          ? `<span class="phase failed">failed · open launch log</span>`
          : status === 'orphaned'
            ? `<span class="phase orphaned">worktree removed · server stopped</span>`
            : `<span class=phase hidden></span>`
      // The log row is rendered hidden alongside every worktree; toggleLogs/
      // refreshLogs reveal and fill it. One full-width pane at a time — tabs
      // switch between the launch, BE and FE logs (BE shown first).
      const tab = (key: string, label: string) =>
        `<button type=button class=tab data-tab="${key}-${r.name}" onclick="showTab('${r.name}','${key}')">${label}</button>`
      const logRow = `<tr class=logrow id="logrow-${r.name}" hidden><td colspan=4><div class=drawer>
        <div class=tabs>${tab('be', 'BE')}${tab('fe', 'FE')}${tab('up', 'launch')}</div>
        <pre id="up-${r.name}" class=logpane hidden></pre>
        <pre id="be-${r.name}" class=logpane></pre>
        <pre id="fe-${r.name}" class=logpane hidden></pre></div></td></tr>`
      return `<tr class="wt ${status}" data-wt="${r.name}"><td class=col-status>${dot}</td><td><div class=name>${r.name}</div>${phase}</td><td>${link}</td><td class=col-actions>${actions}</td></tr>${logRow}`
    }),
  )
  return cells.join('')
}

// Static assets live in real files next to this script (DASH-17) — dashboard.html
// (page skeleton with placeholders), dashboard.css, dashboard.client.js — served
// straight off disk by the same Bun.serve, no build step or framework. Read per
// request: this is a localhost dev tool, so edits show live and caching would only
// confuse. The genuinely *dynamic* bits stay in code — renderRows() (per-request
// row markup) and the header counts, filled into the HTML placeholders by page().
const ASSET_DIR = import.meta.dir
const STATIC_ASSETS: Record<string, string> = {
  '/dashboard.css': 'text/css',
  '/dashboard.client.js': 'text/javascript',
}

function readAsset(name: string): string {
  return readFileSync(join(ASSET_DIR, name), 'utf8')
}

function page(rows: string, summary: { running: number; total: number }): string {
  return fillPageTemplate(readAsset('dashboard.html'), rows, summary)
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
  // Fire-and-return; grove-up detaches its own processes (and may wait ~30s to
  // bind). Capture output to a per-instance launch log so failed starts are
  // inspectable from the dashboard. ponytail: truncate per start ('w'), no rotation.
  const logsDir = join(groveRoot(), 'logs')
  mkdirSync(logsDir, { recursive: true }) // dir may not exist before grove-up's own mkdir
  const fd = openSync(join(logsDir, `${name}-up.log`), 'w')
  // Spawn the grove-up entrypoint directly (not via `just`) so the dashboard
  // stays project-agnostic — no dependency on the consumer's task runner or
  // recipe names. The child inherits a dup of fd, so close ours immediately to
  // avoid leaking a descriptor per click in this long-lived process.
  Bun.spawn(['bun', 'run', join(import.meta.dir, 'grove-up.ts'), name], {
    cwd: repoRoot,
    stdout: fd,
    stderr: fd,
  })
  closeSync(fd)
}

function down(name: string): void {
  // Synchronous so callers (incl. restart) know the ports are freed before reusing them.
  Bun.spawnSync(['bun', 'run', join(import.meta.dir, 'grove-down.ts'), name], {
    cwd: repoRoot,
    stdout: 'ignore',
    stderr: 'ignore',
  })
}

function serve(): void {
  Bun.serve({
    port: PORT,
    // Loopback-only: this is a localhost dev tool with no auth, so the kernel —
    // not just convention — keeps it off the LAN. The POST guards below are the
    // in-process trust boundary for same-host browsers.
    hostname: '127.0.0.1',
    async fetch(req) {
      const url = new URL(req.url)
      // Static assets (CSS/JS) are fixed filenames, no user input in the path — no
      // traversal risk. Served before the action routing below.
      if (req.method === 'GET' && STATIC_ASSETS[url.pathname]) {
        return new Response(readAsset(url.pathname.slice(1)), {
          headers: {
            'content-type': `${STATIC_ASSETS[url.pathname]}; charset=utf-8`,
            'cache-control': 'no-store',
          },
        })
      }
      // The client encodeURIComponent's the name (worktree names contain `+`),
      // and URL.pathname does NOT decode — so decode it back before any check or
      // path build. A malformed encoding decodes to '' → treated as no match.
      const [, action, seg] = url.pathname.split('/')
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
        if (action === 'up') {
          up(name)
          return Response.redirect('/', 303)
        }
        if (action === 'down') {
          down(name)
          return Response.redirect('/', 303)
        }
        if (action === 'restart') {
          down(name)
          await Bun.sleep(300) // let the OS release the ports before grove-up's in-use precheck
          up(name)
          return Response.redirect('/', 303)
        }
      }
      if (action === 'rows') {
        return new Response(await renderRows(), {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })
      }
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
      // Seed the header counts server-side (total is exact; the client recounts
      // live status dots after the first poll). loadConfig caches, so this second
      // buildRows is in-memory and cheap.
      const config = await loadConfig()
      const summary = groveSummary(buildRows(listWorktreeDirs(), readInstances(), config))
      return new Response(page(await renderRows(), summary), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    },
  })
  console.log(`dashboard on http://localhost:${PORT}`)
}

function start(): void {
  // Quiet on success — no "▶ started" banner (the URL is the fixed localhost:PORT).
  // Only failures surface (DASH-1a idempotency: an already-running dashboard is a
  // silent no-op, not an error). start() is fire-and-forget detached, so this
  // catches the synchronous mkdir/spawn failures; it cannot verify the dashboard
  // actually bound.
  try {
    if (portsInUse([PORT]).length > 0) return // already running → no-op
    mkdirSync(join(groveRoot(), 'logs'), { recursive: true })
    const log = join(groveRoot(), 'logs', 'dashboard.log')
    // Re-launch this same script in `serve` mode, detached, so closing the
    // terminal (or Ctrl+C) leaves it running. import.meta.path is this file's
    // absolute path (= argv[1] when run as the entrypoint), typed as string.
    spawnDetached(['bun', 'run', import.meta.path, 'serve'], {
      cwd: repoRoot,
      env: {},
      logFile: log,
    })
  } catch (err) {
    console.error(dashboardActionError('start', err))
  }
}

function stop(): void {
  // Quiet on success; surface only a failure to kill the listener.
  try {
    killByPortAndPids([PORT], [])
  } catch (err) {
    console.error(dashboardActionError('stop', err))
  }
}

const mode = process.argv[2] ?? 'start'
if (mode === 'serve') serve()
else if (mode === 'stop') stop()
else start()
