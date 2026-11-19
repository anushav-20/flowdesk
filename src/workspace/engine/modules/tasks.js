import { projectProgress } from '@shared/analytics.js'
import { validateCustomValues } from '@shared/customFields.js'
import { applyEvent, BADGES, emptyStats } from '@shared/gamification.js'
import { openBlockers, wouldCreateCycle } from '@shared/graph.js'
import { nextOccurrence } from '@shared/recurrence.js'
import { ApiError, cleanText, ISO_DATE, notify, PRIORITIES, STATUS_LABELS, STATUSES, uid } from '../core'

/** Gamification inside a transaction: points, streaks, badges (+ a notification per new badge). */
export function award(tx, { orgId, userId, now }, event) {
  if (!userId) return
  const key = `${orgId}:${userId}`
  const { stats, newBadges } = applyEvent(tx.state.stats[key] ?? emptyStats(), { ...event, at: now })
  tx.ensure('stats')[key] = stats
  for (const b of newBadges)
    notify(tx, {
      orgId,
      userId,
      type: 'badge',
      message: `${BADGES[b].icon} Achievement unlocked: ${BADGES[b].name}`,
      now,
    })
}

const validDate = (d, field) => {
  if (d == null || d === '') return null
  if (!ISO_DATE.test(d) || Number.isNaN(Date.parse(d)))
    throw new ApiError('validation', `${field} must be a valid date.`, 422)
  return d
}

