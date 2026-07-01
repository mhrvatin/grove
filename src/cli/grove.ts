#!/usr/bin/env bun
import { Command } from 'commander'
import pkg from '../../package.json'
import { serve, start, stop } from './dashboard.ts'
import { run as runDown } from './down.ts'
import { run as runUp } from './up.ts'
import { run as runUrl } from './url.ts'

// Internal re-launch arg used by `grove start` — pre-empt commander so it
// never appears in --help.
if (process.argv[2] === 'serve') {
  serve()
  process.exit(0)
}

const program = new Command()
program
  .name('grove')
  .description(
    'Worktree dev launcher and dashboard — launches a backend + frontend per git worktree on deterministic ports',
  )
  .version(pkg.version)

program
  .command('up [target]')
  .description('Launch backend + frontend for a worktree (default: current worktree)')
  .action(async (target = '') => runUp(target))

program
  .command('down [target]')
  .description("Stop a worktree's instances (default: current worktree)")
  .option('--all', 'Stop all running instances')
  .action((target = '', opts) => runDown(target, opts.all ?? false))

program
  .command('url [target]')
  .description(
    'Print the frontend URL for a worktree; exits non-zero if nothing is listening (default: current worktree)',
  )
  .action(async (target = '') => runUrl(target))

program
  .command('start')
  .description(
    'Start the dashboard (idempotent — no-op if already running; builds SPA on first start)',
  )
  .action(start)

program.command('stop').description('Stop the dashboard').action(stop)

program.parse()
