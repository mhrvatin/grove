import { useCallback, useEffect, useState } from 'react'
import { type Action, fetchMeta, fetchRows, postAction } from './api'
import { liveNames } from './bulk'
import { gradientColorFor } from './color'
import { Icon } from './Icon'
import { type ClientState, reconcile } from './reconcile'
import { Sprite } from './Sprite'
import { clearFailed, finishStop, pruneStop, type StopState, startStop } from './stopState'
import type { ApiRow, EffectiveStatus } from './types'
import { usePoll } from './usePoll'
import { WorktreeTable } from './WorktreeTable'

const EMPTY: ClientState = { pending: new Map(), failed: new Set() }
const EMPTY_STOP: StopState = { inFlight: new Set(), failed: new Set() }

export function App() {
  const { data: rows, refetch, stale } = usePoll(fetchRows, 2000)
  const [client, setClient] = useState<ClientState>(EMPTY)
  const [stop, setStop] = useState<StopState>(EMPTY_STOP)
  const [repoName, setRepoName] = useState<string | null>(null)

  // Repo identity never changes during a session (DASH-19), so a plain mount
  // effect — not usePoll — fetches it once and derives the gradient hue from it.
  useEffect(() => {
    fetchMeta()
      .then((meta) => {
        setRepoName(meta.repoName)
        document.title = `Grove - ${meta.repoName}`
        document.documentElement.style.setProperty(
          '--gradient-color',
          gradientColorFor(meta.repoName),
        )
      })
      .catch(() => {})
  }, [])

  // Fold each poll into the client launch state (DASH-11). performance.now() is read
  // here (not inside reconcile) so reconcile stays pure and unit-testable.
  useEffect(() => {
    if (!rows) return
    setClient((prev) => reconcile(prev, rows, performance.now()))
    setStop((prev) => pruneStop(prev, rows))
  }, [rows])

  // Fires the action and updates client/stop state, but leaves refetching to the
  // caller — so a bulk operation (onStopAll/onRestartAll) can await every row's
  // POST and issue a single trailing refetch instead of one per row (DASH-23).
  const fireAction = useCallback(
    (action: Action, name: string): Promise<void> => {
      // A start/restart marks the row pending → 'starting…' immediately; a retry
      // clears any prior fast-fail notice. Stop just fires and lets the poll settle.
      if (action === 'up' || action === 'restart') {
        setClient((prev) => {
          const failed = new Set(prev.failed)
          failed.delete(name)
          return { pending: new Map(prev.pending).set(name, performance.now()), failed }
        })
        // A restart supersedes any earlier stop failure recorded for this row.
        setStop((prev) => clearFailed(prev, name))
        // A start/restart that fails outright (server crash, 4xx/5xx) marks the row
        // failed now rather than leaving it stuck 'starting…' until the backstop
        // expires. Down/clear failures get their own overlay below (DASH-21).
        return postAction(action, name).catch(() =>
          setClient((prev) => {
            const pending = new Map(prev.pending)
            pending.delete(name)
            return { pending, failed: new Set(prev.failed).add(name) }
          }),
        )
      }
      // down (stop or orphan clear): disable the buttons for the duration of the
      // POST and flag the phase if it comes back non-2xx (DASH-21) — unlike start,
      // a live row staying live already shows a failed stop, but silently. A row
      // already mid-stop is left alone, so a bulk "stop all" overlapping a per-row
      // stop (or a second "stop all" click) can't fire a duplicate POST.
      if (stop.inFlight.has(name)) return Promise.resolve()
      setStop((prev) => startStop(prev, name))
      return postAction(action, name).then(
        () => setStop((prev) => finishStop(prev, name, true)),
        () => setStop((prev) => finishStop(prev, name, false)),
      )
    },
    [stop],
  )

  const onAction = useCallback(
    (action: Action, name: string) => {
      fireAction(action, name).finally(refetch)
    },
    [fireAction, refetch],
  )

  const list = rows ?? []
  const effectiveStatus = (row: ApiRow): EffectiveStatus =>
    client.failed.has(row.name) ? 'failed' : client.pending.has(row.name) ? 'starting' : row.status
  // Header counts mirror the row dots (DASH-13): running = live probe only; total
  // excludes orphan tombstones (DASH-15).
  const running = list.filter((r) => r.status === 'live').length
  const total = list.filter((r) => !r.orphaned).length
  // Header bulk actions (DASH-23): fan the same per-row action out to every live
  // row, so running many worktrees at once doesn't mean clicking once per row.
  const liveRowNames = liveNames(list, effectiveStatus)
  const onStopAll = () => {
    Promise.allSettled(liveRowNames.map((name) => fireAction('down', name))).finally(refetch)
  }
  const onRestartAll = () => {
    Promise.allSettled(liveRowNames.map((name) => fireAction('restart', name))).finally(refetch)
  }

  return (
    <div className="wrap">
      <Sprite />
      <header>
        <div className="brand">
          <Icon id="leaf" className="mark" />
          <div>
            <div className="wordmark">{repoName ? `Grove - ${repoName}` : 'Grove'}</div>
            <div className="tagline">worktree dev instances</div>
          </div>
        </div>
        <div className="summary">
          <div className="stat">
            <span className="dot on" />
            <span className="n live">{running}</span>
            <span className="l">running</span>
          </div>
          <div className="stat">
            <span className="n">{total}</span>
            <span className="l">worktrees</span>
          </div>
          <button
            type="button"
            className="btn"
            disabled={liveRowNames.length === 0}
            onClick={onRestartAll}
          >
            <Icon id="restart" />
            restart all
          </button>
          <button
            type="button"
            className="btn danger"
            disabled={liveRowNames.length === 0}
            onClick={onStopAll}
          >
            <Icon id="stop" />
            stop all
          </button>
        </div>
      </header>
      <WorktreeTable
        rows={rows}
        effectiveStatus={effectiveStatus}
        isPending={(name) => client.pending.has(name)}
        isClientFailed={(name) => client.failed.has(name)}
        isStopPending={(name) => stop.inFlight.has(name)}
        isStopFailed={(name) => stop.failed.has(name)}
        onAction={onAction}
      />
      <footer>
        <span className={`live-pip${stale ? ' stale' : ''}`} />
        {stale ? 'stale · retrying…' : 'live · refreshing every 2s'}
      </footer>
    </div>
  )
}
