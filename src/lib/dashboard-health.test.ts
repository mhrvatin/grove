import { describe, expect, test } from 'bun:test'
import { probeDashboard } from './dashboard-health.ts'

function boundPort(server: { port: number | undefined }): number {
  if (server.port === undefined) throw new Error('test server has no TCP port')
  return server.port
}

describe('probeDashboard', () => {
  test('recognizes a broken dashboard from a legacy Grove installation', async () => {
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(req) {
        return new URL(req.url).pathname === '/api/meta'
          ? Response.json({ repoName: 'logga' })
          : new Response('missing dashboard files', { status: 500 })
      },
    })
    try {
      expect(await probeDashboard(boundPort(server), 'logga', process.cwd())).toBe('broken')
    } finally {
      server.stop(true)
    }
  })

  test('keeps a healthy dashboard for the same repository', async () => {
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(req) {
        return new URL(req.url).pathname === '/api/meta'
          ? Response.json({ repoName: 'logga', repoRoot: '/repos/logga' })
          : new Response('<h1>Grove</h1>')
      },
    })
    try {
      expect(await probeDashboard(boundPort(server), 'logga', '/repos/logga')).toBe('healthy')
    } finally {
      server.stop(true)
    }
  })

  test('does not claim a different repository on a colliding port', async () => {
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch() {
        return Response.json({ repoName: 'logga', repoRoot: '/repos/other-logga' })
      },
    })
    try {
      expect(await probeDashboard(boundPort(server), 'logga', '/repos/logga')).toBe('foreign')
    } finally {
      server.stop(true)
    }
  })

  test('does not replace a broken legacy dashboard from another repo with the same name', async () => {
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(req) {
        return new URL(req.url).pathname === '/api/meta'
          ? Response.json({ repoName: 'logga' })
          : new Response('missing dashboard files', { status: 500 })
      },
    })
    try {
      expect(await probeDashboard(boundPort(server), 'logga', '/repos/another-logga')).toBe(
        'foreign',
      )
    } finally {
      server.stop(true)
    }
  })

  test('treats a failed identity request as unverified, not foreign', async () => {
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch() {
        return new Response('busy', { status: 503 })
      },
    })
    try {
      expect(await probeDashboard(boundPort(server), 'logga', process.cwd())).toBe('unverified')
    } finally {
      server.stop(true)
    }
  })
})
