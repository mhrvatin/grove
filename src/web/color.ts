// Repo-distinguishing accent for the dashboard header gradient (DASH-19a). Web-side
// (no src/lib import, per the browser-bundle boundary).
const HUE_SPAN = 360

// Unlike port-utils.ts's hashOffset, this reduces mod HUE_SPAN (360) instead of a
// port span in the thousands. 360's small factors (2, 3, 5) give the ×31 multiplier
// a multiplicative order of only 6 mod 360, so hashing straight into the hue range
// clusters unrelated names into a handful of near-identical hues (e.g. "logga" and
// "facit" landed 3° apart). Hashing into the full 32-bit range first and running a
// Murmur3-style avalanche finalizer before the final %HUE_SPAN fixes that.
export function hueFor(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (Math.imul(hash, 31) + name.charCodeAt(i)) | 0
  }
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x85ebca6b)
  hash ^= hash >>> 13
  return (hash >>> 0) % HUE_SPAN
}

// Same lightness/chroma family as the previous hardcoded gradient
// (oklch(0.97 0.02 110)), just paler and a touch more saturated so a hashed hue
// stays soft but still visibly repo-distinguishable.
export function gradientColorFor(name: string): string {
  return `oklch(0.9 0.07 ${hueFor(name)})`
}
