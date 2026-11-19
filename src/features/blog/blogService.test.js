import { describe, expect, it, vi } from 'vitest'
import { jsonResponse } from '@/test/utils'
import { getPosts, toPostSummary } from './blogService'

const apiPost = {
  id: 7,
  title: 'Hello',
  body: 'word '.repeat(200).trim(),
  tags: ['history'],
  reactions: { likes: 5 },
  views: 10,
}

describe('blogService', () => {
  it('maps API posts into UI summaries', () => {
    const s = toPostSummary(apiPost)
    expect(s).toMatchObject({ id: '7', title: 'Hello', likes: 5, views: 10, readTime: 5, tags: ['history'] })
    expect(s.excerpt.endsWith('…')).toBe(true)
  })

  it('builds the search URL and pagination maths', async () => {
    const fetchMock = vi.fn(() => jsonResponse({ posts: [apiPost], total: 13 }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await getPosts({ q: 'a&b', page: 2, limit: 6 })

    const url = fetchMock.mock.calls[0][0]
    expect(url).toContain('/posts/search?q=a%26b') // user input is URL-encoded
    expect(url).toContain('skip=6')
    expect(res).toMatchObject({ total: 13, pages: 3, page: 2, isFallback: false })
  })

  it('falls back to offline posts on a network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    )
    vi.useFakeTimers()
    const promise = getPosts({ tag: 'guides' })
    await vi.runAllTimersAsync()
    const res = await promise
    vi.useRealTimers()

    expect(res.isFallback).toBe(true)
    expect(res.posts.length).toBeGreaterThan(0)
    expect(res.posts.every((p) => p.tags.includes('guides'))).toBe(true)
  })

  it('surfaces real server errors instead of hiding them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse({}, 400)),
    )
    await expect(getPosts()).rejects.toMatchObject({ status: 400 })
  })
})
