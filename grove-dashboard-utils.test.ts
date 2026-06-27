import { describe, expect, test } from 'bun:test'
import {
  buildRows,
  dashboardActionError,
  fillPageTemplate,
  formatPinoLog,
  groveSummary,
  instanceLogSections,
  isActionableName,
  isAllowedName,
  isSameOrigin,
  orphanInstances,
  prunedReaped,
  reapTargets,
  rowStatus,
} from './grove-dashboard-utils.ts'
import type { GroveConfig } from './grove-instances-utils.ts'
import { portsFor } from './grove-port-utils.ts'

const config: GroveConfig = {
  envFile: '.env.local',
  backend: { portBase: 8080, cmd: [], env: () => ({}) },
  frontend: { portBase: 5173, cmd: [], env: () => ({}) },
}

const inst = (name: string) => ({
  name,
  dir: `/repo/${name}`,
  bePort: 9999,
  fePort: 8888,
  bePid: 1,
  fePid: 2,
  beLog: 'b',
  feLog: 'f',
  url: 'http://localhost:8888',
})

describe('buildRows', () => {
  test('marks worktrees with an instance file as running', () => {
    const rows = buildRows(['/repo/main', '/repo/feat+x'], [inst('feat+x')], config)
    expect(rows.find((r) => r.name === 'feat+x')?.running).toBe(true)
    expect(rows.find((r) => r.name === 'main')?.running).toBe(false)
  })

  test('derives ports from the name + config when not running', () => {
    const rows = buildRows(['/repo/main'], [], config)
    const { be, fe } = portsFor('main', config)
    expect(rows[0]).toMatchObject({ running: false, bePort: be, fePort: fe })
  })

  test('uses instance ports/url when running', () => {
    const rows = buildRows(['/repo/feat+x'], [inst('feat+x')], config)
    expect(rows[0]).toMatchObject({ bePort: 9999, fePort: 8888, url: 'http://localhost:8888' })
  })

  test('one row per worktree', () => {
    expect(buildRows(['/repo/a', '/repo/b'], [inst('a')], config)).toHaveLength(2)
  })

  test('appends an orphan row for an instance whose worktree is gone (DASH-15)', () => {
    const rows = buildRows(['/repo/main'], [inst('gone')], config)
    expect(rows.find((r) => r.name === 'main')?.orphaned).toBe(false)
    const orphan = rows.find((r) => r.name === 'gone')
    expect(orphan).toMatchObject({ orphaned: true, running: false, url: 'http://localhost:8888' })
  })
})

describe('orphanInstances', () => {
  test('returns instances with no matching worktree basename (DASH-15)', () => {
    const result = orphanInstances(['/repo/main', '/repo/keep'], [inst('keep'), inst('gone')])
    expect(result.map((i) => i.name)).toEqual(['gone'])
  })

  test('empty when every instance maps to a worktree', () => {
    expect(orphanInstances(['/repo/a'], [inst('a')])).toEqual([])
  })
})

// covers: DASH-16
describe('reaper state (reapTargets / prunedReaped)', () => {
  test('reapTargets returns only orphans not already reaped', () => {
    const reaped = new Set(['a'])
    expect(reapTargets(reaped, [inst('a'), inst('b')]).map((o) => o.name)).toEqual(['b'])
  })

  test('prunedReaped keeps only names that are still orphans', () => {
    const reaped = new Set(['gone', 'recreated'])
    // 'recreated' is no longer an orphan (its worktree came back) → evicted.
    expect([...prunedReaped(reaped, [inst('gone')])]).toEqual(['gone'])
  })

  test('a remove→recreate→remove worktree reaps fresh on each removal episode', () => {
    let reaped = new Set<string>()
    // 1. removed → orphan, not yet reaped → reap target, then mark reaped
    expect(reapTargets(reaped, [inst('w')]).map((o) => o.name)).toEqual(['w'])
    reaped.add('w')
    reaped = prunedReaped(reaped, [inst('w')])
    // steady tombstone: reaped at most once while it stays an orphan
    expect(reapTargets(reaped, [inst('w')])).toEqual([])
    // 2. recreated → no longer an orphan → name evicted
    reaped = prunedReaped(reaped, [])
    expect([...reaped]).toEqual([])
    // 3. removed again → orphan again → reaps fresh
    expect(reapTargets(reaped, [inst('w')]).map((o) => o.name)).toEqual(['w'])
  })
})

describe('groveSummary', () => {
  test('counts running instances and total worktrees', () => {
    const rows = buildRows(['/repo/a', '/repo/b', '/repo/c'], [inst('a'), inst('c')], config)
    expect(groveSummary(rows)).toEqual({ running: 2, total: 3 })
  })

  test('zero of both for no worktrees', () => {
    expect(groveSummary([])).toEqual({ running: 0, total: 0 })
  })

  test('excludes orphan tombstones from running and total (DASH-15)', () => {
    const rows = buildRows(['/repo/a', '/repo/b'], [inst('a'), inst('gone')], config)
    expect(groveSummary(rows)).toEqual({ running: 1, total: 2 })
  })
})

describe('isAllowedName', () => {
  const dirs = ['/repo/main', '/repo/feat+x']

  test('accepts an actual worktree basename', () => {
    expect(isAllowedName('feat+x', dirs)).toBe(true)
    expect(isAllowedName('main', dirs)).toBe(true)
  })

  test('rejects names that are not worktrees', () => {
    expect(isAllowedName('feat+y', dirs)).toBe(false)
    expect(isAllowedName('', dirs)).toBe(false)
  })

  test('rejects shell-injection payloads (closes the just/recipe interpolation)', () => {
    expect(isAllowedName('x;touch$IFS/tmp/pwned', dirs)).toBe(false)
    expect(isAllowedName('$(rm -rf ~)', dirs)).toBe(false)
    expect(isAllowedName('`id`', dirs)).toBe(false)
  })
})

