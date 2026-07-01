// Repo-distinguishing accent for the dashboard header gradient (DASH-19). Web-side
// (no src/lib import, per the browser-bundle boundary) — same hash-to-range style
// as port-utils.ts's hashOffset, just against a hue range instead of a port span.
const HUE_SPAN = 360

export function hueFor(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) % HUE_SPAN
  }
  return ((hash % HUE_SPAN) + HUE_SPAN) % HUE_SPAN
}

// Same lightness/chroma family as the previous hardcoded gradient
// (oklch(0.97 0.02 110)), just paler and a touch more saturated so a hashed hue
// stays soft but still visibly repo-distinguishable.
export function gradientColorFor(name: string): string {
  return `oklch(0.9 0.07 ${hueFor(name)})`
}
