import { describe, expect, test } from 'bun:test'
import { phaseFor } from './WorktreeRow'

// covers: DASH-11, DASH-21
describe('phaseFor', () => {
  test('starting takes priority over everything else', () => {
    expect(phaseFor('starting', false, true)).toEqual({ cls: 'starting', text: 'starting…' })
  })

  test('a client fast-fail reads "start failed"', () => {
    expect(phaseFor('failed', true, false)).toEqual({
      cls: 'failed',
      text: 'start failed · open launch log',
    })
  })

  test('a server-reported failure reads plain "failed"', () => {
    expect(phaseFor('failed', false, false)).toEqual({
      cls: 'failed',
      text: 'failed · open launch log',
    })
  })

  test('a stop failure on a live row reads "stop failed"', () => {
    expect(phaseFor('live', false, true)).toEqual({
      cls: 'failed',
      text: 'stop failed · try again',
    })
  })

  test('a clear failure on an orphan reads "clear failed", not the removed-notice', () => {
    expect(phaseFor('orphaned', false, true)).toEqual({
      cls: 'failed',
      text: 'clear failed · try again',
    })
  })

  test('an orphan with no stop failure keeps the removed notice', () => {
    expect(phaseFor('orphaned', false, false)).toEqual({
      cls: 'orphaned',
      text: 'worktree removed · server stopped',
    })
  })

  test('live and idle show no phase when nothing failed', () => {
    expect(phaseFor('live', false, false)).toBeNull()
    expect(phaseFor('idle', false, false)).toBeNull()
  })
})