describe('instanceLogSections', () => {
  test('returns keyed launch/BE/FE sections in order with paths from logsDir/name', () => {
    const sections = instanceLogSections('/repo/.grove/logs', 'feat+x')
    expect(sections.map((s) => s.key)).toEqual(['up', 'be', 'fe'])
    expect(sections.map((s) => s.header)).toEqual(['launch (just grove-up)', 'BE', 'FE'])
    expect(sections.map((s) => s.path)).toEqual([
      '/repo/.grove/logs/feat+x-up.log',
      '/repo/.grove/logs/feat+x-be.log',
      '/repo/.grove/logs/feat+x-fe.log',
    ])
  })
})

describe('formatPinoLog', () => {
  test('renders a pino JSON line with a local timestamp, level name, msg and extras', () => {
    const at = new Date(2026, 0, 2, 3, 4, 5, 678).getTime()
    const line = JSON.stringify({ level: 30, time: at, msg: 'server_starting', port: 8159 })
    expect(formatPinoLog(line)).toBe('03:04:05.678 INFO server_starting port=8159')
  })

  test('maps level numbers to names', () => {
    const at = new Date(2026, 0, 1, 0, 0, 0, 0).getTime()
    const line = JSON.stringify({ level: 50, time: at, msg: 'boom' })
    expect(formatPinoLog(line)).toBe('00:00:00.000 ERROR boom')
  })

  test('passes non-JSON lines through untouched', () => {
    expect(formatPinoLog('VITE v6.4.2 ready')).toBe('VITE v6.4.2 ready')
    expect(formatPinoLog('{not json')).toBe('{not json')
  })

  test('leaves JSON without time/level alone', () => {
    expect(formatPinoLog('{"foo":1}')).toBe('{"foo":1}')
  })
})

describe('rowStatus', () => {
  test('running instance with a live probe is live', () => {
    expect(rowStatus(true, true)).toBe('live')
  })

  test('instance file present but a dead probe is failed (UP-6 pid-0 bind / crash)', () => {
    expect(rowStatus(true, false)).toBe('failed')
  })

  test('no instance file is idle, regardless of probe', () => {
    expect(rowStatus(false, false)).toBe('idle')
    expect(rowStatus(false, true)).toBe('idle')
  })

  test('an orphaned row is orphaned regardless of running/live (DASH-15)', () => {
    expect(rowStatus(false, false, true)).toBe('orphaned')
    expect(rowStatus(true, true, true)).toBe('orphaned')
  })
})

describe('isActionableName', () => {
  const dirs = ['/repo/main', '/repo/feat+x']
  const instances = [inst('feat+x'), inst('gone')]

  test('accepts an actual worktree basename', () => {
    expect(isActionableName('main', dirs, instances)).toBe(true)
  })

  test('accepts an instance name whose worktree is gone (clears an orphan — SEC-3a)', () => {
    expect(isActionableName('gone', dirs, instances)).toBe(true)
  })

  test('rejects a name that is neither a worktree nor an instance', () => {
    expect(isActionableName('nope', dirs, instances)).toBe(false)
    expect(isActionableName('', dirs, instances)).toBe(false)
  })

  test('rejects shell-injection payloads', () => {
    expect(isActionableName('$(rm -rf ~)', dirs, instances)).toBe(false)
  })
})

// covers: DASH-17
describe('fillPageTemplate', () => {
  const tpl =
    '<i id=stat-running>{{running}}</i><i id=stat-total>{{total}}</i><tbody>{{rows}}</tbody>'

  test('fills the running/total/rows placeholders', () => {
    expect(fillPageTemplate(tpl, '<tr></tr>', { running: 2, total: 5 })).toBe(
      '<i id=stat-running>2</i><i id=stat-total>5</i><tbody><tr></tr></tbody>',
    )
  })

  test('inserts row markup verbatim — $& and $1 are not read as replace patterns', () => {
    const rows = '<tr data-wt="a$&b$1c$`d"></tr>'
    expect(fillPageTemplate(tpl, rows, { running: 0, total: 0 })).toContain('a$&b$1c$`d')
  })
})

// covers: DASH-1a
describe('dashboardActionError', () => {
  test('unwraps an Error message into a labelled line', () => {
    expect(dashboardActionError('start', new Error('EADDRINUSE'))).toBe(
      'grove dashboard start failed: EADDRINUSE',
    )
  })

  test('stringifies a non-Error throw', () => {
    expect(dashboardActionError('stop', 'boom')).toBe('grove dashboard stop failed: boom')
  })
})

describe('isSameOrigin', () => {
  test('accepts a matching dashboard origin', () => {
    expect(isSameOrigin('http://localhost:4000', 4000)).toBe(true)
  })

  test('rejects a cross-site origin (blocks CSRF)', () => {
    expect(isSameOrigin('http://evil.example', 4000)).toBe(false)
    expect(isSameOrigin('http://localhost:5203', 4000)).toBe(false)
  })

  test('allows a missing origin (non-browser client, not a CSRF vector)', () => {
    expect(isSameOrigin(null, 4000)).toBe(true)
  })
})
