import { describe, expect, test } from 'bun:test'
import {
  apiRow,
  buildRows,
  dashboardActionError,
  formatPinoLog,
  instanceLogSections,
  instancePids,
  instancePorts,
  isActionableName,
  isAllowedName,
  isSameOrigin,
  orphanInstances,
  probePort,
  prunedReaped,
  reapTargets,
  rowStatus,
} from './dashboard-utils.ts'
import type { GroveConfig } from './instances-utils.ts'
import { portsFor } from './port-utils.ts'

const dualConfig: GroveConfig = {
  envFile: '.env.local',
  backend: { portBase: 8080, cmd: [], env: {} },
  frontend: { portBase: 5173, cmd: [], env: {} },
}

const singleConfig: GroveConfig = {
  envFile: '.env.local',
  server: { portBase: 5173, cmd: [], env: {} },
}

// A dual instance fixture (pre-single-slot feature: kind defaults to 'dual').
const inst = (name: string) => ({
  kind: 'dual' as const,
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

const singleInst = (name: string) => ({
  kind: 'single' as const,
  name,
  dir: `/repo/${name}`,
  port: 5200,
  pid: 1,
  log: 's',
  url: 'http://localhost:5200',
})

describe('buildRows — dual config', () => {
  test('marks worktrees with an instance file as running', () => {
    const rows = buildRows(['/repo/main', '/repo/feat+x'], [inst('feat+x')], dualConfig)
    expect(rows.find((r) => r.name === 'feat+x')?.running).toBe(true)
    expect(rows.find((r) => r.name === 'main')?.running).toBe(false)
  })

  test('derives ports from the name + config when not running', () => {
    const rows = buildRows(['/repo/main'], [], dualConfig)
    const ports = portsFor('main', dualConfig)
    if (ports.kind !== 'dual') throw new Error('expected dual')
    expect(rows[0]).toMatchObject({
      kind: 'dual',
      running: false,
      bePort: ports.be,
      fePort: ports.fe,
    })
  })

  test('uses instance ports/url when running', () => {
    const rows = buildRows(['/repo/feat+x'], [inst('feat+x')], dualConfig)
    expect(rows[0]).toMatchObject({ bePort: 9999, fePort: 8888, url: 'http://localhost:8888' })
  })

  test('one row per worktree', () => {
    expect(buildRows(['/repo/a', '/repo/b'], [inst('a')], dualConfig)).toHaveLength(2)
  })

  test('appends an orphan row for an instance whose worktree is gone (DASH-15)', () => {
    const rows = buildRows(['/repo/main'], [inst('gone')], dualConfig)
    expect(rows.find((r) => r.name === 'main')?.orphaned).toBe(false)
    const orphan = rows.find((r) => r.name === 'gone')
    expect(orphan).toMatchObject({ orphaned: true, running: false, url: 'http://localhost:8888' })
  })
})

describe('buildRows — single config', () => {
  test('derives a single port from config for an idle worktree', () => {
    const rows = buildRows(['/repo/main'], [], singleConfig)
    const ports = portsFor('main', singleConfig)
    if (ports.kind !== 'single') throw new Error('expected single')
    expect(rows[0]).toMatchObject({ kind: 'single', running: false, port: ports.port })
  })

  test('uses instance port/url when running', () => {
    const rows = buildRows(['/repo/feat+sk'], [singleInst('feat+sk')], singleConfig)
    expect(rows[0]).toMatchObject({ kind: 'single', port: 5200, url: 'http://localhost:5200' })
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
    expect([...prunedReaped(reaped, [inst('gone')])]).toEqual(['gone'])
  })

  test('a remove→recreate→remove worktree reaps fresh on each removal episode', () => {
    let reaped = new Set<string>()
    expect(reapTargets(reaped, [inst('w')]).map((o) => o.name)).toEqual(['w'])
    reaped.add('w')
    reaped = prunedReaped(reaped, [inst('w')])
    expect(reapTargets(reaped, [inst('w')])).toEqual([])
    reaped = prunedReaped(reaped, [])
    expect([...reaped]).toEqual([])
    expect(reapTargets(reaped, [inst('w')]).map((o) => o.name)).toEqual(['w'])
  })
})

describe('instancePorts / instancePids', () => {
  test('dual: returns both be and fe ports/pids', () => {
    expect(instancePorts(inst('a'))).toEqual([9999, 8888])
    expect(instancePids(inst('a'))).toEqual([1, 2])
  })

  test('single: returns the one server port/pid', () => {
    expect(instancePorts(singleInst('a'))).toEqual([5200])
    expect(instancePids(singleInst('a'))).toEqual([1])
  })
})

describe('probePort', () => {
  test('dual: probes the frontend port', () => {
    expect(
      probePort({
        kind: 'dual',
        name: 'a',
        dir: '/r/a',
        url: 'u',
        bePort: 8080,
        fePort: 5173,
        running: false,
        orphaned: false,
      }),
    ).toBe(5173)
  })

  test('single: probes the server port', () => {
    expect(
      probePort({
        kind: 'single',
        name: 'a',
        dir: '/r/a',
        url: 'u',
        port: 5200,
        running: false,
        orphaned: false,
      }),
    ).toBe(5200)
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
  test('dual mode (default): returns launch/BE/FE sections in order', () => {
    const sections = instanceLogSections('/repo/.grove/logs', 'feat+x')
    expect(sections.map((s) => s.key)).toEqual(['up', 'be', 'fe'])
    expect(sections.map((s) => s.header)).toEqual(['launch (grove up)', 'BE', 'FE'])
    expect(sections.map((s) => s.path)).toEqual([
      '/repo/.grove/logs/feat+x-up.log',
      '/repo/.grove/logs/feat+x-be.log',
      '/repo/.grove/logs/feat+x-fe.log',
    ])
  })

  test('single mode: returns launch/server sections in order', () => {
    const sections = instanceLogSections('/repo/.grove/logs', 'feat+sk', 'single')
    expect(sections.map((s) => s.key)).toEqual(['up', 'server'])
    expect(sections.map((s) => s.header)).toEqual(['launch (grove up)', 'server'])
    expect(sections.map((s) => s.path)).toEqual([
      '/repo/.grove/logs/feat+sk-up.log',
      '/repo/.grove/logs/feat+sk-server.log',
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

// covers: DASH-12
describe('apiRow — dual', () => {
  const base = {
    kind: 'dual' as const,
    name: 'feat+x',
    dir: '/repo/feat+x',
    url: 'http://localhost:8888',
    bePort: 9999,
    fePort: 8888,
  }

  test('maps a dual row to the API DTO with mode and status from the live probe', () => {
    expect(apiRow({ ...base, running: true, orphaned: false }, true)).toEqual({
      name: 'feat+x',
      url: 'http://localhost:8888',
      mode: 'dual',
      bePort: 9999,
      fePort: 8888,
      status: 'live',
      orphaned: false,
    })
  })

  test('a running row with a dead probe is failed', () => {
    expect(apiRow({ ...base, running: true, orphaned: false }, false).status).toBe('failed')
  })

  test('a non-running row is idle regardless of the probe', () => {
    expect(apiRow({ ...base, running: false, orphaned: false }, false).status).toBe('idle')
  })

  test('an orphan row is orphaned', () => {
    expect(apiRow({ ...base, running: false, orphaned: true }, false).status).toBe('orphaned')
  })
})

describe('apiRow — single', () => {
  const base = {
    kind: 'single' as const,
    name: 'feat+sk',
    dir: '/repo/feat+sk',
    url: 'http://localhost:5200',
    port: 5200,
  }

  test('maps a single row to the API DTO with mode=single and one port field', () => {
    expect(apiRow({ ...base, running: true, orphaned: false }, true)).toEqual({
      name: 'feat+sk',
      url: 'http://localhost:5200',
      mode: 'single',
      port: 5200,
      status: 'live',
      orphaned: false,
    })
  })

  test('does not include bePort/fePort', () => {
    const row = apiRow({ ...base, running: true, orphaned: false }, true)
    expect('bePort' in row).toBe(false)
    expect('fePort' in row).toBe(false)
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
