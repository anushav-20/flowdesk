import { can } from '@shared/permissions.js'

/** Error with a machine-readable code, mirroring the server's JSON error format. */
export class ApiError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

export const uid = (prefix) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

/** Text input hygiene used by every write: trims, collapses control chars, enforces max length. */
export function cleanText(value, { max = 200, required = false, field = 'Value' } = {}) {
  const s = String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim()
  if (required && !s) throw new ApiError('validation', `${field} is required.`, 422)
  if (s.length > max) throw new ApiError('validation', `${field} must be ${max} characters or fewer.`, 422)
  return s
}

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
export const PRIORITIES = ['low', 'medium', 'high']
export const STATUSES = ['todo', 'progress', 'review', 'done']
export const STATUS_LABELS = { todo: 'To do', progress: 'In progress', review: 'Review', done: 'Completed' }

/**
 * Creates the execution context shared by every API module.
 * @param {{ db: ReturnType<import('./db').createDB>, session: { get: () => {userId?:string, orgId?:string}, set: Function }, clock?: () => number }} deps
 */
export function createContext({ db, session, clock = () => Date.now() }) {
  const ctx = {
    db,
    session,
    now: clock,
    /** post-commit handlers (automations, webhooks…) registered by modules */
    eventHandlers: [],
    metrics: { calls: [], errors: [] },

    /** Current user + membership; throws if not signed in / not a member. */
    actor() {
      const { userId, orgId } = session.get()
      const state = db.getState()
      const user = userId && state.users[userId]
      if (!user) throw new ApiError('unauthenticated', 'Please sign in.', 401)
      const membership = orgId && state.memberships[`${orgId}:${userId}`]
      if (!membership) throw new ApiError('forbidden', 'You are not a member of this workspace.', 403)
      return { user, orgId, role: membership.role }
    },

    /** Throws 403 unless the current user's role allows `permission`. */
    authorize(permission) {
      const a = ctx.actor()
      if (!can(a.role, permission)) throw new ApiError('forbidden', `Your role (${a.role}) can't do that.`, 403)
      return a
    },

    /** Loads an entity and enforces tenant isolation: another org's data is "not found", never leaked. */
    inOrg(collection, id, orgId) {
      const e = db.getState()[collection][id]
      if (!e || e.orgId !== orgId) throw new ApiError('not_found', 'Not found.', 404)
      return e
    },

    /**
     * A permission-checked, audited, atomic write. Domain events emitted inside are
     * dispatched after commit (so automations see the committed state).
     */
    mutate(permission, recipe, { depth = 0 } = {}) {
      const actor = ctx.authorize(permission)
      const events = []
      const emit = (type, subject, extra = {}) =>
        events.push({ type, subject, orgId: actor.orgId, actorId: actor.user.id, depth, ...extra })
      const audit = (tx, entry) =>
        tx.log('audit', {
          id: uid('a'),
          orgId: actor.orgId,
          actorId: actor.user.id,
          at: ctx.now(),
          viaAutomation: depth > 0,
          ...entry,
        })
      const result = db.transact((tx) => recipe(tx, { ...actor, emit, audit }))
      for (const e of events) for (const h of ctx.eventHandlers) h(e)
      return result
    },

    /**
     * Write performed by the system (automations, background jobs) rather than a person.
     * Not permission-checked — rules were authorised when an admin created them — but fully audited.
     */
    systemMutate(orgId, recipe, { depth = 1, label = 'Automation' } = {}) {
      const events = []
      const system = { id: 'system', name: label }
      const emit = (type, subject, extra = {}) =>
        events.push({ type, subject, orgId, actorId: 'system', depth, ...extra })
      const audit = (tx, entry) =>
        tx.log('audit', {
          id: uid('a'),
          orgId,
          actorId: 'system',
          actorLabel: label,
          at: ctx.now(),
          viaAutomation: true,
          ...entry,
        })
      const result = db.transact((tx) => recipe(tx, { user: system, orgId, role: 'owner', emit, audit }))
      for (const e of events) for (const h of ctx.eventHandlers) h(e)
      return result
    },

    /** Wraps an API method to record timing + errors for the Health dashboard. */
    instrument(name, fn) {
      return async (...args) => {
        const start = performance.now()
        try {
          const r = await fn(...args)
          ctx.recordCall(name, performance.now() - start, true)
          return r
        } catch (err) {
          ctx.recordCall(name, performance.now() - start, false, err)
          throw err
        }
      }
    },

    recordCall(name, ms, ok, err) {
      ctx.metrics.calls.push({ name, ms, ok, at: ctx.now() })
      if (ctx.metrics.calls.length > 300) ctx.metrics.calls.shift()
      if (!ok && !(err instanceof ApiError && err.status < 500 && err.code !== 'internal')) {
        ctx.metrics.errors.unshift({ name, message: String(err?.message ?? err), at: ctx.now() })
        ctx.metrics.errors.length = Math.min(ctx.metrics.errors.length, 50)
      } else if (!ok) {
        ctx.metrics.errors.unshift({ name, message: `${err.code}: ${err.message}`, at: ctx.now(), level: 'warn' })
        ctx.metrics.errors.length = Math.min(ctx.metrics.errors.length, 50)
      }
    },
  }
  return ctx
}

/** Notification helper used inside transactions. */
export function notify(tx, { orgId, userId, type, message, link = null, now }) {
  if (!userId) return
  tx.put('notifications', { id: uid('n'), orgId, userId, type, message, link, read: false, createdAt: now })
}

export const orgMembers = (state, orgId) =>
  Object.values(state.memberships)
    .filter((m) => m.orgId === orgId)
    .map((m) => ({ ...state.users[m.userId], role: m.role }))
