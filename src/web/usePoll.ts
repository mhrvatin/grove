import { useCallback, useEffect, useRef, useState } from 'react'

// A single transient blip (a dropped tick) shouldn't flip the footer to stale
// (DASH-22); only consecutive failures spanning this many ticks do.
export const STALE_AFTER_FAILURES = 2

export function isStale(consecutiveFailures: number): boolean {
  return consecutiveFailures >= STALE_AFTER_FAILURES
}

// Poll `fn` every intervalMs and expose the latest value, a manual refetch, and
// whether the poll has been failing long enough to call the data stale (DASH-22).
// `fn` is held in a ref so a changing closure (e.g. a new name) never tears down
// the interval; a thrown fetch keeps the last good value and retries next tick.
export function usePoll<T>(fn: () => Promise<T>, intervalMs: number) {
  const [data, setData] = useState<T>()
  const [stale, setStale] = useState(false)
  const failuresRef = useRef(0)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const refetch = useCallback(async () => {
    try {
      setData(await fnRef.current())
      failuresRef.current = 0
      setStale(false)
    } catch {
      // transient — keep the last value, the next tick retries
      failuresRef.current += 1
      setStale(isStale(failuresRef.current))
    }
  }, [])
  useEffect(() => {
    refetch()
    const id = setInterval(refetch, intervalMs)
    return () => clearInterval(id)
  }, [refetch, intervalMs])
  return { data, refetch, stale }
}
