import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { O, setup } from './helpers.js'

let env
let deliveries
const fakeFetch = vi.fn(async (url, init) => {
  deliveries.push({ url, init })
  return { status: url.includes('fail') ? 500 : 200 }
})

beforeEach(async () => {
  deliveries = []
  env = await setup({ fetch: fakeFetch })
})

describe('health & docs', () => {
  it('reports database health and serves the OpenAPI spec', async () => {
    const h = await env.api.get('/api/health')
    expect(h.body).toMatchObject({ status: 'ok', database: 'ok' })
    expect(h.headers['x-request-id']).toBeTruthy()
    const spec = await env.api.get('/api/openapi.yaml')
    expect(spec.text).toContain('openapi: 3.1.0')
  })

  it('sets security headers and hides the framework', async () => {
    const res = await env.api.get('/api/health')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-powered-by']).toBeUndefined()
  })
})

describe('authentication', () => {
  it('registers, logs in and returns the user with their workspaces', async () => {
    const reg = await env.api
      .post('/api/auth/register')
      .send({ name: 'New Person', email: 'NEW@Example.com', password: 'supersecret' })
    expect(reg.status).toBe(201)
    expect(reg.body.user.email).toBe('new@example.com')
    const me = await env.api.get('/api/auth/me').set('Authorization', `Bearer ${reg.body.accessToken}`)
    expect(me.body.orgs).toHaveLength(1)
  })

  it('validates input and rejects duplicate emails', async () => {
    const bad = await env.api.post('/api/auth/register').send({ name: '', email: 'nope', password: 'short' })
    expect(bad.status).toBe(422)
    expect(bad.body.error.code).toBe('validation')
    const dup = await env.api
      .post('/api/auth/register')
      .send({ name: 'X', email: 'priya@acme.test', password: 'supersecret' })
    expect(dup.status).toBe(409)
  })

  it('uses the same error for unknown email and wrong password', async () => {
    const a = await env.api.post('/api/auth/login').send({ email: 'priya@acme.test', password: 'wrong' })
    const b = await env.api.post('/api/auth/login').send({ email: 'ghost@acme.test', password: 'wrong' })
    expect(a.status).toBe(401)
    expect(a.body).toEqual(b.body)
  })

  it('rejects missing, malformed and forged tokens', async () => {
    expect((await env.api.get('/api/auth/me')).status).toBe(401)
    expect((await env.api.get('/api/auth/me').set('Authorization', 'Bearer not.a.jwt')).status).toBe(401)
  })

  it('rotates refresh tokens and revokes everything when an old one is reused', async () => {
    const { refreshToken } = await env.login('priya@acme.test')
    const first = await env.api.post('/api/auth/refresh').send({ refreshToken })
    expect(first.status).toBe(200)
    expect(first.body.refreshToken).not.toBe(refreshToken)

    const reuse = await env.api.post('/api/auth/refresh').send({ refreshToken }) // stolen old token
    expect(reuse.body.error.code).toBe('token_reused')
    const after = await env.api.post('/api/auth/refresh').send({ refreshToken: first.body.refreshToken })
    expect(after.status).toBe(401) // the whole family was revoked
  })
})

describe('multi-tenancy & RBAC', () => {
  it('hides other tenants completely (404, not 403)', async () => {
    const reg = await env.api
      .post('/api/auth/register')
      .send({ name: 'Outsider', email: 'out@x.com', password: 'supersecret' })
    const res = await env.api.get(`${O}/tasks`).set('Authorization', `Bearer ${reg.body.accessToken}`)
    expect(res.status).toBe(404)
  })

  it('enforces role permissions', async () => {
    const viewer = await env.as('sara@acme.test')
    expect((await viewer.get(`${O}/tasks`)).status).toBe(200)
    expect((await viewer.post(`${O}/tasks`, { title: 'x', projectId: 'p_web' })).status).toBe(403)
    const member = await env.as('ravi@acme.test')
    expect(
      (
        await member.post(`${O}/automations`, {
          name: 'x',
          trigger: { type: 'task.created' },
          actions: [{ type: 'notify' }],
        })
      ).status,
    ).toBe(403)
    expect((await member.get(`${O}/audit`)).status).toBe(403)
  })

  it('protects the last owner', async () => {
    const owner = await env.as('priya@acme.test')
    const res = await owner.post(`${O}/members/u_daniel`, {}) // wrong method → 404 endpoint
    expect(res.status).toBe(404)
    const demote = await owner.patch(`${O}/members/u_priya`, { role: 'admin' })
    expect(demote.status).toBe(403)
  })
})

