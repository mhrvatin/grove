#!/usr/bin/env bun
import { Command } from 'commander'
import pkg from '../../package.json'
import { serve, start, stop } from './dashboard.ts'
import { run as runDown } from './down.ts'
import { serveHub, startHub, stopHub } from './hub.ts'
import { run as runUp } from './up.ts'
import { run as runUrl } from './url.ts'

// Internal re-launch args used by `grove start` (`serve`) and `grove hub start`
// (`serve-hub`) — pre-empt commander so they never appear in --help. Must NOT
// process.exit after either: Bun.serve's listener is what keeps this detached
// process alive, so exiting here would tear the server down the instant it starts.
if (process.argv[2] === 'serve') {
  serve()
} else if (process.argv[2] === 'serve-hub') {
  serveHub()
} else {
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
    .description('Start the dashboard and the hub (idempotent — no-op if already running)')
    .action(async () => {
      await start()
      // Ensure the hub on every start (DASH-1d), even when the dashboard was
      // already running, so one `grove start` always makes the hub URL work.
      await startHub()
    })

  program.command('stop').description('Stop the dashboard').action(stop)

  const hub = program
    .command('hub')
    .description('Manage the hub that lists every running grove dashboard on one fixed port')
  hub.command('start').description('Start the hub (idempotent)').action(startHub)
  hub.command('stop').description('Stop the hub').action(stopHub)

  program.parse()
}
