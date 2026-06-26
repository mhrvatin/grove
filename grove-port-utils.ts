// Deterministic dev ports from a worktree name, so every worktree always maps
// to the same FE/BE URL and the dashboard can discover instances without state.
// Both slots share the same offset, so they move together. portBase per slot
// comes from grove.config.ts.
// ponytail: 1-in-100 chance two worktrees hash to the same offset; grove-up
// surfaces the resulting port-in-use error rather than silently bumping (keeps
// ports stable). Rename the branch if it ever collides.
import type { GroveConfig, Ports } from './grove-instances-utils.ts'

const SPAN = 100

export function portsFor(name: string, config: GroveConfig): Ports {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) % SPAN
  }
  const offset = ((hash % SPAN) + SPAN) % SPAN
  return { be: config.backend.portBase + offset, fe: config.frontend.portBase + offset }
}

// The grove-url output line + exit code for a frontend port (URL-2). The URL is
// always the real deterministic location (URL-1); liveness only adds a suffix and
// flips the exit code, so a caller can branch on up/down without parsing.
export function urlStatus(fePort: number, live: boolean): { line: string; code: number } {
  const url = `http://localhost:${fePort}`
  return live ? { line: url, code: 0 } : { line: `${url} (down)`, code: 1 }
}
