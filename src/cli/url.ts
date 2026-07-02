// Print a worktree's app URL + up/down (no arg = current worktree). The URL is
// derived statelessly from portsFor (URL-1), so it's the real location even
// when down; a port probe sets the ` (down)` suffix and exit code (URL-2). The
// one sanctioned way for an agent to find the running app without guessing ports.
// Orchestration only — git/fs/process I/O lives in lib/instances.ts, pure logic
// (the line + exit code) in lib/port-utils.ts.
import { basename } from 'node:path'
import { currentToplevel, listWorktreeDirs, loadConfig, portsInUse } from '../lib/instances.ts'
import { resolveWorktreeDir } from '../lib/instances-utils.ts'
import { portsFor, urlStatus } from '../lib/port-utils.ts'

export async function run(target: string): Promise<void> {
  const config = await loadConfig()

  const dir = resolveWorktreeDir(target, listWorktreeDirs(), currentToplevel())
  if (!dir) {
    console.error(`No worktree matching '${target}'`)
    process.exit(1)
  }

  const ports = portsFor(basename(dir), config)
  // URL-2: probe the app's single port — the server port for single mode, the
  // frontend port for dual mode. Both are the user-facing URL for the worktree.
  const appPort = ports.kind === 'single' ? ports.port : ports.fe
  const { line, code } = urlStatus(appPort, portsInUse([appPort]).length > 0)
  console.log(line)
  process.exit(code)
}
