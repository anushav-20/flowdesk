import { createContext, ApiError } from '../engine/core'
import { createDB } from '../engine/db'
import { createSession } from '../engine/session'
import { DEMO_USERS, DEMO_PASSWORD } from '../engine/seed'
import { readJSON, writeJSON } from '@/lib/storage'

/**
 * "API mode": the same `api` contract as the in-browser engine, backed by the Node/Express server.
 *
 *  - Data: one GET /bootstrap fills the local store; the UI reads it exactly as in demo mode
 *  - Writes: REST calls, then a debounced refresh
 *  - Real time: WebSocket events trigger refreshes; presence/cursors are relayed by the server
 *  - Auth: JWT access token + rotating refresh token (retried transparently on 401)
 *  - Offline: task edits made offline are queued, applied optimistically, and synced via POST /sync
 *    when the connection returns (field-level conflicts are reported)
 */

const EMPTY = {
  users: {},
  orgs: {},
  memberships: {},
  invitations: {},
  projects: {},
  tasks: {},
  comments: {},
  events: {},
  fieldDefs: {},
  rules: {},
  ruleRuns: [],
  webhooks: {},
  deliveries: [],
  jobs: {},
  notifications: {},
  audit: [],
  docs: {},
  docVersions: [],
  savedSearches: {},
  stats: {},
  outbox: [],
  counters: {},
}
const OUTBOX_KEY = 'flowdesk-offline-outbox'
const keyed = (list, mapFn = (x) => x) => Object.fromEntries(list.map((x) => [x.id, mapFn(x)]))