/** Projects, tasks, dependencies, subtasks, recurrence and calendar events. */
export function tasksModule(ctx) {
  const orgTasks = (state, orgId) => Object.values(state.tasks).filter((t) => t.orgId === orgId)

  /** Applies a validated change set to a task and emits the right domain events. */
  function applyTaskChange(tx, a, task, changes) {
    const now = ctx.now()
    const state = tx.state
    const next = { ...task, ...changes, updatedAt: now, version: task.version + 1 }

    if (changes.status && changes.status !== task.status) {
      if (changes.status !== 'todo') {
        const blockers = openBlockers(next, state.tasks)
        if (blockers.length)
          throw new ApiError(
            'blocked',
            `Blocked by ${blockers.map((id) => state.tasks[id].key).join(', ')} — finish prerequisites first.`,
            409,
          )
      }
      if (changes.status === 'done' && task.approval?.status === 'pending' && !changes._approved)
        throw new ApiError(
          'approval_pending',
          'This task is waiting for approval and will complete when approved.',
          409,
        )
      next.completedAt = changes.status === 'done' ? now : null
    }
    delete next._approved

    const projectBefore = projectProgress(orgTasks(state, a.orgId).filter((t) => t.projectId === task.projectId))
    tx.put('tasks', next)
    a.audit(tx, {
      action: 'task.updated',
      entityType: 'task',
      entityId: task.id,
      before: task,
      after: next,
      summary: describeChange(task, next, state),
    })

    // ---- domain events
    a.emit('task.updated', next, { before: task })
    if (changes.assigneeId !== undefined && changes.assigneeId !== task.assigneeId && changes.assigneeId) {
      a.emit('task.assigned', next)
      if (changes.assigneeId !== a.user.id)
        notify(tx, {
          orgId: a.orgId,
          userId: changes.assigneeId,
          type: 'assignment',
          message: `${a.user.name} assigned you ${next.key} ${next.title}`,
          link: { taskId: next.id },
          now,
        })
    }
    if (changes.status && changes.status !== task.status) {
      a.emit('task.status_changed', next, { before: task })
      if (changes.status === 'done') {
        a.emit('task.completed', next)
        award(
          tx,
          { orgId: a.orgId, userId: next.assigneeId ?? a.user.id, now },
          { type: 'task_completed', priority: next.priority },
        )

        // Recurring task → create the next occurrence
        if (next.recurrence) {
          const from = next.dueDate ?? new Date(now).toISOString().slice(0, 10)
          createTaskInTx(tx, a, {
            ...pick(next, [
              'title',
              'description',
              'projectId',
              'priority',
              'assigneeId',
              'estimate',
              'customFields',
              'recurrence',
            ]),
            dueDate: nextOccurrence(from, next.recurrence),
            recurrenceOf: next.recurrenceOf ?? next.id,
          })
        }
        // Last subtask done → parent's subtasks are complete
        if (next.parentId) {
          const siblings = orgTasks(tx.state, a.orgId).filter((t) => t.parentId === next.parentId)
          const parent = tx.state.tasks[next.parentId]
          if (parent && parent.status !== 'done' && siblings.every((s) => s.status === 'done'))
            a.emit('subtasks.completed', parent)
        }
      }
      const projectAfter = projectProgress(orgTasks(tx.state, a.orgId).filter((t) => t.projectId === task.projectId))
      if (projectAfter !== projectBefore) {
        const project = tx.state.projects[task.projectId]
        a.emit('project.progress', {
          ...project,
          projectId: project.id,
          progress: projectAfter,
          previousProgress: projectBefore,
        })
        if (projectAfter === 100) a.emit('project.completed', project)
      }
    }
    return next
  }

  function createTaskInTx(tx, a, input) {
    const now = ctx.now()
    const project = tx.state.projects[input.projectId]
    if (!project || project.orgId !== a.orgId) throw new ApiError('validation', 'Choose a project.', 422)
    const counters = tx.ensure('counters')
    counters[a.orgId] = (counters[a.orgId] ?? 0) + 1
    const org = tx.state.orgs[a.orgId]
    const task = {
      id: uid('t'),
      orgId: a.orgId,
      key: `${org.keyPrefix}-${counters[a.orgId]}`,
      title: cleanText(input.title, { max: 120, required: true, field: 'Title' }),
      description: cleanText(input.description, { max: 4000, field: 'Description' }),
      projectId: project.id,
      status: STATUSES.includes(input.status) ? input.status : 'todo',
      priority: PRIORITIES.includes(input.priority) ? input.priority : 'medium',
      assigneeId: input.assigneeId && tx.state.memberships[`${a.orgId}:${input.assigneeId}`] ? input.assigneeId : null,
      dueDate: validDate(input.dueDate, 'Due date'),
      estimate: Math.max(0, Math.min(999, Number(input.estimate) || 0)),
      blockedBy: (input.blockedBy ?? []).filter((id) => tx.state.tasks[id]?.orgId === a.orgId),
      parentId: input.parentId && tx.state.tasks[input.parentId]?.orgId === a.orgId ? input.parentId : null,
      customFields: input.customFields ?? {},
      recurrence: input.recurrence ?? null,
      recurrenceOf: input.recurrenceOf ?? null,
      approval: { status: 'none', step: 0, history: [] },
      links: [],
      timeSpent: 0,
      createdBy: a.user.id,
      createdAt: now,
      updatedAt: now,
      completedAt: input.status === 'done' ? now : null,
      version: 1,
    }
    tx.put('tasks', task)
    a.audit(tx, {
      action: 'task.created',
      entityType: 'task',
      entityId: task.id,
      after: task,
      summary: `Created ${task.key} ${task.title}`,
    })
    a.emit('task.created', task)
    if (task.assigneeId && task.assigneeId !== a.user.id)
      notify(tx, {
        orgId: a.orgId,
        userId: task.assigneeId,
        type: 'assignment',
        message: `${a.user.name} assigned you ${task.key} ${task.title}`,
        link: { taskId: task.id },
        now,
      })
    return task
  }

  return {
    _applyTaskChange: applyTaskChange,
    _createTaskInTx: createTaskInTx,

    // ------------------------------------------------------------ projects
    async createProject({ name, description, deadline, color = '#6d5dfc' }) {
      return ctx.mutate('project.manage', (tx, a) => {
        const p = tx.put('projects', {
          id: uid('p'),
          orgId: a.orgId,
          name: cleanText(name, { max: 80, required: true, field: 'Project name' }),
          description: cleanText(description, { max: 500 }),
          color: /^#[0-9a-f]{6}$/i.test(color) ? color : '#6d5dfc',
          deadline: validDate(deadline, 'Deadline'),
          createdAt: ctx.now(),
          archived: false,
        })
        a.audit(tx, {
          action: 'project.created',
          entityType: 'project',
          entityId: p.id,
          after: p,
          summary: `Created project ${p.name}`,
        })
        return p
      })
    },

    async updateProject(id, changes) {
      return ctx.mutate('project.manage', (tx, a) => {
        const p = ctx.inOrg('projects', id, a.orgId)
        const next = {
          ...p,
          ...(changes.name !== undefined && {
            name: cleanText(changes.name, { max: 80, required: true, field: 'Project name' }),
          }),
          ...(changes.description !== undefined && { description: cleanText(changes.description, { max: 500 }) }),
          ...(changes.deadline !== undefined && { deadline: validDate(changes.deadline, 'Deadline') }),
          ...(changes.archived !== undefined && { archived: Boolean(changes.archived) }),
        }
        tx.put('projects', next)
        a.audit(tx, {
          action: 'project.updated',
          entityType: 'project',
          entityId: id,
          before: p,
          after: next,
          summary: `Updated project ${next.name}`,
        })
        return next
      })
    },

    async deleteProject(id) {
      return ctx.mutate('project.manage', (tx, a) => {
        const p = ctx.inOrg('projects', id, a.orgId)
        if (orgTasks(tx.state, a.orgId).some((t) => t.projectId === id))
          throw new ApiError('conflict', 'Move or delete this project’s tasks first, or archive it.', 409)
        tx.remove('projects', id)
        a.audit(tx, {
          action: 'project.deleted',
          entityType: 'project',
          entityId: id,
          before: p,
          summary: `Deleted project ${p.name}`,
        })
      })
    },

    // ------------------------------------------------------------ tasks
    async createTask(input) {
      return ctx.mutate('task.create', (tx, a) => {
        const defs = Object.values(tx.state.fieldDefs).filter((f) => f.orgId === a.orgId)
        const cf = validateCustomValues(defs, input.customFields)
        if (!cf.valid) throw new ApiError('validation', Object.values(cf.errors)[0], 422)
        return createTaskInTx(tx, a, { ...input, customFields: cf.values })
      })
    },

    /** Creates many tasks at once (AI-generated plans); `ref`s in blockedBy are mapped to new ids. */
    async createTasksBulk(projectId, items) {
      return ctx.mutate('task.create', (tx, a) => {
        const refToId = {}
        return items.slice(0, 50).map((item) => {
          const t = createTaskInTx(tx, a, {
            ...item,
            projectId,
            blockedBy: (item.blockedBy ?? []).map((r) => refToId[r]).filter(Boolean),
          })
          refToId[item.ref] = t.id
          return t
        })
      })
    },

    async updateTask(id, input) {
      return ctx.mutate('task.update', (tx, a) => {
        const task = ctx.inOrg('tasks', id, a.orgId)
        if (input.version != null && input.version !== task.version)
          throw new ApiError(
            'version_conflict',
            'Someone else changed this task. Reload to see the latest version.',
            409,
          )
        const changes = {}
        if (input.title !== undefined)
          changes.title = cleanText(input.title, { max: 120, required: true, field: 'Title' })
        if (input.description !== undefined)
          changes.description = cleanText(input.description, { max: 4000, field: 'Description' })
        if (input.status !== undefined) {
          if (!STATUSES.includes(input.status)) throw new ApiError('validation', 'Invalid status.', 422)
          changes.status = input.status
        }
        if (input.priority !== undefined) {
          if (!PRIORITIES.includes(input.priority)) throw new ApiError('validation', 'Invalid priority.', 422)
          changes.priority = input.priority
        }
        if (input.assigneeId !== undefined) {
          if (input.assigneeId && !tx.state.memberships[`${a.orgId}:${input.assigneeId}`])
            throw new ApiError('validation', 'Assignee must be a workspace member.', 422)
          changes.assigneeId = input.assigneeId || null
        }
        if (input.dueDate !== undefined) changes.dueDate = validDate(input.dueDate, 'Due date')
        if (input.estimate !== undefined) changes.estimate = Math.max(0, Math.min(999, Number(input.estimate) || 0))
        if (input.projectId !== undefined) changes.projectId = ctx.inOrg('projects', input.projectId, a.orgId).id
        if (input.recurrence !== undefined)
          changes.recurrence =
            input.recurrence && ['daily', 'weekly', 'monthly'].includes(input.recurrence.freq)
              ? { freq: input.recurrence.freq, interval: Math.max(1, Number(input.recurrence.interval) || 1) }
              : null
        if (input.customFields !== undefined) {
          const defs = Object.values(tx.state.fieldDefs).filter((f) => f.orgId === a.orgId)
          const cf = validateCustomValues(defs, input.customFields)
          if (!cf.valid) throw new ApiError('validation', Object.values(cf.errors)[0], 422)
          changes.customFields = cf.values
        }
        return applyTaskChange(tx, a, task, changes)
      })
    },

    async moveTask(id, status) {
      return this.updateTask(id, { status })
    },

    async deleteTask(id) {
      return ctx.mutate('task.delete', (tx, a) => {
        const task = ctx.inOrg('tasks', id, a.orgId)
        tx.remove('tasks', id)
        // Clean up references: dependencies and subtasks
        for (const t of orgTasks(tx.state, a.orgId)) {
          if (t.blockedBy.includes(id)) tx.patch('tasks', t.id, { blockedBy: t.blockedBy.filter((b) => b !== id) })
          if (t.parentId === id) tx.patch('tasks', t.id, { parentId: null })
        }
        a.audit(tx, {
          action: 'task.deleted',
          entityType: 'task',
          entityId: id,
          before: task,
          summary: `Deleted ${task.key} ${task.title}`,
        })
        a.emit('task.deleted', task)
      })
    },

    async addDependency(taskId, prereqId) {
      return ctx.mutate('task.update', (tx, a) => {
        const task = ctx.inOrg('tasks', taskId, a.orgId)
        ctx.inOrg('tasks', prereqId, a.orgId)
        if (task.blockedBy.includes(prereqId)) return task
        if (wouldCreateCycle(orgTasks(tx.state, a.orgId), taskId, prereqId))
          throw new ApiError('cycle', 'That would create a circular dependency.', 409)
        return applyTaskChange(tx, a, task, { blockedBy: [...task.blockedBy, prereqId] })
      })
    },

    async removeDependency(taskId, prereqId) {
      return ctx.mutate('task.update', (tx, a) => {
        const task = ctx.inOrg('tasks', taskId, a.orgId)
        return applyTaskChange(tx, a, task, { blockedBy: task.blockedBy.filter((b) => b !== prereqId) })
      })
    },

    async logFocusSession(taskId, minutes) {
      return ctx.mutate('task.update', (tx, a) => {
        const task = taskId ? ctx.inOrg('tasks', taskId, a.orgId) : null
        if (task) tx.patch('tasks', task.id, { timeSpent: (task.timeSpent ?? 0) + Math.max(0, Math.min(120, minutes)) })
        award(tx, { orgId: a.orgId, userId: a.user.id, now: ctx.now() }, { type: 'pomodoro' })
      })
    },

    // ------------------------------------------------------------ calendar events
    async createEvent({ title, date, type = 'meeting', projectId = null }) {
      return ctx.mutate('task.create', (tx, a) => {
        const e = tx.put('events', {
          id: uid('e'),
          orgId: a.orgId,
          title: cleanText(title, { max: 100, required: true, field: 'Title' }),
          date:
            validDate(date, 'Date') ??
            (() => {
              throw new ApiError('validation', 'Date is required.', 422)
            })(),
          type: ['meeting', 'milestone'].includes(type) ? type : 'meeting',
          projectId: projectId && tx.state.projects[projectId]?.orgId === a.orgId ? projectId : null,
        })
        a.audit(tx, {
          action: 'event.created',
          entityType: 'event',
          entityId: e.id,
          after: e,
          summary: `Scheduled ${e.type} “${e.title}” on ${e.date}`,
        })
        return e
      })
    },

    async deleteEvent(id) {
      return ctx.mutate('task.update', (tx, a) => {
        const e = ctx.inOrg('events', id, a.orgId)
        tx.remove('events', id)
        a.audit(tx, {
          action: 'event.deleted',
          entityType: 'event',
          entityId: id,
          before: e,
          summary: `Removed “${e.title}”`,
        })
      })
    },
  }
}

