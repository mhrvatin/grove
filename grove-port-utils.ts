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
