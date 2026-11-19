import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import useQuery from './useQuery'

describe('useQuery', () => {
  it('goes from loading to success', async () => {
    const { result } = renderHook(() => useQuery('q1', () => Promise.resolve(42)))
    expect(result.current.status).toBe('loading')
    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(result.current.data).toBe(42)
  })

  it('exposes errors and recovers on refetch', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('fail')).mockResolvedValueOnce('ok')
    const { result } = renderHook(() => useQuery('q2', fetcher))

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error.message).toBe('fail')

    act(() => result.current.refetch())
    await waitFor(() => expect(result.current.data).toBe('ok'))
  })

  it('keeps previous data while the next key loads', async () => {
    let resolvePage2
    const fetcher = vi.fn((page) => (page === 1 ? Promise.resolve('page-1') : new Promise((r) => (resolvePage2 = r))))
    const { result, rerender } = renderHook(
      ({ page }) => useQuery(`p${page}`, () => fetcher(page), { keepPreviousData: true }),
      {
        initialProps: { page: 1 },
      },
    )
    await waitFor(() => expect(result.current.data).toBe('page-1'))

    rerender({ page: 2 })
    await waitFor(() => expect(result.current.isPreviousData).toBe(true))
    expect(result.current.data).toBe('page-1')
    expect(result.current.status).toBe('success')

    await act(async () => resolvePage2('page-2'))
    await waitFor(() => expect(result.current.data).toBe('page-2'))
    expect(result.current.isPreviousData).toBe(false)
  })

  it('does nothing when the key is null', () => {
    const fetcher = vi.fn()
    renderHook(() => useQuery(null, fetcher))
    expect(fetcher).not.toHaveBeenCalled()
  })
})
