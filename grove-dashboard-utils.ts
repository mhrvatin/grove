// Pure model for the grove dashboard: cross-reference the git worktree list with
// the .grove/instances/*.json files to produce one row per worktree. Stateless —
// no instance file means "idle", and ports for idle worktrees are derived
// the same way grove-up derives them (via portsFor + config), so the URL is shown
// even before launch.
import { join } from 'node:path'
import type { GroveConfig, Instance } from './grove-instances-utils.ts'
import { portsFor } from './grove-port-utils.ts'

export type { Instance }

export type Row = {
  name: string
  dir: string
  url: string
  bePort: number
  fePort: number
  running: boolean
  // An orphan tombstone: an instance file whose worktree was removed (DASH-15).
  orphaned: boolean
}

export type LogSection = { key: 'up' | 'be' | 'fe'; header: string; path: string }

function basename(p: string): string {
  return p.split('/').filter(Boolean).pop() ?? p
}

// Accept only names that are actual worktrees. The dashboard hands `name` to
// `just grove-up/grove-down`, which textually interpolates `{{target}}` into a
// shell recipe — so an unconstrained name from the HTTP path is a command-
// injection vector. Real worktree basenames are `[A-Za-z0-9._+-]`, so exact-set
// membership closes the hole without a separate character allowlist.
export function isAllowedName(name: string, worktreeDirs: string[]): boolean {
  return name.length > 0 && worktreeDirs.some((d) => basename(d) === name)
}

// Like isAllowedName, but also accepts the name of an existing instance record
// whose worktree is gone — so an orphan tombstone can be cleared (SEC-3a). Both
// sets are populated by grove from real worktree basenames, never HTTP input.
export function isActionableName(
  name: string,
  worktreeDirs: string[],
  instances: Instance[],
): boolean {
  return isAllowedName(name, worktreeDirs) || instances.some((i) => i.name === name)
}

// Instances whose worktree no longer exists (the worktree was removed) — the
// tombstones the dashboard shows and reaps (DASH-15/16).
export function orphanInstances(worktreeDirs: string[], instances: Instance[]): Instance[] {
  const names = new Set(worktreeDirs.map(basename))
  return instances.filter((i) => !names.has(i.name))
}

// Orphans the reaper should kill this poll: those not yet reaped this episode
// (DASH-16). Pairs with prunedReaped — once an orphan is reaped its name stays in
// the set (so a port a later process rebinds is never re-killed) until it stops
// being an orphan.
export function reapTargets(reaped: Set<string>, orphans: Instance[]): Instance[] {
  return orphans.filter((o) => !reaped.has(o.name))
}

// Evict from the reaped set any name that is no longer an orphan — cleared (the
// instance file removed) or its worktree recreated. This bounds reaping to "once
// per orphan episode": a steady tombstone is reaped at most once, but a worktree
// removed → recreated → removed reaps fresh on each removal (DASH-16).
export function prunedReaped(reaped: Set<string>, orphans: Instance[]): Set<string> {
  const orphanNames = new Set(orphans.map((o) => o.name))
  return new Set([...reaped].filter((name) => orphanNames.has(name)))
}

// CSRF guard for state-changing POSTs: browsers always send Origin on cross-site
// POSTs, so a present-but-mismatched Origin is a drive-by from another site —
// reject it. A missing Origin is a non-browser client (curl/scripts), which a
// remote attacker can't forge via a victim's browser, so it's allowed.
export function isSameOrigin(origin: string | null, port: number): boolean {
  return origin === null || origin === `http://localhost:${port}`
}

// Ordered, keyed log sections shown for an instance: the launch log (grove-up's
// own stdout/stderr, so failed starts are inspectable), then BE and FE. The keys
// match the /api/logs/<name> JSON fields so each log renders in its own pane.
export function instanceLogSections(logsDir: string, name: string): LogSection[] {
  return [
    { key: 'up', header: 'launch (just grove-up)', path: join(logsDir, `${name}-up.log`) },
    { key: 'be', header: 'BE', path: join(logsDir, `${name}-be.log`) },
    { key: 'fe', header: 'FE', path: join(logsDir, `${name}-fe.log`) },
  ]
}

const PINO_LEVELS: Record<number, string> = {
  10: 'TRACE',
  20: 'DEBUG',
  30: 'INFO',
  40: 'WARN',
  50: 'ERROR',
  60: 'FATAL',
}

