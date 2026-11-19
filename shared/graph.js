/**
 * Task dependency graph algorithms.
 * A task lists the tasks it depends on in `blockedBy` (prerequisites).
 * Edge direction: prerequisite → dependent.
 *
 * All functions are pure and O(V + E).
 */

/** @typedef {{ id: string, blockedBy?: string[], estimate?: number, status?: string, dueDate?: string|null, title?: string }} GraphTask */

const prereqs = (t) => t.blockedBy ?? []

/** Build adjacency (prerequisite → dependents) restricted to known tasks. */
function buildGraph(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const dependents = new Map(tasks.map((t) => [t.id, []]))
  for (const t of tasks) {
    for (const p of prereqs(t)) if (byId.has(p)) dependents.get(p).push(t.id)
  }
  return { byId, dependents }
}

/**
 * Detects a cycle. Returns the cycle as a list of ids (first === last) or null.
 * Iterative DFS with white/grey/black colouring (no recursion-depth limits).
 */
export function findCycle(tasks) {
  const { dependents } = buildGraph(tasks)
  const colour = new Map() // undefined = white, 1 = grey (on stack), 2 = black (done)
  const parent = new Map()

  for (const start of dependents.keys()) {
    if (colour.get(start)) continue
    const stack = [[start, 0]]
    colour.set(start, 1)
    while (stack.length) {
      const frame = stack[stack.length - 1]
      const [node, i] = frame
      const next = dependents.get(node)
      if (i < next.length) {
        frame[1]++
        const child = next[i]
        if (colour.get(child) === 1) {
          // Found a back edge: rebuild the cycle path
          const cycle = [child]
          for (let n = node; n !== child; n = parent.get(n)) cycle.push(n)
          cycle.push(child)
          return cycle.reverse()
        }
        if (!colour.get(child)) {
          colour.set(child, 1)
          parent.set(child, node)
          stack.push([child, 0])
        }
      } else {
        colour.set(node, 2)
        stack.pop()
      }
    }
  }
  return null
}

/** Would making `taskId` depend on `prereqId` create a cycle? */
export function wouldCreateCycle(tasks, taskId, prereqId) {
  if (taskId === prereqId) return true
  const next = tasks.map((t) => (t.id === taskId ? { ...t, blockedBy: [...new Set([...prereqs(t), prereqId])] } : t))
  return findCycle(next) !== null
}

/** Kahn's algorithm. Throws if the graph has a cycle. */
export function topologicalSort(tasks) {
  const { byId, dependents } = buildGraph(tasks)
  const indegree = new Map(tasks.map((t) => [t.id, prereqs(t).filter((p) => byId.has(p)).length]))
  const queue = tasks.filter((t) => indegree.get(t.id) === 0).map((t) => t.id)
  const order = []
  while (queue.length) {
    const id = queue.shift()
    order.push(id)
    for (const d of dependents.get(id)) {
      indegree.set(d, indegree.get(d) - 1)
      if (indegree.get(d) === 0) queue.push(d)
    }
  }
  if (order.length !== tasks.length) throw new Error('Dependency cycle detected')
  return order
}

/**
 * Layered layout for drawing the graph: each task's level = longest chain of prerequisites before it.
 * @returns {Map<string, number>}
 */
export function computeLevels(tasks) {
  const { byId } = buildGraph(tasks)
  const levels = new Map()
  for (const id of topologicalSort(tasks)) {
    const t = byId.get(id)
    const lvl =
      Math.max(
        -1,
        ...prereqs(t)
          .filter((p) => byId.has(p))
          .map((p) => levels.get(p)),
      ) + 1
    levels.set(id, lvl)
  }
  return levels
}

/**
 * Critical path method. Durations = remaining estimate in hours (done tasks count as 0).
 * Returns the longest chain, its total duration, and earliest start/finish per task.
 */
export function criticalPath(tasks) {
  if (tasks.length === 0) return { path: [], duration: 0, schedule: new Map() }
  const { byId } = buildGraph(tasks)
  const order = topologicalSort(tasks)
  const schedule = new Map()
  const via = new Map()

  for (const id of order) {
    const t = byId.get(id)
    const duration = t.status === 'done' ? 0 : Math.max(0, Number(t.estimate) || 0)
    let start = 0
    for (const p of prereqs(t)) {
      if (!byId.has(p)) continue
      const pf = schedule.get(p).finish
      if (pf > start) {
        start = pf
        via.set(id, p)
      }
    }
    schedule.set(id, { start, finish: start + duration, duration })
  }

  let end = order[0]
  for (const id of order) if (schedule.get(id).finish > schedule.get(end).finish) end = id
  const path = []
  for (let n = end; n; n = via.get(n)) path.unshift(n)
  return { path, duration: schedule.get(end).finish, schedule }
}

/**
 * Deadline impact analysis: projects each open task's finish date from `now`
 * (working `hoursPerDay`) through the dependency chain and flags tasks that will finish after their due date.
 */
export function deadlineImpact(tasks, { now = Date.now(), hoursPerDay = 6 } = {}) {
  const { schedule } = criticalPath(tasks)
  const DAY = 86_400_000
  const results = []
  for (const t of tasks) {
    if (t.status === 'done') continue
    const s = schedule.get(t.id)
    const projectedFinish = now + Math.ceil(s.finish / hoursPerDay) * DAY
    const due = t.dueDate ? new Date(t.dueDate).getTime() + DAY - 1 : null
    const lateByDays = due && projectedFinish > due ? Math.ceil((projectedFinish - due) / DAY) : 0
    results.push({ id: t.id, projectedFinish, dueDate: t.dueDate ?? null, atRisk: lateByDays > 0, lateByDays })
  }
  return results.sort((a, b) => b.lateByDays - a.lateByDays)
}

/** Ids of prerequisites that are not done yet (a task can't start while this is non-empty). */
export function openBlockers(task, tasksById) {
  return prereqs(task).filter((p) => tasksById[p] && tasksById[p].status !== 'done')
}
