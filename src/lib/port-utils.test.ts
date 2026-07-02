import { describe, expect, test } from 'bun:test'
import type { GroveConfig } from './instances-utils.ts'
import { dashboardPortFor, portsFor, urlStatus } from './port-utils.ts'

const slot = (portBase: number) => ({ portBase, cmd: [], env: {} })
const dualConfig: GroveConfig = {
  envFile: '.env.local',
  backend: slot(8080),
  frontend: slot(5173),
}
const singleConfig: GroveConfig = {
  envFile: '.env.local',
  server: slot(5173),
}

describe('portsFor — dual mode', () => {
  test('is deterministic for the same name', () => {
    expect(portsFor('feat+foo', dualConfig)).toEqual(portsFor('feat+foo', dualConfig))
  })

  test('returns kind=dual', () => {
    expect(portsFor('main', dualConfig).kind).toBe('dual')
  })

  test('be and fe share the same offset', () => {
    const ports = portsFor('feat+foo', dualConfig)
    if (ports.kind !== 'dual') throw new Error('expected dual')
    expect(ports.be - 8080).toBe(ports.fe - 5173)
  })

  test('stays within the reserved ranges (portBase + 0..99)', () => {
    for (const name of ['main', 'feat+foo', 'feat+dev-up-combined', 'x', '']) {
      const ports = portsFor(name, dualConfig)
      if (ports.kind !== 'dual') throw new Error('expected dual')
      expect(ports.be).toBeGreaterThanOrEqual(8080)
      expect(ports.be).toBeLessThanOrEqual(8179)
      expect(ports.fe).toBeGreaterThanOrEqual(5173)
      expect(ports.fe).toBeLessThanOrEqual(5272)
    }
  })

  test('honors the config portBase for each slot', () => {
    const shifted: GroveConfig = { ...dualConfig, backend: slot(9000), frontend: slot(6000) }
    const ports = portsFor('main', shifted)
    const base = portsFor('main', dualConfig)
    if (ports.kind !== 'dual' || base.kind !== 'dual') throw new Error('expected dual')
    expect(ports.be).toBe(9000 + (base.be - 8080))
    expect(ports.fe).toBe(6000 + (base.fe - 5173))
  })

  test('different names usually differ', () => {
    expect(portsFor('main', dualConfig)).not.toEqual(portsFor('feat+dev-up-combined', dualConfig))
  })
})

describe('portsFor — single mode', () => {
  test('returns kind=single with one port', () => {
    const ports = portsFor('main', singleConfig)
    expect(ports.kind).toBe('single')
  })

  test('is deterministic for the same name', () => {
    expect(portsFor('feat+foo', singleConfig)).toEqual(portsFor('feat+foo', singleConfig))
  })

  test('stays within the reserved range (portBase + 0..99)', () => {
    for (const name of ['main', 'feat+foo', 'x', '']) {
      const ports = portsFor(name, singleConfig)
      if (ports.kind !== 'single') throw new Error('expected single')
      expect(ports.port).toBeGreaterThanOrEqual(5173)
      expect(ports.port).toBeLessThanOrEqual(5272)
    }
  })

  test('uses the same hash offset as dual mode for the same name', () => {
    const dual = portsFor('main', dualConfig)
    const single = portsFor('main', singleConfig)
    if (dual.kind !== 'dual' || single.kind !== 'single') throw new Error('wrong kinds')
    // Both portBases are 5173 in these configs, so ports must be identical
    expect(single.port - 5173).toBe(dual.fe - 5173)
  })

  test('different names usually differ', () => {
    expect(portsFor('main', singleConfig)).not.toEqual(
      portsFor('feat+dev-up-combined', singleConfig),
    )
  })
})

// covers: PORT-5
describe('dashboardPortFor', () => {
  test('is deterministic for the same repo root', () => {
    expect(dashboardPortFor('/Users/mhrvatin/personal/grove')).toBe(
      dashboardPortFor('/Users/mhrvatin/personal/grove'),
    )
  })

  test('stays within [4000, 4099]', () => {
    for (const repoRoot of ['/Users/a/repo', '/Users/b/other-repo', '/x', '']) {
      const port = dashboardPortFor(repoRoot)
      expect(port).toBeGreaterThanOrEqual(4000)
      expect(port).toBeLessThanOrEqual(4099)
    }
  })

  test('different repo paths usually differ, even with the same basename', () => {
    expect(dashboardPortFor('/Users/a/grove')).not.toBe(dashboardPortFor('/Users/b/grove'))
  })
})

// covers: URL-1, URL-2
describe('urlStatus', () => {
  test('live: bare URL and exit 0', () => {
    expect(urlStatus(5269, true)).toEqual({ line: 'http://localhost:5269', code: 0 })
  })

  test('down: URL with (down) suffix and non-zero exit', () => {
    expect(urlStatus(5269, false)).toEqual({ line: 'http://localhost:5269 (down)', code: 1 })
  })
})
