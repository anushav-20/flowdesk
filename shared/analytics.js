/**
 * Productivity analytics and deadline prediction. Pure functions over task lists.
 */

const DAY = 86_400_000
export const startOfDay = (ts) => {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export const isOverdue = (task, now = Date.now()) =>
  task.status !== 'done' && Boolean(task.dueDate) && new Date(task.dueDate).getTime() + DAY - 1 < now

export function summarize(tasks, now = Date.now()) {
  const done = tasks.filter((t) => t.status === 'done').length
  const overdue = tasks.filter((t) => isOverdue(t, now)).length
  return {
    total: tasks.length,
    done,
    pending: tasks.length - done,
    overdue,
    inReview: tasks.filter((t) => t.status === 'review').length,
    completionRate: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
  }
}

/** Tasks completed per day for the last `days` days (oldest first). */
export function completedPerDay(tasks, { now = Date.now(), days = 14 } = {}) {
  const today = startOfDay(now)
  const buckets = Array.from({ length: days }, (_, i) => ({ day: today - (days - 1 - i) * DAY, count: 0 }))
  for (const t of tasks) {
    if (!t.completedAt) continue
    const idx = Math.round((startOfDay(t.completedAt) - buckets[0].day) / DAY)
    if (idx >= 0 && idx < days) buckets[idx].count++
  }
  return buckets
}

/** Created vs completed per ISO week for the last `weeks` weeks. */
export function weeklyProgress(tasks, { now = Date.now(), weeks = 6 } = {}) {
  const end = startOfDay(now) + DAY
  const out = []
  for (let i = weeks - 1; i >= 0; i--) {
    const to = end - i * 7 * DAY
    const from = to - 7 * DAY
    out.push({
      from,
      to,
      created: tasks.filter((t) => t.createdAt >= from && t.createdAt < to).length,
      completed: tasks.filter((t) => t.completedAt >= from && t.completedAt < to).length,
    })
  }
  return out
}

/** Per-member workload and productivity. `capacity` = open tasks before someone counts as overloaded. */
export function workload(tasks, members, { capacity = 5, now = Date.now() } = {}) {
  const weekAgo = now - 7 * DAY
  return members
    .map((m) => {
      const mine = tasks.filter((t) => t.assigneeId === m.id)
      const open = mine.filter((t) => t.status !== 'done')
      const hours = open.reduce((h, t) => h + (Number(t.estimate) || 0), 0)
      return {
        memberId: m.id,
        name: m.name,
        open: open.length,
        hours,
        overdue: open.filter((t) => isOverdue(t, now)).length,
        completedThisWeek: mine.filter((t) => t.completedAt >= weekAgo).length,
        utilisation: Math.round((open.length / capacity) * 100),
        overloaded: open.length > capacity,
      }
    })
    .sort((a, b) => b.open - a.open)
}

/**
 * Smart deadline prediction: uses recent velocity (tasks done per day, last `windowDays`)
 * to forecast when the remaining work will be finished, and compares it to the deadline.
 */
export function predictCompletion(tasks, { deadline, now = Date.now(), windowDays = 14 } = {}) {
  const remaining = tasks.filter((t) => t.status !== 'done').length
  const recent = tasks.filter((t) => t.completedAt && t.completedAt >= now - windowDays * DAY).length
  const velocity = recent / windowDays // tasks per day
  if (tasks.length === 0) return { remaining: 0, velocity: 0, predictedDate: null, risk: 'empty', daysLate: null }
  if (remaining === 0) return { remaining, velocity, predictedDate: now, risk: 'done', daysLate: 0 }
  if (velocity === 0) {
    return { remaining, velocity, predictedDate: null, risk: deadline ? 'high' : 'unknown', daysLate: null }
  }
  const predictedDate = now + Math.ceil(remaining / velocity) * DAY
  if (!deadline) return { remaining, velocity, predictedDate, risk: 'unknown', daysLate: 0 }
  const dl = new Date(deadline).getTime() + DAY - 1
  const daysLate = Math.max(0, Math.ceil((predictedDate - dl) / DAY))
  const slack = (dl - predictedDate) / DAY
  const risk = daysLate > 0 ? 'high' : slack < 3 ? 'medium' : 'low'
  return { remaining, velocity: Math.round(velocity * 100) / 100, predictedDate, risk, daysLate }
}

export const projectProgress = (tasks) =>
  tasks.length ? Math.round((tasks.filter((t) => t.status === 'done').length / tasks.length) * 100) : 0
