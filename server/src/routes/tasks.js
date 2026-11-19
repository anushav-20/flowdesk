import { Router } from 'express'
import { z } from 'zod'
import { ApprovalError, transition } from '../../../shared/approval.js'
import { conflict, forbidden, notFound } from '../lib/errors.js'
import { id, toCamel } from '../lib/util.js'
import { authorize } from '../middleware/auth.js'
import { body, query } from '../middleware/validate.js'
import { applyChange, award, createTask, deleteTask, loadTask, rowToTask } from '../services/tasks.js'
import { withWrite } from '../services/write.js'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.')
const recurrence = z
  .object({ freq: z.enum(['daily', 'weekly', 'monthly']), interval: z.number().int().min(1).max(365).default(1) })
  .nullable()

const createSchema = z.object({
  title: z.string().trim().min(1, 'Title is required.').max(120),
  description: z.string().max(4000).default(''),
  projectId: z.string().max(60),
  status: z.enum(['todo', 'progress', 'review', 'done']).default('todo'),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  assigneeId: z.string().max(60).nullable().optional(),
  dueDate: isoDate.nullable().optional(),
  estimate: z.number().min(0).max(999).default(0),
  blockedBy: z.array(z.string().max(60)).max(50).default([]),
  parentId: z.string().max(60).nullable().optional(),
  customFields: z.record(z.string(), z.unknown()).default({}),
  recurrence: recurrence.optional(),
})

const updateSchema = createSchema.partial().omit({ blockedBy: true }).extend({ version: z.number().int().optional() })

const ATTACHMENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
]

