import { id } from '../lib/util.js'

/**
 * Unit of work: runs `fn` inside a database transaction and gives it helpers to
 *  - emit domain events   (dispatched only AFTER commit → automations, webhooks, realtime see committed data)
 *  - write the audit log  (same transaction → an audited change can never be half-saved)
 *  - send notifications   (same transaction)
 *
 * @param {object} ctx  app context ({ db, bus, now })
 * @param {{ user: {id:string,name:string}, orgId: string, role: string }} actor
 */
export async function withWrite(ctx, actor, fn, { depth = 0, label } = {}) {
  const events = []
  const result = await ctx.db.tx(async (t) => {
    const w = {
      t,
      actor,
      depth,
      now: ctx.now(),
      emit: (type, subject, extra = {}) =>
        events.push({ type, subject, orgId: actor.orgId, actorId: actor.user.id, depth, ...extra }),
      audit: (entry) =>
        t.query(
          `INSERT INTO audit_logs (id, org_id, actor_id, actor_label, action, entity_type, entity_id, before, after, summary, via_automation, at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            id('a'),
            actor.orgId,
            actor.user.id,
            label ?? null,
            entry.action,
            entry.entityType,
            entry.entityId,
            entry.before ? JSON.stringify(entry.before) : null,
            entry.after ? JSON.stringify(entry.after) : null,
            entry.summary,
            depth > 0 || actor.user.id === 'system',
            ctx.now(),
          ],
        ),
      notify: (n) =>
        n.userId &&
        t.query(
          'INSERT INTO notifications (id, org_id, user_id, type, message, link, read, created_at) VALUES ($1,$2,$3,$4,$5,$6,false,$7)',
          [id('n'), actor.orgId, n.userId, n.type, n.message, n.link ? JSON.stringify(n.link) : null, ctx.now()],
        ),
    }
    return fn(w)
  })
  for (const e of events) await ctx.bus.dispatch(e)
  return result
}

export const systemActor = (orgId, name = 'Automation') => ({ user: { id: 'system', name }, orgId, role: 'owner' })
