import { describe, expect, test } from 'bun:test'
import {
  buildRows,
  formatPinoLog,
  instanceLogSections,
  isAllowedName,
  isSameOrigin,
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
})

describe('rowStatus', () => {
  test('a live port is running', () => {
    expect(rowStatus(true, true)).toBe('live')
  })

  test('an instance file with a dead port is a failed start (grove-up wrote the record then the port never bound)', () => {
    expect(rowStatus(true, false)).toBe('failed')
  })

  test('no instance file is stopped', () => {
    expect(rowStatus(false, false)).toBe('stopped')
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
