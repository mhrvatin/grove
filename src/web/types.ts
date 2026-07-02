// Shapes shared across the dashboard SPA. ApiRow mirrors the server's
// grove-dashboard-utils ApiRow DTO by hand (not imported) so the browser bundle
// never pulls in node:path via the server utils.

export type RowStatus = 'live' | 'failed' | 'idle' | 'orphaned'

export type ApiRow = {
  name: string
  url: string
  // `mode` drives which port fields to render and which log tabs to show.
  mode: 'dual' | 'single'
  // Populated in dual mode:
  bePort?: number
  fePort?: number
  // Populated in single mode:
  port?: number
  status: RowStatus
  orphaned: boolean
}

// Keyed logs GET /api/logs/<name> returns (LOG-1), already formatted server-side.
// dual mode → { up, be, fe }; single mode → { up, server }.
export type Logs = { up: string; be?: string; fe?: string; server?: string }

// GET /api/meta (DASH-19) — the repo this dashboard instance is serving, since
// the built SPA in dist/ is shared across all repos and only the running server
// process knows which one it is.
export type Meta = { repoName: string }