function pad(n: number, len = 2): string {
  return String(n).padStart(len, '0')
}

// Pino emits one-line JSON (not pino-pretty) when the BE stdout is piped to a
// file, so the dashboard sees `{"time":<epoch-ms>,...}` with no human stamp.
// Render each pino line as `HH:mm:ss.SSS LEVEL msg key=val` in local time.
// Non-pino lines (vite/bun banners, stack traces, plain text) pass through.
function formatPinoLine(line: string): string {
  if (!line.startsWith('{')) return line
  let o: Record<string, unknown>
  try {
    o = JSON.parse(line)
  } catch {
    return line
  }
  const { time, level, msg, ...rest } = o
  if (typeof time !== 'number' || typeof level !== 'number') return line
  const d = new Date(time)
  const ts = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
  const name = PINO_LEVELS[level] ?? String(level)
  const extra = Object.keys(rest)
    .map((k) => `${k}=${typeof rest[k] === 'object' ? JSON.stringify(rest[k]) : rest[k]}`)
    .join(' ')
  return `${ts} ${name} ${msg ?? ''}${extra ? ` ${extra}` : ''}`.trimEnd()
}

export function formatPinoLog(text: string): string {
  return text.split('\n').map(formatPinoLine).join('\n')
}

// start/stop are deliberately quiet on success (no "▶ started" / "■ stopped"
// banner) — only failures surface. This formats the one line we print when the
// synchronous start/stop work throws.
export function dashboardActionError(action: 'start' | 'stop', err: unknown): string {
  return `grove dashboard ${action} failed: ${err instanceof Error ? err.message : String(err)}`
}

export type RowStatus = 'live' | 'failed' | 'idle' | 'orphaned'

// Three-state row status from stateless discovery (DASH-12). `running` is whether
// an instance file exists (buildRows); `live` is the port probe. A file with a
// dead probe is a *failed* start — UP-6 writes the instance with pid 0 when a port
// never binds, and a crashed slot leaves the file behind too. Collapsing that into
// "idle" (a bare "start" button) is the bug: a failed start then looks identical to
// a never-started worktree.
export function rowStatus(running: boolean, live: boolean, orphaned = false): RowStatus {
  if (orphaned) return 'orphaned'
  if (!running) return 'idle'
  return live ? 'live' : 'failed'
}

// The per-row DTO the dashboard SPA polls from GET /api/rows. The server folds the
// liveness probe (a browser can't probe arbitrary loopback ports) into a computed
// `status` so the client never sees the raw running/live split. Shape is mirrored
// — not imported — by src/types.ts, to keep node:path out of the browser bundle.
export type ApiRow = {
  name: string
  url: string
  bePort: number
  fePort: number
  status: RowStatus
  orphaned: boolean
}

// Map an internal Row + its probe result to the API DTO. `live` is the caller's
// port-probe outcome (server-side only); status collapses running/live/orphaned
// via rowStatus (DASH-12).
export function apiRow(row: Row, live: boolean): ApiRow {
  return {
    name: row.name,
    url: row.url,
    bePort: row.bePort,
    fePort: row.fePort,
    status: rowStatus(row.running, live, row.orphaned),
    orphaned: row.orphaned,
  }
}

export function buildRows(
  worktreeDirs: string[],
  instances: Instance[],
  config: GroveConfig,
): Row[] {
  const byName = new Map(instances.map((i) => [i.name, i]))
  const worktreeRows = worktreeDirs.map((dir) => {
    const name = basename(dir)
    const inst = byName.get(name)
    if (inst) {
      return {
        name,
        dir,
        url: inst.url,
        bePort: inst.bePort,
        fePort: inst.fePort,
        running: true,
        orphaned: false,
      }
    }
    const { be, fe } = portsFor(name, config)
    return {
      name,
      dir,
      url: `http://localhost:${fe}`,
      bePort: be,
      fePort: fe,
      running: false,
      orphaned: false,
    }
  })
  // Tombstone rows for instances whose worktree is gone (DASH-15).
  const orphanRows = orphanInstances(worktreeDirs, instances).map((i) => ({
    name: i.name,
    dir: i.dir,
    url: i.url,
    bePort: i.bePort,
    fePort: i.fePort,
    running: false,
    orphaned: true,
  }))
  return [...worktreeRows, ...orphanRows]
}
