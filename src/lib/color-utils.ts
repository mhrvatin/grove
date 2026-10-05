// Per-repo dashboard accent color (DASH-19b), stored machine-wide in ~/.groverc
// (STATE-3). Pure: lib/instances.ts does the file I/O.

// Eight hand-picked colors: oklch(0.87 0.09 h) with hues 45° apart, so any two
// are clearly distinguishable in the pale header gradient.
export const PALETTE = [
  '#ffbdbc',
  '#fec995',
  '#ddd892',
  '#afe4b0',
  '#8ae8e1',
  '#99deff',
  '#c8ceff',
  '#f3c0f5',
] as const

export type GroveRc = { colors: Record<string, unknown> } & Record<string, unknown>

const HEX = /^#[0-9a-f]{6}$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Returns the repo's recorded color, or assigns it the least-used palette color
// (earliest on ties) so no two repos share one until there are more than eight.
// Non-hex values are ignored, since the color lands in a CSS custom property.
export function assignColor(
  rc: unknown,
  repoRoot: string,
): { color: string; rc: GroveRc; changed: boolean } {
  const base = isRecord(rc) ? rc : {}
  const raw = isRecord(base['colors']) ? base['colors'] : {}
  const colors: Record<string, string> = {}
  for (const [root, color] of Object.entries(raw)) {
    if (typeof color === 'string' && HEX.test(color)) colors[root] = color
  }
  const existing = colors[repoRoot]
  if (existing) return { color: existing, rc: { ...base, colors: raw }, changed: false }
  const used = Object.values(colors).map((c) => c.toLowerCase())
  const count = (c: string) => used.filter((u) => u === c).length
  const color = PALETTE.reduce((best, c) => (count(c) < count(best) ? c : best))
  // Other repos' entries are written back untouched, even invalid ones, so a typo
  // in a hand edit is never silently erased.
  return { color, rc: { ...base, colors: { ...raw, [repoRoot]: color } }, changed: true }
}
