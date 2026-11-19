import { projectProgress } from '../../../shared/analytics.js'
import { validateCustomValues } from '../../../shared/customFields.js'
import { applyEvent, BADGES, emptyStats } from '../../../shared/gamification.js'
import { openBlockers, wouldCreateCycle } from '../../../shared/graph.js'
import { nextOccurrence } from '../../../shared/recurrence.js'
import { badRequest, conflict, notFound } from '../lib/errors.js'
import { id, toCamel } from '../lib/util.js'

/**
 * Task domain service. The rules (blockers, cycles, recurrence, gamification,
 * custom-field validation) come from /shared, so they're identical to the browser engine.
 */

export const STATUS_LABELS = { todo: 'To do', progress: 'In progress', review: 'Review', done: 'Completed' }

const JSON_FIELDS = ['blockedBy', 'customFields', 'recurrence', 'approval', 'links']

/** DB row → task. JSON columns are normalised defensively (some drivers return JSON defaults as text). */
export function rowToTask(row) {
  if (!row) return null
  const t = toCamel(row)
  for (const f of JSON_FIELDS) if (typeof t[f] === 'string') t[f] = JSON.parse(t[f])
  return t
}

export async function loadTask(t, orgId, taskId) {
  const task = rowToTask(await t.one('SELECT * FROM tasks WHERE org_id = $1 AND id = $2', [orgId, taskId]))
  if (!task) throw notFound('Task')
  return task
}

export const orgTasks = async (t, orgId) =>
  (await t.query('SELECT * FROM tasks WHERE org_id = $1', [orgId])).map(rowToTask)

async function saveTask(t, task) {
  await t.query(
    `UPDATE tasks SET title=$3, description=$4, status=$5, priority=$6, assignee_id=$7, due_date=$8, estimate=$9, blocked_by=$10,
       parent_id=$11, custom_fields=$12, recurrence=$13, approval=$14, links=$15, time_spent=$16, overdue_notified_on=$17,
       project_id=$18, updated_at=$19, completed_at=$20, version=$21
     WHERE org_id=$1 AND id=$2`,
    [
      task.orgId,
      task.id,
      task.title,
      task.description,
      task.status,
      task.priority,
      task.assigneeId,
      task.dueDate,
      task.estimate,
      JSON.stringify(task.blockedBy),
      task.parentId,
      JSON.stringify(task.customFields),
      task.recurrence ? JSON.stringify(task.recurrence) : null,
      JSON.stringify(task.approval),
      JSON.stringify(task.links),
      task.timeSpent,
      task.overdueNotifiedOn ?? null,
      task.projectId,
      task.updatedAt,
      task.completedAt,
      task.version,
    ],
  )
}

export async function award(w, userId, event) {
  if (!userId || userId === 'system') return
  const row = await w.t.one('SELECT stats FROM user_stats WHERE org_id = $1 AND user_id = $2', [w.actor.orgId, userId])
  const { stats, newBadges } = applyEvent(row?.stats ?? emptyStats(), { ...event, at: w.now })
  if (row)
    await w.t.query('UPDATE user_stats SET stats = $3 WHERE org_id = $1 AND user_id = $2', [
      w.actor.orgId,
      userId,
      JSON.stringify(stats),
    ])
  else
    await w.t.query('INSERT INTO user_stats (org_id, user_id, stats) VALUES ($1,$2,$3)', [
      w.actor.orgId,
      userId,
      JSON.stringify(stats),
    ])
  for (const b of newBadges)
    await w.notify({ userId, type: 'badge', message: `${BADGES[b].icon} Achievement unlocked: ${BADGES[b].name}` })
}

