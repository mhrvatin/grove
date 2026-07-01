import type { ApiRow, Logs, Meta } from './types'

// Thin client over the dashboard's JSON API (cli/dashboard.ts). All dynamic
// routes live under /api so the SPA index fallback never swallows them.

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(path)
  if (!r.ok) throw new Error(`${path} -> ${r.status}`)
  return (await r.json()) as T
}

export function fetchRows(): Promise<ApiRow[]> {
  return getJson<ApiRow[]>('/api/rows')
}

export function fetchMeta(): Promise<Meta> {
  return getJson<Meta>('/api/meta')
}

export function fetchLogs(name: string): Promise<Logs> {
  return getJson<Logs>(`/api/logs/${encodeURIComponent(name)}`)
}

export type Action = 'up' | 'down' | 'restart'

// State-changing POSTs return 204 (DASH-11); the poll picks up the new state. A
// non-2xx response throws so the caller can surface the failed action (DASH-12)
// instead of it vanishing — the row would otherwise look unchanged.
export async function postAction(action: Action, name: string): Promise<void> {
  const r = await fetch(`/api/${action}/${encodeURIComponent(name)}`, { method: 'POST' })
  if (!r.ok) throw new Error(`/api/${action}/${name} -> ${r.status}`)
}