export function createRemoteWorkspace({ baseUrl, toast = () => {} }) {
  const db = createDB(EMPTY, { persist: false })
  const session = createSession()
  const ctx = createContext({ db, session })
  const tokens = { access: sessionStorage.getItem('fd-at'), refresh: sessionStorage.getItem('fd-rt') }
  let refreshTimer = null
  let socket = null
  const peers = new Map()
  const peerListeners = new Set()
  let peerSnapshot = []

  const saveTokens = (t) => {
    tokens.access = t.accessToken
    tokens.refresh = t.refreshToken
    sessionStorage.setItem('fd-at', t.accessToken)
    sessionStorage.setItem('fd-rt', t.refreshToken)
  }

  async function http(path, { method = 'GET', body, retry = true } = {}) {
    let res
    try {
      res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(tokens.access && { Authorization: `Bearer ${tokens.access}` }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      throw new ApiError('offline', 'You appear to be offline.', 0)
    }
    if (res.status === 401 && retry && tokens.refresh && !path.startsWith('/auth/')) {
      const r = await fetch(`${baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: tokens.refresh }),
      })
      if (r.ok) {
        saveTokens(await r.json())
        return http(path, { method, body, retry: false })
      }
      session.set({})
    }
    if (res.status === 204) return null
    const data = await res.json().catch(() => ({}))
    if (!res.ok)
      throw new ApiError(
        data.error?.code ?? 'error',
        data.error?.message ?? `Request failed (${res.status})`,
        res.status,
      )
    return data
  }

  const org = () => `/orgs/${session.get().orgId}`

  // ---------------------------------------------------------------- loading
  async function load() {
    const { orgId, userId } = session.get()
    if (!userId) return
    const me = await http('/auth/me')
    const current = orgId && me.orgs.some((o) => o.id === orgId) ? orgId : me.orgs[0]?.id
    if (current !== orgId) session.set({ userId, orgId: current })
    const [details, b] = await Promise.all([http(`/orgs/${current}`), http(`/orgs/${current}/bootstrap`)])
    const admin = ['owner', 'admin'].includes(details.role)
    const [jobs, hooks, deliveries] = admin
      ? await Promise.all([
          http(`/orgs/${current}/jobs`).catch(() => ({ items: [] })),
          http(`/orgs/${current}/webhooks`).catch(() => []),
          http(`/orgs/${current}/webhooks/deliveries`).catch(() => []),
        ])
      : [{ items: [] }, [], []]
    const withOrg = (x) => ({ ...x, orgId: current })
    db.reset({
      ...EMPTY,
      users: { ...keyed(b.members), [me.user.id]: { ...me.user } },
      orgs: Object.fromEntries(
        me.orgs.map((o) => [o.id, o.id === current ? { ...details, name: details.name } : { id: o.id, name: o.name }]),
      ),
      memberships: Object.fromEntries([
        ...b.members.map((m) => [
          `${current}:${m.id}`,
          { id: `${current}:${m.id}`, orgId: current, userId: m.id, role: m.role, joinedAt: m.joinedAt },
        ]),
        ...me.orgs
          .filter((o) => o.id !== current)
          .map((o) => [
            `${o.id}:${me.user.id}`,
            { id: `${o.id}:${me.user.id}`, orgId: o.id, userId: me.user.id, role: o.role },
          ]),
      ]),
      projects: keyed(b.projects),
      tasks: keyed(b.tasks),
      comments: keyed(b.comments),
      events: keyed(b.events),
      fieldDefs: keyed(b.fields, withOrg),
      rules: keyed(b.rules),
      ruleRuns: b.runs,
      notifications: keyed(b.notifications),
      audit: b.audit,
      docs: keyed(b.docs),
      jobs: keyed(jobs.items),
      webhooks: keyed(hooks),
      deliveries,
      stats: Object.fromEntries(Object.entries(b.stats).map(([u, s]) => [`${current}:${u}`, s])),
      savedSearches: readJSON('fd-saved-searches', {}),
    })
    connectSocket(current)
  }

  const refresh = () => {
    clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => load().catch((e) => ctx.recordCall('refresh', 0, false, e)), 150)
  }

  // ---------------------------------------------------------------- realtime
  function connectSocket(orgId) {
    if (socket?.orgId === orgId && socket.readyState <= 1) return
    socket?.close()
    const url = `${baseUrl.replace(/^http/, 'ws').replace(/\/api$/, '')}/ws?token=${encodeURIComponent(tokens.access)}`
    socket = new WebSocket(url)
    socket.orgId = orgId
    socket.onopen = () => socket.send(JSON.stringify({ type: 'subscribe', orgId }))
    socket.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.type === 'event') refresh()
      if (msg.type === 'presence') {
        const u = db.getState().users[msg.userId]
        peers.set(msg.userId, {
          tabId: msg.userId,
          userId: msg.userId,
          orgId,
          name: u?.name ?? 'Someone',
          color: u?.color ?? '#888',
          location: msg.location,
          docId: msg.docId,
          cursor: msg.cursor,
          at: msg.at,
        })
        peerSnapshot = [...peers.values()].filter((p) => Date.now() - p.at < 15_000)
        peerListeners.forEach((l) => l())
      }
    }
    socket.onclose = () => setTimeout(() => session.get().userId && connectSocket(orgId), 3000)
  }

  const presence = {
    update(patch) {
      if (socket?.readyState === 1) socket.send(JSON.stringify({ type: 'presence', ...patch }))
    },
    getPeers: () => peerSnapshot,
    subscribe(l) {
      peerListeners.add(l)
      return () => peerListeners.delete(l)
    },
    announce() {},
    stop() {},
  }

  // ---------------------------------------------------------------- offline outbox
  async function flushOutbox() {
    const queue = readJSON(OUTBOX_KEY, [])
    if (!queue.length || !navigator.onLine) return
    const { results } = await http(`${org()}/sync`, { method: 'POST', body: { mutations: queue } })
    writeJSON(OUTBOX_KEY, [])
    const conflicts = results.filter((r) => r.conflicts?.length).length
    const rejected = results.filter((r) => r.status === 'rejected').length
    toast(
      `Synced ${results.length} offline change${results.length === 1 ? '' : 's'}${conflicts ? ` — ${conflicts} had conflicts (server values kept)` : ''}${rejected ? `, ${rejected} rejected` : ''}`,
      conflicts || rejected ? 'error' : 'success',
    )
    refresh()
  }
  if (typeof window !== 'undefined') window.addEventListener('online', () => flushOutbox().catch(() => {}))

  async function updateTaskWithOffline(id, changes) {
    try {
      const t = await http(`${org()}/tasks/${id}`, { method: 'PATCH', body: changes })
      refresh()
      return t
    } catch (err) {
      if (err.code !== 'offline') throw err
      const base = db.getState().tasks[id]
      const queue = readJSON(OUTBOX_KEY, [])
      queue.push({ clientId: `m${Date.now()}`, taskId: id, base, changes })
      writeJSON(OUTBOX_KEY, queue)
      db.transact((tx) => tx.patch('tasks', id, { ...changes, updatedAt: Date.now() })) // optimistic
      toast('Offline — change saved and will sync when you reconnect')
      return { ...base, ...changes }
    }
  }

  // ---------------------------------------------------------------- api (same contract as the local engine)
  const after = async (p) => {
    const r = await p
    refresh()
    return r
  }
  const notInApi = (what) => async () => {
    throw new ApiError('unsupported', `${what} isn't available in API mode.`, 400)
  }

  const methods = {
    async login({ email, password }) {
      const r = await http('/auth/login', { method: 'POST', body: { email, password } })
      saveTokens(r)
      session.set({ userId: r.user.id, orgId: null })
      await load()
    },
    async demoLogin(userId) {
      const u = DEMO_USERS.find((x) => x.id === userId)
      return methods.login({ email: u.email, password: DEMO_PASSWORD })
    },
    async register(input) {
      const r = await http('/auth/register', { method: 'POST', body: input })
      saveTokens(r)
      session.set({ userId: r.user.id, orgId: r.orgId })
      await load()
    },
    async logout() {
      await http('/auth/logout', { method: 'POST', body: { refreshToken: tokens.refresh } }).catch(() => {})
      sessionStorage.removeItem('fd-at')
      sessionStorage.removeItem('fd-rt')
      socket?.close()
      session.set({})
      db.reset(EMPTY)
    },
    async switchOrg(orgId) {
      session.set({ ...session.get(), orgId })
      await load()
    },
    createOrg: async ({ name }) => {
      const o = await http('/orgs', { method: 'POST', body: { name } })
      await methods.switchOrg(o.id)
      return o.id
    },
    invite: (body) => after(http(`${org()}/invitations`, { method: 'POST', body })),
    changeRole: (userId, role) => after(http(`${org()}/members/${userId}`, { method: 'PATCH', body: { role } })),
    removeMember: (userId) => after(http(`${org()}/members/${userId}`, { method: 'DELETE' })),
    cancelInvite: notInApi('Cancelling invitations'),
    updateProfile: notInApi('Editing profiles'),

    createProject: (body) =>
      after(http(`${org()}/projects`, { method: 'POST', body: { ...body, deadline: body.deadline || null } })),
    updateProject: (id, body) => after(http(`${org()}/projects/${id}`, { method: 'PATCH', body })),
    deleteProject: notInApi('Deleting projects'),
    createTask: (body) =>
      after(
        http(`${org()}/tasks`, {
          method: 'POST',
          body: {
            ...body,
            assigneeId: body.assigneeId || null,
            dueDate: body.dueDate || null,
            estimate: Number(body.estimate) || 0,
          },
        }),
      ),
    async createTasksBulk(projectId, items) {
      const refToId = {}
      for (const item of items) {
        const t = await http(`${org()}/tasks`, {
          method: 'POST',
          body: {
            title: item.title,
            projectId,
            priority: item.priority,
            estimate: item.estimate,
            dueDate: item.dueDate,
            blockedBy: (item.blockedBy ?? []).map((r) => refToId[r]).filter(Boolean),
          },
        })
        refToId[item.ref] = t.id
      }
      refresh()
    },
    updateTask: (id, changes) =>
      updateTaskWithOffline(id, {
        ...changes,
        ...(changes.estimate !== undefined && { estimate: Number(changes.estimate) || 0 }),
      }),
    moveTask: (id, status) => updateTaskWithOffline(id, { status }),
    deleteTask: (id) => after(http(`${org()}/tasks/${id}`, { method: 'DELETE' })),
    addDependency: (id, prerequisiteId) =>
      after(http(`${org()}/tasks/${id}/dependencies`, { method: 'POST', body: { prerequisiteId } })),
    removeDependency: (id, prereqId) =>
      after(http(`${org()}/tasks/${id}/dependencies/${prereqId}`, { method: 'DELETE' })),
    logFocusSession: (taskId, minutes) =>
      taskId ? after(http(`${org()}/tasks/${taskId}/focus`, { method: 'POST', body: { minutes } })) : Promise.resolve(),
    createEvent: (body) => after(http(`${org()}/events`, { method: 'POST', body })),
    deleteEvent: (id) => after(http(`${org()}/events/${id}`, { method: 'DELETE' })),

    addComment: (taskId, body) => after(http(`${org()}/tasks/${taskId}/comments`, { method: 'POST', body })),
    async deleteComment(id) {
      const c = db.getState().comments[id]
      return after(http(`${org()}/tasks/${c.taskId}/comments/${id}`, { method: 'DELETE' }))
    },
    createDoc: (body) => after(http(`${org()}/docs`, { method: 'POST', body })),
    saveDoc: (id, body) => after(http(`${org()}/docs/${id}`, { method: 'PUT', body })),
    restoreDocVersion: notInApi('Restoring doc versions'),
    markNotificationRead: (id) => after(http(`${org()}/notifications/read`, { method: 'POST', body: { ids: [id] } })),
    markAllNotificationsRead: () => after(http(`${org()}/notifications/read`, { method: 'POST', body: {} })),
    announce: (message) => after(http(`${org()}/announcements`, { method: 'POST', body: { message } })),

    approvalAction: (taskId, type, reason) =>
      after(http(`${org()}/tasks/${taskId}/approval`, { method: 'POST', body: { type, reason } })),
    updateApprovalChain: (approvalChain) => after(http(org(), { method: 'PATCH', body: { approvalChain } })),
    saveRule: (rule) =>
      after(
        rule.id
          ? http(`${org()}/automations/${rule.id}`, { method: 'PATCH', body: rule })
          : http(`${org()}/automations`, { method: 'POST', body: rule }),
      ),
    toggleRule: (id, enabled) => after(http(`${org()}/automations/${id}`, { method: 'PATCH', body: { enabled } })),
    deleteRule: (id) => after(http(`${org()}/automations/${id}`, { method: 'DELETE' })),
    async saveWebhook({ id, url, events, active }) {
      if (id) await http(`${org()}/webhooks/${id}`, { method: 'DELETE' })
      return after(http(`${org()}/webhooks`, { method: 'POST', body: { url, events, active } }))
    },
    deleteWebhook: (id) => after(http(`${org()}/webhooks/${id}`, { method: 'DELETE' })),
    testWebhook: (id) => after(http(`${org()}/webhooks/${id}/test`, { method: 'POST' })),
    updateIntegration: (name, body) => after(http(`${org()}/integrations/${name}`, { method: 'PATCH', body })),
    syncGitHub: () => after(http(`${org()}/integrations/github/sync`, { method: 'POST' })),
    handleGitHubEvent: notInApi('Simulated GitHub events (GitHub calls the signed webhook endpoint directly)'),

    enqueueJob: (type, { priority } = {}) => after(http(`${org()}/jobs`, { method: 'POST', body: { type, priority } })),
    retryJob: (id) => after(http(`${org()}/jobs/${id}/retry`, { method: 'POST' })),
    discardJob: notInApi('Discarding jobs'),
    restoreFromAudit: (id) => after(http(`${org()}/audit/${id}/restore`, { method: 'POST' })),
    saveField: (body) => after(http(`${org()}/fields`, { method: 'POST', body })),
    deleteField: (id) => after(http(`${org()}/fields/${id}`, { method: 'DELETE' })),
    updateOrgSettings: ({ name, capacity }) =>
      after(http(org(), { method: 'PATCH', body: { name, capacity: Number(capacity) } })),

    // Saved searches are a per-device preference in API mode
    async saveSearch(s) {
      const all = readJSON('fd-saved-searches', {})
      const id = `s${Date.now()}`
      all[id] = { ...s, id, orgId: session.get().orgId, userId: session.get().userId, createdAt: Date.now() }
      writeJSON('fd-saved-searches', all)
      db.transact((tx) => tx.put('savedSearches', all[id]))
    },
    async deleteSavedSearch(id) {
      const all = readJSON('fd-saved-searches', {})
      delete all[id]
      writeJSON('fd-saved-searches', all)
      db.transact((tx) => tx.remove('savedSearches', id))
    },
    resetDemo: notInApi('Resetting demo data'),
  }

  const api = {}
  for (const [name, fn] of Object.entries(methods)) api[name] = ctx.instrument(name, fn)
  api.startWorker = () => () => {} // the server runs the background worker
  api._tick = async () => 0

  // Resume an existing session
  if (session.get().userId && tokens.access)
    load()
      .then(flushOutbox)
      .catch(() => session.set({}))

  return { db, session, ctx, api, presence, metrics: ctx.metrics, mode: 'api' }
}
