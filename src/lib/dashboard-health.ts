import { listenerIsInRepo } from './instances.ts'

type DashboardHealth = 'healthy' | 'broken' | 'foreign' | 'unverified'

const PROBE_TIMEOUT_MS = 500

export async function probeDashboard(
  port: number,
  repoName: string,
  repoRoot: string,
): Promise<DashboardHealth> {
  const base = `http://127.0.0.1:${port}`
  let meta: unknown
  try {
    const response = await fetch(`${base}/api/meta`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    if (!response.ok) return 'unverified'
    meta = await response.json()
  } catch {
    return 'unverified'
  }
  if (typeof meta !== 'object' || meta === null) return 'foreign'
  const identity = meta as Record<string, unknown>
  if (
    identity['repoName'] !== repoName ||
    (identity['repoRoot'] === undefined
      ? !listenerIsInRepo(port, repoRoot)
      : identity['repoRoot'] !== repoRoot)
  ) {
    return 'foreign'
  }

  try {
    const response = await fetch(`${base}/`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      redirect: 'manual',
    })
    return response.ok ? 'healthy' : 'broken'
  } catch {
    return 'unverified'
  }
}
