import { describe, expect, test } from 'bun:test'
import { type Dashboard, hubResponse, toDashboard } from './hub-utils.ts'

const facit: Dashboard = { port: 4012, repoName: 'facit', repoRoot: '/code/facit' }
const reda: Dashboard = { port: 4071, repoName: 'reda', repoRoot: '/code/reda' }

// covers: HUB-3
describe('hubResponse — /', () => {
  test('lists every running dashboard with a link to its port', () => {
    const res = hubResponse('/', [facit, reda])
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toStartWith('text/html')
    expect(res.body).toContain('href="http://localhost:4012/"')
    expect(res.body).toContain('facit')
    expect(res.body).toContain('/code/facit')
    expect(res.body).toContain('href="http://localhost:4071/"')
  })

  test('lists dashboards sorted by repo name', () => {
    const body = hubResponse('/', [reda, facit]).body
    expect(body.indexOf('/code/facit')).toBeLessThan(body.indexOf('/code/reda'))
  })

  test('says so when no dashboards are running', () => {
    expect(hubResponse('/', []).body).toContain('No grove dashboards are running')
  })
})

// covers: HUB-4
describe('hubResponse — /<repoName>', () => {
  test('redirects to the only dashboard with that repo name', () => {
    const res = hubResponse('/facit', [facit, reda])
    expect(res.status).toBe(302)
    expect(res.headers['location']).toBe('http://localhost:4012/')
  })

  test('shows a choice page listing each match when several share the name', () => {
    const clone: Dashboard = { port: 4090, repoName: 'facit', repoRoot: '/tmp/facit' }
    const res = hubResponse('/facit', [facit, reda, clone])
    expect(res.status).toBe(200)
    expect(res.headers['location']).toBeUndefined()
    expect(res.body).toContain('/code/facit')
    expect(res.body).toContain('/tmp/facit')
    expect(res.body).not.toContain('/code/reda')
  })

  test('returns 404 with the full index when no dashboard has that name', () => {
    const res = hubResponse('/logga', [facit, reda])
    expect(res.status).toBe(404)
    expect(res.body).toContain('logga')
    expect(res.body).toContain('/code/facit')
    expect(res.body).toContain('/code/reda')
  })

  test('ignores a trailing slash', () => {
    expect(hubResponse('/facit/', [facit]).headers['location']).toBe('http://localhost:4012/')
  })

  test('treats malformed percent-encoding as an unknown name', () => {
    expect(hubResponse('/%E0%A4%A', [facit]).status).toBe(404)
  })
})

// covers: HUB-5
describe('hubResponse — escaping', () => {
  test('escapes HTML from probed metadata and the request path', () => {
    const evil: Dashboard = { port: 4001, repoName: '<script>x</script>', repoRoot: '/a"b' }
    const index = hubResponse('/', [evil]).body
    expect(index).not.toContain('<script>x')
    expect(index).toContain('&lt;script&gt;x&lt;/script&gt;')
    expect(index).toContain('/a&quot;b')
    expect(hubResponse('/<img>', []).body).not.toContain('<img>')
  })
})

// covers: HUB-2, DASH-19a
describe('toDashboard', () => {
  test('accepts a grove /api/meta reply', () => {
    expect(toDashboard(4012, { repoName: 'facit', repoRoot: '/code/facit' })).toEqual(facit)
  })

  test('rejects replies that are not grove dashboards', () => {
    expect(toDashboard(4012, { repoName: 'facit' })).toBeNull()
    expect(toDashboard(4012, { repoName: 1, repoRoot: '/x' })).toBeNull()
    expect(toDashboard(4012, null)).toBeNull()
    expect(toDashboard(4012, 'hello')).toBeNull()
    expect(toDashboard(4012, [])).toBeNull()
  })
})
