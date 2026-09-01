import type { ApiRow, EffectiveStatus } from './types'

// Backs the header's stop-all/restart-all actions (DASH-23): the names to fan an
// action out to, given the same client-overlaid status the rows render with.
export function liveNames(
  rows: ApiRow[],
  effectiveStatus: (row: ApiRow) => EffectiveStatus,
): string[] {
  return rows.filter((r) => effectiveStatus(r) === 'live').map((r) => r.name)
}
