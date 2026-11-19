import { describe, expect, it, vi } from 'vitest'
import { fetchQuery, getEntry, isFresh, setQueryData, subscribe } from './queryCache'

describe('queryCache', () => {
  it('serves fresh data from cache without calling the fetcher again', async () => {
    const fetcher = vi.fn(() => Promise.resolve('data'))
    await fetchQuery('k', fetcher)
    await fetchQuery('k', fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('de-duplicates concurrent requests for the same key', async () => {
    const fetcher = vi.fn(() => Promise.resolve('data'))
    const [a, b] = await Promise.all([fetchQuery('dup', fetcher), fetchQuery('dup', fetcher)])
    expect(a).toBe('data')
    expect(b).toBe('data')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('refetches once data is stale or when forced', async () => {
    const fetcher = vi.fn(() => Promise.resolve('data'))
    await fetchQuery('stale', fetcher, { staleTime: 0 })
    await fetchQuery('stale', fetcher, { staleTime: 0 })
    await fetchQuery('stale', fetcher, { force: true })
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('records errors on the entry and notifies subscribers', async () => {
    const listener = vi.fn()
    subscribe('err', listener)
    await expect(fetchQuery('err', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    expect(getEntry('err')).toMatchObject({ status: 'error', isFetching: false })
    expect(listener).toHaveBeenCalled()
  })

  it('can be seeded with setQueryData', () => {
    setQueryData('seed', { id: 1 })
    expect(isFresh('seed')).toBe(true)
    expect(getEntry('seed').data).toEqual({ id: 1 })
  })
})
