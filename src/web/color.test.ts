import { describe, expect, test } from 'bun:test'
import { gradientColorFor, hueFor } from './color'

// covers: DASH-19
describe('hueFor', () => {
  test('is deterministic for the same name', () => {
    expect(hueFor('grove')).toBe(hueFor('grove'))
  })

  test('stays within [0, 359]', () => {
    for (const name of ['grove', 'facit', 'x', '']) {
      const hue = hueFor(name)
      expect(hue).toBeGreaterThanOrEqual(0)
      expect(hue).toBeLessThanOrEqual(359)
    }
  })

  test('different names usually differ', () => {
    expect(hueFor('grove')).not.toBe(hueFor('facit'))
  })

  test('similar-length names spread out instead of clustering', () => {
    // Regression: the naive hash*31 % 360 hash gave 31 a multiplicative order of
    // only 6 mod 360, landing "logga" and "facit" within a few degrees of each
    // other. Hue is circular, so compare the shorter arc between the two hues.
    const d = Math.abs(hueFor('logga') - hueFor('facit'))
    const circularDistance = Math.min(d, 360 - d)
    expect(circularDistance).toBeGreaterThan(10)
  })
})

describe('gradientColorFor', () => {
  test('renders an oklch color using the hashed hue', () => {
    expect(gradientColorFor('grove')).toBe(`oklch(0.9 0.07 ${hueFor('grove')})`)
  })
})
