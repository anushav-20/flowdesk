/**
 * Workflow automation engine: "When <trigger>, if <conditions>, then <actions>".
 *
 * The engine is pure — it decides *which* actions to run. Executing them
 * (assigning, notifying…) is done by the caller, which feeds resulting events
 * back in with an increased `depth`, so rules can chain but never loop forever.
 */

export const MAX_DEPTH = 3

export const TRIGGERS = {
  'task.created': 'A task is created',
  'task.status_changed': 'A task changes status',
  'task.completed': 'A task is completed',
  'task.due_soon': 'A task is due within 24 hours',
  'task.overdue': 'A task becomes overdue',
  'task.assigned': 'A task is assigned',
  'subtasks.completed': 'All subtasks of a task are completed',
  'project.progress': 'A project reaches a completion %',
  'approval.requested': 'A task is submitted for approval',
  'approval.decided': 'An approval is approved or rejected',
}

export const CONDITION_FIELDS = {
  priority: 'Priority',
  status: 'Status',
  projectId: 'Project',
  assigneeId: 'Assignee',
  title: 'Title',
  progress: 'Project progress %',
  decision: 'Approval decision',
}

export const OPERATORS = {
  equals: 'is',
  not_equals: 'is not',
  contains: 'contains',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
  gte: '≥',
  lte: '≤',
}

export const ACTIONS = {
  assign: 'Assign to',
  set_priority: 'Set priority to',
  set_status: 'Move to status',
  notify: 'Notify',
  add_comment: 'Add a comment',
  complete_parent: 'Complete the parent task',
}

const DAY_MS = 86_400_000
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10)

/** Open task due today or tomorrow (used by the deadline reminder job for `task.due_soon`). */
export const isDueSoon = (t, now) =>
  t.status !== 'done' && Boolean(t.dueDate) && t.dueDate >= isoDay(now) && t.dueDate <= isoDay(now + DAY_MS)

const DECISION_LABEL = { approve: 'approved', reject: 'rejected' }

/** Evaluates one condition against the event's subject. */
export function matchesCondition(subject, { field, op, value }) {
  const actual = subject?.[field]
  switch (op) {
    case 'equals':
      return String(actual ?? '') === String(value ?? '')
    case 'not_equals':
      return String(actual ?? '') !== String(value ?? '')
    case 'contains':
      return String(actual ?? '')
        .toLowerCase()
        .includes(String(value ?? '').toLowerCase())
    case 'is_empty':
      return actual == null || actual === ''
    case 'is_not_empty':
      return !(actual == null || actual === '')
    case 'gte':
      return Number(actual) >= Number(value)
    case 'lte':
      return Number(actual) <= Number(value)
    default:
      return false
  }
}

/**
 * @param {{ type: string, subject: object, depth?: number }} event
 * @param {Array<{ id: string, enabled: boolean, trigger: {type: string, threshold?: number}, conditions?: any[], actions: any[] }>} rules
 * @returns {Array<{ ruleId: string, actions: any[] }>}
 */
export function evaluateRules(event, rules) {
  if ((event.depth ?? 0) >= MAX_DEPTH) return []
  const matches = []
  for (const rule of rules) {
    if (!rule.enabled || rule.trigger?.type !== event.type) continue
    if (event.type === 'project.progress') {
      // Fire once when progress crosses the threshold upwards
      const t = Number(rule.trigger.threshold ?? 80)
      if (!(event.subject.progress >= t && (event.subject.previousProgress ?? 0) < t)) continue
    }
    if ((rule.conditions ?? []).every((c) => matchesCondition(event.subject, c))) {
      matches.push({ ruleId: rule.id, actions: rule.actions })
    }
  }
  return matches
}

/** Picks the member with the fewest open tasks (ties → first). Used by `assign: least_loaded`. */
export function leastLoaded(memberIds, tasks) {
  if (memberIds.length === 0) return null
  const load = new Map(memberIds.map((id) => [id, 0]))
  for (const t of tasks)
    if (t.status !== 'done' && load.has(t.assigneeId)) load.set(t.assigneeId, load.get(t.assigneeId) + 1)
  return [...load.entries()].sort((a, b) => a[1] - b[1])[0][0]
}

/** Human-readable sentence for a rule, for the UI and logs. */
export function describeRule(rule, { nameOf = (id) => id } = {}) {
  const trig =
    rule.trigger.type === 'project.progress'
      ? `a project reaches ${rule.trigger.threshold ?? 80}%`
      : (TRIGGERS[rule.trigger.type] ?? rule.trigger.type).replace(/^A /, 'a ').replace(/^All /, 'all ')
  const conds = (rule.conditions ?? []).map(
    (c) =>
      `${CONDITION_FIELDS[c.field] ?? c.field} ${OPERATORS[c.op] ?? c.op}${c.value != null && c.value !== '' ? ` “${DECISION_LABEL[c.value] ?? nameOf(c.value)}”` : ''}`,
  )
  const acts = rule.actions.map((a) => {
    const p = a.params ?? {}
    switch (a.type) {
      case 'assign':
        return `assign to ${p.userId === 'least_loaded' ? 'the least busy member' : nameOf(p.userId)}`
      case 'notify':
        return `notify ${p.target === 'assignee' ? 'the assignee' : p.target === 'admins' ? 'admins' : nameOf(p.target)}`
      case 'set_priority':
        return `set priority to ${p.priority}`
      case 'set_status':
        return `move to ${p.status}`
      case 'add_comment':
        return 'add a comment'
      case 'complete_parent':
        return 'complete the parent task'
      default:
        return a.type
    }
  })
  return `When ${trig}${conds.length ? ` and ${conds.join(' and ')}` : ''}, ${acts.join(', then ')}.`
}
