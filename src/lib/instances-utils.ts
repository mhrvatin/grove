// Pure logic + shared types for grove (the worktree dev launcher + dashboard):
// the project-config shape, the worktree resolver, and the instance-record
// builder. No I/O — all git/fs/process calls live in lib/instances.ts. The
// Instance type is the on-disk shape of a .grove/instances/<name>.json file.

// Resolved ports for a worktree's two slots.
export type Ports = { be: number; fe: number }

// One service slot (backend or frontend). `env` is static data loaded from
// grove.config.jsonc; values may contain ${be}/${fe} placeholders that resolveEnv
// interpolates against the slot's resolved ports — that placeholder is how a
// slot's env references the other slot's port (the FE proxies /api to the BE
// port), which plain JSON can't express with a function.
export type GroveSlot = {
  portBase: number
  cmd: string[]
  env: Record<string, string>
}

// The single source of project-specific truth, loaded canonically from the main
// repo's grove.config.jsonc. grove's whole domain is "a backend + a frontend per
// worktree" — two fixed slots, not an arbitrary service list.
export type GroveConfig = {
  envFile: string // symlinked into a worktree if missing
  prestart?: string[] // run once before launch (e.g. ['just', 'migrate']); omit to skip
  backend: GroveSlot
  frontend: GroveSlot
}

export type Instance = {
  name: string
  dir: string
  url: string
  bePort: number
  fePort: number
  bePid: number
  fePid: number
  beLog: string
  feLog: string
}

// Resolve a grove-up/grove-down target to a worktree directory, given the already
// listed worktree dirs and the current toplevel. Empty target = current worktree;
// otherwise the first listed dir containing the target as a substring (so a name
// fragment or an absolute path both match). Returns null when nothing matches —
// injection-shaped strings are never substrings of a real worktree path, so they
// resolve to null.
// ponytail: no fs-based subdir resolution; pass a worktree root or name fragment.
// Restore an fs branch only if subdir targets ever become a need.
export function resolveWorktreeDir(
  target: string,
  worktreeDirs: string[],
  currentToplevel: string,
): string | null {
  if (target === '') return currentToplevel
  return worktreeDirs.find((d) => d.includes(target)) ?? null
}

// Build the instance record written to .grove/instances/<name>.json. url is
// derived from the frontend port; everything else is passed in.
export function makeInstance(parts: Omit<Instance, 'url'>): Instance {
  return { ...parts, url: `http://localhost:${parts.fePort}` }
}

// Interpolate ${be}/${fe} placeholders in a slot's env map against its resolved
// ports. env is static data from grove.config.jsonc, so a value like
// "http://localhost:${fe}" becomes "http://localhost:5173". Anything that isn't
// a ${be}/${fe} placeholder is left untouched.
export function resolveEnv(env: Record<string, string>, ports: Ports): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    out[key] = value.replace(/\$\{(be|fe)\}/g, (_match, slot: 'be' | 'fe') => String(ports[slot]))
  }
  return out
}
