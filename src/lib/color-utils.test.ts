import { describe, expect, test } from 'bun:test'
import { assignColor, PALETTE } from './color-utils.ts'

// covers: DASH-19b, STATE-3
describe('assignColor', () => {
  test('gives the first palette color to the first repo', () => {
    const result = assignColor({}, '/code/facit')
    expect(result.color).toBe(PALETTE[0])
    expect(result.rc).toEqual({ colors: { '/code/facit': PALETTE[0] } })
    expect(result.changed).toBe(true)
  })

  test('keeps a repo’s recorded color, including a hand-edited one', () => {
    const rc = { colors: { '/code/facit': '#123abc' } }
    const result = assignColor(rc, '/code/facit')
    expect(result.color).toBe('#123abc')
    expect(result.changed).toBe(false)
  })

  test('gives a new repo the least-used palette color, earliest on ties', () => {
    const rc = {
      colors: { '/a': PALETTE[0], '/b': PALETTE[0], '/c': PALETTE[1], '/d': PALETTE[2] },
    }
    expect(assignColor(rc, '/e').color).toBe(PALETTE[3])
  })

  test('no two of eight repos share a color', () => {
    let rc: unknown = {}
    const colors = new Set<string>()
    for (let i = 0; i < 8; i++) {
      const result = assignColor(rc, `/repo${i}`)
      colors.add(result.color)
      rc = result.rc
    }
    expect(colors.size).toBe(8)
  })

  test('keeps other repos and unrelated settings when adding a repo', () => {
    const rc = { editor: 'vim', colors: { '/a': PALETTE[0] } }
    expect(assignColor(rc, '/b').rc).toEqual({
      editor: 'vim',
      colors: { '/a': PALETTE[0], '/b': PALETTE[1] },
    })
  })

  test('reassigns a repo whose recorded color is not a #rrggbb hex', () => {
    const rc = { colors: { '/a': 'red; background: url(x)' } }
    const result = assignColor(rc, '/a')
    expect(result.color).toBe(PALETTE[0])
    expect(result.changed).toBe(true)
  })

  test('leaves other repos’ invalid entries in place', () => {
    const rc = { colors: { '/a': 'oops' } }
    expect(assignColor(rc, '/b').rc.colors).toEqual({ '/a': 'oops', '/b': PALETTE[0] })
  })

  test('treats a malformed file as empty', () => {
    for (const rc of [null, 'x', [], { colors: 'x' }, { colors: [] }]) {
      expect(assignColor(rc, '/a').color).toBe(PALETTE[0])
    }
  })
})
