import { useState } from 'react'
import { ActionButtons } from './ActionButtons'
import type { Action } from './api'
import { Icon } from './Icon'
import { LogDrawer } from './LogDrawer'
import { StatusDot } from './StatusDot'
import type { ApiRow, RowStatus } from './types'

export type EffectiveStatus = RowStatus | 'starting'

type Props = {
  row: ApiRow
  // The client overlay (DASH-11): 'starting' while pending, 'failed' for a client
  // fast-fail. Drives the row class, dot and phase only — actions stay on row.status.
  effectiveStatus: EffectiveStatus
  // True when the 'failed' overlay is a client fast-fail (server-idle), so the phase
  // reads "start failed" vs a server-side crash's "failed".
  clientFailed: boolean
  pending: boolean
  onAction: (action: Action, name: string) => void
}

function phaseFor(
  status: EffectiveStatus,
  clientFailed: boolean,
): { cls: string; text: string } | null {
  if (status === 'starting') return { cls: 'starting', text: 'starting…' }
  if (status === 'failed') {
    return {
      cls: 'failed',
      text: clientFailed ? 'start failed · open launch log' : 'failed · open launch log',
    }
  }
  if (status === 'orphaned') return { cls: 'orphaned', text: 'worktree removed · server stopped' }
  return null
}

export function WorktreeRow({ row, effectiveStatus, clientFailed, pending, onAction }: Props) {
  const [logsOpen, setLogsOpen] = useState(false)
  const phase = phaseFor(effectiveStatus, clientFailed)
  // Strip the scheme for display — localhost:5173 reads cleaner; the href stays whole.
  const host = row.url.replace(/^https?:\/\//, '')
  return (
    <>
      <tr className={`wt ${effectiveStatus}`} data-wt={row.name}>
        <td className="col-status">
          <StatusDot />
        </td>
        <td>
          <div className="name">{row.name}</div>
          {phase ? (
            <span className={`phase ${phase.cls}`}>{phase.text}</span>
          ) : (
            <span className="phase" hidden />
          )}
        </td>
        <td>
          <a className="url" href={row.url} target="_blank" rel="noopener noreferrer">
            {host} <Icon id="ext" />
          </a>
          <div className="ports">
            api <b>{row.bePort}</b> · web <b>{row.fePort}</b>
          </div>
        </td>
        <td className="col-actions">
          <ActionButtons
            status={row.status}
            disabled={pending}
            logsOpen={logsOpen}
            onAction={(action) => onAction(action, row.name)}
            onToggleLogs={() => setLogsOpen((o) => !o)}
          />
        </td>
      </tr>
      {logsOpen && (
        <tr className="logrow">
          <td colSpan={4}>
            <LogDrawer name={row.name} />
          </td>
        </tr>
      )}
    </>
  )
}
