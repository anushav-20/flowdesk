import { describe, expect, it } from 'vitest'
import { completedPerDay, isOverdue, predictCompletion, summarize, weeklyProgress, workload } from '../analytics.js'
import { answer, detectIntent, generatePlan, prioritize } from '../assistant.js'
import { topologicalSort } from '../graph.js'

const DAY = 86_400_000
const now = Date.parse('2026-11-20T12:00:00Z')
const iso = (offsetDays) => new Date(now + offsetDays * DAY).toISOString().slice(0, 10)

const tasks = [
  {
    id: '1',
    title: 'Old bug',
    status: 'todo',
    priority: 'medium',
    dueDate: iso(-3),
    assigneeId: 'u1',
    createdAt: now - 10 * DAY,
  },
  {
    id: '2',
    title: 'Ship API',
    status: 'progress',
    priority: 'high',
    dueDate: iso(1),
    assigneeId: 'u1',
    createdAt: now - 5 * DAY,
  },
  {
    id: '3',
    title: 'Write docs',
    status: 'done',
    priority: 'low',
    completedAt: now - 2 * DAY,
    assigneeId: 'u2',
    createdAt: now - 9 * DAY,
  },
  {
    id: '4',
    title: 'Frontend',
    status: 'todo',
    priority: 'high',
    blockedBy: ['2'],
    assigneeId: 'u2',
    createdAt: now - 1 * DAY,
  },
]
const members = [
  { id: 'u1', name: 'Priya' },
  { id: 'u2', name: 'Daniel' },
]

describe('analytics', () => {
  it('summarises status counts', () => {
    expect(summarize(tasks, now)).toMatchObject({ total: 4, done: 1, pending: 3, overdue: 1, completionRate: 25 })
    expect(isOverdue(tasks[1], now)).toBe(false)
  })

  it('buckets completions per day and week', () => {
    const days = completedPerDay(tasks, { now, days: 7 })
    expect(days).toHaveLength(7)
    expect(days.reduce((n, d) => n + d.count, 0)).toBe(1)
    const weeks = weeklyProgress(tasks, { now, weeks: 2 })
    expect(weeks.at(-1)).toMatchObject({ completed: 1, created: 2 })
  })

  it('computes workload and flags overload', () => {
    const w = workload(tasks, members, { capacity: 1, now })
    expect(w[0]).toMatchObject({ name: 'Priya', open: 2, overloaded: true, overdue: 1 })
  })

  it('predicts completion from velocity', () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ status: 'done', completedAt: now - i * DAY }))
    const open = Array.from({ length: 7 }, () => ({ status: 'todo' }))
    const f = predictCompletion([...many, ...open], { deadline: iso(2), now }) // velocity 1/day, 7 left
    expect(f.velocity).toBe(1)
    expect(f.risk).toBe('high')
    expect(f.daysLate).toBe(5)
    expect(predictCompletion(open, { deadline: iso(30), now }).risk).toBe('high') // no velocity at all
  })
})

describe('assistant', () => {
  it.each([
    ['What tasks are overdue?', 'overdue'],
    ["Summarize this week's progress", 'summary'],
    ['Which tasks should I prioritize?', 'prioritize'],
    ['Create a project plan for an online store', 'plan'],
    ['Are we on track for the deadline?', 'risk'],
    ['Who is overloaded?', 'workload'],
  ])('detects intent for "%s"', (q, intent) => {
    expect(detectIntent(q)).toBe(intent)
  })

  it('prioritises urgent, unblocking work and skips blocked tasks', () => {
    const ranked = prioritize(tasks, { now }).map((r) => r.task.id)
    expect(ranked[0]).toBe('1') // overdue
    expect(ranked).toContain('2')
    expect(ranked).not.toContain('4') // blocked by an unfinished task
  })

  it('answers overdue questions with the right items', () => {
    const res = answer('anything overdue?', { tasks, members, now })
    expect(res.items).toHaveLength(1)
    expect(res.items[0].label).toMatch(/Old bug.*Priya/)
  })

  it('generates a dependency-ordered plan from a goal', () => {
    const plan = generatePlan('Build an e-commerce website', { startDate: now })
    expect(plan.name).toBe('E-commerce website')
    expect(plan.tasks.map((t) => t.title)).toEqual(
      expect.arrayContaining([
        'Design homepage',
        'Create product API',
        'Implement authentication',
        'Build shopping cart',
        'Test checkout end to end',
      ]),
    )
    // Valid DAG: can be topologically sorted
    expect(() => topologicalSort(plan.tasks.map((t) => ({ id: t.ref, blockedBy: t.blockedBy })))).not.toThrow()
  })

  it('falls back to a generic plan for unknown goals', () => {
    expect(generatePlan('organise the office party').name).toBe('Project')
  })
})
