import type { EffectiveStatus } from './types'

// The dot's colour, ring and pulse come from the row's status class (tr.wt.<status>
// .dot in dashboard.css, DASH-12); `title` adds a plain-text name on hover (DASH-24)
// so a state is never carried by colour/animation alone.
export function legendFor(status: EffectiveStatus): string {
  switch (status) {
    case 'live':
      return 'live'
    case 'idle':
      return 'idle'
    case 'starting':
      return 'starting…'
    case 'failed':
      return 'failed'
    case 'orphaned':
      return 'worktree removed'
  }
}

export function StatusDot({ status }: { status: EffectiveStatus }) {
  return <span className="dot" title={legendFor(status)} />
}