const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]))

function describeChange(before, after, state) {
  const parts = []
  if (before.status !== after.status)
    parts.push(`moved ${after.key} from ${STATUS_LABELS[before.status]} to ${STATUS_LABELS[after.status]}`)
  if (before.title !== after.title) parts.push(`renamed ${after.key} to “${after.title}”`)
  if (before.assigneeId !== after.assigneeId)
    parts.push(`assigned ${after.key} to ${state.users[after.assigneeId]?.name ?? 'nobody'}`)
  if (before.priority !== after.priority) parts.push(`set ${after.key} priority to ${after.priority}`)
  if (before.dueDate !== after.dueDate) parts.push(`changed ${after.key} due date to ${after.dueDate ?? 'none'}`)
  if (before.blockedBy.length !== after.blockedBy.length) parts.push(`updated ${after.key} dependencies`)
  if (JSON.stringify(before.customFields) !== JSON.stringify(after.customFields))
    parts.push(`updated ${after.key} custom fields`)
  if (before.approval?.status !== after.approval?.status || before.approval?.step !== after.approval?.step)
    parts.push(
      `approval for ${after.key}: ${after.approval.status}${after.approval.status === 'pending' ? ` (step ${after.approval.step + 1})` : ''}`,
    )
  if ((before.links?.length ?? 0) !== (after.links?.length ?? 0))
    parts.push(`linked ${after.links.at(-1)?.title ?? 'a GitHub item'} to ${after.key}`)
  return parts.length ? parts.join(', ') : `updated ${after.key}`
}
