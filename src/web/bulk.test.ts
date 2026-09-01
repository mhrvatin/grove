import { describe, expect, test } from 'bun:test'
import { liveNames } from './bulk'
import type { ApiRow, EffectiveStatus } from './types'

const row = (name: string): ApiRow => ({
  name,
  url: '',
  mode: 'single',
  status: 'idle',
  orphaned: false,
})

// covers: DASH-23
describe('liveNames', () => {
  test('returns only rows whose effective status is live', () => {
    const rows = [row('a'), row('b'), row('c')]
    const status: Record<string, EffectiveStatus> = { a: 'live', b: 'starting', c: 'live' }
    expect(liveNames(rows, (r) => status[r.name] ?? 'idle')).toEqual(['a', 'c'])
  })

  test('returns an empty list when nothing is live', () => {
    const rows = [row('a')]
    expect(liveNames(rows, () => 'idle')).toEqual([])
  })

  test('returns an empty list for no rows', () => {
    expect(liveNames([], () => 'live')).toEqual([])
  })
})
