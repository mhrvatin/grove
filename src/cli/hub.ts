// The grove hub (HUB-*): one fixed, memorable URL that lists every running
// grove dashboard on this machine and redirects /<repoName> to it. Stateless —
// each request probes the dashboard port range, so there is no registry to go
// stale when a dashboard dies.
//
// Runs detached in the background, started by `grove start` / `grove hub start`
// and stopped with `grove hub stop`. It outlives any one repo's dashboard.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { type Dashboard, hubResponse, toDashboard } from '../lib/hub-utils.ts'
import {
  groveRoot,
  killByPortAndPids,
  mainRepoRoot,
  portsInUse,
  spawnDetached,
} from '../lib/instances.ts'
import { dashboardPorts, hubPort } from '../lib/port-utils.ts'

const PORT = hubPort(process.env['GROVE_HUB_PORT'])
// Loopback dashboards answer or refuse almost instantly; the timeout only
// bounds a port held by something that accepts but never replies.
const PROBE_TIMEOUT_MS = 300

function hubError(action: 'start' | 'stop', err: unknown): string {
  return `grove hub ${action} failed: ${err instanceof Error ? err.message : String(err)}`
}

async function probe(port: number): Promise<Dashboard | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/meta`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    return res.ok ? toDashboard(port, await res.json()) : null
  } catch {
    return null // closed port, timeout, or a non-JSON reply → not a dashboard
  }
}

async function probeDashboards(): Promise<Dashboard[]> {
  const found = await Promise.all(dashboardPorts().map(probe))
  return found.filter((d) => d !== null)
}

export function serveHub(): void {
  Bun.serve({
    port: PORT,
    hostname: '127.0.0.1', // loopback-only, like the dashboard (SEC-1)
    async fetch(req) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return new Response('method not allowed', { status: 405 })
      }
      const { pathname } = new URL(req.url)
      if (pathname === '/favicon.ico') return new Response(null, { status: 404 })
      const { status, headers, body } = hubResponse(pathname, await probeDashboards())
      return new Response(body, { status, headers })
    },
  })
  console.log(`hub on http://localhost:${PORT}`)
}

export function startHub(): void {
  // Idempotent like the dashboard's start (DASH-1c). A failure here must never
  // stop the caller's dashboard from starting, so it surfaces as one error line.
  try {
    if (portsInUse([PORT]).length === 0) {
      mkdirSync(join(groveRoot(), 'logs'), { recursive: true })
      spawnDetached(['bun', 'run', join(import.meta.dir, 'grove.ts'), 'serve-hub'], {
        cwd: mainRepoRoot(),
        env: {},
        logFile: join(groveRoot(), 'logs', 'hub.log'),
      })
    }
    console.log(`hub on http://localhost:${PORT}`)
  } catch (err) {
    console.error(hubError('start', err))
  }
}

export function stopHub(): void {
  try {
    killByPortAndPids([PORT], [])
  } catch (err) {
    console.error(hubError('stop', err))
  }
}
