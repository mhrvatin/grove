import { describe, expect, test } from 'bun:test'
import { legendFor } from './StatusDot'

// covers: DASH-24
describe('legendFor', () => {
  test('names every effective status in plain text', () => {
    expect(legendFor('live')).toBe('live')
    expect(legendFor('idle')).toBe('idle')
    expect(legendFor('starting')).toBe('starting…')
    expect(legendFor('failed')).toBe('failed')
    expect(legendFor('orphaned')).toBe('worktree removed')
  })
})
