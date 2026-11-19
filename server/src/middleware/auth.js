import jwt from 'jsonwebtoken'
import { can } from '../../../shared/permissions.js'
import { forbidden, HttpError, notFound } from '../lib/errors.js'

/** Verifies the `Authorization: Bearer <JWT>` access token and loads the user. */
export function requireAuth(ctx) {
  return async (req, _res, next) => {
    const header = req.get('authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : null
    if (!token) throw new HttpError(401, 'unauthenticated', 'Sign in required.')
    let payload
    try {
      payload = jwt.verify(token, ctx.config.jwtSecret, { algorithms: ['HS256'], issuer: 'flowdesk' })
    } catch {
      throw new HttpError(401, 'invalid_token', 'Your session has expired. Please sign in again.')
    }
    const user = await ctx.db.one('SELECT id, email, name, title, color FROM users WHERE id = $1', [payload.sub])
    if (!user) throw new HttpError(401, 'invalid_token', 'Account not found.')
    req.user = user
    next()
  }
}

/**
 * Multi-tenant guard for /orgs/:orgId/* routes: the user must be a member of the org.
 * Non-members get 404 (not 403) so the existence of other tenants isn't revealed.
 */
export function requireMembership(ctx) {
  return async (req, _res, next) => {
    const m = await ctx.db.one('SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2', [
      req.params.orgId,
      req.user.id,
    ])
    if (!m) throw notFound('Workspace')
    const org = await ctx.db.one('SELECT * FROM orgs WHERE id = $1', [req.params.orgId])
    req.org = org
    req.role = m.role
    req.actor = { user: req.user, orgId: org.id, role: m.role }
    next()
  }
}

/** Role-based authorisation using the shared permission table (same rules as the UI). */
export const authorize = (permission) => (req, _res, next) => {
  if (!can(req.role, permission)) throw forbidden(`Your role (${req.role}) can't do that.`)
  next()
}
