// Client-owned overlay for the down/clear action (DASH-21), parallel to reconcile.ts's
// start overlay: `inFlight` disables the row's buttons while a POST is outstanding,
// `failed` marks a stop that came back non-2xx until the row is retried.
export type StopState = { inFlight: Set<string>; failed: Set<string> }

// Drops a recorded stop failure for `name` — used on retry (startStop) and when a
// start/restart supersedes it, so the notice can't outlive the action it describes.
export function clearFailed(prev: StopState, name: string): StopState {
  const failed = new Set(prev.failed)
  failed.delete(name)
  return { inFlight: prev.inFlight, failed }
}

export function startStop(prev: StopState, name: string): StopState {
  const { failed } = clearFailed(prev, name)
  return { inFlight: new Set(prev.inFlight).add(name), failed }
}

// Mirrors reconcile.ts's vanished-worktree cleanup: drop any entry for a name no
// longer in the poll. Also clears `failed` once the row's server status confirms
// the stop landed (`idle`) — an idle row's ActionButtons offers no stop/clear
// button to retry with, so the notice would otherwise never clear.
export function pruneStop(prev: StopState, rows: { name: string; status: string }[]): StopState {
  const statusByName = new Map(rows.map((r) => [r.name, r.status]))
  const inFlight = new Set([...prev.inFlight].filter((n) => statusByName.has(n)))
  const failed = new Set(
    [...prev.failed].filter((n) => statusByName.has(n) && statusByName.get(n) !== 'idle'),
  )
  return { inFlight, failed }
}

export function finishStop(prev: StopState, name: string, ok: boolean): StopState {
  const inFlight = new Set(prev.inFlight)
  inFlight.delete(name)
  const failed = new Set(prev.failed)
  if (ok) failed.delete(name)
  else failed.add(name)
  return { inFlight, failed }
}
