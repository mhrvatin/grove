// Stop a worktree's instance (no arg = current worktree; `--all` = every
// instance). Orchestration only — the kill/fs/git I/O lives in lib/instances.ts.
import { basename } from 'node:path'
import { instancePids, instancePorts } from '../lib/dashboard-utils.ts'
import {
  currentToplevel,
  killByPortAndPids,
  readInstance,
  readInstances,
  removeInstance,
} from '../lib/instances.ts'

function stopWorktree(name: string): void {
  const inst = readInstance(name)
  if (!inst) {
    console.log(`not running: ${name}`)
    return
  }
  killByPortAndPids(instancePorts(inst), instancePids(inst))
  removeInstance(name)
  console.log(`■ stopped ${name}`)
}

export function run(target: string, all: boolean): void {
  if (all) {
    for (const inst of readInstances()) stopWorktree(inst.name)
  } else {
    stopWorktree(target || basename(currentToplevel()))
  }
}
