import { isOverdue, summarize } from '@shared/analytics.js'
import { isDueSoon } from '@shared/automation.js'
import { fieldIdFromName, validateFieldDef } from '@shared/customFields.js'
import { createJob, markFailed, markRunning, markSucceeded, pickNext, requeue } from '@shared/jobs.js'
import { ApiError, cleanText, notify, uid } from '../core'
import { hmacSha256 } from '../crypto'

const DAY = 86_400_000
const RESTORABLE = ['task', 'project', 'rule']

/**
 * Background job engine (queue, retries, dead-letter queue, scheduler),
 * audit log restore, custom fields, saved searches and reports.
 */
export function operationsModule(ctx) {
  const { db } = ctx

  // ================================================================ job handlers
  const handlers = {
    /** Finds overdue tasks once per day and fires `task.overdue` (automations send reminders). */
    'reminders.overdue': ({ orgId }) => {
      const state = db.getState()
      const today = new Date(ctx.now()).toISOString().slice(0, 10)
      const overdue = Object.values(state.tasks).filter(
        (t) => t.orgId === orgId && isOverdue(t, ctx.now()) && t.overdueNotifiedOn !== today,
      )
      // `overdueNotifiedOn` remembers the last reminder: "soon:<due date>" or the day it was flagged overdue
      const dueSoon = Object.values(state.tasks).filter(
        (t) => t.orgId === orgId && isDueSoon(t, ctx.now()) && t.overdueNotifiedOn !== `soon:${t.dueDate}`,
      )
      if (!overdue.length && !dueSoon.length) return 'No new deadline reminders'
      ctx.systemMutate(
        orgId,
        (tx, sys) => {
          for (const t of dueSoon) {
            tx.patch('tasks', t.id, { overdueNotifiedOn: `soon:${t.dueDate}` })
            sys.emit('task.due_soon', t)
          }
          for (const t of overdue) {
            tx.patch('tasks', t.id, { overdueNotifiedOn: today })
            sys.emit('task.overdue', { ...t, overdueNotifiedOn: today })
          }
        },
        { label: 'Scheduler', depth: 0 },
      )
      return `${overdue.length} overdue, ${dueSoon.length} due soon`
    },

    /** Ensures every recurring series has an open instance (safety net for the on-complete logic). */
    'tasks.recurring': ({ orgId }) => {
      const tasks = Object.values(db.getState().tasks).filter((t) => t.orgId === orgId && t.recurrence)
      const open = new Set(tasks.filter((t) => t.status !== 'done').map((t) => t.recurrenceOf ?? t.id))
      const orphaned = tasks.filter((t) => t.status === 'done' && !open.has(t.recurrenceOf ?? t.id))
      return orphaned.length
        ? `${orphaned.length} recurring series need a new instance`
        : 'All recurring series are up to date'
    },

    /** Builds an HTML weekly report and "emails" it (puts it in the outbox). */
    'reports.weekly': ({ orgId }) => {
      const state = db.getState()
      const tasks = Object.values(state.tasks).filter((t) => t.orgId === orgId)
      const s = summarize(tasks, ctx.now())
      const done = tasks.filter((t) => t.completedAt >= ctx.now() - 7 * DAY)
      const admins = Object.values(state.memberships).filter(
        (m) => m.orgId === orgId && ['owner', 'admin'].includes(m.role),
      )
      db.transact((tx) =>
        tx.log('outbox', {
          id: uid('mail'),
          orgId,
          to: admins.map((m) => state.users[m.userId].email),
          subject: `Weekly report — ${state.orgs[orgId].name}`,
          summary: `${done.length} tasks completed this week · ${s.pending} open · ${s.overdue} overdue · ${s.completionRate}% overall`,
          lines: done.slice(0, 10).map((t) => `${t.key} ${t.title}`),
          at: ctx.now(),
        }),
      )
      return `Report sent to ${admins.length} admin${admins.length === 1 ? '' : 's'}`
    },

    /**
     * Delivers a webhook. In the browser demo, delivery is simulated (browsers can't POST to
     * arbitrary servers under our CSP); the payload is still signed exactly like the server does.
     * URLs containing "fail" simulate an endpoint that returns 500 — to show retries and the DLQ.
     */
    'webhook.deliver': async ({ orgId, payload }) => {
      const state = db.getState()
      const hook = payload.slack ? null : state.webhooks[payload.webhookId]
      if (!payload.slack && !hook) return 'Webhook was deleted — skipped'
      const url = payload.slack ? state.orgs[orgId].integrations.slack.webhookUrl : hook.url
      const body = JSON.stringify(payload.body)
      const signature = hook ? await hmacSha256(hook.secret, body) : null
      if (payload.slack) {
        // Real Slack post (see postToSlack); the browser can't read Slack's response, so it's logged as "sent"
        await ctx.postToSlack(url, payload.body)
        db.transact((tx) =>
          tx.log('deliveries', {
            id: uid('dl'),
            orgId,
            webhookId: 'slack',
            url,
            event: payload.event,
            status: 'sent',
            ok: true,
            signature: null,
            body,
            at: ctx.now(),
          }),
        )
        return `Posted ${payload.event} to Slack`
      }
      const failed = /fail/i.test(url)
      db.transact((tx) =>
        tx.log('deliveries', {
          id: uid('dl'),
          orgId,
          webhookId: hook?.id ?? 'slack',
          url,
          event: payload.event,
          status: failed ? 500 : 200,
          ok: !failed,
          signature,
          body,
          at: ctx.now(),
        }),
      )
      if (failed) throw new Error('Endpoint responded 500 Internal Server Error')
      return `Delivered ${payload.event} → ${new URL(url).host} (200)`
    },

    'github.sync': async ({ orgId }) => {
      const r = await ctx.syncGitHubOrg(orgId)
      return `Checked ${r.pulls} PRs and ${r.commits} commits · ${r.updated} task${r.updated === 1 ? '' : 's'} updated`
    },

    'notifications.bulk': ({ orgId, payload }) => {
      const members = Object.values(db.getState().memberships).filter((m) => m.orgId === orgId)
      db.transact((tx) => {
        for (const m of members)
          notify(tx, { orgId, userId: m.userId, type: 'announcement', message: payload.message, now: ctx.now() })
      })
      return `Notified ${members.length} members`
    },

    /** Archives projects with no task activity for 30 days. */
    'projects.archive': ({ orgId }) => {
      const state = db.getState()
      const stale = Object.values(state.projects).filter((p) => {
        if (p.orgId !== orgId || p.archived) return false
        const last = Math.max(
          p.createdAt,
          ...Object.values(state.tasks)
            .filter((t) => t.projectId === p.id)
            .map((t) => t.updatedAt),
        )
        return ctx.now() - last > 30 * DAY
      })
      if (!stale.length) return 'No inactive projects'
      ctx.systemMutate(
        orgId,
        (tx, sys) => {
          for (const p of stale) {
            tx.patch('projects', p.id, { archived: true })
            sys.audit(tx, {
              action: 'project.archived',
              entityType: 'project',
              entityId: p.id,
              before: p,
              after: { ...p, archived: true },
              summary: `Archived inactive project ${p.name}`,
            })
          }
        },
        { label: 'Scheduler' },
      )
      return `Archived ${stale.length} project(s)`
    },

    /** Post-upload processing for attachments (type sniffing + "scan"). */
    'files.process': ({ payload }) => {
      const c = db.getState().comments[payload.commentId]
      if (!c) return 'Comment deleted — skipped'
      const file = c.attachments.find((f) => f.id === payload.fileId)
      // Verify the data URL's declared MIME type matches the claimed type (basic content sniffing)
      const declared = /^data:([^;]+);/.exec(file?.dataUrl ?? '')?.[1]
      const status = declared === file?.type ? 'ready' : 'rejected'
      db.transact((tx) =>
        tx.patch('comments', c.id, {
          attachments: c.attachments.map((f) =>
            f.id === payload.fileId ? { ...f, status, ...(status === 'rejected' && { dataUrl: null }) } : f,
          ),
        }),
      )
      return `${file?.name}: ${status}`
    },
  }

  // ================================================================ runner
  let running = false

  /** Processes due jobs (one at a time, like a single worker). Returns how many ran. */
  async function tick(maxJobs = 5) {
    if (running) return 0
    running = true
    let count = 0
    try {
      for (; count < maxJobs; count++) {
        const job = pickNext(Object.values(db.getState().jobs), ctx.now())
        if (!job) break
        const started = markRunning(job, ctx.now())
        db.transact((tx) => tx.put('jobs', started))
        const t0 = performance.now()
        try {
          const result = await handlers[job.type]?.(job)
          if (result === undefined && !handlers[job.type]) throw new Error(`No handler for ${job.type}`)
          db.transact((tx) =>
            tx.put('jobs', {
              ...markSucceeded(started, result, ctx.now()),
              durationMs: Math.round(performance.now() - t0),
            }),
          )
        } catch (err) {
          const failed = markFailed(started, err, ctx.now())
          db.transact((tx) => tx.put('jobs', { ...failed, durationMs: Math.round(performance.now() - t0) }))
          ctx.recordCall(`job:${job.type}`, performance.now() - t0, false, err)
        }
      }
      pruneJobs()
    } finally {
      running = false
    }
    return count
  }

  /** Keep the newest 150 finished jobs so storage doesn't grow forever. */
  function pruneJobs() {
    const finished = Object.values(db.getState().jobs)
      .filter((j) => j.status === 'done')
      .sort((a, b) => b.finishedAt - a.finishedAt)
    if (finished.length <= 150) return
    db.transact((tx) => {
      for (const j of finished.slice(150)) tx.remove('jobs', j.id)
    })
  }

  /** Scheduler: enqueues recurring system jobs for an org at their interval. */
  const SCHEDULE = [
    { type: 'reminders.overdue', every: 60_000, priority: 'normal' },
    { type: 'tasks.recurring', every: 5 * 60_000, priority: 'low' },
    { type: 'projects.archive', every: 60 * 60_000, priority: 'low' },
    { type: 'reports.weekly', every: 7 * DAY, priority: 'low' },
    { type: 'github.sync', every: 10 * 60_000, priority: 'low' },
  ]

  function schedule(orgId) {
    const state = db.getState()
    const last = state.lastScan?.[orgId] ?? {}
    const due = SCHEDULE.filter((s) => ctx.now() - (last[s.type] ?? 0) >= s.every)
    if (!due.length) return
    db.transact((tx) => {
      const scans = tx.ensure('lastScan')
      scans[orgId] = { ...last }
      for (const s of due) {
        const integ = state.orgs[orgId]?.integrations
        if (
          (s.type === 'reports.weekly' && !integ?.email?.weeklyReport) ||
          (s.type === 'github.sync' && !(integ?.github?.connected && integ.github.verified))
        ) {
          scans[orgId][s.type] = ctx.now()
          continue
        }
        tx.put('jobs', createJob({ id: uid('j'), orgId, type: s.type, priority: s.priority, runAt: ctx.now() }))
        scans[orgId][s.type] = ctx.now()
      }
    })
  }

  return {
    _tick: tick,
    _schedule: schedule,
    _handlers: handlers,

    /** Starts the in-browser worker. Returns a stop function. */
    startWorker({ interval = 2000 } = {}) {
      const loop = () => {
        const { orgId } = ctx.session.get()
        if (orgId) schedule(orgId)
        tick().catch(() => {})
      }
      loop()
      const id = setInterval(loop, interval)
      return () => clearInterval(id)
    },

    async enqueueJob(type, { priority = 'normal', payload = {} } = {}) {
      if (!handlers[type] || type === 'webhook.deliver' || type === 'files.process')
        throw new ApiError('validation', 'This job type cannot be started manually.', 422)
      return ctx.mutate('jobs.manage', (tx, a) => {
        const job = tx.put(
          'jobs',
          createJob({ id: uid('j'), orgId: a.orgId, type, priority, payload, runAt: ctx.now() }),
        )
        a.audit(tx, { action: 'job.enqueued', entityType: 'job', entityId: job.id, summary: `Started job “${type}”` })
        return job
      })
    },

    async retryJob(id) {
      return ctx.mutate('jobs.manage', (tx, a) => {
        const job = ctx.inOrg('jobs', id, a.orgId)
        if (job.status !== 'dead') throw new ApiError('validation', 'Only dead-lettered jobs can be retried.', 422)
        tx.put('jobs', requeue(job, ctx.now()))
        a.audit(tx, {
          action: 'job.retried',
          entityType: 'job',
          entityId: id,
          summary: `Retried failed job “${job.type}”`,
        })
      })
    },

    async discardJob(id) {
      return ctx.mutate('jobs.manage', (tx, a) => {
        ctx.inOrg('jobs', id, a.orgId)
        tx.remove('jobs', id)
      })
    },

    // ------------------------------------------------------------ audit: restore previous versions
    async restoreFromAudit(auditId) {
      return ctx.mutate('audit.restore', (tx, a) => {
        const entry = tx.state.audit.find((e) => e.id === auditId && e.orgId === a.orgId)
        if (!entry) throw new ApiError('not_found', 'Audit entry not found.', 404)
        if (!RESTORABLE.includes(entry.entityType) || !entry.before)
          throw new ApiError('validation', 'This change cannot be restored.', 422)
        const collection = { task: 'tasks', project: 'projects', rule: 'rules' }[entry.entityType]
        const current = tx.state[collection][entry.entityId]
        const restored = {
          ...entry.before,
          ...(current && { version: (current.version ?? 1) + 1 }),
          updatedAt: ctx.now(),
        }
        if (collection === 'tasks') restored.blockedBy = restored.blockedBy.filter((id) => tx.state.tasks[id])
        tx.put(collection, restored)
        a.audit(tx, {
          action: `${entry.entityType}.restored`,
          entityType: entry.entityType,
          entityId: entry.entityId,
          before: current ?? null,
          after: restored,
          summary: `Restored ${entry.entityType} ${restored.key ?? restored.name} to its state before: “${entry.summary}”`,
        })
        return restored
      })
    },

    // ------------------------------------------------------------ custom fields
    async saveField({ id, name, type, options = [], required = false }) {
      return ctx.mutate('settings.manage', (tx, a) => {
        const existing = Object.values(tx.state.fieldDefs).filter((f) => f.orgId === a.orgId)
        const def = {
          id: id ?? fieldIdFromName(name),
          orgId: a.orgId,
          name: String(name ?? '').trim(),
          type,
          options: options.map((o) => o.trim()).filter(Boolean),
          required: Boolean(required),
        }
        if (!id && tx.state.fieldDefs[def.id]) def.id = `${def.id}_${Math.random().toString(36).slice(2, 5)}`
        const err = validateFieldDef(def, existing)
        if (err) throw new ApiError('validation', err, 422)
        tx.put('fieldDefs', def)
        a.audit(tx, {
          action: id ? 'field.updated' : 'field.created',
          entityType: 'field',
          entityId: def.id,
          after: def,
          summary: `${id ? 'Updated' : 'Added'} custom field “${def.name}”`,
        })
        return def
      })
    },

    async deleteField(id) {
      return ctx.mutate('settings.manage', (tx, a) => {
        const f = ctx.inOrg('fieldDefs', id, a.orgId)
        tx.remove('fieldDefs', id)
        a.audit(tx, {
          action: 'field.deleted',
          entityType: 'field',
          entityId: id,
          before: f,
          summary: `Deleted custom field “${f.name}” (values are kept on tasks)`,
        })
      })
    },

    async updateOrgSettings({ name, capacity }) {
      return ctx.mutate('settings.manage', (tx, a) => {
        const org = tx.state.orgs[a.orgId]
        const next = {
          ...(name !== undefined && { name: cleanText(name, { max: 60, required: true, field: 'Workspace name' }) }),
          ...(capacity !== undefined && { capacity: Math.max(1, Math.min(30, Number(capacity) || 5)) }),
        }
        tx.patch('orgs', a.orgId, next)
        a.audit(tx, {
          action: 'settings.updated',
          entityType: 'org',
          entityId: a.orgId,
          before: { name: org.name, capacity: org.capacity },
          after: next,
          summary: 'Updated workspace settings',
        })
      })
    },

    // ------------------------------------------------------------ saved searches
    async saveSearch({ name, query, filters }) {
      const { user, orgId } = ctx.actor()
      return db.transact((tx) =>
        tx.put('savedSearches', {
          id: uid('s'),
          orgId,
          userId: user.id,
          name: cleanText(name, { max: 40, required: true, field: 'Name' }),
          query: cleanText(query, { max: 100 }),
          filters: filters ?? {},
          createdAt: ctx.now(),
        }),
      )
    },

    async deleteSavedSearch(id) {
      const { user } = ctx.actor()
      db.transact((tx) => {
        if (tx.state.savedSearches[id]?.userId === user.id) tx.remove('savedSearches', id)
      })
    },
  }
}
