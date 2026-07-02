// Pure logic + shared types for grove (the worktree dev launcher + dashboard):
// the project-config shape, the worktree resolver, and the instance-record
// builder. No I/O — all git/fs/process calls live in lib/instances.ts. The
// Instance type is the on-disk shape of a .grove/instances/<name>.json file.

// One service slot (backend, frontend, or single-process server).
// `env` is static data from grove.config.jsonc; values may contain ${be}/${fe}
// (dual mode) or ${port} (single mode) placeholders that resolveEnv interpolates.
export type GroveSlot = {
  portBase: number
  cmd: string[]
  env: Record<string, string>
}

// Two-slot project: a separate backend and frontend process per worktree.
export type DualConfig = {
  envFile: string
  prestart?: string[]
  backend: GroveSlot
  frontend: GroveSlot
}

// Single-process project (SvelteKit, Next.js, Remix, Nuxt, etc.): one dev
// server handles both the API and the UI. Use `server` instead of
// `backend`+`frontend`. The `${port}` env placeholder resolves to the server's
// assigned port (analogous to `${be}`/`${fe}` in dual mode).
export type SingleConfig = {
  envFile: string
  prestart?: string[]
  server: GroveSlot
}

export type GroveConfig = DualConfig | SingleConfig

export function isSingleConfig(c: GroveConfig): c is SingleConfig {
  return 'server' in c
}

// Resolved ports for a worktree — one per process. The `kind` discriminant lets
// callers narrow without an extra boolean.
export type DualPorts = { kind: 'dual'; be: number; fe: number }
export type SinglePorts = { kind: 'single'; port: number }
export type Ports = DualPorts | SinglePorts

// On-disk .grove/instances/<name>.json — two variants, one per mode.
export type DualInstance = {
  kind: 'dual'
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

export type SingleInstance = {
  kind: 'single'
  name: string
  dir: string
  url: string
  port: number
  pid: number
  log: string
}

export type Instance = DualInstance | SingleInstance

// Build the instance record for a dual (BE+FE) worktree.
export function makeDualInstance(parts: Omit<DualInstance, 'kind' | 'url'>): DualInstance {
  return { kind: 'dual', ...parts, url: `http://localhost:${parts.fePort}` }
}

// Build the instance record for a single-process worktree.
export function makeSingleInstance(parts: Omit<SingleInstance, 'kind' | 'url'>): SingleInstance {
  return { kind: 'single', ...parts, url: `http://localhost:${parts.port}` }
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

// Interpolate env placeholders against resolved ports.
// Dual mode: ${be} and ${fe} → the backend/frontend port numbers.
// Single mode: ${port} → the server port number.
export function resolveEnv(env: Record<string, string>, ports: Ports): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (ports.kind === 'dual') {
      const { be, fe } = ports
      out[key] = value.replace(/\$\{(be|fe)\}/g, (_match, slot: 'be' | 'fe') =>
        String(slot === 'be' ? be : fe),
      )
    } else {
      out[key] = value.replace(/\$\{port\}/g, String(ports.port))
    }
  }
  return out
}
