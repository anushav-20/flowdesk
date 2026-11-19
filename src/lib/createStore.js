import { useCallback, useSyncExternalStore } from 'react'
import { readJSON, writeJSON } from './storage'

/**
 * A tiny, dependency-free global store (similar in spirit to Zustand).
 *
 * Why not just Context? A Context re-renders *every* consumer whenever any
 * part of its value changes. Here components subscribe with a *selector*
 * and only re-render when the slice they selected actually changes.
 *
 * @template S
 * @param {S} initialState
 * @param {(state: S, action: {type: string, payload?: any}) => S} reducer
 * @param {{ persist?: { key: string, pick?: (s: S) => Partial<S>, version?: number } }} [options]
 */
export function createStore(initialState, reducer, options = {}) {
  const { persist } = options
  let state = initialState

  if (persist && typeof window !== 'undefined') {
    const saved = readJSON(persist.key, null)
    if (saved && saved.version === (persist.version ?? 1)) {
      state = { ...state, ...saved.state }
    }
  }

  const listeners = new Set()

  const getState = () => state

  /** @param {{type: string, payload?: any}} action */
  const dispatch = (action) => {
    const next = reducer(state, action)
    if (Object.is(next, state)) return
    state = next
    if (persist) {
      const slice = persist.pick ? persist.pick(state) : state
      writeJSON(persist.key, { version: persist.version ?? 1, state: slice })
    }
    listeners.forEach((l) => l())
  }

  const subscribe = (listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  /**
   * React hook. `selector` picks the slice a component needs.
   * @template T
   * @param {(s: S) => T} [selector]
   * @returns {T}
   */
  function useStore(selector = (s) => s) {
    const getSnapshot = useCallback(() => selector(state), [selector])
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  }

  /** Replace state directly — for tests and dev tooling only; app code should dispatch actions. */
  const setState = (next) => {
    state = typeof next === 'function' ? next(state) : next
    listeners.forEach((l) => l())
  }

  return { getState, dispatch, subscribe, useStore, setState }
}
