import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useDebounce from './useDebounce'

describe('useDebounce', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('only emits the value after it stops changing', () => {
    const { result, rerender } = renderHook(({ v }) => useDebounce(v, 300), { initialProps: { v: 'a' } })

    rerender({ v: 'ab' })
    act(() => vi.advanceTimersByTime(200))
    rerender({ v: 'abc' })
    act(() => vi.advanceTimersByTime(200))
    expect(result.current).toBe('a') // still waiting

    act(() => vi.advanceTimersByTime(100))
    expect(result.current).toBe('abc')
  })
})