describe('tasks', () => {
  it('creates tasks with sequential keys and validates input', async () => {
    const owner = await env.as('priya@acme.test')
    const res = await owner.post(`${O}/tasks`, {
      title: 'New thing',
      projectId: 'p_web',
      priority: 'high',
      assigneeId: 'u_ravi',
    })
    expect(res.status).toBe(201)
    expect(res.body.key).toBe('FD-7')
    expect((await owner.post(`${O}/tasks`, { title: '', projectId: 'p_web' })).status).toBe(422)
    expect((await owner.post(`${O}/tasks`, { title: 'x', projectId: 'p_web', priority: 'urgent' })).status).toBe(422)
  })

  it('filters and paginates', async () => {
    const owner = await env.as('priya@acme.test')
    const res = await owner.get(`${O}/tasks?assigneeId=u_ravi&limit=1`)
    expect(res.body.items).toHaveLength(1)
    const search = await owner.get(`${O}/tasks?q=checkout`)
    expect(search.body.items.map((t) => t.key).sort()).toEqual(['FD-3', 'FD-4'])
  })

  it('uses optimistic concurrency (409 on stale version)', async () => {
    const owner = await env.as('priya@acme.test')
    expect((await owner.patch(`${O}/tasks/t_6`, { title: 'A', version: 1 })).status).toBe(200)
    const stale = await owner.patch(`${O}/tasks/t_6`, { title: 'B', version: 1 })
    expect(stale.status).toBe(409)
    expect(stale.body.error.code).toBe('version_conflict')
  })

  it('blocks starting a task with open prerequisites and rejects cycles', async () => {
    const owner = await env.as('priya@acme.test')
    const blocked = await owner.patch(`${O}/tasks/t_4`, { status: 'progress' })
    expect(blocked.body.error.code).toBe('blocked')
    const cycle = await owner.post(`${O}/tasks/t_1/dependencies`, { prerequisiteId: 't_5' })
    expect(cycle.body.error.code).toBe('cycle')
  })

  it('records an audit trail and restores a previous version', async () => {
    const owner = await env.as('priya@acme.test')
    await owner.patch(`${O}/tasks/t_2`, { title: 'Oops' })
    const audit = await owner.get(`${O}/audit?entityId=t_2`)
    expect(audit.body[0]).toMatchObject({ action: 'task.updated', actorId: 'u_priya' })
    const restored = await owner.post(`${O}/audit/${audit.body[0].id}/restore`)
    expect(restored.body.title).toBe('Build shopping cart')
  })
})

