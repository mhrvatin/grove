import { describe, expect, test } from 'bun:test'
import { makeInstance, resolveEnv, resolveWorktreeDir } from './instances-utils.ts'

const DIRS = [
  '/Users/me/myrepo',
  '/Users/me/myrepo/.claude/worktrees/feat+dev-up-combined',
  '/Users/me/myrepo/.claude/worktrees/fix+bar',
]

describe('resolveWorktreeDir', () => {
  test('empty target resolves to the current toplevel', () => {
    expect(resolveWorktreeDir('', DIRS, '/Users/me/myrepo/.claude/worktrees/x')).toBe(
      '/Users/me/myrepo/.claude/worktrees/x',
    )
  })

  test('matches a worktree by name fragment', () => {
    expect(resolveWorktreeDir('fix+bar', DIRS, '/cur')).toBe(
      '/Users/me/myrepo/.claude/worktrees/fix+bar',
    )
  })

  test('an absolute worktree path resolves to its own entry (first match wins)', () => {
    // The main repo path is a substring of the longer combined path, but the
    // main entry comes first in the list — mirrors `git worktree list` order.
    expect(resolveWorktreeDir('/Users/me/myrepo', DIRS, '/cur')).toBe('/Users/me/myrepo')
  })

  test('returns null when nothing matches', () => {
    expect(resolveWorktreeDir('nope', DIRS, '/cur')).toBeNull()
  })

  test('rejects injection-shaped targets as non-matches', () => {
    expect(resolveWorktreeDir('x;touch$IFS/tmp/pwned', DIRS, '/cur')).toBeNull()
    expect(resolveWorktreeDir('$(rm -rf ~)', DIRS, '/cur')).toBeNull()
    expect(resolveWorktreeDir('`id`', DIRS, '/cur')).toBeNull()
  })
})

describe('makeInstance', () => {
  test('builds the instance object with url derived from the frontend port', () => {
    const inst = makeInstance({
      name: 'feat+x',
      dir: '/repo/feat+x',
      bePort: 8085,
      fePort: 5178,
      bePid: 111,
      fePid: 222,
      beLog: '/grove/logs/feat+x-be.log',
      feLog: '/grove/logs/feat+x-fe.log',
    })
    expect(inst).toEqual({
      name: 'feat+x',
      dir: '/repo/feat+x',
      bePort: 8085,
      fePort: 5178,
      bePid: 111,
      fePid: 222,
      beLog: '/grove/logs/feat+x-be.log',
      feLog: '/grove/logs/feat+x-fe.log',
      url: 'http://localhost:5178',
    })
  })

  test('round-trips through JSON unchanged', () => {
    const inst = makeInstance({
      name: 'a',
      dir: '/repo/a',
      bePort: 8080,
      fePort: 5173,
      bePid: 0,
      fePid: 0,
      beLog: 'b',
      feLog: 'f',
    })
    expect(JSON.parse(JSON.stringify(inst))).toEqual(inst)
  })
})

describe('resolveEnv', () => {
  const ports = { be: 8085, fe: 5178 }

  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${be}/${fe} placeholder syntax under test, not template interpolation
  test('interpolates ${be} and ${fe} placeholders', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${be}/${fe} placeholder syntax under test, not template interpolation
    expect(resolveEnv({ PORT: '${be}', ORIGIN: 'http://localhost:${fe}' }, ports)).toEqual({
      PORT: '8085',
      ORIGIN: 'http://localhost:5178',
    })
  })

  test('leaves literal values untouched', () => {
    expect(resolveEnv({ NODE_ENV: 'development' }, ports)).toEqual({ NODE_ENV: 'development' })
  })

  test('replaces every occurrence within one value', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${be}/${fe} placeholder syntax under test, not template interpolation
    expect(resolveEnv({ X: '${be}-${fe}-${be}' }, ports)).toEqual({ X: '8085-5178-8085' })
  })

  test('returns an empty object for an empty env map', () => {
    expect(resolveEnv({}, ports)).toEqual({})
  })
})
