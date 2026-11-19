/**
 * Background job queue semantics (storage-agnostic).
 * The browser runner and the Node worker both use these rules:
 *  - higher priority first, then oldest `runAt`
 *  - failed jobs retry with exponential backoff + jitter
 *  - after `maxAttempts` a job moves to the dead-letter queue ('dead')
 */

export const JOB_PRIORITY = { high: 10, normal: 5, low: 1 }
export const JOB_TYPES = {
  'reminders.overdue': 'Send overdue reminders',
  'tasks.recurring': 'Create recurring tasks',
  'reports.weekly': 'Generate weekly report',
  'webhook.deliver': 'Deliver webhook',
  'notifications.bulk': 'Send bulk notifications',
  'projects.archive': 'Archive inactive projects',
  'files.process': 'Process uploaded file',
}

export function createJob({ id, orgId, type, payload = {}, priority = 'normal', runAt = Date.now(), maxAttempts = 4 }) {
  return {
    id,
    orgId,
    type,
    payload,
    priority: JOB_PRIORITY[priority] ?? JOB_PRIORITY.normal,
    status: 'queued',
    attempts: 0,
    maxAttempts,
    runAt,
    lastError: null,
    createdAt: Date.now(),
    finishedAt: null,
  }
}

/** Next job that is due, by priority then age. */
export function pickNext(jobs, now = Date.now()) {
  let best = null
  for (const j of jobs) {
    if (j.status !== 'queued' || j.runAt > now) continue
    if (!best || j.priority > best.priority || (j.priority === best.priority && j.runAt < best.runAt)) best = j
  }
  return best
}

/** Backoff: 2s, 4s, 8s… capped at 5 min, ±20% jitter so retries don't stampede. */
export function backoffMs(attempt, random = Math.random) {
  const base = Math.min(300_000, 2000 * 2 ** Math.max(0, attempt - 1))
  return Math.round(base * (0.8 + random() * 0.4))
}

export function markRunning(job, now = Date.now()) {
  return { ...job, status: 'running', attempts: job.attempts + 1, startedAt: now }
}

export function markSucceeded(job, result, now = Date.now()) {
  return { ...job, status: 'done', result: result ?? null, finishedAt: now, lastError: null }
}

export function markFailed(job, error, now = Date.now(), random = Math.random) {
  const message = String(error?.message ?? error).slice(0, 300)
  if (job.attempts >= job.maxAttempts) return { ...job, status: 'dead', lastError: message, finishedAt: now }
  return { ...job, status: 'queued', lastError: message, runAt: now + backoffMs(job.attempts, random) }
}

/** Manually retry a dead job from the dead-letter queue. */
export function requeue(job, now = Date.now()) {
  return { ...job, status: 'queued', attempts: 0, runAt: now, lastError: null, finishedAt: null }
}

export function queueStats(jobs) {
  const s = { queued: 0, running: 0, done: 0, dead: 0 }
  for (const j of jobs) s[j.status] = (s[j.status] ?? 0) + 1
  return s
}