export async function createTask(w, input) {
  const { t, actor } = w
  const project = await t.one('SELECT id FROM projects WHERE org_id = $1 AND id = $2', [actor.orgId, input.projectId])
  if (!project) throw badRequest('Choose a project in this workspace.')
  if (
    input.assigneeId &&
    !(await t.one('SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2', [actor.orgId, input.assigneeId]))
  )
    throw badRequest('Assignee must be a workspace member.')

  const defs = (await t.query('SELECT * FROM field_defs WHERE org_id = $1', [actor.orgId])).map(toCamel)
  const cf = validateCustomValues(defs, input.customFields ?? {})
  if (!cf.valid) throw badRequest(Object.values(cf.errors)[0])

  // Atomic per-tenant sequence for human-friendly keys (FD-1, FD-2…)
  const seq = await t.one('UPDATE orgs SET task_seq = task_seq + 1 WHERE id = $1 RETURNING task_seq, key_prefix', [
    actor.orgId,
  ])
  const existing = new Set((await t.query('SELECT id FROM tasks WHERE org_id = $1', [actor.orgId])).map((r) => r.id))
  const task = {
    id: id('t'),
    orgId: actor.orgId,
    projectId: input.projectId,
    key: `${seq.key_prefix}-${seq.task_seq}`,
    title: input.title,
    description: input.description ?? '',
    status: input.status ?? 'todo',
    priority: input.priority ?? 'medium',
    assigneeId: input.assigneeId ?? null,
    dueDate: input.dueDate ?? null,
    estimate: input.estimate ?? 0,
    blockedBy: (input.blockedBy ?? []).filter((b) => existing.has(b)),
    parentId: input.parentId && existing.has(input.parentId) ? input.parentId : null,
    customFields: cf.values,
    recurrence: input.recurrence ?? null,
    recurrenceOf: input.recurrenceOf ?? null,
    approval: { status: 'none', step: 0, history: [] },
    links: [],
    timeSpent: 0,
    createdBy: actor.user.id,
    createdAt: w.now,
    updatedAt: w.now,
    completedAt: input.status === 'done' ? w.now : null,
    version: 1,
  }
  await t.query(
    `INSERT INTO tasks (id, org_id, project_id, key, title, description, status, priority, assignee_id, due_date, estimate, blocked_by, parent_id,
       custom_fields, recurrence, recurrence_of, approval, links, time_spent, created_by, created_at, updated_at, completed_at, version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
    [
      task.id,
      task.orgId,
      task.projectId,
      task.key,
      task.title,
      task.description,
      task.status,
      task.priority,
      task.assigneeId,
      task.dueDate,
      task.estimate,
      JSON.stringify(task.blockedBy),
      task.parentId,
      JSON.stringify(task.customFields),
      task.recurrence ? JSON.stringify(task.recurrence) : null,
      task.recurrenceOf,
      JSON.stringify(task.approval),
      '[]',
      0,
      task.createdBy,
      task.createdAt,
      task.updatedAt,
      task.completedAt,
      1,
    ],
  )
  await w.audit({
    action: 'task.created',
    entityType: 'task',
    entityId: task.id,
    after: task,
    summary: `Created ${task.key} ${task.title}`,
  })
  w.emit('task.created', task)
  if (task.assigneeId && task.assigneeId !== actor.user.id)
    await w.notify({
      userId: task.assigneeId,
      type: 'assignment',
      message: `${actor.user.name} assigned you ${task.key} ${task.title}`,
      link: { taskId: task.id },
    })
  return task
}

/**
 * Applies a change set to a task, enforcing the business rules and emitting domain events.
 * `expectedVersion` gives optimistic concurrency: if someone else saved first → 409.
 */
export async function applyChange(w, task, changes, { expectedVersion, approved = false } = {}) {
  const { t, actor } = w
  if (expectedVersion != null && expectedVersion !== task.version)
    throw conflict('version_conflict', 'Someone else changed this task. Reload to see the latest version.')

  const tasks = await orgTasks(t, actor.orgId)
  const byId = Object.fromEntries(tasks.map((x) => [x.id, x]))
  const next = { ...task, ...changes, updatedAt: w.now, version: task.version + 1 }

  if (
    changes.assigneeId &&
    !(await t.one('SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2', [actor.orgId, changes.assigneeId]))
  )
    throw badRequest('Assignee must be a workspace member.')
  if (
    changes.projectId &&
    !(await t.one('SELECT 1 FROM projects WHERE org_id=$1 AND id=$2', [actor.orgId, changes.projectId]))
  )
    throw badRequest('Choose a project in this workspace.')
  if (changes.customFields) {
    const defs = (await t.query('SELECT * FROM field_defs WHERE org_id = $1', [actor.orgId])).map(toCamel)
    const cf = validateCustomValues(defs, changes.customFields)
    if (!cf.valid) throw badRequest(Object.values(cf.errors)[0])
    next.customFields = cf.values
  }
  if (changes.blockedBy) {
    for (const p of changes.blockedBy) {
      if (!byId[p]) throw badRequest('Unknown prerequisite.')
      if (!task.blockedBy.includes(p) && wouldCreateCycle(tasks, task.id, p))
        throw conflict('cycle', 'That would create a circular dependency.')
    }
  }
  const statusChanged = changes.status && changes.status !== task.status
  if (statusChanged) {
    if (changes.status !== 'todo') {
      const blockers = openBlockers(next, byId)
      if (blockers.length)
        throw conflict(
          'blocked',
          `Blocked by ${blockers.map((b) => byId[b].key).join(', ')} — finish prerequisites first.`,
        )
    }
    if (changes.status === 'done' && task.approval?.status === 'pending' && !approved)
      throw conflict('approval_pending', 'This task is waiting for approval and will complete when approved.')
    next.completedAt = changes.status === 'done' ? w.now : null
  }

  const before = projectProgress(tasks.filter((x) => x.projectId === task.projectId))
  await saveTask(t, next)
  await w.audit({
    action: 'task.updated',
    entityType: 'task',
    entityId: task.id,
    before: task,
    after: next,
    summary: describe(task, next),
  })

  w.emit('task.updated', next, { before: task })
  if (changes.assigneeId && changes.assigneeId !== task.assigneeId) {
    w.emit('task.assigned', next)
    if (changes.assigneeId !== actor.user.id)
      await w.notify({
        userId: changes.assigneeId,
        type: 'assignment',
        message: `${actor.user.name} assigned you ${next.key} ${next.title}`,
        link: { taskId: next.id },
      })
  }
  if (statusChanged) {
    w.emit('task.status_changed', next, { before: task })
    if (next.status === 'done') {
      w.emit('task.completed', next)
      await award(w, next.assigneeId ?? actor.user.id, { type: 'task_completed', priority: next.priority })
      if (next.recurrence) {
        await createTask(w, {
          title: next.title,
          description: next.description,
          projectId: next.projectId,
          priority: next.priority,
          assigneeId: next.assigneeId,
          estimate: next.estimate,
          customFields: next.customFields,
          recurrence: next.recurrence,
          recurrenceOf: next.recurrenceOf ?? next.id,
          dueDate: nextOccurrence(next.dueDate ?? new Date(w.now).toISOString().slice(0, 10), next.recurrence),
        })
      }
      if (next.parentId) {
        const siblings = (await orgTasks(t, actor.orgId)).filter((x) => x.parentId === next.parentId)
        const parent = byId[next.parentId]
        if (parent && parent.status !== 'done' && siblings.every((s) => s.status === 'done'))
          w.emit('subtasks.completed', parent)
      }
    }
    const after = projectProgress((await orgTasks(t, actor.orgId)).filter((x) => x.projectId === task.projectId))
    if (after !== before) {
      const project = toCamel(await t.one('SELECT * FROM projects WHERE id = $1', [task.projectId]))
      w.emit('project.progress', { ...project, projectId: project.id, progress: after, previousProgress: before })
      if (after === 100) w.emit('project.completed', project)
    }
  }
  return next
}

export async function deleteTask(w, task) {
  const { t, actor } = w
  await t.query('DELETE FROM comments WHERE org_id = $1 AND task_id = $2', [actor.orgId, task.id])
  await t.query('DELETE FROM tasks WHERE org_id = $1 AND id = $2', [actor.orgId, task.id])
  for (const other of await orgTasks(t, actor.orgId)) {
    if (other.blockedBy.includes(task.id) || other.parentId === task.id) {
      await saveTask(t, {
        ...other,
        blockedBy: other.blockedBy.filter((b) => b !== task.id),
        parentId: other.parentId === task.id ? null : other.parentId,
      })
    }
  }
  await w.audit({
    action: 'task.deleted',
    entityType: 'task',
    entityId: task.id,
    before: task,
    summary: `Deleted ${task.key} ${task.title}`,
  })
  w.emit('task.deleted', task)
}

function describe(a, b) {
  const parts = []
  if (a.status !== b.status) parts.push(`moved ${b.key} from ${STATUS_LABELS[a.status]} to ${STATUS_LABELS[b.status]}`)
  if (a.title !== b.title) parts.push(`renamed ${b.key} to “${b.title}”`)
  if (a.assigneeId !== b.assigneeId) parts.push(`reassigned ${b.key}`)
  if (a.priority !== b.priority) parts.push(`set ${b.key} priority to ${b.priority}`)
  if (a.dueDate !== b.dueDate) parts.push(`changed ${b.key} due date to ${b.dueDate ?? 'none'}`)
  if (JSON.stringify(a.blockedBy) !== JSON.stringify(b.blockedBy)) parts.push(`updated ${b.key} dependencies`)
  if (JSON.stringify(a.approval) !== JSON.stringify(b.approval))
    parts.push(`approval for ${b.key}: ${b.approval.status}`)
  if (JSON.stringify(a.links) !== JSON.stringify(b.links)) parts.push(`linked GitHub activity to ${b.key}`)
  return parts.join(', ') || `updated ${b.key}`
}
