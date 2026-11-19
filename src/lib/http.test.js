import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse } from '@/test/utils'
import { http, HttpError } from './http'

describe('http', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('prefixes the base URL and parses JSON', async () => {
    const fetchMock = vi.fn(() => jsonResponse({ ok: 1 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(http('/posts', { baseUrl: 'https://api.test' })).resolves.toEqual({ ok: 1 })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test/posts',
      expect.objectContaining({ headers: expect.any(Object) }),
    )
  })

  it('serialises a `json` body and sets Content-Type', async () => {
    const fetchMock = vi.fn(() => jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)

    await http('/x', { method: 'POST', json: { a: 1 } })
    const init = fetchMock.mock.calls[0][1]
    expect(init.body).toBe('{"a":1}')
    expect(init.headers['Content-Type']).toBe('application/json')
  })

  it('retries server errors with backoff, then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => jsonResponse({}, 503))
      .mockImplementationOnce(() => jsonResponse({ done: true }))
    vi.stubGlobal('fetch', fetchMock)

    const promise = http('/flaky', { retries: 2 })
    await vi.runAllTimersAsync()

    await expect(promise).resolves.toEqual({ done: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry client errors (4xx)', async () => {
    const fetchMock = vi.fn(() => jsonResponse({}, 404))
    vi.stubGlobal('fetch', fetchMock)

    await expect(http('/missing', { retries: 3 })).rejects.toMatchObject({ name: 'HttpError', status: 404 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('turns network failures into HttpError with status 0 after retries', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
    vi.stubGlobal('fetch', fetchMock)

    const promise = http('/offline', { retries: 1 })
    promise.catch(() => {}) // handled below; avoids an unhandled-rejection warning while timers run
    await vi.runAllTimersAsync()
    await expect(promise).rejects.toEqual(new HttpError('Network error', 0))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('stops immediately when the caller aborts', async () => {
    const controller = new AbortController()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, init) =>
          new Promise((_res, rej) =>
            init.signal.addEventListener('abort', () => rej(new DOMException('x', 'AbortError'))),
          ),
      ),
    )

    const promise = http('/slow', { signal: controller.signal, retries: 3 })
    controller.abort()
    await expect(promise).rejects.toHaveProperty('name', 'AbortError')
  })
})
