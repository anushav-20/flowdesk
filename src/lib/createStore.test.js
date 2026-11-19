import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createStore } from './createStore'

const reducer = (state, action) => {
  switch (action.type) {
    case 'inc':
      return { ...state, count: state.count + 1 }
    case 'rename':
      return { ...state, name: action.payload }
    case 'noop':
      return state
    default:
      return state
  }
}

describe('createStore', () => {
  it('updates state through the reducer and notifies subscribers', () => {
    const store = createStore({ count: 0, name: 'a' }, reducer)
    const listener = vi.fn()
    store.subscribe(listener)

    store.dispatch({ type: 'inc' })

    expect(store.getState().count).toBe(1)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('does not notify when the reducer returns the same state', () => {
    const store = createStore({ count: 0 }, reducer)
    const listener = vi.fn()
    store.subscribe(listener)

    store.dispatch({ type: 'noop' })

    expect(listener).not.toHaveBeenCalled()
  })

  it('re-renders a component only when its selected slice changes', () => {
    const store = createStore({ count: 0, name: 'a' }, reducer)
    const selectName = (s) => s.name
    let renders = 0
    const { result } = renderHook(() => {
      renders++
      return store.useStore(selectName)
    })
    expect(result.current).toBe('a')
    const initialRenders = renders

    act(() => store.dispatch({ type: 'inc' })) // unrelated slice
    expect(renders).toBe(initialRenders)

    act(() => store.dispatch({ type: 'rename', payload: 'b' }))
    expect(result.current).toBe('b')
    expect(renders).toBe(initialRenders + 1)
  })

  it('persists the picked slice and restores it on creation', () => {
    const persist = { key: 'test-store', version: 1, pick: (s) => ({ count: s.count }) }
    const first = createStore({ count: 0, name: 'a' }, reducer, { persist })
    first.dispatch({ type: 'inc' })
    first.dispatch({ type: 'rename', payload: 'not-persisted' })

    const second = createStore({ count: 0, name: 'a' }, reducer, { persist })
    expect(second.getState()).toEqual({ count: 1, name: 'a' })
  })

  it('ignores persisted data from an older version', () => {
    localStorage.setItem('versioned', JSON.stringify({ version: 1, state: { count: 99 } }))
    const store = createStore({ count: 0 }, reducer, { persist: { key: 'versioned', version: 2 } })
    expect(store.getState().count).toBe(0)
  })

  it('survives corrupted storage', () => {
    localStorage.setItem('broken', '{not json')
    const store = createStore({ count: 0 }, reducer, { persist: { key: 'broken' } })
    expect(store.getState().count).toBe(0)
  })
})
