import { describe, expect, it } from 'vitest'
import { ApprovalError, DEFAULT_CHAIN, initialApproval, transition } from '../approval.js'
import { describeRule, evaluateRules, leastLoaded, matchesCondition, MAX_DEPTH } from '../automation.js'
import { can, canChangeRole } from '../permissions.js'

const chain = DEFAULT_CHAIN.map((s, i) => ({ ...s, approverId: ['lead', 'qa', 'pm'][i] }))
const at = 1

describe('approval state machine', () => {
  it('walks through every step to approved', () => {
    let a = transition(initialApproval(), { type: 'submit', actorId: 'dev', at }, { chain })
    expect(a).toMatchObject({ status: 'pending', step: 0 })
    a = transition(a, { type: 'approve', actorId: 'lead', at }, { chain })
    a = transition(a, { type: 'approve', actorId: 'qa', at }, { chain })
    expect(a).toMatchObject({ status: 'pending', step: 2 })
    a = transition(a, { type: 'approve', actorId: 'pm', at }, { chain })
    expect(a.status).toBe('approved')
    expect(a.history.map((h) => h.type)).toEqual(['submit', 'approve', 'approve', 'approve'])
  })

  it('only lets the assigned approver (or an owner) act', () => {
    const a = transition(initialApproval(), { type: 'submit', actorId: 'dev', at }, { chain })
    expect(() => transition(a, { type: 'approve', actorId: 'qa', at }, { chain })).toThrow(ApprovalError)
    expect(transition(a, { type: 'approve', actorId: 'boss', at }, { chain, isOwner: true }).step).toBe(1)
  })

  it('requires a reason to reject, then allows resubmission', () => {
    let a = transition(initialApproval(), { type: 'submit', actorId: 'dev', at }, { chain })
    expect(() => transition(a, { type: 'reject', actorId: 'lead', at, reason: '' }, { chain })).toThrow(/reason/)
    a = transition(a, { type: 'reject', actorId: 'lead', at, reason: 'Missing tests' }, { chain })
    expect(a.status).toBe('rejected')
    expect(a.history.at(-1).reason).toBe('Missing tests')
    a = transition(a, { type: 'resubmit', actorId: 'dev', at }, { chain })
    expect(a).toMatchObject({ status: 'pending', step: 0 })
  })

  it('rejects invalid transitions', () => {
    expect(() => transition(initialApproval(), { type: 'approve', actorId: 'lead', at }, { chain })).toThrow(
      'Nothing is waiting for approval',
    )
    expect(() => transition(initialApproval(), { type: 'resubmit', actorId: 'dev', at }, { chain })).toThrow(
      'Cannot resubmit while none',
    )
  })
})

describe('automation engine', () => {
  const rules = [
    {
      id: 'r1',
      enabled: true,
      trigger: { type: 'task.created' },
      conditions: [{ field: 'priority', op: 'equals', value: 'high' }],
      actions: [{ type: 'notify', params: { target: 'admins' } }],
    },
    { id: 'r2', enabled: false, trigger: { type: 'task.created' }, actions: [{ type: 'assign' }] },
    { id: 'r3', enabled: true, trigger: { type: 'project.progress', threshold: 80 }, actions: [{ type: 'notify' }] },
  ]

  it('matches rules by trigger and conditions, skipping disabled ones', () => {
    expect(evaluateRules({ type: 'task.created', subject: { priority: 'high' } }, rules).map((m) => m.ruleId)).toEqual([
      'r1',
    ])
    expect(evaluateRules({ type: 'task.created', subject: { priority: 'low' } }, rules)).toEqual([])
  })

  it('fires progress rules only when crossing the threshold', () => {
    expect(
      evaluateRules({ type: 'project.progress', subject: { progress: 82, previousProgress: 70 } }, rules),
    ).toHaveLength(1)
    expect(
      evaluateRules({ type: 'project.progress', subject: { progress: 90, previousProgress: 85 } }, rules),
    ).toHaveLength(0)
  })

  it('stops chains at the max depth (no infinite loops)', () => {
    expect(evaluateRules({ type: 'task.created', subject: { priority: 'high' }, depth: MAX_DEPTH }, rules)).toEqual([])
  })

  it.each([
    [{ title: 'Fix Login' }, { field: 'title', op: 'contains', value: 'login' }, true],
    [{ assigneeId: null }, { field: 'assigneeId', op: 'is_empty' }, true],
    [{ progress: 50 }, { field: 'progress', op: 'gte', value: 80 }, false],
  ])('condition %o %o → %s', (subject, cond, expected) => {
    expect(matchesCondition(subject, cond)).toBe(expected)
  })

  it('assigns to the least loaded member', () => {
    const tasks = [
      { assigneeId: 'a', status: 'todo' },
      { assigneeId: 'a', status: 'todo' },
      { assigneeId: 'b', status: 'todo' },
      { assigneeId: 'c', status: 'done' },
    ]
    expect(leastLoaded(['a', 'b', 'c'], tasks)).toBe('c')
  })

  it('describes a rule in plain English', () => {
    expect(describeRule(rules[0])).toBe('When a task is created and Priority is “high”, notify admins.')
  })
})

describe('permissions', () => {
  it('maps roles to permissions', () => {
    expect(can('viewer', 'task.read')).toBe(true)
    expect(can('viewer', 'task.create')).toBe(false)
    expect(can('member', 'automation.manage')).toBe(false)
    expect(can('admin', 'audit.restore')).toBe(true)
  })

  it('protects the last owner', () => {
    expect(canChangeRole({ actorRole: 'owner', targetRole: 'owner', newRole: 'admin', ownerCount: 1 })).toBe(false)
    expect(canChangeRole({ actorRole: 'owner', targetRole: 'owner', newRole: 'admin', ownerCount: 2 })).toBe(true)
    expect(canChangeRole({ actorRole: 'admin', targetRole: 'member', newRole: 'admin', ownerCount: 1 })).toBe(false)
  })
})
