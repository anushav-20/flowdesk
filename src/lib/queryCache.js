/**
 * Observable in-memory query cache (a minimal take on TanStack Query's model).
 *
 *  - Every key has one entry: { status, data, error, updatedAt, isFetching }
 *  - Components subscribe to a key and re-render only when *that* entry changes
 *  - Fresh entries (younger than `staleTime`) are served without a network call
 *  - Concurrent requests for the same key are de-duplicated
 *  - `prefetchQuery` warms the cache (e.g. on hover) for instant navigation
 */

export const DEFAULT_STALE_TIME = 60_000

/** @typedef {{ status: 'idle'|'loading'|'success'|'error', data?: any, error?: Error|null, updatedAt: number, isFetching: boolean }} Entry */

const IDLE = Object.freeze({ status: 'idle', data: undefined, error: null, updatedAt: 0, isFetching: false })

/** @type {Map<string, Entry>} */
const entries = new Map()
/** @type {Map<string, Promise<any>>} */
const inFlight = new Map()
/** @type {Map<string, Set<() => void>>} */
const listeners = new Map()

function setEntry(key, patch) {
  entries.set(key, { ...(entries.get(key) ?? IDLE), ...patch })
  listeners.get(key)?.forEach((l) => l())
}

/** @returns {Entry} stable reference until the entry changes */
export function getEntry(key) {
  return (key && entries.get(key)) || IDLE
}

export function subscribe(key, listener) {
  if (!key) return () => {}
  if (!listeners.has(key)) listeners.set(key, new Set())
  listeners.get(key).add(listener)
  return () => listeners.get(key)?.delete(listener)
}

export function isFresh(key, staleTime = DEFAULT_STALE_TIME) {
  const e = entries.get(key)
  return Boolean(e && e.status === 'success' && Date.now() - e.updatedAt < staleTime)
}

/**
 * Returns cached data if fresh, otherwise runs `fetcher` (at most once per key at a time).
 * @template T
 * @param {string} key
 * @param {() => Promise<T>} fetcher
 * @param {{ staleTime?: number, force?: boolean }} [opts]
 * @returns {Promise<T>}
 */
export function fetchQuery(key, fetcher, { staleTime = DEFAULT_STALE_TIME, force = false } = {}) {
  if (!force && isFresh(key, staleTime)) return Promise.resolve(entries.get(key).data)
  if (inFlight.has(key)) return inFlight.get(key)

  const prev = entries.get(key)
  setEntry(key, { isFetching: true, status: prev?.data !== undefined ? prev.status : 'loading', error: null })

  const promise = fetcher()
    .then((data) => {
      setEntry(key, { status: 'success', data, error: null, updatedAt: Date.now(), isFetching: false })
      return data
    })
    .catch((error) => {
      setEntry(key, { status: 'error', error, isFetching: false })
      throw error
    })
    .finally(() => inFlight.delete(key))

  inFlight.set(key, promise)
  return promise
}

/** Warm the cache in the background; errors are swallowed. */
export function prefetchQuery(key, fetcher, opts) {
  fetchQuery(key, fetcher, opts).catch(() => {})
}

/** Directly seed the cache (e.g. with data we already have from a list view). */
export function setQueryData(key, data) {
  setEntry(key, { status: 'success', data, error: null, updatedAt: Date.now(), isFetching: false })
}

export function clearCache() {
  entries.clear()
  inFlight.clear()
}
