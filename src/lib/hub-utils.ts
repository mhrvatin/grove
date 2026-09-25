// Pure model for the grove hub (HUB-*): given the dashboards found by probing
// the dashboard port range, decide what a hub request returns. The hub only
// ever redirects; it never proxies, so each dashboard's own same-origin CSRF
// check (SEC-2) stays intact.

export type Dashboard = { port: number; repoName: string; repoRoot: string }

export type HubResponse = { status: number; headers: Record<string, string>; body: string }

// GET /api/hub reply. It lets `grove hub start|stop` tell the hub apart from any
// other process on the hub port (PORT-6). A repo basename can't contain `/`, so
// this path never shadows a /<repoName> route.
export const HUB_IDENTITY = { hub: 'grove' } as const
const HUB_IDENTITY_PATH = '/api/hub'

export function isHubIdentity(reply: unknown): boolean {
  return typeof reply === 'object' && reply !== null && (reply as { hub?: unknown }).hub === 'grove'
}

// Responses that need no dashboard probe: the method gate (HUB-1), the identity
// path (HUB-6), and the browser's favicon request. null means "probe, then call
// hubResponse".
export function staticHubResponse(method: string, pathname: string): HubResponse | null {
  if (method !== 'GET' && method !== 'HEAD') {
    return { status: 405, headers: {}, body: 'method not allowed' }
  }
  if (pathname === HUB_IDENTITY_PATH) {
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(HUB_IDENTITY),
    }
  }
  if (pathname === '/favicon.ico') return { status: 404, headers: {}, body: '' }
  return null
}

// A port counts as a grove dashboard only if its GET /api/meta returns this
// shape (DASH-19a); anything else on the dashboard range is ignored.
export function toDashboard(port: number, meta: unknown): Dashboard | null {
  if (typeof meta !== 'object' || meta === null) return null
  const { repoName, repoRoot } = meta as Record<string, unknown>
  if (typeof repoName !== 'string' || typeof repoRoot !== 'string') return null
  return { port, repoName, repoRoot }
}

// The CSP is a backstop in case a future field skips esc(): the page needs only
// inline styles, so scripts, frames and every other load are blocked.
const HTML = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
}

const STYLE =
  'body{font:15px/1.5 system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem}' +
  'ul{list-style:none;padding:0}li{margin:.5rem 0}a{font-weight:600}span{color:#777;margin-left:.5rem}'

// Probed metadata comes from whatever answers on a dashboard-range port, and the
// request path is user input, so both are escaped before reaching the page.
function esc(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function byName(a: Dashboard, b: Dashboard): number {
  return a.repoName.localeCompare(b.repoName) || a.repoRoot.localeCompare(b.repoRoot)
}

function dashboardUrl(d: Dashboard): string {
  return `http://localhost:${d.port}/`
}

function page(title: string, dashboards: Dashboard[]): string {
  const items = [...dashboards]
    .sort(byName)
    .map(
      (d) =>
        `<li><a href="${dashboardUrl(d)}">${esc(d.repoName)}</a> ` +
        `<span>${esc(d.repoRoot)} · :${d.port}</span></li>`,
    )
    .join('')
  const list = items ? `<ul>${items}</ul>` : '<p>No grove dashboards are running.</p>'
  return (
    '<!doctype html><meta charset="utf-8"><title>Grove hub</title>' +
    `<style>${STYLE}</style><h1>${title}</h1>${list}`
  )
}

function decodeName(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname.replace(/^\/+|\/+$/g, ''))
  } catch {
    return null
  }
}

export function hubResponse(pathname: string, dashboards: Dashboard[]): HubResponse {
  if (pathname === '/') {
    return { status: 200, headers: HTML, body: page('Grove dashboards', dashboards) }
  }
  const name = decodeName(pathname)
  const matches = name === null ? [] : dashboards.filter((d) => d.repoName === name)
  const [only] = matches
  if (only && matches.length === 1) {
    return { status: 302, headers: { location: dashboardUrl(only) }, body: '' }
  }
  const label = esc(name ?? pathname)
  if (matches.length > 1) {
    return { status: 200, headers: HTML, body: page(`Several dashboards named ${label}`, matches) }
  }
  return { status: 404, headers: HTML, body: page(`No dashboard named ${label}`, dashboards) }
}
