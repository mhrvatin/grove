import { describe, expect, test } from 'bun:test'
import { isStale, STALE_AFTER_FAILURES } from './usePoll'

// covers: DASH-22
describe('isStale', () => {
  test('a single transient failure is not yet stale', () => {
    expect(isStale(1)).toBe(false)
  })

  test('reaching the threshold is stale', () => {
    expect(isStale(STALE_AFTER_FAILURES)).toBe(true)
  })

  test('zero failures is not stale', () => {
    expect(isStale(0)).toBe(false)
  })
})
