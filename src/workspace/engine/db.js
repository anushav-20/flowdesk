import { readJSON, writeJSON } from '@/lib/storage'

/**
 * In-browser database for the workspace demo.
 *
 *  - Immutable, copy-on-write state: a transaction copies only the collections it touches,
 *    so components subscribed to other collections don't re-render.
 *  - Persisted to localStorage (debounced) and shared between tabs: a BroadcastChannel
 *    tells other tabs to reload, giving real-time updates across tabs with no server.
 *  - Exposes subscribe/getState for useSyncExternalStore.
 */

export const STORAGE_KEY = 'flowdesk-workspace-v1'
const CHANNEL = 'flowdesk-workspace'

export function createDB(initial, { persist = true } = {}) {
  let state = (persist && readJSON(STORAGE_KEY, null)) || initial
  const listeners = new Set()
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null
  const tabId = Math.random().toString(36).slice(2)
  let saveTimer = null

  const notify = () => listeners.forEach((l) => l())

  const save = () => {
    if (!persist) return
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      writeJSON(STORAGE_KEY, state)
      channel?.postMessage({ type: 'changed', from: tabId })
    }, 60)
  }

  // Another tab changed the data → reload it
  channel?.addEventListener('message', (e) => {
    if (e.data?.type === 'changed' && e.data.from !== tabId) {
      const next = readJSON(STORAGE_KEY, null)
      if (next) {
        state = next
        notify()
      }
    }
  })

  /**
   * Runs `recipe(tx)` and commits atomically. If the recipe throws, nothing changes.
   * @template T
   * @param {(tx: ReturnType<typeof makeTx>) => T} recipe
   * @returns {T}
   */
  function transact(recipe) {
    const tx = makeTx(state)
    const result = recipe(tx)
    if (tx.changed) {
      state = tx.state
      notify()
      save()
    }
    return result
  }

  return {
    getState: () => state,
    subscribe: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    transact,
    tabId,
    channel,
    /** Replace everything (reset demo, tests). */
    reset(next) {
      state = next
      notify()
      if (persist) {
        writeJSON(STORAGE_KEY, state)
        channel?.postMessage({ type: 'changed', from: tabId })
      }
    },
    flush() {
      if (persist) {
        clearTimeout(saveTimer)
        writeJSON(STORAGE_KEY, state)
      }
    },
  }
}

const LOG_LIMIT = 500

/** Transaction helper with copy-on-write collections. */
function makeTx(base) {
  const copied = new Set()
  const tx = {
    state: base,
    changed: false,
    ensure(name) {
      if (!copied.has(name)) {
        if (tx.state === base) tx.state = { ...base }
        const coll = tx.state[name]
        tx.state[name] = Array.isArray(coll) ? [...coll] : { ...coll }
        copied.add(name)
      }
      tx.changed = true
      return tx.state[name]
    },
    get: (name, id) => tx.state[name]?.[id],
    all: (name) => Object.values(tx.state[name] ?? {}),
    put(name, obj) {
      tx.ensure(name)[obj.id] = obj
      return obj
    },
    patch(name, id, changes) {
      const current = tx.state[name][id]
      if (!current) throw new Error(`${name}/${id} not found`)
      return tx.put(name, { ...current, ...changes })
    },
    remove(name, id) {
      delete tx.ensure(name)[id]
    },
    /** Append to a capped log (newest first). */
    log(name, entry) {
      const arr = tx.ensure(name)
      arr.unshift(entry)
      if (arr.length > LOG_LIMIT) arr.length = LOG_LIMIT
      return entry
    },
    set(name, value) {
      if (tx.state === base) tx.state = { ...base }
      tx.state[name] = value
      tx.changed = true
    },
  }
  return tx
}
