import { describe, expect, test } from 'bun:test'
import { BACKSTOP_MS, reconcile } from './reconcile'
import type { ApiRow, RowStatus } from './types'

const row = (name: string, status: RowStatus): ApiRow => ({
  name,
  url: '',
  bePort: 0,
  fePort: 0,
  status,
  orphaned: status === 'orphaned',
})
const state = (pending: [string, number][] = [], failed: string[] = []) => ({
  pending: new Map(pending),
  failed: new Set(failed),
})

// covers: DASH-11
describe('reconcile', () => {
  test('clears a pending row once the server reports it live', () => {
    const next = reconcile(state([['a', 0]]), [row('a', 'live')], 1000)
    expect(next.pending.has('a')).toBe(false)
    expect(next.failed.has('a')).toBe(false)
  })

  test('a pending row past the backstop becomes a client fast-fail', () => {
    const next = reconcile(state([['a', 0]]), [row('a', 'idle')], BACKSTOP_MS + 1)
    expect(next.pending.has('a')).toBe(false)
    expect(next.failed.has('a')).toBe(true)
  })

  test('a still-idle pending row within the backstop stays pending', () => {
    const next = reconcile(state([['a', 0]]), [row('a', 'idle')], BACKSTOP_MS - 1)
    expect(next.pending.has('a')).toBe(true)
    expect(next.failed.has('a')).toBe(false)
  })

  test('a server-failed pending row clears pending without becoming a client fail', () => {
    // server already paints it failed (DASH-12) via row.status, so no failed entry
    const next = reconcile(state([['a', 0]]), [row('a', 'failed')], 1000)
    expect(next.pending.has('a')).toBe(false)
    expect(next.failed.has('a')).toBe(false)
  })

  test('a client-failed row clears once a slow-but-legit start finally goes live', () => {
    const next = reconcile(state([], ['a']), [row('a', 'live')], 1000)
    expect(next.failed.has('a')).toBe(false)
  })

  test('a vanished worktree clears it from both pending and failed', () => {
    const next = reconcile(state([['a', 0]], ['b']), [], 1000)
    expect(next.pending.has('a')).toBe(false)
    expect(next.failed.has('b')).toBe(false)
  })
})
