#!/usr/bin/env bun
// Launch FE+BE for a worktree on deterministic ports (no arg = current
// worktree). Detached + logged; manage from `just grove` or stop with `just
// grove-down`. Orchestration only — git/fs/process I/O lives in grove-instances.ts,
// pure logic in grove-instances-utils.ts, all project facts in grove.config.ts.
import { mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import {
  currentToplevel,
  ensureEnvFile,
  groveRoot,
  listWorktreeDirs,
  loadConfig,
  portsInUse,
  runPrestart,
  spawnDetached,
  waitForPort,
  writeInstance,
} from './grove-instances.ts'
import { makeInstance, resolveWorktreeDir } from './grove-instances-utils.ts'
import { portsFor } from './grove-port-utils.ts'

const config = await loadConfig()

const target = process.argv[2] ?? ''
const dir = resolveWorktreeDir(target, listWorktreeDirs(), currentToplevel())
if (!dir) {
  console.error(`No worktree matching '${target}'`)
  process.exit(1)
}
const name = basename(dir)
const root = groveRoot()
mkdirSync(join(root, 'instances'), { recursive: true })
mkdirSync(join(root, 'logs'), { recursive: true })
ensureEnvFile(dir, config.envFile)

const ports = portsFor(name, config)
const busy = portsInUse([ports.be, ports.fe])
if (busy.length > 0) {
  console.error(
    `Port ${busy[0]} already in use — is '${name}' already up? Stop it (just grove-down ${name}), or rename the branch if this is a hash collision.`,
  )
  process.exit(1)
}

const beLog = join(root, 'logs', `${name}-be.log`)
const feLog = join(root, 'logs', `${name}-fe.log`)

// ponytail: shared DB across all instances; the additive-only migration rule
// makes divergent-schema branches safe in practice. Per-worktree DB later if not.
if (config.prestart) runPrestart(dir, config.prestart)

// bun auto-loads the worktree's env file from its cwd.
spawnDetached(config.backend.cmd, { cwd: dir, env: config.backend.env(ports), logFile: beLog })
spawnDetached(config.frontend.cmd, { cwd: dir, env: config.frontend.env(ports), logFile: feLog })

const bePid = waitForPort(ports.be)
const fePid = waitForPort(ports.fe)
const inst = makeInstance({
  name,
  dir,
  bePort: ports.be,
  fePort: ports.fe,
  bePid,
  fePid,
  beLog,
  feLog,
})
writeInstance(inst)

if (bePid === 0 || fePid === 0) {
  console.error(`⚠ ${name}: a server did not bind within 30s — check logs: ${beLog} / ${feLog}`)
}
console.log(`▶ ${name} up at ${inst.url} (api :${ports.be}) — logs: ${beLog}`)
