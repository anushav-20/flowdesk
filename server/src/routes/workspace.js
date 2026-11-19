import { Router } from 'express'
import { z } from 'zod'
import {
  completedPerDay,
  predictCompletion,
  projectProgress,
  summarize,
  weeklyProgress,
  workload,
} from '../../../shared/analytics.js'
import { answer, generatePlan } from '../../../shared/assistant.js'
import { ACTIONS, TRIGGERS } from '../../../shared/automation.js'
import { JOB_TYPES, queueStats } from '../../../shared/jobs.js'
import { mergeRecord, threeWayMerge } from '../../../shared/merge.js'
import { buildIndex, search } from '../../../shared/search.js'
import { validateWebhookUrl, WEBHOOK_EVENTS } from '../../../shared/integrations.js'
import { badRequest, conflict, notFound } from '../lib/errors.js'
import { id, randomToken, toCamel } from '../lib/util.js'
import { authorize } from '../middleware/auth.js'
import { body, query } from '../middleware/validate.js'
import { polishWithLlm } from '../services/llm.js'
import { applyChange, loadTask, orgTasks } from '../services/tasks.js'
import { withWrite } from '../services/write.js'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const rows = async (ctx, sql, params) => (await ctx.db.query(sql, params)).map(toCamel)

/** Projects, calendar, docs, notifications, search, analytics, AI, audit, automations, webhooks, jobs, sync. */
export function workspaceRoutes(ctx) {
  const r = Router({ mergeParams: true })

  // ---------------------------------------------------------------- bootstrap (everything the app needs in one round trip)
  r.get('/bootstrap', async (req, res) => {
    const o = req.org.id
    const admin = ['owner', 'admin'].includes(req.role)
    const [members, projects, tasks, comments, events, fields, rules, runs, notifications, audit, docs, stats] =
      await Promise.all([
        rows(
          ctx,
          'SELECT u.id, u.name, u.email, u.title, u.color, m.role, m.joined_at FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = $1',
          [o],
        ),
        rows(ctx, 'SELECT * FROM projects WHERE org_id = $1', [o]),
        orgTasks(ctx.db, o),
        rows(ctx, 'SELECT * FROM comments WHERE org_id = $1', [o]),
        rows(ctx, 'SELECT * FROM events WHERE org_id = $1', [o]),
        rows(ctx, 'SELECT * FROM field_defs WHERE org_id = $1', [o]),
        rows(ctx, 'SELECT * FROM automation_rules WHERE org_id = $1', [o]),
        rows(ctx, 'SELECT * FROM automation_runs WHERE org_id = $1 ORDER BY at DESC LIMIT 50', [o]),
        rows(ctx, 'SELECT * FROM notifications WHERE org_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 100', [
          o,
          req.user.id,
        ]),
        rows(ctx, 'SELECT * FROM audit_logs WHERE org_id = $1 ORDER BY at DESC LIMIT 300', [o]),
        rows(ctx, 'SELECT * FROM docs WHERE org_id = $1', [o]),
        ctx.db.query('SELECT user_id, stats FROM user_stats WHERE org_id = $1', [o]),
      ])
    // Non-admins don't receive before/after snapshots (they may contain data beyond their role)
    const safeAudit = admin ? audit : audit.map(({ before: _before, after: _after, ...e }) => e)
    res.json({
      members,
      projects,
      tasks,
      comments,
      events,
      fields,
      rules,
      runs,
      notifications,
      audit: safeAudit,
      docs,
      stats: Object.fromEntries(stats.map((s) => [s.user_id, s.stats])),
    })
  })

  // ---------------------------------------------------------------- projects
  r.get('/projects', async (req, res) =>
    res.json(await rows(ctx, 'SELECT * FROM projects WHERE org_id = $1 ORDER BY created_at', [req.org.id])),
  )

  const projectSchema = z.object({
    name: z.string().trim().min(1).max(80),
    description: z.string().max(500).default(''),
    color: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .default('#6d5dfc'),
    deadline: isoDate.nullable().optional(),
  })
  r.post('/projects', authorize('project.manage'), body(projectSchema), async (req, res) => {
    const p = { id: id('p'), ...req.body, deadline: req.body.deadline ?? null }
    await withWrite(ctx, req.actor, async (w) => {
      await w.t.query(
        'INSERT INTO projects (id, org_id, name, description, color, deadline, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [p.id, req.org.id, p.name, p.description, p.color, p.deadline, w.now],
      )
      await w.audit({
        action: 'project.created',
        entityType: 'project',
        entityId: p.id,
        after: p,
        summary: `Created project ${p.name}`,
      })
    })
    res.status(201).json(p)
  })

  r.patch(
    '/projects/:projectId',
    authorize('project.manage'),
    body(projectSchema.partial().extend({ archived: z.boolean().optional() })),
    async (req, res) => {
      const before = toCamel(
        await ctx.db.one('SELECT * FROM projects WHERE org_id = $1 AND id = $2', [req.org.id, req.params.projectId]),
      )
      if (!before) throw notFound('Project')
      const next = { ...before, ...req.body }
      await withWrite(ctx, req.actor, async (w) => {
        await w.t.query(
          'UPDATE projects SET name=$3, description=$4, color=$5, deadline=$6, archived=$7 WHERE org_id=$1 AND id=$2',
          [req.org.id, before.id, next.name, next.description, next.color, next.deadline, next.archived],
        )
        await w.audit({
          action: 'project.updated',
          entityType: 'project',
          entityId: before.id,
          before,
          after: next,
          summary: `Updated project ${next.name}`,
        })
      })
      res.json(next)
    },
  )

  // ---------------------------------------------------------------- calendar events
  r.get('/events', query(z.object({ from: isoDate.optional(), to: isoDate.optional() })), async (req, res) => {
    const { from = '0000-01-01', to = '9999-12-31' } = req.valid.query
    res.json(
      await rows(ctx, 'SELECT * FROM events WHERE org_id = $1 AND date >= $2 AND date <= $3 ORDER BY date', [
        req.org.id,
        from,
        to,
      ]),
    )
  })
  r.post(
    '/events',
    authorize('task.create'),
    body(
      z.object({
        title: z.string().trim().min(1).max(100),
        date: isoDate,
        type: z.enum(['meeting', 'milestone']).default('meeting'),
        projectId: z.string().max(60).nullable().optional(),
      }),
    ),
    async (req, res) => {
      const e = { id: id('e'), ...req.body, projectId: req.body.projectId ?? null }
      await ctx.db.query('INSERT INTO events (id, org_id, title, type, date, project_id) VALUES ($1,$2,$3,$4,$5,$6)', [
        e.id,
        req.org.id,
        e.title,
        e.type,
        e.date,
        e.projectId,
      ])
      res.status(201).json(e)
    },
  )
  r.delete('/events/:eventId', authorize('task.update'), async (req, res) => {
    if (!(await ctx.db.exec('DELETE FROM events WHERE org_id = $1 AND id = $2', [req.org.id, req.params.eventId])))
      throw notFound('Event')
    res.status(204).end()
  })

  // ---------------------------------------------------------------- collaborative docs
  r.get('/docs/:docId', async (req, res) => {
    const d = await ctx.db.one('SELECT * FROM docs WHERE org_id = $1 AND id = $2', [req.org.id, req.params.docId])
    if (!d) throw notFound('Document')
    res.json(toCamel(d))
  })
  r.post(
    '/docs',
    authorize('doc.edit'),
    body(z.object({ title: z.string().trim().min(1).max(100), projectId: z.string().max(60).nullable().optional() })),
    async (req, res) => {
      const d = { id: id('d'), title: req.body.title, projectId: req.body.projectId ?? null, content: '', version: 1 }
      await ctx.db.query(
        'INSERT INTO docs (id, org_id, project_id, title, content, version, updated_by, updated_at) VALUES ($1,$2,$3,$4,$5,1,$6,$7)',
        [d.id, req.org.id, d.projectId, d.title, '', req.user.id, ctx.now()],
      )
      res.status(201).json(d)
    },
  )
  /** Optimistic concurrency + automatic 3-way merge of concurrent edits. */
  r.put(
    '/docs/:docId',
    authorize('doc.edit'),
    body(
      z.object({ content: z.string().max(50_000), baseVersion: z.number().int(), baseContent: z.string().max(50_000) }),
    ),
    async (req, res) => {
      const result = await withWrite(ctx, req.actor, async (w) => {
        const doc = toCamel(
          await w.t.one('SELECT * FROM docs WHERE org_id = $1 AND id = $2', [req.org.id, req.params.docId]),
        )
        if (!doc) throw notFound('Document')
        let merged = req.body.content
        let conflicts = 0
        if (req.body.baseVersion !== doc.version)
          ({ merged, conflicts } = threeWayMerge(req.body.baseContent, req.body.content, doc.content))
        if (merged === doc.content) return { doc, conflicts, merged: false }
        await w.t.query(
          'INSERT INTO doc_versions (id, org_id, doc_id, version, content, by, at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [id('dv'), req.org.id, doc.id, doc.version, doc.content, doc.updatedBy, doc.updatedAt],
        )
        await w.t.query(
          'UPDATE docs SET content = $3, version = version + 1, updated_by = $4, updated_at = $5 WHERE org_id = $1 AND id = $2',
          [req.org.id, doc.id, merged, req.user.id, w.now],
        )
        w.emit('doc.updated', { id: doc.id })
        return {
          doc: { ...doc, content: merged, version: doc.version + 1, updatedBy: req.user.id, updatedAt: w.now },
          conflicts,
          merged: req.body.baseVersion !== doc.version,
        }
      })
      res.json(result)
    },
  )
  r.get('/docs/:docId/versions', async (req, res) =>
    res.json(
      await rows(ctx, 'SELECT * FROM doc_versions WHERE org_id = $1 AND doc_id = $2 ORDER BY version DESC', [
        req.org.id,
        req.params.docId,
      ]),
    ),
  )

  // ---------------------------------------------------------------- notifications + stats
  r.get('/notifications', async (req, res) =>
    res.json(
      await rows(
        ctx,
        'SELECT * FROM notifications WHERE org_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 100',
        [req.org.id, req.user.id],
      ),
    ),
  )
  r.post(
    '/notifications/read',
    body(z.object({ ids: z.array(z.string().max(60)).max(200).optional() })),
    async (req, res) => {
      if (req.body.ids?.length)
        for (const nid of req.body.ids)
          await ctx.db.query('UPDATE notifications SET read = true WHERE org_id = $1 AND user_id = $2 AND id = $3', [
            req.org.id,
            req.user.id,
            nid,
          ])
      else
        await ctx.db.query('UPDATE notifications SET read = true WHERE org_id = $1 AND user_id = $2', [
          req.org.id,
          req.user.id,
        ])
      res.status(204).end()
    },
  )
  r.post(
    '/announcements',
    authorize('settings.manage'),
    body(z.object({ message: z.string().trim().min(1).max(200) })),
    async (req, res) => {
      await ctx.queue.enqueue(null, {
        orgId: req.org.id,
        type: 'notifications.bulk',
        priority: 'high',
        payload: { message: `📣 ${req.user.name}: ${req.body.message}` },
      })
      res.status(202).json({ queued: true })
    },
  )

  // ---------------------------------------------------------------- search
  r.get(
    '/search',
    query(
      z.object({
        q: z.string().max(100).default(''),
        types: z.string().max(100).optional(),
        status: z.string().max(20).optional(),
        assigneeId: z.string().max(60).optional(),
        sort: z.enum(['relevance', 'recent']).default('relevance'),
      }),
    ),
    async (req, res) => {
      const { q, types, status, assigneeId, sort } = req.valid.query
      const o = req.org.id
      const index = buildIndex({
        tasks: await orgTasks(ctx.db, o),
        projects: await rows(ctx, 'SELECT * FROM projects WHERE org_id = $1', [o]),
        comments: await rows(ctx, 'SELECT * FROM comments WHERE org_id = $1', [o]),
        members: await rows(
          ctx,
          'SELECT u.id, u.name, u.email, u.title, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = $1',
          [o],
        ),
        docs: await rows(ctx, 'SELECT * FROM docs WHERE org_id = $1', [o]),
        activity: await rows(
          ctx,
          'SELECT id, summary, action, at FROM audit_logs WHERE org_id = $1 ORDER BY at DESC LIMIT 200',
          [o],
        ),
      })
      const results = search(index, q, {
        types: types?.split(',').filter(Boolean),
        status,
        assigneeId,
        sort,
        limit: 50,
      })
      res.json(
        results.map(({ type, id: rid, title, score, at }) => ({ type, id: rid, title, score: Math.round(score), at })),
      )
    },
  )

  // ---------------------------------------------------------------- analytics + forecasts
  r.get('/analytics', async (req, res) => {
    const tasks = await orgTasks(ctx.db, req.org.id)
    const members = await rows(
      ctx,
      'SELECT u.id, u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = $1',
      [req.org.id],
    )
    const projects = await rows(ctx, 'SELECT * FROM projects WHERE org_id = $1 AND archived = false', [req.org.id])
    res.json({
      summary: summarize(tasks, ctx.now()),
      completedPerDay: completedPerDay(tasks, { now: ctx.now() }),
      weekly: weeklyProgress(tasks, { now: ctx.now() }),
      workload: workload(tasks, members, { capacity: req.org.capacity, now: ctx.now() }),
      projects: projects.map((p) => {
        const pt = tasks.filter((t) => t.projectId === p.id)
        return {
          id: p.id,
          name: p.name,
          progress: projectProgress(pt),
          forecast: predictCompletion(pt, { deadline: p.deadline, now: ctx.now() }),
        }
      }),
    })
  })

  // ---------------------------------------------------------------- AI assistant
  r.post('/ai/ask', body(z.object({ question: z.string().trim().min(1).max(300) })), async (req, res) => {
    const grounded = answer(req.body.question, {
      tasks: await orgTasks(ctx.db, req.org.id),
      members: await rows(
        ctx,
        'SELECT u.id, u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = $1',
        [req.org.id],
      ),
      projects: await rows(ctx, 'SELECT * FROM projects WHERE org_id = $1 AND archived = false', [req.org.id]),
      userId: req.user.id,
      now: ctx.now(),
    })
    res.json(
      grounded.plan
        ? { ...grounded, source: 'rules' }
        : await polishWithLlm(ctx.config, req.body.question, grounded, { fetchImpl: ctx.fetch }),
    )
  })
  r.post('/ai/plan', body(z.object({ goal: z.string().trim().min(3).max(200) })), async (req, res) =>
    res.json(generatePlan(req.body.goal, { startDate: ctx.now() })),
  )

  // ---------------------------------------------------------------- audit log + restore
  r.get(
    '/audit',
    authorize('audit.read'),
    query(
      z.object({
        entityId: z.string().max(60).optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      }),
    ),
    async (req, res) => {
      const { entityId, limit } = req.valid.query
      const list = entityId
        ? await rows(ctx, 'SELECT * FROM audit_logs WHERE org_id = $1 AND entity_id = $2 ORDER BY at DESC LIMIT $3', [
            req.org.id,
            entityId,
            limit,
          ])
        : await rows(ctx, 'SELECT * FROM audit_logs WHERE org_id = $1 ORDER BY at DESC LIMIT $2', [req.org.id, limit])
      res.json(list)
    },
  )
  r.post('/audit/:auditId/restore', authorize('audit.restore'), async (req, res) => {
    const entry = toCamel(
      await ctx.db.one('SELECT * FROM audit_logs WHERE org_id = $1 AND id = $2', [req.org.id, req.params.auditId]),
    )
    if (!entry) throw notFound('Audit entry')
    if (entry.entityType !== 'task' || !entry.before) throw badRequest('Only task changes can be restored.')
    const restored = await withWrite(ctx, req.actor, async (w) => {
      const current = await loadTask(w.t, req.org.id, entry.entityId)
      const fields = [
        'title',
        'description',
        'status',
        'priority',
        'assigneeId',
        'dueDate',
        'estimate',
        'customFields',
        'projectId',
      ]
      const changes = Object.fromEntries(
        fields
          .filter((f) => JSON.stringify(entry.before[f]) !== JSON.stringify(current[f]))
          .map((f) => [f, entry.before[f]]),
      )
      return applyChange(w, current, changes)
    })
    res.json(restored)
  })

  // ---------------------------------------------------------------- automations
  const ruleSchema = z.object({
    name: z.string().trim().min(1).max(80),
    enabled: z.boolean().default(true),
    trigger: z.object({ type: z.enum(Object.keys(TRIGGERS)), threshold: z.coerce.number().min(1).max(100).optional() }),
    conditions: z
      .array(z.object({ field: z.string().max(30), op: z.string().max(20), value: z.any().optional() }))
      .max(5)
      .default([]),
    actions: z
      .array(z.object({ type: z.enum(Object.keys(ACTIONS)), params: z.record(z.string(), z.any()).optional() }))
      .min(1)
      .max(5),
  })
  r.get('/automations', async (req, res) =>
    res.json(await rows(ctx, 'SELECT * FROM automation_rules WHERE org_id = $1', [req.org.id])),
  )
  r.get('/automations/runs', async (req, res) =>
    res.json(
      await rows(ctx, 'SELECT * FROM automation_runs WHERE org_id = $1 ORDER BY at DESC LIMIT 100', [req.org.id]),
    ),
  )
  r.post('/automations', authorize('automation.manage'), body(ruleSchema), async (req, res) => {
    const rule = { id: id('r'), ...req.body }
    await withWrite(ctx, req.actor, async (w) => {
      await w.t.query(
        'INSERT INTO automation_rules (id, org_id, name, enabled, trigger, conditions, actions) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [
          rule.id,
          req.org.id,
          rule.name,
          rule.enabled,
          JSON.stringify(rule.trigger),
          JSON.stringify(rule.conditions),
          JSON.stringify(rule.actions),
        ],
      )
      await w.audit({
        action: 'automation.created',
        entityType: 'rule',
        entityId: rule.id,
        after: rule,
        summary: `Created automation “${rule.name}”`,
      })
    })
    res.status(201).json(rule)
  })
  r.patch('/automations/:ruleId', authorize('automation.manage'), body(ruleSchema.partial()), async (req, res) => {
    const before = toCamel(
      await ctx.db.one('SELECT * FROM automation_rules WHERE org_id = $1 AND id = $2', [req.org.id, req.params.ruleId]),
    )
    if (!before) throw notFound('Automation')
    const next = { ...before, ...req.body }
    await ctx.db.query(
      'UPDATE automation_rules SET name=$3, enabled=$4, trigger=$5, conditions=$6, actions=$7 WHERE org_id=$1 AND id=$2',
      [
        req.org.id,
        before.id,
        next.name,
        next.enabled,
        JSON.stringify(next.trigger),
        JSON.stringify(next.conditions),
        JSON.stringify(next.actions),
      ],
    )
    res.json(next)
  })
  r.delete('/automations/:ruleId', authorize('automation.manage'), async (req, res) => {
    if (
      !(await ctx.db.exec('DELETE FROM automation_rules WHERE org_id = $1 AND id = $2', [
        req.org.id,
        req.params.ruleId,
      ]))
    )
      throw notFound('Automation')
    res.status(204).end()
  })

  // ---------------------------------------------------------------- webhooks
  const hookSchema = z.object({
    url: z.string().url().max(500),
    events: z.array(z.enum(Object.keys(WEBHOOK_EVENTS))).min(1),
    active: z.boolean().default(true),
  })
  r.get('/webhooks', authorize('webhook.manage'), async (req, res) =>
    res.json(await rows(ctx, 'SELECT * FROM webhooks WHERE org_id = $1', [req.org.id])),
  )
  r.get('/webhooks/deliveries', authorize('webhook.manage'), async (req, res) =>
    res.json(
      await rows(ctx, 'SELECT * FROM webhook_deliveries WHERE org_id = $1 ORDER BY at DESC LIMIT 100', [req.org.id]),
    ),
  )
  r.post('/webhooks', authorize('webhook.manage'), body(hookSchema), async (req, res) => {
    const err = validateWebhookUrl(req.body.url)
    if (err && !ctx.config.webhooks.allowPrivateHosts) throw badRequest(err)
    const hook = { id: id('w'), ...req.body, secret: `whsec_${randomToken(24)}` }
    await ctx.db.query(
      'INSERT INTO webhooks (id, org_id, url, events, secret, active, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [hook.id, req.org.id, hook.url, JSON.stringify(hook.events), hook.secret, hook.active, ctx.now()],
    )
    res.status(201).json(hook) // the secret is shown once at creation, like Stripe/GitHub
  })
  r.delete('/webhooks/:hookId', authorize('webhook.manage'), async (req, res) => {
    if (!(await ctx.db.exec('DELETE FROM webhooks WHERE org_id = $1 AND id = $2', [req.org.id, req.params.hookId])))
      throw notFound('Webhook')
    res.status(204).end()
  })
  r.post('/webhooks/:hookId/test', authorize('webhook.manage'), async (req, res) => {
    const hook = await ctx.db.one('SELECT id FROM webhooks WHERE org_id = $1 AND id = $2', [
      req.org.id,
      req.params.hookId,
    ])
    if (!hook) throw notFound('Webhook')
    const job = await ctx.queue.enqueue(null, {
      orgId: req.org.id,
      type: 'webhook.deliver',
      priority: 'high',
      payload: { webhookId: hook.id, event: 'ping', body: { event: 'ping', message: 'Hello from FlowDesk' } },
    })
    res.status(202).json({ jobId: job.id })
  })

  // ---------------------------------------------------------------- background jobs
  r.get(
    '/jobs',
    authorize('jobs.manage'),
    query(z.object({ status: z.enum(['queued', 'running', 'done', 'dead']).optional() })),
    async (req, res) => {
      const list = req.valid.query.status
        ? await rows(ctx, 'SELECT * FROM jobs WHERE org_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT 100', [
            req.org.id,
            req.valid.query.status,
          ])
        : await rows(ctx, 'SELECT * FROM jobs WHERE org_id = $1 ORDER BY created_at DESC LIMIT 100', [req.org.id])
      res.json({
        stats: queueStats(await rows(ctx, 'SELECT status FROM jobs WHERE org_id = $1', [req.org.id])),
        items: list,
      })
    },
  )
  r.post(
    '/jobs',
    authorize('jobs.manage'),
    body(
      z.object({
        type: z.enum(['reminders.overdue', 'tasks.recurring', 'reports.weekly', 'projects.archive']),
        priority: z.enum(['high', 'normal', 'low']).default('normal'),
      }),
    ),
    async (req, res) => {
      res
        .status(202)
        .json(await ctx.queue.enqueue(null, { orgId: req.org.id, type: req.body.type, priority: req.body.priority }))
    },
  )
  r.post('/jobs/:jobId/retry', authorize('jobs.manage'), async (req, res) => {
    if (!(await ctx.queue.retry(req.org.id, req.params.jobId)))
      throw conflict('not_dead', 'Only dead-lettered jobs can be retried.')
    res.status(202).json({ ok: true })
  })
  r.get('/jobs/types', (_req, res) => res.json(JOB_TYPES))

  // ---------------------------------------------------------------- offline sync
  /**
   * Applies mutations queued while the client was offline. Each carries the task version it was based on;
   * fields only the client changed are applied, and fields changed on both sides are reported as conflicts
   * (server wins for those) — see shared/merge.js mergeRecord.
   */
  r.post(
    '/sync',
    authorize('task.update'),
    body(
      z.object({
        mutations: z
          .array(
            z.object({
              clientId: z.string().max(60),
              taskId: z.string().max(60),
              base: z.record(z.string(), z.any()),
              changes: z.record(z.string(), z.any()),
            }),
          )
          .max(100),
      }),
    ),
    async (req, res) => {
      const ALLOWED = ['title', 'description', 'status', 'priority', 'assigneeId', 'dueDate', 'estimate']
      const results = []
      for (const m of req.body.mutations) {
        try {
          const r2 = await withWrite(ctx, req.actor, async (w) => {
            const server = await loadTask(w.t, req.org.id, m.taskId)
            const client = {
              ...m.base,
              ...Object.fromEntries(Object.entries(m.changes).filter(([k]) => ALLOWED.includes(k))),
            }
            const { record, conflicts } = mergeRecord(m.base, client, server)
            const changes = Object.fromEntries(
              ALLOWED.filter((k) => JSON.stringify(record[k]) !== JSON.stringify(server[k])).map((k) => [k, record[k]]),
            )
            const saved = Object.keys(changes).length ? await applyChange(w, server, changes) : server
            return {
              clientId: m.clientId,
              status: conflicts.length ? 'merged_with_conflicts' : 'applied',
              conflicts,
              task: saved,
            }
          })
          results.push(r2)
        } catch (err) {
          results.push({ clientId: m.clientId, status: 'rejected', error: err.message })
        }
      }
      res.json({ results })
    },
  )

  // ---------------------------------------------------------------- org-level health (admins)
  r.get('/health', authorize('health.read'), async (req, res) => {
    const t0 = Date.now()
    await ctx.db.query('SELECT 1')
    res.json({
      database: { ok: true, latencyMs: Date.now() - t0 },
      jobs: queueStats(await rows(ctx, 'SELECT status FROM jobs WHERE org_id = $1', [req.org.id])),
      api: ctx.metrics.snapshot(),
    })
  })

  return r
}