/** Tasks: CRUD with filtering + pagination, dependencies, approvals, comments with attachments. */
export function taskRoutes(ctx) {
  const r = Router({ mergeParams: true })

  r.get(
    '/',
    query(
      z.object({
        status: z.enum(['todo', 'progress', 'review', 'done']).optional(),
        projectId: z.string().max(60).optional(),
        assigneeId: z.string().max(60).optional(),
        q: z.string().max(100).optional(),
        limit: z.coerce.number().int().min(1).max(500).default(200),
        offset: z.coerce.number().int().min(0).default(0),
      }),
    ),
    async (req, res) => {
      const { status, projectId, assigneeId, q, limit, offset } = req.valid.query
      const where = ['org_id = $1']
      const params = [req.org.id]
      const add = (sql, v) => {
        params.push(v)
        where.push(sql.replace('?', `$${params.length}`))
      }
      if (status) add('status = ?', status)
      if (projectId) add('project_id = ?', projectId)
      if (assigneeId) add('assignee_id = ?', assigneeId)
      if (q) {
        params.push(`%${q}%`)
        where.push(`(title ILIKE $${params.length} OR key ILIKE $${params.length})`)
      }
      params.push(limit, offset)
      const rows = await ctx.db.query(
        `SELECT * FROM tasks WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      )
      res.json({ items: rows.map(rowToTask), limit, offset })
    },
  )

  r.post('/', authorize('task.create'), body(createSchema), async (req, res) => {
    const task = await withWrite(ctx, req.actor, (w) => createTask(w, req.body))
    res.status(201).json(task)
  })

  r.get('/:taskId', async (req, res) => res.json(await loadTask(ctx.db, req.org.id, req.params.taskId)))

  r.patch('/:taskId', authorize('task.update'), body(updateSchema), async (req, res) => {
    const { version, ...changes } = req.body
    const task = await withWrite(ctx, req.actor, async (w) =>
      applyChange(w, await loadTask(w.t, req.org.id, req.params.taskId), changes, { expectedVersion: version }),
    )
    res.json(task)
  })

  r.delete('/:taskId', authorize('task.delete'), async (req, res) => {
    await withWrite(ctx, req.actor, async (w) => deleteTask(w, await loadTask(w.t, req.org.id, req.params.taskId)))
    res.status(204).end()
  })

  // ---------------------------------------------------------------- dependencies
  r.post(
    '/:taskId/dependencies',
    authorize('task.update'),
    body(z.object({ prerequisiteId: z.string().max(60) })),
    async (req, res) => {
      const task = await withWrite(ctx, req.actor, async (w) => {
        const t = await loadTask(w.t, req.org.id, req.params.taskId)
        await loadTask(w.t, req.org.id, req.body.prerequisiteId) // 404 if it's another tenant's task
        if (t.blockedBy.includes(req.body.prerequisiteId)) return t
        return applyChange(w, t, { blockedBy: [...t.blockedBy, req.body.prerequisiteId] })
      })
      res.status(201).json(task)
    },
  )

  r.delete('/:taskId/dependencies/:prereqId', authorize('task.update'), async (req, res) => {
    const task = await withWrite(ctx, req.actor, async (w) => {
      const t = await loadTask(w.t, req.org.id, req.params.taskId)
      return applyChange(w, t, { blockedBy: t.blockedBy.filter((b) => b !== req.params.prereqId) })
    })
    res.json(task)
  })

  // ---------------------------------------------------------------- approvals (state machine)
  r.post(
    '/:taskId/approval',
    body(
      z.object({ type: z.enum(['submit', 'resubmit', 'approve', 'reject']), reason: z.string().max(500).optional() }),
    ),
    async (req, res) => {
      const { type, reason } = req.body
      if ((type === 'submit' || type === 'resubmit') && !['owner', 'admin', 'member'].includes(req.role))
        throw forbidden()
      const task = await withWrite(ctx, req.actor, async (w) => {
        const t = await loadTask(w.t, req.org.id, req.params.taskId)
        const chain = req.org.approval_chain
        let approval
        try {
          approval = transition(
            t.approval,
            { type, actorId: req.user.id, reason, at: w.now },
            { chain, isOwner: req.role === 'owner' },
          )
        } catch (err) {
          if (err instanceof ApprovalError) throw conflict('approval', err.message)
          throw err
        }
        const changes = { approval }
        if (type === 'submit' || type === 'resubmit') changes.status = 'review'
        if (approval.status === 'approved') changes.status = 'done'
        if (approval.status === 'rejected') changes.status = 'progress'
        const next = await applyChange(w, t, changes, { approved: approval.status === 'approved' })
        const step = chain[approval.step]
        if (approval.status === 'pending' && step?.approverId)
          await w.notify({
            userId: step.approverId,
            type: 'approval',
            message: `${t.key} ${t.title} is waiting for your ${step.name}`,
            link: { taskId: t.id },
          })
        if (type === 'reject' && t.assigneeId)
          await w.notify({
            userId: t.assigneeId,
            type: 'approval',
            message: `${req.user.name} rejected ${t.key}: “${reason}”`,
            link: { taskId: t.id },
          })
        if (type === 'approve') await award(w, req.user.id, { type: 'approval' })
        if (type === 'approve' || type === 'reject') w.emit('approval.decided', { ...next, decision: type })
        if (type === 'submit') w.emit('approval.requested', next)
        return next
      })
      res.json(task)
    },
  )

  // ---------------------------------------------------------------- comments + attachments
  r.get('/:taskId/comments', async (req, res) => {
    await loadTask(ctx.db, req.org.id, req.params.taskId)
    res.json(
      (
        await ctx.db.query('SELECT * FROM comments WHERE org_id = $1 AND task_id = $2 ORDER BY created_at', [
          req.org.id,
          req.params.taskId,
        ])
      ).map(toCamel),
    )
  })

  r.post(
    '/:taskId/comments',
    authorize('comment.create'),
    body(
      z
        .object({
          body: z.string().trim().max(2000).default(''),
          attachments: z
            .array(
              z.object({
                name: z.string().max(120),
                type: z.enum(ATTACHMENT_TYPES),
                size: z.number().int().max(1_000_000, 'Files must be under 1 MB.'),
                dataUrl: z
                  .string()
                  .max(1_400_000)
                  .regex(/^data:[\w/+.-]+;base64,/, 'Invalid file data.'),
              }),
            )
            .max(3)
            .default([]),
        })
        .refine((v) => v.body || v.attachments.length, 'Write a comment or attach a file.'),
    ),
    async (req, res) => {
      const comment = await withWrite(ctx, req.actor, async (w) => {
        const t = await loadTask(w.t, req.org.id, req.params.taskId)
        const members = await w.t.query(
          'SELECT u.id, u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = $1',
          [req.org.id],
        )
        const lower = req.body.body.toLowerCase()
        const mentions = members
          .filter((m) => m.id !== req.user.id && new RegExp(`@${m.name.split(' ')[0].toLowerCase()}\\b`).test(lower))
          .map((m) => m.id)
        // Content sniffing: the data URL's declared type must match the claimed type
        const attachments = req.body.attachments.map((f) => ({
          id: id('f'),
          name: f.name,
          type: f.type,
          size: f.size,
          dataUrl: f.dataUrl,
          status: f.dataUrl.startsWith(`data:${f.type};`) ? 'ready' : 'rejected',
        }))
        const c = {
          id: id('c'),
          orgId: req.org.id,
          taskId: t.id,
          authorId: req.user.id,
          body: req.body.body,
          mentions,
          attachments,
          createdAt: w.now,
        }
        await w.t.query(
          'INSERT INTO comments (id, org_id, task_id, author_id, body, mentions, attachments, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          [
            c.id,
            c.orgId,
            c.taskId,
            c.authorId,
            c.body,
            JSON.stringify(mentions),
            JSON.stringify(attachments),
            c.createdAt,
          ],
        )
        for (const userId of mentions)
          await w.notify({
            userId,
            type: 'mention',
            message: `${req.user.name} mentioned you on ${t.key}`,
            link: { taskId: t.id },
          })
        await award(w, req.user.id, { type: 'comment' })
        await w.audit({
          action: 'comment.created',
          entityType: 'comment',
          entityId: c.id,
          after: { body: c.body, attachments: attachments.map((a) => a.name) },
          summary: `Commented on ${t.key}`,
        })
        w.emit('comment.created', { ...c, task: t })
        return c
      })
      res.status(201).json(comment)
    },
  )

  r.delete('/:taskId/comments/:commentId', authorize('comment.create'), async (req, res) => {
    const c = await ctx.db.one('SELECT * FROM comments WHERE org_id = $1 AND id = $2', [
      req.org.id,
      req.params.commentId,
    ])
    if (!c) throw notFound('Comment')
    if (c.author_id !== req.user.id && !['owner', 'admin'].includes(req.role))
      throw forbidden('You can only delete your own comments.')
    await ctx.db.query('DELETE FROM comments WHERE id = $1', [c.id])
    res.status(204).end()
  })

  // ---------------------------------------------------------------- focus sessions (pomodoro)
  r.post(
    '/:taskId/focus',
    authorize('task.update'),
    body(z.object({ minutes: z.number().int().min(1).max(120) })),
    async (req, res) => {
      await withWrite(ctx, req.actor, async (w) => {
        await loadTask(w.t, req.org.id, req.params.taskId)
        await w.t.query('UPDATE tasks SET time_spent = time_spent + $3 WHERE org_id = $1 AND id = $2', [
          req.org.id,
          req.params.taskId,
          req.body.minutes,
        ])
        await award(w, req.user.id, { type: 'pomodoro' })
      })
      res.status(204).end()
    },
  )

  return r
}
