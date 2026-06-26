import { describe, expect, test } from 'bun:test'
import type { GroveConfig } from './grove-instances-utils.ts'
import { portsFor, urlStatus } from './grove-port-utils.ts'

const slot = (portBase: number) => ({ portBase, cmd: [], env: () => ({}) })
const config: GroveConfig = {
  envFile: '.env.local',
  backend: slot(8080),
  frontend: slot(5173),
}

describe('portsFor', () => {
  test('is deterministic for the same name', () => {
    expect(portsFor('feat+foo', config)).toEqual(portsFor('feat+foo', config))
  })

  test('be and fe share the same offset', () => {
    const { be, fe } = portsFor('feat+foo', config)
    expect(be - 8080).toBe(fe - 5173)
  })

  test('stays within the reserved ranges (portBase + 0..99)', () => {
    for (const name of ['main', 'feat+foo', 'feat+dev-up-combined', 'x', '']) {
      const { be, fe } = portsFor(name, config)
      expect(be).toBeGreaterThanOrEqual(8080)
      expect(be).toBeLessThanOrEqual(8179)
      expect(fe).toBeGreaterThanOrEqual(5173)
      expect(fe).toBeLessThanOrEqual(5272)
    }
  })

  test('honors the config portBase for each slot', () => {
    const shifted: GroveConfig = { ...config, backend: slot(9000), frontend: slot(6000) }
    const { be, fe } = portsFor('main', shifted)
    const base = portsFor('main', config)
    expect(be).toBe(9000 + (base.be - 8080))
    expect(fe).toBe(6000 + (base.fe - 5173))
  })

  test('different names usually differ', () => {
    expect(portsFor('main', config)).not.toEqual(portsFor('feat+dev-up-combined', config))
  })
})

// covers: URL-1, URL-2
describe('urlStatus', () => {
  // live → bare URL, exit 0
  test('live: bare URL and exit 0', () => {
    expect(urlStatus(5269, true)).toEqual({ line: 'http://localhost:5269', code: 0 })
  })

  // down → URL with ` (down)` suffix, exit non-zero. The URL is still the
  // real deterministic location (URL-1), useful even when nothing is listening.
  test('down: URL with (down) suffix and non-zero exit', () => {
    expect(urlStatus(5269, false)).toEqual({ line: 'http://localhost:5269 (down)', code: 1 })
  })
})
