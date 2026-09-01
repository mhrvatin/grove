import { describe, expect, test } from 'bun:test'
import { clearFailed, finishStop, pruneStop, type StopState, startStop } from './stopState'

const EMPTY: StopState = { inFlight: new Set(), failed: new Set() }
const row = (name: string, status: string) => ({ name, status })

// covers: DASH-21
describe('startStop', () => {
  test('marks the row in flight', () => {
    const next = startStop(EMPTY, 'a')
    expect(next.inFlight.has('a')).toBe(true)
  })

  test('clears a prior failure for the row, so a retry drops the old notice', () => {
    const next = startStop({ inFlight: new Set(), failed: new Set(['a']) }, 'a')
    expect(next.failed.has('a')).toBe(false)
  })

  test('leaves other rows untouched', () => {
    const next = startStop({ inFlight: new Set(['b']), failed: new Set(['c']) }, 'a')
    expect(next.inFlight.has('b')).toBe(true)
    expect(next.failed.has('c')).toBe(true)
  })
})

describe('pruneStop', () => {
  test('drops entries for names no longer present, like reconcile does for a vanished worktree', () => {
    const next = pruneStop({ inFlight: new Set(['a']), failed: new Set(['b']) }, [row('a', 'live')])
    expect(next.inFlight.has('a')).toBe(true)
    expect(next.failed.has('b')).toBe(false)
  })

  test('keeps entries for names still present and not idle', () => {
    const next = pruneStop({ inFlight: new Set(['a']), failed: new Set(['a']) }, [row('a', 'live')])
    expect(next.inFlight.has('a')).toBe(true)
    expect(next.failed.has('a')).toBe(true)
  })

  test('clears a failed stop once the row settles idle, since there is no button left to retry with', () => {
    const next = pruneStop({ inFlight: new Set(), failed: new Set(['a']) }, [row('a', 'idle')])
    expect(next.failed.has('a')).toBe(false)
  })
})

describe('clearFailed', () => {
  test('drops the failure for the named row', () => {
    const next = clearFailed({ inFlight: new Set(), failed: new Set(['a']) }, 'a')
    expect(next.failed.has('a')).toBe(false)
  })

  test('leaves other rows and inFlight untouched', () => {
    const next = clearFailed({ inFlight: new Set(['b']), failed: new Set(['a', 'b']) }, 'a')
    expect(next.failed.has('b')).toBe(true)
    expect(next.inFlight.has('b')).toBe(true)
  })
})

describe('finishStop', () => {
  test('a successful stop clears in-flight and any failure', () => {
    const next = finishStop({ inFlight: new Set(['a']), failed: new Set(['a']) }, 'a', true)
    expect(next.inFlight.has('a')).toBe(false)
    expect(next.failed.has('a')).toBe(false)
  })

  test('a failed stop clears in-flight but records the failure', () => {
    const next = finishStop({ inFlight: new Set(['a']), failed: new Set() }, 'a', false)
    expect(next.inFlight.has('a')).toBe(false)
    expect(next.failed.has('a')).toBe(true)
  })

  test('leaves other rows untouched', () => {
    const next = finishStop({ inFlight: new Set(['a', 'b']), failed: new Set() }, 'a', false)
    expect(next.inFlight.has('b')).toBe(true)
  })
})