describe('automations, approvals and notifications', () => {
  it('auto-assigns unassigned tasks and logs the run', async () => {
    const owner = await env.as('priya@acme.test')
    const created = await owner.post(`${O}/tasks`, { title: 'Nobody owns me', projectId: 'p_web' })
    const task = await owner.get(`${O}/tasks/${created.body.id}`)
    expect(task.body.assigneeId).toBeTruthy()
    const runs = await owner.get(`${O}/automations/runs`)
    expect(runs.body[0]).toMatchObject({ ruleName: 'Auto-assign new tasks', status: 'success' })
  })

  it('runs the approval chain end to end with the right approvers', async () => {
    const ravi = await env.as('ravi@acme.test')
    await ravi.patch(`${O}/tasks/t_6`, { status: 'progress' })
    expect((await ravi.post(`${O}/tasks/t_6/approval`, { type: 'submit' })).body.status).toBe('review')
    expect((await ravi.post(`${O}/tasks/t_6/approval`, { type: 'approve' })).status).toBe(409) // not the approver

    const priya = await env.as('priya@acme.test')
    await priya.post(`${O}/tasks/t_6/approval`, { type: 'approve' })
    const daniel = await env.as('daniel@acme.test')
    const rejected = await daniel.post(`${O}/tasks/t_6/approval`, { type: 'reject', reason: 'Missing tests' })
    expect(rejected.body.approval.status).toBe('rejected')

    const notes = await ravi.get(`${O}/notifications`)
    expect(notes.body.some((n) => n.message.includes('Missing tests'))).toBe(true)
  })

  it('notifies mentioned members and validates attachments', async () => {
    const ravi = await env.as('ravi@acme.test')
    const ok = await ravi.post(`${O}/tasks/t_2/comments`, {
      body: 'Hey @Meera please review',
      attachments: [{ name: 'a.txt', type: 'text/plain', size: 5, dataUrl: 'data:text/plain;base64,aGVsbG8=' }],
    })
    expect(ok.status).toBe(201)
    expect(ok.body.attachments[0].status).toBe('ready')
    const meera = await env.as('meera@acme.test')
    expect((await meera.get(`${O}/notifications`)).body[0].type).toBe('mention')
    const bad = await ravi.post(`${O}/tasks/t_2/comments`, {
      body: 'x',
      attachments: [{ name: 'evil.exe', type: 'application/x-msdownload', size: 5, dataUrl: 'data:x;base64,AA==' }],
    })
    expect(bad.status).toBe(422)
  })
})

describe('webhooks & background jobs', () => {
  it('delivers HMAC-signed webhooks', async () => {
    const owner = await env.as('priya@acme.test')
    const hook = await owner.post(`${O}/webhooks`, { url: 'https://hooks.example.com/x', events: ['task.completed'] })
    await owner.patch(`${O}/tasks/t_6`, { status: 'done' })
    await env.runJobs()
    const d = deliveries.find((x) => x.url === 'https://hooks.example.com/x')
    const expected = `sha256=${createHmac('sha256', hook.body.secret).update(d.init.body).digest('hex')}`
    expect(d.init.headers['X-FlowDesk-Signature']).toBe(expected)
    expect(JSON.parse(d.init.body)).toMatchObject({ event: 'task.completed', data: { task: { key: 'FD-6' } } })
  })

  it('retries failed deliveries with backoff, then dead-letters them and allows retry', async () => {
    const owner = await env.as('priya@acme.test')
    await owner.post(`${O}/webhooks`, { url: 'https://fail.example.com/x', events: ['task.created'] })
    await owner.post(`${O}/tasks`, { title: 'Trigger', projectId: 'p_web', assigneeId: 'u_ravi' })
    for (let i = 0; i < 6; i++) {
      await env.runJobs()
      env.clock.now += 10 * 60_000
    }
    const dead = (await owner.get(`${O}/jobs?status=dead`)).body.items.find((j) => j.type === 'webhook.deliver')
    expect(dead).toMatchObject({ attempts: 4 })
    expect((await owner.post(`${O}/jobs/${dead.id}/retry`)).status).toBe(202)
  })

  it('runs scheduled jobs: overdue reminders and weekly reports', async () => {
    const owner = await env.as('priya@acme.test')
    await owner.post(`${O}/jobs`, { type: 'reminders.overdue' })
    await owner.post(`${O}/jobs`, { type: 'reports.weekly' })
    await env.runJobs()
    const ravi = await env.as('ravi@acme.test')
    expect((await ravi.get(`${O}/notifications`)).body.some((n) => n.message.includes('overdue'))).toBe(true)
    const outbox = await env.db.query('SELECT * FROM outbox')
    expect(outbox[0].subject).toContain('Weekly report')
  })

  it('blocks webhooks to private addresses (SSRF)', async () => {
    const strict = await setup()
    strict.ctx.config.webhooks.allowPrivateHosts = false
    const owner = await strict.as('priya@acme.test')
    const res = await owner.post(`${O}/webhooks`, { url: 'https://127.0.0.1/admin', events: ['task.created'] })
    expect(res.status).toBe(422)
  })
})

