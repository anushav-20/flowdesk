/**
 * Per-tab session (who is signed in, which workspace is open).
 * Stored in sessionStorage so two tabs can be signed in as different people —
 * handy for seeing real-time collaboration in the demo.
 */
const KEY = 'flowdesk-session'

export function createSession({ storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null } = {}) {
  let value = {}
  try {
    value = JSON.parse(storage?.getItem(KEY) ?? '{}') ?? {}
  } catch {
    value = {}
  }
  const listeners = new Set()
  return {
    get: () => value,
    set(next) {
      value = { ...next }
      try {
        storage?.setItem(KEY, JSON.stringify(value))
      } catch {
        /* storage unavailable */
      }
      listeners.forEach((l) => l())
    },
    subscribe(l) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
}
