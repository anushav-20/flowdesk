import { http } from '@/lib/http'

const MIN_FILL_TIME_MS = 2500

/**
 * Sends a contact enquiry. Uses DummyJSON's mock POST endpoint (nothing is stored).
 *
 * Basic bot protection (a real backend would add rate limiting + CAPTCHA):
 *  - honeypot field must be empty
 *  - form must not be submitted faster than a human could fill it
 */
export async function sendContactMessage(payload, { honeypot = '', startedAt = 0 } = {}) {
  if (honeypot || (startedAt && Date.now() - startedAt < MIN_FILL_TIME_MS)) {
    // Pretend success so bots get no signal, but send nothing
    return { ok: true, id: null }
  }

  const res = await http('/posts/add', {
    method: 'POST',
    retries: 0, // never auto-retry a non-idempotent request (could send twice)
    json: { title: `Contact: ${payload.topic}`, body: payload.message, userId: 1 },
  })
  return { ok: true, id: res?.id ?? null }
}

export async function subscribeToNewsletter(email) {
  return http('/users/add', { method: 'POST', retries: 0, json: { email } })
}
