// The grove hub (HUB-*): one fixed, memorable URL that lists every running
// grove dashboard on this machine and redirects /<repoName> to it. Stateless —
// each request probes the dashboard port range, so there is no registry to go
// stale when a dashboard dies.
//
// Runs detached in the background, started by `grove start` / `grove hub start`
// and stopped with `grove hub stop`. It outlives any one repo's dashboard.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  type Dashboard,
  hubResponse,
  isHubIdentity,
  staticHubResponse,
  toDashboard,
} from '../lib/hub-utils.ts'
import {
  groveRoot,
  killByPortAndPids,
  mainRepoRoot,
  portsInUse,
  spawnDetached,
} from '../lib/instances.ts'
import { dashboardPorts, hubPort } from '../lib/port-utils.ts'

// Resolved per call, not at import: hubPort throws on an in-range override, and
// grove.ts imports this module for every command.
const port = () => hubPort(process.env['GROVE_HUB_PORT'])
// Loopback dashboards answer or refuse almost instantly; the timeout only
// bounds a port held by something that accepts but never replies.
const PROBE_TIMEOUT_MS = 300

function hubError(action: 'start' | 'stop', err: unknown): string {
  return `grove hub ${action} failed: ${err instanceof Error ? err.message : String(err)}`
}

async function getJson(url: string): Promise<unknown> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    return res.ok ? await res.json() : null
  } catch {
    return null // closed port, timeout, or a non-JSON reply
  }
}

async function probeDashboards(): Promise<Dashboard[]> {
  const found = await Promise.all(
    dashboardPorts().map(async (p) =>
      toDashboard(p, await getJson(`http://127.0.0.1:${p}/api/meta`)),
    ),
  )
  return found.filter((d) => d !== null)
}

// What holds the hub port: nothing, our hub, or some other process (PORT-6).
async function hubPortHolder(p: number): Promise<'free' | 'hub' | 'other'> {
  if (portsInUse([p]).length === 0) return 'free'
  return isHubIdentity(await getJson(`http://127.0.0.1:${p}/api/hub`)) ? 'hub' : 'other'
}

export function serveHub(): void {
  const p = port()
  Bun.serve({
    port: p,
    hostname: '127.0.0.1', // loopback-only, like the dashboard (SEC-1)
    async fetch(req) {
      const { pathname } = new URL(req.url)
      const { status, headers, body } =
        staticHubResponse(req.method, pathname) ?? hubResponse(pathname, await probeDashboards())
      return new Response(body, { status, headers })
    },
  })
  console.log(`hub on http://localhost:${p}`)
}

export async function startHub(): Promise<void> {
  // Idempotent like the dashboard's start (HUB-6). Callers run this after the
  // dashboard has started, so a failure here never blocks the dashboard.
  try {
    const p = port()
    const holder = await hubPortHolder(p)
    if (holder === 'other') throw new Error(`port ${p} is in use by another process`)
    if (holder === 'free') {
      mkdirSync(join(groveRoot(), 'logs'), { recursive: true })
      spawnDetached(['bun', 'run', join(import.meta.dir, 'grove.ts'), 'serve-hub'], {
        cwd: mainRepoRoot(),
        env: {},
        logFile: join(groveRoot(), 'logs', 'hub.log'),
      })
    }
    console.log(`hub on http://localhost:${p}`)
  } catch (err) {
    console.error(hubError('start', err))
  }
}

export async function stopHub(): Promise<void> {
  try {
    const p = port()
    const holder = await hubPortHolder(p)
    if (holder === 'other') throw new Error(`port ${p} is held by another process; not stopping it`)
    if (holder === 'hub') killByPortAndPids([p], [])
  } catch (err) {
    console.error(hubError('stop', err))
  }
}
