import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'

export const id = (prefix) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url')
export const sha256 = (s) => createHash('sha256').update(s).digest('hex')
export const hmacSha256 = (secret, body) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`

/** Constant-time comparison of two signature strings. */
export function safeEqual(a, b) {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}

const camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
/** DB row (snake_case) → API object (camelCase). */
export const toCamel = (row) => (row ? Object.fromEntries(Object.entries(row).map(([k, v]) => [camel(k), v])) : row)

/** Structured JSON logger (one line per event — easy to ship to any log platform). */
export const logger = {
  info: (msg, data = {}) =>
    process.env.NODE_ENV !== 'test' &&
    console.info(JSON.stringify({ level: 'info', msg, ...data, time: new Date().toISOString() })),
  warn: (msg, data = {}) =>
    process.env.NODE_ENV !== 'test' &&
    console.warn(JSON.stringify({ level: 'warn', msg, ...data, time: new Date().toISOString() })),
  error: (msg, data = {}) =>
    console.error(JSON.stringify({ level: 'error', msg, ...data, time: new Date().toISOString() })),
}
