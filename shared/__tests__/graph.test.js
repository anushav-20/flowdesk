import { describe, expect, it } from 'vitest'
import {
  computeLevels,
  criticalPath,
  deadlineImpact,
  findCycle,
  openBlockers,
  topologicalSort,
  wouldCreateCycle,
} from '../graph.js'

// api → frontend → testing → deploy ; docs is independent
const tasks = [
  { id: 'api', blockedBy: [], estimate: 8 },
  { id: 'frontend', blockedBy: ['api'], estimate: 12 },
  { id: 'testing', blockedBy: ['frontend'], estimate: 4 },
  { id: 'deploy', blockedBy: ['testing'], estimate: 2 },
  { id: 'docs', blockedBy: [], estimate: 30 },
]

describe('dependency graph', () => {
  it('orders tasks so prerequisites come first', () => {
    const order = topologicalSort(tasks)
    expect(order.indexOf('api')).toBeLessThan(order.indexOf('frontend'))
    expect(order.indexOf('testing')).toBeLessThan(order.indexOf('deploy'))
  })

  it('detects cycles and returns the path', () => {
    const cyclic = [
      { id: 'a', blockedBy: ['c'] },
      { id: 'b', blockedBy: ['a'] },
      { id: 'c', blockedBy: ['b'] },
    ]
    const cycle = findCycle(cyclic)
    expect(cycle[0]).toBe(cycle.at(-1))
    expect(new Set(cycle)).toEqual(new Set(['a', 'b', 'c']))
    expect(() => topologicalSort(cyclic)).toThrow(/cycle/)
  })

  it('rejects a new dependency that would create a cycle', () => {
    expect(wouldCreateCycle(tasks, 'api', 'deploy')).toBe(true)
    expect(wouldCreateCycle(tasks, 'api', 'api')).toBe(true)
    expect(wouldCreateCycle(tasks, 'deploy', 'docs')).toBe(false)
  })

  it('computes layout levels', () => {
    const levels = computeLevels(tasks)
    expect(levels.get('api')).toBe(0)
    expect(levels.get('deploy')).toBe(3)
    expect(levels.get('docs')).toBe(0)
  })

  it('finds the critical path (longest chain by estimate)', () => {
    const { path, duration } = criticalPath(tasks)
    expect(path).toEqual(['docs']) // 30h beats 8+12+4+2 = 26h
    expect(duration).toBe(30)

    const shorterDocs = tasks.map((t) => (t.id === 'docs' ? { ...t, estimate: 5 } : t))
    expect(criticalPath(shorterDocs)).toMatchObject({ path: ['api', 'frontend', 'testing', 'deploy'], duration: 26 })
  })

  it('treats completed tasks as zero remaining work', () => {
    const done = tasks.map((t) => (t.id === 'docs' ? { ...t, status: 'done' } : t))
    expect(criticalPath(done).duration).toBe(26)
  })

  it('flags tasks whose dependency chain will miss the due date', () => {
    const now = Date.parse('2026-11-20T09:00:00Z')
    const withDue = tasks.map((t) => (t.id === 'deploy' ? { ...t, dueDate: '2026-11-21' } : t))
    const impact = deadlineImpact(withDue, { now, hoursPerDay: 6 })
    const deploy = impact.find((i) => i.id === 'deploy')
    expect(deploy.atRisk).toBe(true) // 26h / 6h per day ≈ 5 days of work
    expect(deploy.lateByDays).toBeGreaterThan(0)
  })

  it('lists open blockers', () => {
    const byId = { api: { id: 'api', status: 'done' }, ui: { id: 'ui', status: 'todo' } }
    expect(openBlockers({ blockedBy: ['api', 'ui'] }, byId)).toEqual(['ui'])
  })
})
