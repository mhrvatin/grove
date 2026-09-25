import { expect, test } from 'bun:test'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { listenerIsInRepo } from '../lib/instances.ts'

function consumerEnv(port: number): Record<string, string | undefined> {
  const env = { ...process.env, DASHBOARD_PORT: String(port) }
  for (const name of Bun.spawnSync(['git', 'rev-parse', '--local-env-vars'])
    .stdout.toString()
    .trim()
    .split('\n')) {
    delete env[name]
  }
  return env
}

async function waitForStatus(port: number, status: number): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/`)).status === status) return
    } catch {
      // The detached server may not have bound yet.
    }
    await Bun.sleep(50)
  }
  throw new Error(`dashboard on port ${port} did not return ${status}`)
}

async function waitForListener(port: number, repoRoot: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (listenerIsInRepo(port, repoRoot)) return
    await Bun.sleep(50)
  }
  throw new Error(`listener on port ${port} was not owned by ${repoRoot}`)
}

test('start replaces a broken dashboard launched from an old worktree', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'grove-dashboard-repair-')))
  const script = new URL('./dashboard.ts', import.meta.url).href
  const portServer = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() })
  const port = portServer.port
  portServer.stop(true)
  if (port === undefined) throw new Error('test server has no TCP port')

  const env = consumerEnv(port)
  const old = Bun.spawn(
    [
      'bun',
      '-e',
      `let metaRequests = 0;
       Bun.serve({ hostname: '127.0.0.1', port: ${port}, fetch(req) {
        if (new URL(req.url).pathname === '/api/meta') {
          if (metaRequests++ === 0) return new Response('busy', { status: 503 });
          return Response.json({ repoName: ${JSON.stringify(basename(dir))} });
        }
        return new Response('missing dist/index.html', { status: 500 })
      } })`,
    ],
    { cwd: dir, stdout: 'ignore', stderr: 'ignore' },
  )

  try {
    await waitForStatus(port, 500)
    await waitForListener(port, dir)
    const git = Bun.spawnSync(['git', 'init', '--quiet', dir], { env })
    expect(git.exitCode).toBe(0)

    const result = Bun.spawnSync(
      ['bun', '-e', `const { start } = await import(${JSON.stringify(script)}); await start()`],
      { cwd: dir, env },
    )
    if (result.stderr.length > 0) {
      const healthScript = new URL('../lib/dashboard-health.ts', import.meta.url).href
      const diagnosis = Bun.spawnSync(
        [
          'bun',
          '-e',
          `const { probeDashboard } = await import(${JSON.stringify(healthScript)});
           console.log(await probeDashboard(${port}, ${JSON.stringify(basename(dir))}, ${JSON.stringify(dir)}))`,
        ],
        { cwd: dir, env },
      )
      throw new Error(
        `${result.stderr.toString()} (subsequent probe: ${diagnosis.stdout.toString()})`,
      )
    }
    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString()).toContain(`dashboard on http://localhost:${port}`)
    await waitForStatus(port, 200)
    const meta = await fetch(`http://127.0.0.1:${port}/api/meta`)
    expect(await meta.json()).toEqual({ repoName: basename(dir), repoRoot: dir })
  } finally {
    Bun.spawnSync(
      ['bun', '-e', `const { stop } = await import(${JSON.stringify(script)}); stop()`],
      {
        cwd: dir,
        env,
      },
    )
    old.kill()
    rmSync(dir, { recursive: true, force: true })
  }
}, 10_000)

test('start leaves a broken legacy dashboard from another repo running', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'grove-dashboard-foreign-')))
  const script = new URL('./dashboard.ts', import.meta.url).href
  const portServer = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() })
  const port = portServer.port
  portServer.stop(true)
  if (port === undefined) throw new Error('test server has no TCP port')

  const foreign = Bun.spawn(
    [
      'bun',
      '-e',
      `Bun.serve({ hostname: '127.0.0.1', port: ${port}, fetch(req) {
        return new URL(req.url).pathname === '/api/meta'
          ? Response.json({ repoName: ${JSON.stringify(basename(dir))} })
          : new Response('foreign dashboard', { status: 500 })
      } })`,
    ],
    { cwd: process.cwd(), stdout: 'ignore', stderr: 'ignore' },
  )
  try {
    await waitForStatus(port, 500)
    const env = consumerEnv(port)
    expect(Bun.spawnSync(['git', 'init', '--quiet', dir], { env }).exitCode).toBe(0)
    const result = Bun.spawnSync(
      ['bun', '-e', `const { start } = await import(${JSON.stringify(script)}); await start()`],
      { cwd: dir, env },
    )
    expect(result.stderr.toString()).toContain(`port ${port} is in use`)
    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(500)
  } finally {
    foreign.kill()
    rmSync(dir, { recursive: true, force: true })
  }
})
