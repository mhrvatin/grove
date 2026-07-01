import type { Action } from './api'
import { Icon } from './Icon'
import type { RowStatus } from './types'

// The action set is driven by the *server* status (DASH-12), never the client
// overlay: a client fast-fail is server-idle, so it must keep the bare "start" to
// retry — only its dot + phase repaint (handled in WorktreeRow). `disabled` (the
// pending overlay) greys the action buttons but never the logs toggle.
type Props = {
  status: RowStatus
  disabled: boolean
  logsOpen: boolean
  onAction: (action: Action) => void
  onToggleLogs: () => void
}

function ActButton({
  action,
  cls,
  icon,
  label,
  disabled,
  onAction,
}: {
  action: Action
  cls: string
  icon: string
  label: string
  disabled: boolean
  onAction: (action: Action) => void
}) {
  return (
    <button
      type="button"
      className={`btn ${cls}`.trim()}
      disabled={disabled}
      onClick={() => onAction(action)}
    >
      <Icon id={icon} />
      {label}
    </button>
  )
}

export function ActionButtons({ status, disabled, logsOpen, onAction, onToggleLogs }: Props) {
  // An orphan tombstone offers only "clear" (the down path), no logs toggle.
  if (status === 'orphaned') {
    return (
      <ActButton
        action="down"
        cls="danger"
        icon="stop"
        label="clear"
        disabled={disabled}
        onAction={onAction}
      />
    )
  }
  const logs = (
    <button type="button" className="btn ghost" aria-expanded={logsOpen} onClick={onToggleLogs}>
      logs
    </button>
  )
  // Idle → a single start. Live/failed → restart + stop (a failed start is never a
  // bare "start"). Logs toggle in both.
  if (status === 'idle') {
    return (
      <>
        <ActButton
          action="up"
          cls="primary"
          icon="play"
          label="start"
          disabled={disabled}
          onAction={onAction}
        />
        {logs}
      </>
    )
  }
  return (
    <>
      <ActButton
        action="restart"
        cls=""
        icon="restart"
        label="restart"
        disabled={disabled}
        onAction={onAction}
      />
      <ActButton
        action="down"
        cls="danger"
        icon="stop"
        label="stop"
        disabled={disabled}
        onAction={onAction}
      />
      {logs}
    </>
  )
}
