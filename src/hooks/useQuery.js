import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { fetchQuery, getEntry, isFresh, subscribe } from '@/lib/queryCache'

/**
 * Subscribe a component to a cached query.
 *
 *  - Fresh cached data is shown instantly (no loading flash when revisiting a page)
 *  - `keepPreviousData`: while a new key loads, the last data stays on screen (smooth pagination)
 *  - Responses are stored per key, so out-of-order responses can never show the wrong page
 *
 * @template T
 * @param {string | null} key  cache key; `null` disables the query
 * @param {() => Promise<T>} fetcher
 * @param {{ staleTime?: number, keepPreviousData?: boolean }} [options]
 */
export default function useQuery(key, fetcher, { staleTime, keepPreviousData = false } = {}) {
  const entry = useSyncExternalStore(
    useCallback((cb) => subscribe(key, cb), [key]),
    () => getEntry(key),
    () => getEntry(key),
  )

  // Always call the latest fetcher without re-running the effect when it changes identity
  const fetcherRef = useRef(fetcher)
  useEffect(() => {
    fetcherRef.current = fetcher
  })

  useEffect(() => {
    if (key && !isFresh(key, staleTime)) {
      fetchQuery(key, () => fetcherRef.current(), { staleTime }).catch(() => {})
    }
  }, [key, staleTime])

  // Remember the last successful data ("derive state from previous render" pattern)
  const [previous, setPrevious] = useState(entry.data)
  if (entry.data !== undefined && entry.data !== previous) setPrevious(entry.data)

  const showPrevious = keepPreviousData && entry.data === undefined && previous !== undefined
  const data = showPrevious ? previous : entry.data
  const status =
    showPrevious && entry.status !== 'error' ? 'success' : entry.status === 'idle' ? 'loading' : entry.status

  const refetch = useCallback(() => {
    if (key) fetchQuery(key, () => fetcherRef.current(), { force: true }).catch(() => {})
  }, [key])

  return {
    data,
    error: entry.error,
    status, // 'loading' | 'success' | 'error'
    isFetching: entry.isFetching,
    isPreviousData: showPrevious,
    refetch,
  }
}
