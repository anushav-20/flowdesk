/**
 * Browser crypto helpers (Web Crypto API).
 * Passwords: PBKDF2-SHA256 with a random salt and 150k iterations — never stored in plain text.
 * Webhooks: HMAC-SHA256 signatures, the same scheme as GitHub/Stripe ("sha256=<hex>").
 */

const enc = new TextEncoder()
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
const fromHex = (hex) => new Uint8Array(hex.match(/.{2}/g).map((h) => parseInt(h, 16)))

const subtle = () => globalThis.crypto?.subtle

export async function hashPassword(password, saltHex) {
  const salt = saltHex ? fromHex(saltHex) : globalThis.crypto.getRandomValues(new Uint8Array(16))
  const key = await subtle().importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await subtle().deriveBits({ name: 'PBKDF2', salt, iterations: 150_000, hash: 'SHA-256' }, key, 256)
  return `pbkdf2$${toHex(salt)}$${toHex(bits)}`
}

/** Constant-time comparison to avoid leaking information through timing. */
function safeEqual(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function verifyPassword(password, stored) {
  const [, salt] = String(stored).split('$')
  if (!salt) return false
  return safeEqual(await hashPassword(password, salt), stored)
}

export async function hmacSha256(secret, body) {
  const key = await subtle().importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return `sha256=${toHex(await subtle().sign('HMAC', key, enc.encode(body)))}`
}
