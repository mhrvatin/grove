import { useCallback, useEffect, useRef, useState } from 'react'

// Poll `fn` every intervalMs and expose the latest value plus a manual refetch.
// `fn` is held in a ref so a changing closure (e.g. a new name) never tears down
// the interval; a thrown fetch keeps the last good value and retries next tick.
export function usePoll<T>(fn: () => Promise<T>, intervalMs: number) {
  const [data, setData] = useState<T>()
  const fnRef = useRef(fn)
  fnRef.current = fn
  const refetch = useCallback(async () => {
    try {
      setData(await fnRef.current())
    } catch {
      // transient — keep the last value, the next tick retries
    }
  }, [])
  useEffect(() => {
    refetch()
    const id = setInterval(refetch, intervalMs)
    return () => clearInterval(id)
  }, [refetch, intervalMs])
  return { data, refetch }
}
