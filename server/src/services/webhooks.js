import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { slackMessage, validateWebhookUrl, webhookPayload } from '../../../shared/integrations.js'
import { hmacSha256, id, toCamel } from '../lib/util.js'

const WEBHOOK_EVENTS = new Set([
  'task.created',
  'task.updated',
  'task.completed',
  'task.deleted',
  'comment.created',
  'approval.decided',
  'project.completed',
])
const SLACK_EVENTS = new Set(['task.completed', 'approval.decided', 'project.completed'])

const PRIVATE = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\./,
  /^::1$/,
  /^f[cd]/i,
  /^fe80/i,
]

/**
 * SSRF protection: besides validating the URL text, resolve the hostname and refuse
 * private/loopback addresses (stops "public-looking" names that resolve to internal IPs).
 */
export async function assertPublicHost(url, { allowPrivate = false } = {}) {
  const err = validateWebhookUrl(url)
  if (err && !allowPrivate) throw new Error(err)
  if (allowPrivate) return
  const host = new URL(url).hostname
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true })
  if (addresses.some((a) => PRIVATE.some((re) => re.test(a.address))))
    throw new Error('Webhook host resolves to a private address')
}

/** Turns committed domain events into delivery jobs (one per subscribed webhook, plus Slack). */
export function registerWebhooks(ctx) {
  ctx.bus.on(async (event) => {
    if (!WEBHOOK_EVENTS.has(event.type)) return
    const s = event.subject
    const data = s.key
      ? { task: { id: s.id, key: s.key, title: s.title, status: s.status, priority: s.priority } }
      : { subject: { id: s.id, name: s.name } }
    const hooks = (await ctx.db.query('SELECT * FROM webhooks WHERE org_id = $1 AND active = true', [event.orgId]))
      .map(toCamel)
      .filter((h) => h.events.includes(event.type))
    for (const h of hooks) {
      await ctx.queue.enqueue(null, {
        orgId: event.orgId,
        type: 'webhook.deliver',
        payload: {
          webhookId: h.id,
          event: event.type,
          body: webhookPayload(event.type, data, { orgId: event.orgId, id: id('evt'), at: ctx.now() }),
        },
      })
    }
    if (SLACK_EVENTS.has(event.type)) {
      const org = await ctx.db.one('SELECT integrations FROM orgs WHERE id = $1', [event.orgId])
      if (org?.integrations?.slack?.connected)
        await ctx.queue.enqueue(null, {
          orgId: event.orgId,
          type: 'webhook.deliver',
          priority: 'low',
          payload: { slack: true, event: event.type, body: slackMessage(event.type, data) },
        })
    }
  })
}

/** Job handler: POSTs the signed payload; non-2xx or network errors throw → retry with backoff → DLQ. */
export async function deliverWebhook(ctx, job) {
  const { payload, orgId } = job
  let url
  let secret = null
  let webhookId = 'slack'
  if (payload.slack) {
    const org = await ctx.db.one('SELECT integrations FROM orgs WHERE id = $1', [orgId])
    url = org?.integrations?.slack?.webhookUrl
    if (!url) return 'Slack disconnected — skipped'
  } else {
    const hook = await ctx.db.one('SELECT * FROM webhooks WHERE id = $1 AND org_id = $2', [payload.webhookId, orgId])
    if (!hook) return 'Webhook deleted — skipped'
    url = hook.url
    secret = hook.secret
    webhookId = hook.id
  }
  await assertPublicHost(url, { allowPrivate: ctx.config.webhooks.allowPrivateHosts })

  const body = JSON.stringify(payload.body)
  const signature = secret ? hmacSha256(secret, body) : null
  let status = 0
  try {
    const res = await (ctx.fetch ?? fetch)(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'FlowDesk-Webhooks/1.0',
        'X-FlowDesk-Event': payload.event,
        'X-FlowDesk-Delivery': job.id,
        ...(signature && { 'X-FlowDesk-Signature': signature }),
      },
      body,
      redirect: 'manual', // never follow redirects to (possibly internal) hosts
      signal: AbortSignal.timeout(ctx.config.webhooks.timeoutMs),
    })
    status = res.status
  } finally {
    await ctx.db.query(
      'INSERT INTO webhook_deliveries (id, org_id, webhook_id, url, event, status, ok, signature, body, at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [
        id('dl'),
        orgId,
        webhookId,
        url,
        payload.event,
        status,
        status >= 200 && status < 300,
        signature,
        body.slice(0, 5000),
        ctx.now(),
      ],
    )
  }
  if (status < 200 || status >= 300) throw new Error(`Endpoint responded ${status || 'with a network error'}`)
  return `Delivered ${payload.event} (${status})`
}
