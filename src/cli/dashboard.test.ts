import { expect, test } from 'bun:test'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

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

test('start replaces a broken dashboard launched from an old worktree', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'grove-dashboard-repair-')))
  const script = new URL('./dashboard.ts', import.meta.url).href
  const portServer = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() })
  const port = portServer.port
  portServer.stop(true)
  if (port === undefined) throw new Error('test server has no TCP port')

  const env = { ...process.env, DASHBOARD_PORT: String(port) }
  const old = Bun.spawn(
    [
      'bun',
      '-e',
      `Bun.serve({ hostname: '127.0.0.1', port: ${port}, fetch(req) {
        return new URL(req.url).pathname === '/api/meta'
          ? Response.json({ repoName: ${JSON.stringify(basename(dir))} })
          : new Response('missing dist/index.html', { status: 500 })
      } })`,
    ],
    { cwd: dir, stdout: 'ignore', stderr: 'ignore' },
  )

  try {
    await waitForStatus(port, 500)
    const git = Bun.spawnSync(['git', 'init', '--quiet', dir])
    expect(git.exitCode).toBe(0)

    const result = Bun.spawnSync(
      ['bun', '-e', `const { start } = await import(${JSON.stringify(script)}); await start()`],
      { cwd: dir, env },
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString()).toContain(`dashboard on http://localhost:${port}`)
    expect(result.stderr.toString()).toBe('')
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
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(req) {
      return new URL(req.url).pathname === '/api/meta'
        ? Response.json({ repoName: basename(dir) })
        : new Response('foreign dashboard', { status: 500 })
    },
  })
  try {
    if (server.port === undefined) throw new Error('test server has no TCP port')
    expect(Bun.spawnSync(['git', 'init', '--quiet', dir]).exitCode).toBe(0)
    const result = Bun.spawnSync(
      ['bun', '-e', `const { start } = await import(${JSON.stringify(script)}); await start()`],
      { cwd: dir, env: { ...process.env, DASHBOARD_PORT: String(server.port) } },
    )
    expect(result.stderr.toString()).toContain(`port ${server.port} is in use`)
    expect((await fetch(`http://127.0.0.1:${server.port}/`)).status).toBe(500)
  } finally {
    server.stop(true)
    rmSync(dir, { recursive: true, force: true })
  }
})
