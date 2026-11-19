import { isOverdue, summarize } from '../../../shared/analytics.js'
import { isDueSoon } from '../../../shared/automation.js'
import { id, logger, toCamel } from '../lib/util.js'
import { orgTasks } from './tasks.js'
import { syncGitHub } from './github.js'
import { deliverWebhook } from './webhooks.js'
import { systemActor, withWrite } from './write.js'

const DAY = 86_400_000

/** Job handlers by type. Each returns a short result string (stored on the job). */
export const handlers = {
  'webhook.deliver': deliverWebhook,

  async 'github.sync'(ctx, job) {
    const r = await syncGitHub(ctx, job.orgId)
    return `Checked ${r.pulls} PRs and ${r.commits} commits · ${r.updated} task(s) updated`
  },

  async 'reminders.overdue'(ctx, job) {
    const today = new Date(ctx.now()).toISOString().slice(0, 10)
    const all = await orgTasks(ctx.db, job.orgId)
    const tasks = all.filter((t) => isOverdue(t, ctx.now()) && t.overdueNotifiedOn !== today)
    // overdue_notified_on remembers the last reminder: "soon:<due date>" or the day it was flagged overdue
    const dueSoon = all.filter((t) => isDueSoon(t, ctx.now()) && t.overdueNotifiedOn !== `soon:${t.dueDate}`)
    if (!tasks.length && !dueSoon.length) return 'No new deadline reminders'
    await withWrite(ctx, systemActor(job.orgId, 'Scheduler'), async (w) => {
      for (const t of dueSoon) {
        await w.t.query('UPDATE tasks SET overdue_notified_on = $3 WHERE org_id = $1 AND id = $2', [
          job.orgId,
          t.id,
          `soon:${t.dueDate}`,
        ])
        w.emit('task.due_soon', t)
      }
      for (const t of tasks) {
        await w.t.query('UPDATE tasks SET overdue_notified_on = $3 WHERE org_id = $1 AND id = $2', [
          job.orgId,
          t.id,
          today,
        ])
        w.emit('task.overdue', { ...t, overdueNotifiedOn: today })
      }
    })
    return `${tasks.length} overdue, ${dueSoon.length} due soon`
  },

  async 'reports.weekly'(ctx, job) {
    const tasks = await orgTasks(ctx.db, job.orgId)
    const s = summarize(tasks, ctx.now())
    const done = tasks.filter((t) => t.completedAt >= ctx.now() - 7 * DAY)
    const admins = await ctx.db.query(
      "SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = $1 AND m.role IN ('owner','admin')",
      [job.orgId],
    )
    const org = await ctx.db.one('SELECT name FROM orgs WHERE id = $1', [job.orgId])
    // A real deployment would hand this to an email provider (SES, Postmark…); here it goes to the outbox table.
    await ctx.db.query(
      'INSERT INTO outbox (id, org_id, to_list, subject, summary, lines, at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [
        id('mail'),
        job.orgId,
        JSON.stringify(admins.map((a) => a.email)),
        `Weekly report — ${org.name}`,
        `${done.length} tasks completed this week · ${s.pending} open · ${s.overdue} overdue · ${s.completionRate}% overall`,
        JSON.stringify(done.slice(0, 10).map((t) => `${t.key} ${t.title}`)),
        ctx.now(),
      ],
    )
    return `Report sent to ${admins.length} admin(s)`
  },

  async 'notifications.bulk'(ctx, job) {
    const members = await ctx.db.query('SELECT user_id FROM memberships WHERE org_id = $1', [job.orgId])
    for (const m of members)
      await ctx.db.query(
        "INSERT INTO notifications (id, org_id, user_id, type, message, read, created_at) VALUES ($1,$2,$3,'announcement',$4,false,$5)",
        [id('n'), job.orgId, m.user_id, String(job.payload.message).slice(0, 300), ctx.now()],
      )
    return `Notified ${members.length} members`
  },

  async 'projects.archive'(ctx, job) {
    const projects = (
      await ctx.db.query('SELECT * FROM projects WHERE org_id = $1 AND archived = false', [job.orgId])
    ).map(toCamel)
    const tasks = await orgTasks(ctx.db, job.orgId)
    const stale = projects.filter(
      (p) =>
        ctx.now() - Math.max(p.createdAt, ...tasks.filter((t) => t.projectId === p.id).map((t) => t.updatedAt)) >
        30 * DAY,
    )
    if (!stale.length) return 'No inactive projects'
    await withWrite(ctx, systemActor(job.orgId, 'Scheduler'), async (w) => {
      for (const p of stale) {
        await w.t.query('UPDATE projects SET archived = true WHERE id = $1', [p.id])
        await w.audit({
          action: 'project.archived',
          entityType: 'project',
          entityId: p.id,
          before: p,
          after: { ...p, archived: true },
          summary: `Archived inactive project ${p.name}`,
        })
      }
    })
    return `Archived ${stale.length} project(s)`
  },

  async 'tasks.recurring'(ctx, job) {
    const tasks = (await orgTasks(ctx.db, job.orgId)).filter((t) => t.recurrence)
    const open = new Set(tasks.filter((t) => t.status !== 'done').map((t) => t.recurrenceOf ?? t.id))
    const orphaned = tasks.filter((t) => t.status === 'done' && !open.has(t.recurrenceOf ?? t.id))
    return orphaned.length ? `${orphaned.length} series need attention` : 'All recurring series are up to date'
  },
}

const SCHEDULE = [
  { type: 'reminders.overdue', every: 60_000 },
  { type: 'tasks.recurring', every: 5 * 60_000 },
  { type: 'projects.archive', every: 60 * 60_000 },
  { type: 'reports.weekly', every: 7 * DAY },
  { type: 'github.sync', every: 10 * 60_000 },
]

/**
 * Worker loop: enqueue scheduled jobs, then process due jobs one at a time.
 * Run more worker processes to scale out — claiming is race-safe.
 */
export function startWorker(ctx) {
  const lastRun = new Map()
  let busy = false

  async function tick() {
    if (busy) return
    busy = true
    try {
      const orgs = await ctx.db.query('SELECT id, integrations FROM orgs')
      for (const org of orgs) {
        for (const s of SCHEDULE) {
          const key = `${org.id}:${s.type}`
          if (ctx.now() - (lastRun.get(key) ?? 0) < s.every) continue
          lastRun.set(key, ctx.now())
          if (s.type === 'reports.weekly' && !org.integrations?.email?.weeklyReport) continue
          if (s.type === 'github.sync' && !(org.integrations?.github?.connected && org.integrations.github.verified))
            continue
          await ctx.queue.enqueue(null, { orgId: org.id, type: s.type, priority: 'low' })
        }
      }
      await processDue(ctx)
    } catch (err) {
      logger.error('worker_tick_failed', { message: err.message })
    } finally {
      busy = false
    }
  }

  const timer = setInterval(tick, ctx.config.worker.intervalMs)
  tick()
  return () => clearInterval(timer)
}

/** Processes up to `max` due jobs. Exported so tests can drive the queue deterministically. */
export async function processDue(ctx, max = 20) {
  let n = 0
  for (; n < max; n++) {
    const job = await ctx.queue.claim()
    if (!job) break
    try {
      const handler = handlers[job.type]
      if (!handler) throw new Error(`No handler for ${job.type}`)
      await ctx.queue.succeed(job, await handler(ctx, job))
    } catch (err) {
      const failed = await ctx.queue.fail(job, err)
      logger.warn('job_failed', {
        jobId: job.id,
        type: job.type,
        attempts: failed.attempts,
        status: failed.status,
        message: err.message,
      })
    }
  }
  return n
}
