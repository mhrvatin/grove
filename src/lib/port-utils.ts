// Deterministic dev ports from a worktree name, so every worktree always maps
// to the same FE/BE URL and the dashboard can discover instances without state.
// Both slots share the same offset, so they move together. portBase per slot
// comes from grove.config.jsonc.
// ponytail: 1-in-100 chance two worktrees hash to the same offset; grove-up
// surfaces the resulting port-in-use error rather than silently bumping (keeps
// ports stable). Rename the branch if it ever collides.
import type { GroveConfig, Ports } from './instances-utils.ts'

const SPAN = 100
const DASHBOARD_PORT_BASE = 4000
const DASHBOARD_PORT_SPAN = 100

function hashOffset(s: string, span: number): number {
  let hash = 0
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) % span
  }
  return ((hash % span) + span) % span
}

export function portsFor(name: string, config: GroveConfig): Ports {
  const offset = hashOffset(name, SPAN)
  return { be: config.backend.portBase + offset, fe: config.frontend.portBase + offset }
}

// Deterministic dashboard port per repo (PORT-5), so concurrent repos each get
// their own dashboard instead of colliding on a static port. Hashes the repo's
// *absolute path* (not just its basename) so two differently-located repos that
// happen to share a folder name still land on different ports.
export function dashboardPortFor(repoRoot: string): number {
  return DASHBOARD_PORT_BASE + hashOffset(repoRoot, DASHBOARD_PORT_SPAN)
}

// The grove-url output line + exit code for a frontend port (URL-2). The URL is
// always the real deterministic location (URL-1); liveness only adds a suffix and
// flips the exit code, so a caller can branch on up/down without parsing.
export function urlStatus(fePort: number, live: boolean): { line: string; code: number } {
  const url = `http://localhost:${fePort}`
  return live ? { line: url, code: 0 } : { line: `${url} (down)`, code: 1 }
}
