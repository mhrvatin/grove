// Pure model for the grove dashboard: cross-reference the git worktree list with
// the .grove/instances/*.json files to produce one row per worktree. Stateless —
// no instance file means "stopped", and ports for stopped worktrees are derived
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

// CSRF guard for state-changing POSTs: browsers always send Origin on cross-site
// POSTs, so a present-but-mismatched Origin is a drive-by from another site —
// reject it. A missing Origin is a non-browser client (curl/scripts), which a
// remote attacker can't forge via a victim's browser, so it's allowed.
export function isSameOrigin(origin: string | null, port: number): boolean {
  return origin === null || origin === `http://localhost:${port}`
}

// Ordered, keyed log sections shown for an instance: the launch log (grove-up's
// own stdout/stderr, so failed starts are inspectable), then BE and FE. The keys
// match the /logs/<name> JSON fields so each log renders in its own pane.
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

export function buildRows(
  worktreeDirs: string[],
  instances: Instance[],
  config: GroveConfig,
): Row[] {
  const byName = new Map(instances.map((i) => [i.name, i]))
  return worktreeDirs.map((dir) => {
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
    }
  })
}
