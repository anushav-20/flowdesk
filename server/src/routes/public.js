import express, { Router } from 'express'
import { toICS } from '../../../shared/exporters.js'
import { interpretGitHubEvent } from '../../../shared/integrations.js'
import { HttpError, notFound } from '../lib/errors.js'
import { hmacSha256, safeEqual } from '../lib/util.js'
import { applyChange, orgTasks } from '../services/tasks.js'
import { systemActor, withWrite } from '../services/write.js'

/**
 * Endpoints called by other systems (no user session):
 *  - GitHub webhooks, authenticated by HMAC signature (X-Hub-Signature-256)
 *  - Calendar subscription feed (.ics), authenticated by an unguessable per-org token
 */
export function publicRoutes(ctx) {
  const r = Router()

  // Raw body is needed to verify the signature byte-for-byte
  r.post('/integrations/github/:orgId', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
    const org = await ctx.db.one('SELECT id, github_secret, integrations FROM orgs WHERE id = $1', [req.params.orgId])
    const signature = req.get('x-hub-signature-256') ?? ''
    if (!org || !Buffer.isBuffer(req.body) || !safeEqual(signature, hmacSha256(org.github_secret, req.body)))
      throw new HttpError(401, 'invalid_signature', 'Invalid signature.')
    if (!org.integrations?.github?.connected)
      return res.status(202).json({ ignored: 'GitHub integration is disconnected' })

    const event = req.get('x-github-event')
    if (event === 'ping') return res.json({ ok: true })
    const actions = interpretGitHubEvent(event, JSON.parse(req.body.toString('utf8')))
    const results = []
    if (actions.length) {
      await withWrite(
        ctx,
        systemActor(org.id, 'GitHub'),
        async (w) => {
          const tasks = await orgTasks(w.t, org.id)
          for (const a of actions) {
            const task = tasks.find((t) => t.key === a.key)
            if (!task) {
              results.push({ key: a.key, result: 'no matching task' })
              continue
            }
            const links = task.links.some((l) => l.url === a.link.url) ? task.links : [...task.links, a.link]
            const changes = { links }
            if (a.status && task.status !== a.status && !(a.status === 'done' && task.approval?.status === 'pending'))
              changes.status = a.status
            try {
              await applyChange(w, task, changes)
              results.push({ key: a.key, result: changes.status ? `linked, moved to ${changes.status}` : 'linked' })
            } catch (err) {
              await applyChange(w, task, { links })
              results.push({ key: a.key, result: `linked (${err.message})` })
            }
          }
        },
        { label: 'GitHub' },
      )
    }
    res.json({ results })
  })

  r.get('/calendar/:orgId/:token.ics', async (req, res) => {
    const org = await ctx.db.one('SELECT id, name, calendar_token FROM orgs WHERE id = $1', [req.params.orgId])
    if (!org || !safeEqual(req.params.token, org.calendar_token)) throw notFound('Calendar')
    const tasks = await orgTasks(ctx.db, org.id)
    const events = await ctx.db.query('SELECT * FROM events WHERE org_id = $1', [org.id])
    const projects = await ctx.db.query('SELECT * FROM projects WHERE org_id = $1 AND deadline IS NOT NULL', [org.id])
    const ics = toICS(
      [
        ...tasks
          .filter((t) => t.dueDate && t.status !== 'done')
          .map((t) => ({ uid: t.id, title: `${t.key} ${t.title}`, date: t.dueDate })),
        ...events.map((e) => ({ uid: e.id, title: e.title, date: e.date })),
        ...projects.map((p) => ({ uid: p.id, title: `${p.name} deadline`, date: p.deadline })),
      ],
      { name: `${org.name} — FlowDesk` },
    )
    res.type('text/calendar').set('Cache-Control', 'private, max-age=300').send(ics)
  })

  return r
}
