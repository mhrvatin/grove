import { useCallback, useEffect, useState } from 'react'
import { type Action, fetchMeta, fetchRows, postAction } from './api'
import { gradientColorFor } from './color'
import { Icon } from './Icon'
import { type ClientState, reconcile } from './reconcile'
import { Sprite } from './Sprite'
import type { ApiRow } from './types'
import { usePoll } from './usePoll'
import type { EffectiveStatus } from './WorktreeRow'
import { WorktreeTable } from './WorktreeTable'

const EMPTY: ClientState = { pending: new Map(), failed: new Set() }

export function App() {
  const { data: rows, refetch } = usePoll(fetchRows, 2000)
  const [client, setClient] = useState<ClientState>(EMPTY)
  const [repoName, setRepoName] = useState<string | null>(null)

  // Repo identity never changes during a session (DASH-19), so a plain mount
  // effect — not usePoll — fetches it once and derives the gradient hue from it.
  useEffect(() => {
    fetchMeta()
      .then((meta) => {
        setRepoName(meta.repoName)
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
  }, [rows])

  const onAction = useCallback(
    (action: Action, name: string) => {
      // A start/restart marks the row pending → 'starting…' immediately; a retry
      // clears any prior fast-fail notice. Stop just fires and lets the poll settle.
      if (action === 'up' || action === 'restart') {
        setClient((prev) => {
          const failed = new Set(prev.failed)
          failed.delete(name)
          return { pending: new Map(prev.pending).set(name, performance.now()), failed }
        })
        // A start/restart that fails outright (server crash, 4xx/5xx) marks the row
        // failed now rather than leaving it stuck 'starting…' until the backstop
        // expires. A failed stop needs no overlay — the row staying live shows it.
        postAction(action, name)
          .catch(() =>
            setClient((prev) => {
              const pending = new Map(prev.pending)
              pending.delete(name)
              return { pending, failed: new Set(prev.failed).add(name) }
            }),
          )
          .finally(refetch)
        return
      }
      postAction(action, name).finally(refetch)
    },
    [refetch],
  )

  const list = rows ?? []
  const effectiveStatus = (row: ApiRow): EffectiveStatus =>
    client.failed.has(row.name) ? 'failed' : client.pending.has(row.name) ? 'starting' : row.status
  // Header counts mirror the row dots (DASH-13): running = live probe only; total
  // excludes orphan tombstones (DASH-15).
  const running = list.filter((r) => r.status === 'live').length
  const total = list.filter((r) => !r.orphaned).length

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
        </div>
      </header>
      <WorktreeTable
        rows={rows}
        effectiveStatus={effectiveStatus}
        isPending={(name) => client.pending.has(name)}
        isClientFailed={(name) => client.failed.has(name)}
        onAction={onAction}
      />
      <footer>
        <span className="live-pip" />
        live · refreshing every 2s
      </footer>
    </div>
  )
}
