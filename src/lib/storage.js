/**
 * Safe wrapper around localStorage. Storage can be disabled (private mode,
 * sandboxed iframes) or full, so every call is guarded and never throws.
 */

export function readJSON(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key)
    return raw == null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function writeJSON(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function remove(key) {
  try {
    window.localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}
