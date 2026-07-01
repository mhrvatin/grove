import type { Action } from './api'
import { Icon } from './Icon'
import type { ApiRow } from './types'
import { type EffectiveStatus, WorktreeRow } from './WorktreeRow'

type Props = {
  rows: ApiRow[] | undefined
  effectiveStatus: (row: ApiRow) => EffectiveStatus
  isPending: (name: string) => boolean
  isClientFailed: (name: string) => boolean
  onAction: (action: Action, name: string) => void
}

export function WorktreeTable({
  rows,
  effectiveStatus,
  isPending,
  isClientFailed,
  onAction,
}: Props) {
  return (
    <div className="panel">
      <table>
        <thead>
          <tr>
            <th className="col-status" />
            <th>worktree</th>
            <th>address</th>
            <th className="r">actions</th>
          </tr>
        </thead>
        <tbody>
          {rows === undefined ? null : rows.length === 0 ? (
            <tr>
              <td colSpan={4}>
                <div className="empty">
                  <Icon id="leaf" className="mark" />
                  <h2>No worktrees yet</h2>
                  <p>
                    Create a git worktree, then run <code>grove up</code> to plant it here.
                  </p>
                </div>
              </td>
            </tr>
          ) : (
            // Keyed by name → React keeps each row's DOM, open log drawer and scroll
            // across the 2s poll for free (DASH-5).
            rows.map((row) => (
              <WorktreeRow
                key={row.name}
                row={row}
                effectiveStatus={effectiveStatus(row)}
                clientFailed={isClientFailed(row.name)}
                pending={isPending(row.name)}
                onAction={onAction}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
