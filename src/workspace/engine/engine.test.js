import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorkspace } from './index'

const NOW = Date.parse('2026-11-20T09:00:00Z')
let ws
let clock

beforeEach(async () => {
  clock = NOW
  ws = createWorkspace({ persist: false, clock: () => clock, sessionStorage: null, presence: false })
  await ws.api.demoLogin('u_priya') // owner of Acme Labs
})

const state = () => ws.db.getState()
const task = (key) => Object.values(state().tasks).find((t) => t.key === key)

describe('workspace engine', () => {
  it('creates tasks with sequential keys, audit entries and validation', async () => {
    const t = await ws.api.createTask({
      title: '  New feature  ',
      projectId: 'p_web',
      priority: 'high',
      assigneeId: 'u_ravi',
    })
    expect(t).toMatchObject({ key: 'FD-22', title: 'New feature', status: 'todo' })
    expect(state().audit[0]).toMatchObject({ action: 'task.created', actorId: 'u_priya', entityId: t.id })
    await expect(ws.api.createTask({ title: '', projectId: 'p_web' })).rejects.toMatchObject({ code: 'validation' })
  })

  it('enforces tenant isolation', async () => {
    const nimbusTask = Object.values(state().tasks).find((t) => t.orgId === 'o_nimbus')
    await expect(ws.api.updateTask(nimbusTask.id, { title: 'hacked' })).rejects.toMatchObject({ code: 'not_found' })
    await expect(ws.api.createTask({ title: 'x', projectId: 'p_brand' })).rejects.toMatchObject({ code: 'validation' })
  })

  it('enforces role-based permissions', async () => {
    await ws.api.demoLogin('u_sara') // viewer
    await expect(ws.api.createTask({ title: 'x', projectId: 'p_web' })).rejects.toMatchObject({ code: 'forbidden' })
    await ws.api.demoLogin('u_ravi') // member
    await expect(
      ws.api.saveRule({ name: 'x', trigger: { type: 'task.created' }, actions: [{ type: 'notify' }] }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('blocks starting a task while its prerequisites are open', async () => {
    await expect(ws.api.moveTask(task('FD-6').id, 'progress')).rejects.toMatchObject({ code: 'blocked' })
  })

  it('rejects circular dependencies', async () => {
    await expect(ws.api.addDependency(task('FD-2').id, task('FD-7').id)).rejects.toMatchObject({ code: 'cycle' })
  })

  it('runs automations: auto-assigns unassigned tasks to the least busy member', async () => {
    const t = await ws.api.createTask({ title: 'Unassigned work', projectId: 'p_web' })
    expect(state().tasks[t.id].assigneeId).not.toBeNull()
    expect(state().ruleRuns[0]).toMatchObject({ ruleName: 'Auto-assign new tasks', status: 'success' })
  })

  it('completes the parent when all subtasks are done (chained automation)', async () => {
    await ws.api.moveTask(task('FD-18').id, 'done')
    expect(task('FD-16').status).toBe('done')
  })

  it('creates the next occurrence when a recurring task is completed', async () => {
    const weekly = task('FD-19')
    await ws.api.moveTask(weekly.id, 'done')
    const next = Object.values(state().tasks).find((t) => t.recurrenceOf === weekly.id)
    expect(next).toMatchObject({ title: 'Weekly status report', status: 'todo' })
    expect(Date.parse(next.dueDate) - Date.parse(weekly.dueDate)).toBe(7 * 86_400_000)
  })

  it('runs the multi-step approval workflow and completes the task', async () => {
    const t = task('FD-3') // pending at step 2 (QA = Daniel)
    await expect(ws.api.approvalAction(t.id, 'approve')).resolves.toBeTruthy() // Priya is owner → may act
    await ws.api.demoLogin('u_meera')
    await ws.api.approvalAction(t.id, 'approve') // final PM step
    expect(task('FD-3')).toMatchObject({ status: 'done', approval: { status: 'approved' } })
  })

  it('automation connects approvals, tasks and notifications: a rejection sends the work back', async () => {
    const t = task('FD-3')
    await ws.api.approvalAction(t.id, 'reject', 'Missing mobile layout')
    expect(task('FD-3')).toMatchObject({ status: 'progress', approval: { status: 'rejected' } })
    const notes = Object.values(state().notifications).filter((n) => n.userId === t.assigneeId)
    expect(notes.some((n) => /sent back after review/.test(n.message))).toBe(true)
  })

  it('fires deadline reminders once for tasks due within 24 hours', async () => {
    const t = task('FD-8')
    await ws.api.updateTask(t.id, { dueDate: new Date(clock + 86_400_000).toISOString().slice(0, 10) })
    await ws.api.enqueueJob('reminders.overdue')
    await ws.api._tick()
    await ws.api.enqueueJob('reminders.overdue')
    await ws.api._tick()
    const reminders = Object.values(state().notifications).filter((n) => /FD-8.*due within 24 hours/.test(n.message))
    expect(reminders).toHaveLength(1)
  })

  it('awards points and badges on completion', async () => {
    await ws.api.moveTask(task('FD-8').id, 'done') // assigned to Ravi
    expect(state().stats['o_acme:u_ravi'].points).toBe(70)
  })

  it('processes jobs: webhooks are signed, failures retry then dead-letter', async () => {
    await ws.api.createTask({ title: 'Triggers failing webhook', projectId: 'p_web', assigneeId: 'u_ravi' })
    for (let i = 0; i < 6; i++) {
      await ws.api._tick(20)
      clock += 10 * 60_000 // jump past backoff
    }
    const dead = Object.values(state().jobs).find((j) => j.type === 'webhook.deliver' && j.status === 'dead')
    expect(dead).toMatchObject({ attempts: 4, lastError: expect.stringMatching(/500/) })
    await ws.api.retryJob(dead.id)
    expect(state().jobs[dead.id].status).toBe('queued')
  })

  it('records an audit trail and can restore a previous version', async () => {
    const t = task('FD-4')
    await ws.api.updateTask(t.id, { title: 'Renamed by mistake' })
    const entry = state().audit.find((e) => e.action === 'task.updated' && e.entityId === t.id)
    await ws.api.restoreFromAudit(entry.id)
    expect(state().tasks[t.id].title).toBe('Build shopping cart')
  })

  it('merges concurrent doc edits instead of overwriting', async () => {
    const doc = state().docs.d_1
    await ws.api.saveDoc('d_1', {
      content: doc.content.replace('25%', '30%'),
      baseVersion: doc.version,
      baseContent: doc.content,
    })
    const r = await ws.api.saveDoc('d_1', {
      content: doc.content.replace('2 weeks', '3 weeks'),
      baseVersion: doc.version,
      baseContent: doc.content,
    })
    expect(r).toMatchObject({ conflicts: 0, merged: true })
    expect(state().docs.d_1.content).toContain('30%')
    expect(state().docs.d_1.content).toContain('3 weeks')
  })

  it('notifies people mentioned in comments and validates attachments', async () => {
    await ws.api.addComment(task('FD-4').id, { body: 'Hey @Meera, can you review?' })
    expect(Object.values(state().notifications).some((n) => n.userId === 'u_meera' && n.type === 'mention')).toBe(true)
    await expect(
      ws.api.addComment(task('FD-4').id, {
        body: 'x',
        attachments: [{ name: 'a.exe', type: 'application/x-msdownload', size: 10 }],
      }),
    ).rejects.toMatchObject({ code: 'validation' })
  })

  it('locks login after repeated failures', async () => {
    for (let i = 0; i < 5; i++)
      await expect(ws.api.login({ email: 'priya@acme.test', password: 'wrong' })).rejects.toMatchObject({
        code: 'invalid_credentials',
      })
    await expect(ws.api.login({ email: 'priya@acme.test', password: 'demo1234' })).rejects.toMatchObject({
      code: 'rate_limited',
    })
  })

  it('links GitHub pull requests and moves tasks', async () => {
    const res = await ws.api.handleGitHubEvent('pull_request', {
      action: 'opened',
      pull_request: {
        number: 7,
        title: 'FD-4 cart',
        html_url: 'https://github.com/acme/web/pull/7',
        head: { ref: 'fd-4' },
      },
    })
    expect(res[0]).toMatch(/moved to review/)
    expect(task('FD-4').links).toHaveLength(1)
  })

  it('connects to a real GitHub repository (via the API) and syncs PRs and commits onto tasks', async () => {
    const calls = []
    const fakeGitHub = vi.fn(async (url) => {
      calls.push(url)
      const json = (body, status = 200) => ({ ok: status < 300, status, json: async () => body })
      if (url.endsWith('/repos/acme/web'))
        return json({
          full_name: 'acme/web',
          html_url: 'https://github.com/acme/web',
          private: false,
          default_branch: 'main',
        })
      if (url.includes('/pulls'))
        return json([
          {
            number: 9,
            title: 'FD-4 Cart',
            html_url: 'https://github.com/acme/web/pull/9',
            state: 'open',
            draft: false,
            head: { ref: 'x' },
          },
        ])
      if (url.includes('/commits'))
        return json([
          {
            sha: '1234567abc',
            html_url: 'https://github.com/acme/web/commit/1234567',
            commit: { message: 'FD-4 wire up totals' },
          },
        ])
      return json({ message: 'Not Found' }, 404)
    })
    ws = createWorkspace({
      persist: false,
      clock: () => clock,
      sessionStorage: null,
      presence: false,
      fetch: fakeGitHub,
    })
    await ws.api.demoLogin('u_priya')

    await expect(ws.api.updateIntegration('github', { connected: true, repo: 'acme/missing' })).rejects.toThrow(
      /not found/i,
    )
    await ws.api.updateIntegration('github', { connected: true, repo: 'https://github.com/acme/web' })

    expect(calls.some((u) => u === 'https://api.github.com/repos/acme/web')).toBe(true)
    const gh = state().orgs.o_acme.integrations.github
    expect(gh).toMatchObject({ connected: true, verified: true, repo: 'acme/web', lastSync: { ok: true, updated: 1 } })
    expect(task('FD-4').status).toBe('review')
    expect(task('FD-4').links.map((l) => [l.type, l.state ?? null])).toEqual([
      ['pull_request', 'open'],
      ['commit', null],
    ])
    expect(state().audit.find((a) => a.actorLabel === 'GitHub')).toBeTruthy()
  })

  it('sends a real Slack test message when connecting and rejects non-Slack URLs', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 0 }))
    ws = createWorkspace({ persist: false, clock: () => clock, sessionStorage: null, presence: false, fetch: fetchSpy })
    await ws.api.demoLogin('u_priya')
    await expect(
      ws.api.updateIntegration('slack', { connected: true, webhookUrl: 'https://example.com/x' }),
    ).rejects.toThrow(/Slack/)
    await ws.api.updateIntegration('slack', {
      connected: true,
      webhookUrl: 'https://hooks.slack.com/services/T0/B0/abc',
    })
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://hooks.slack.com/services/T0/B0/abc',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body.get('payload')).text).toMatch(/connected/)
  })
})
