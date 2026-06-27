import type { ApiRow } from './types'

// Client-owned launch state the server can't report (DASH-11). `pending` maps a
// just-started worktree → the timestamp the start/restart was clicked; `failed`
// holds fast-fails the server never reports (a UP-3 port-in-use launch writes no
// instance file, so its row stays server-`idle` forever).
export type ClientState = { pending: Map<string, number>; failed: Set<string> }

// > grove-up's worst-case sequential bind wait (30s BE + 30s FE), so a slow-but-
// legit start is never falsely flagged. A still-pending row past this is a
// fast-fail (DASH-11).
export const BACKSTOP_MS = 70_000

// Fold one /api/rows poll into the client launch state. Pure: same inputs → same
// output, no clock read (the caller passes `now`), so it is unit-tested directly.
export function reconcile(prev: ClientState, rows: ApiRow[], now: number): ClientState {
  const status = new Map(rows.map((r) => [r.name, r.status]))
  const pending = new Map(prev.pending)
  const failed = new Set(prev.failed)
  for (const [name, startedAt] of prev.pending) {
    const s = status.get(name)
    if (s === undefined)
      pending.delete(name) // worktree vanished
    else if (s === 'live')
      pending.delete(name) // start succeeded
    else if (s === 'failed')
      pending.delete(name) // server already reports failed (DASH-12)
    else if (now - startedAt > BACKSTOP_MS) {
      // never went live, never wrote a file → fast-fail
      pending.delete(name)
      failed.add(name)
    }
  }
  for (const name of prev.failed) {
    const s = status.get(name)
    if (s === undefined || s === 'live') failed.delete(name) // gone, or a slow start finally lived
  }
  return { pending, failed }
}