describe('integrations', () => {
  const sign = (secret, body) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`

  it('accepts signed GitHub events and moves linked tasks', async () => {
    await env.db.query(`UPDATE orgs SET integrations = $1 WHERE id = 'o_acme'`, [
      JSON.stringify({ github: { connected: true, repo: 'a/b' }, slack: { connected: false }, email: {} }),
    ])
    const owner = await env.as('priya@acme.test')
    const { githubSecret } = (await owner.get(O)).body
    const body = JSON.stringify({
      action: 'opened',
      pull_request: { number: 9, title: 'FD-2 cart', html_url: 'https://github.com/a/b/pull/9', head: { ref: 'x' } },
    })
    const res = await env.api
      .post('/api/integrations/github/o_acme')
      .set('Content-Type', 'application/json')
      .set('X-GitHub-Event', 'pull_request')
      .set('X-Hub-Signature-256', sign(githubSecret, body))
      .send(body)
    expect(res.body.results[0]).toMatchObject({ key: 'FD-2', result: 'linked, moved to review' })
  })

  it('rejects GitHub events with a bad signature', async () => {
    const res = await env.api
      .post('/api/integrations/github/o_acme')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', 'sha256=deadbeef')
      .send('{}')
    expect(res.status).toBe(401)
  })

  it('connects to GitHub through its API, encrypts the token, and syncs PRs and commits onto tasks', async () => {
    const calls = []
    const json = (body, status = 200) => ({ ok: status < 300, status, json: async () => body })
    const fakeGitHub = async (url, init) => {
      calls.push({ url, auth: init?.headers?.Authorization })
      if (url.endsWith('/repos/acme/web'))
        return json({
          full_name: 'acme/web',
          html_url: 'https://github.com/acme/web',
          private: true,
          default_branch: 'main',
        })
      if (url.includes('/pulls'))
        return json([
          {
            number: 5,
            title: 'FD-2 cart',
            html_url: 'https://github.com/acme/web/pull/5',
            state: 'closed',
            merged_at: '2026-11-19T00:00:00Z',
            head: { ref: 'x' },
          },
        ])
      if (url.includes('/commits')) return json([])
      return json({ message: 'Not Found' }, 404)
    }
    const gh = await setup({ fetch: fakeGitHub })
    const owner = await gh.as('priya@acme.test')

    const missing = await owner.patch(`${O}/integrations/github`, { connected: true, repo: 'acme/nope' })
    expect(missing.status).toBe(422)
    expect(missing.body.error.message).toMatch(/not found/i)

    const ok = await owner.patch(`${O}/integrations/github`, {
      connected: true,
      repo: 'acme/web',
      token: 'ghp_secret123',
    })
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({
      connected: true,
      repo: 'acme/web',
      hasToken: true,
      lastSync: { ok: true, updated: 1 },
    })
    expect(JSON.stringify(ok.body)).not.toContain('ghp_secret123')
    expect(calls[1].auth).toBe('Bearer ghp_secret123')

    const stored = await gh.db.one(`SELECT integrations FROM orgs WHERE id = 'o_acme'`)
    expect(stored.integrations.github.tokenEnc).toBeTruthy()
    expect(JSON.stringify(stored.integrations)).not.toContain('ghp_secret123') // encrypted at rest

    const t2 = (await owner.get(`${O}/tasks/t_2`)).body
    expect(t2.links[0]).toMatchObject({ type: 'pull_request', state: 'merged', number: 5 })

    const again = await owner.post(`${O}/integrations/github/sync`)
    expect(again.body).toMatchObject({ pulls: 1, updated: 0 }) // idempotent
  })

  it('sends a real Slack test message on connect and hides the URL from non-admins', async () => {
    const posts = []
    const slack = await setup({
      fetch: async (url, init) => {
        posts.push({ url, body: JSON.parse(init.body) })
        return { ok: !url.includes('bad'), status: url.includes('bad') ? 404 : 200 }
      },
    })
    const owner = await slack.as('priya@acme.test')
    expect(
      (await owner.patch(`${O}/integrations/slack`, { connected: true, webhookUrl: 'https://evil.test/x' })).status,
    ).toBe(422)
    expect(
      (
        await owner.patch(`${O}/integrations/slack`, {
          connected: true,
          webhookUrl: 'https://hooks.slack.com/services/bad',
        })
      ).status,
    ).toBe(502)
    const url = 'https://hooks.slack.com/services/T0/B0/secretpart'
    expect((await owner.patch(`${O}/integrations/slack`, { connected: true, webhookUrl: url })).status).toBe(200)
    expect(posts.at(-1)).toMatchObject({ url, body: { text: expect.stringContaining('connected') } })

    const member = await slack.as('ravi@acme.test')
    const seen = (await member.get(O)).body.integrations.slack
    expect(seen).toMatchObject({ connected: true, webhookUrl: '' })
  })

  it('serves a calendar feed only with the right token', async () => {
    const owner = await env.as('priya@acme.test')
    const { calendarToken } = (await owner.get(O)).body
    const ok = await env.api.get(`/api/calendar/o_acme/${calendarToken}.ics`)
    expect(ok.headers['content-type']).toContain('text/calendar')
    expect(ok.text).toContain('FD-3 Checkout page')
    expect((await env.api.get('/api/calendar/o_acme/wrong.ics')).status).toBe(404)
  })
})

describe('insights, AI, docs and offline sync', () => {
  it('searches across the workspace and returns analytics', async () => {
    const owner = await env.as('priya@acme.test')
    const s = await owner.get(`${O}/search?q=checkout&types=task`)
    expect(s.body.map((r) => r.id)).toEqual(expect.arrayContaining(['t_3', 't_4']))
    const a = await owner.get(`${O}/analytics`)
    expect(a.body.summary).toMatchObject({ total: 6, done: 1, overdue: 1 })
    expect(a.body.projects[0].forecast).toHaveProperty('risk')
  })

  it('answers grounded AI questions and generates plans', async () => {
    const owner = await env.as('priya@acme.test')
    const r = await owner.post(`${O}/ai/ask`, { question: 'What tasks are overdue?' })
    expect(r.body).toMatchObject({ intent: 'overdue', source: 'rules' })
    expect(r.body.items[0].label).toContain('Fix navbar overlap')
    const plan = await owner.post(`${O}/ai/plan`, { goal: 'Build an e-commerce website' })
    expect(plan.body.tasks.length).toBeGreaterThan(10)
  })

  it('merges concurrent document edits', async () => {
    const owner = await env.as('priya@acme.test')
    const base = (await owner.get(`${O}/docs/d_1`)).body
    await owner.put(`${O}/docs/d_1`, {
      content: `${base.content}\nLine from A`,
      baseVersion: base.version,
      baseContent: base.content,
    })
    const r = await owner.put(`${O}/docs/d_1`, {
      content: base.content.replace('25%', '30%'),
      baseVersion: base.version,
      baseContent: base.content,
    })
    expect(r.body).toMatchObject({ merged: true, conflicts: 0 })
    expect(r.body.doc.content).toContain('30%')
    expect(r.body.doc.content).toContain('Line from A')
  })

  it('applies offline mutations and reports field conflicts', async () => {
    const owner = await env.as('priya@acme.test')
    const base = (await owner.get(`${O}/tasks/t_6`)).body
    await owner.patch(`${O}/tasks/t_6`, { priority: 'high' }) // someone changed priority meanwhile
    const r = await owner.post(`${O}/sync`, {
      mutations: [{ clientId: 'm1', taskId: 't_6', base, changes: { priority: 'low', title: 'Offline title' } }],
    })
    expect(r.body.results[0]).toMatchObject({ status: 'merged_with_conflicts', conflicts: ['priority'] })
    expect(r.body.results[0].task).toMatchObject({ title: 'Offline title', priority: 'high' })
  })

  it('returns a single bootstrap payload for the app', async () => {
    const viewer = await env.as('sara@acme.test')
    const b = await viewer.get(`${O}/bootstrap`)
    expect(b.body.tasks).toHaveLength(6)
    expect(b.body.members).toHaveLength(5)
    // JSON columns must arrive as objects/arrays, not strings (the Approvals page reads task.approval.history)
    const t = b.body.tasks[0]
    expect(t.approval).toEqual(expect.objectContaining({ status: 'none', history: [] }))
    expect(Array.isArray(t.blockedBy)).toBe(true)
  })
})
