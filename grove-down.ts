#!/usr/bin/env bun
// Stop a worktree's instance (no arg = current worktree; `--all` = every
// instance). Orchestration only — the kill/fs/git I/O lives in grove-instances.ts.
import { basename } from 'node:path'
import {
  currentToplevel,
  killByPortAndPids,
  readInstance,
  readInstances,
  removeInstance,
} from './grove-instances.ts'

function stop(name: string): void {
  const inst = readInstance(name)
  if (!inst) {
    console.log(`not running: ${name}`)
    return
  }
  killByPortAndPids([inst.bePort, inst.fePort], [inst.bePid, inst.fePid])
  removeInstance(name)
  console.log(`■ stopped ${name}`)
}

const target = process.argv[2] ?? ''
if (target === '--all') {
  for (const inst of readInstances()) stop(inst.name)
} else {
  stop(target || basename(currentToplevel()))
}
