import { env } from '@/config/env'

/** Error thrown for any failed request; carries the HTTP status (0 = network/timeout). */
export class HttpError extends Error {
  constructor(message, status = 0) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    })
  })

/** Retry only on network errors, timeouts, 429 and 5xx. Client errors (4xx) are final. */
const isRetryable = (err) => err instanceof HttpError && (err.status === 0 || err.status === 429 || err.status >= 500)

/**
 * fetch() wrapper with base URL, JSON handling, timeout, cancellation
 * and retry with exponential backoff.
 *
 * @param {string} path  e.g. '/posts?limit=3'
 * @param {RequestInit & { timeout?: number, retries?: number, baseUrl?: string, json?: unknown }} [options]
 */
export async function http(path, options = {}) {
  const { timeout = 8000, retries = 2, baseUrl = env.apiBaseUrl, json, signal, headers, ...init } = options

  for (let attempt = 0; ; attempt++) {
    const timeoutCtrl = new AbortController()
    const timer = setTimeout(() => timeoutCtrl.abort(), timeout)
    const onAbort = () => timeoutCtrl.abort()
    signal?.addEventListener('abort', onAbort)

    try {
      const res = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: { Accept: 'application/json', ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: json ? JSON.stringify(json) : init.body,
        signal: timeoutCtrl.signal,
      })
      if (!res.ok) throw new HttpError(`Request failed with status ${res.status}`, res.status)
      return res.status === 204 ? null : await res.json()
    } catch (err) {
      // Caller cancelled → stop immediately, don't retry
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')

      const error =
        err instanceof HttpError
          ? err
          : new HttpError(timeoutCtrl.signal.aborted ? 'Request timed out' : 'Network error', 0)

      if (attempt >= retries || !isRetryable(error)) throw error
      // Exponential backoff: 300ms, 600ms, 1200ms…
      await sleep(300 * 2 ** attempt, signal)
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }
}
