// Pure logic + shared types for grove (the worktree dev launcher + dashboard):
// the project-config shape, the worktree resolver, and the instance-record
// builder. No I/O — all git/fs/process calls live in grove-instances.ts. The
// Instance type is the on-disk shape of a .grove/instances/<name>.json file.

// Resolved ports for a worktree's two slots.
export type Ports = { be: number; fe: number }

// One service slot (backend or frontend). `env` is a function because env values
// cross-reference the other slot's port (the FE proxies /api to the BE port),
// which a static map can't express.
export type GroveSlot = {
  portBase: number
  cmd: string[]
  env: (ports: Ports) => Record<string, string>
}

// The single source of project-specific truth, loaded canonically from the main
// repo's grove.config.ts. grove's whole domain is "a backend + a frontend per
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
