import { canChangeRole, ROLES } from '@shared/permissions.js'
import { EMAIL_RE } from '@/lib/validators'
import { ApiError, cleanText, notify, uid } from '../core'
import { hashPassword, verifyPassword } from '../crypto'
import { DEMO_PASSWORD } from '../seed'

/** Authentication, organisations (tenants), members, roles and invitations. */
export function accountsModule(ctx) {
  const { db, session } = ctx
  const attempts = new Map() // email → { count, until } — brute-force protection

  const firstOrgOf = (userId) =>
    Object.values(db.getState().memberships).find((m) => m.userId === userId)?.orgId ?? null

  return {
    async login({ email, password }) {
      const key = String(email).trim().toLowerCase()
      const lock = attempts.get(key)
      if (lock?.until > ctx.now()) throw new ApiError('rate_limited', 'Too many attempts. Try again in a minute.', 429)

      const user = Object.values(db.getState().users).find((u) => u.email === key)
      const ok = user && (user.demo ? password === DEMO_PASSWORD : await verifyPassword(password, user.passwordHash))
      if (!ok) {
        const count = (lock?.count ?? 0) + 1
        attempts.set(key, { count, until: count >= 5 ? ctx.now() + 60_000 : 0 })
        // Same message whether the email exists or not (prevents account enumeration)
        throw new ApiError('invalid_credentials', 'Email or password is incorrect.', 401)
      }
      attempts.delete(key)
      session.set({ userId: user.id, orgId: firstOrgOf(user.id) })
      return { userId: user.id }
    },

    /** One-click sign-in for the demo accounts. */
    async demoLogin(userId) {
      const user = db.getState().users[userId]
      if (!user?.demo) throw new ApiError('not_found', 'Unknown demo user.', 404)
      session.set({ userId, orgId: firstOrgOf(userId) })
      return { userId }
    },

    async register({ name, email, password, orgName }) {
      const cleanName = cleanText(name, { max: 60, required: true, field: 'Name' })
      const cleanEmail = String(email ?? '')
        .trim()
        .toLowerCase()
      if (!EMAIL_RE.test(cleanEmail)) throw new ApiError('validation', 'Enter a valid email address.', 422)
      if (String(password ?? '').length < 8)
        throw new ApiError('validation', 'Password must be at least 8 characters.', 422)
      if (Object.values(db.getState().users).some((u) => u.email === cleanEmail))
        throw new ApiError('conflict', 'An account with this email already exists.', 409)
      const workspace = cleanText(orgName || `${cleanName.split(' ')[0]}'s team`, { max: 60, field: 'Workspace name' })

      const passwordHash = await hashPassword(password)
      const userId = uid('u')
      const orgId = uid('o')
      const now = ctx.now()
      db.transact((tx) => {
        tx.put('users', {
          id: userId,
          name: cleanName,
          email: cleanEmail,
          passwordHash,
          color: '#6d5dfc',
          title: '',
          createdAt: now,
        })
        tx.put('orgs', {
          id: orgId,
          name: workspace,
          slug: workspace.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          keyPrefix:
            workspace
              .replace(/[^A-Za-z]/g, '')
              .slice(0, 2)
              .toUpperCase() || 'WS',
          createdAt: now,
          approvalChain: [{ id: 'review', name: 'Owner review', approverId: userId }],
          integrations: {
            github: { connected: false },
            slack: { connected: false, webhookUrl: '' },
            email: { weeklyReport: false },
          },
          capacity: 5,
        })
        tx.put('memberships', { id: `${orgId}:${userId}`, orgId, userId, role: 'owner', joinedAt: now })
        tx.put('projects', {
          id: uid('p'),
          orgId,
          name: 'My first project',
          description: '',
          color: '#6d5dfc',
          deadline: null,
          createdAt: now,
          archived: false,
        })
        tx.ensure('counters')[orgId] = 0
      })
      session.set({ userId, orgId })
      return { userId, orgId }
    },

    async logout() {
      session.set({})
    },

    async switchOrg(orgId) {
      const { userId } = session.get()
      if (!db.getState().memberships[`${orgId}:${userId}`])
        throw new ApiError('forbidden', 'You are not a member of that workspace.', 403)
      session.set({ userId, orgId })
    },

    async createOrg({ name }) {
      const { user } = ctx.actor()
      const clean = cleanText(name, { max: 60, required: true, field: 'Workspace name' })
      const orgId = uid('o')
      db.transact((tx) => {
        tx.put('orgs', {
          id: orgId,
          name: clean,
          slug: clean.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          keyPrefix:
            clean
              .replace(/[^A-Za-z]/g, '')
              .slice(0, 2)
              .toUpperCase() || 'WS',
          createdAt: ctx.now(),
          approvalChain: [{ id: 'review', name: 'Owner review', approverId: user.id }],
          integrations: {
            github: { connected: false },
            slack: { connected: false, webhookUrl: '' },
            email: { weeklyReport: false },
          },
          capacity: 5,
        })
        tx.put('memberships', { id: `${orgId}:${user.id}`, orgId, userId: user.id, role: 'owner', joinedAt: ctx.now() })
        tx.ensure('counters')[orgId] = 0
      })
      session.set({ userId: user.id, orgId })
      return orgId
    },

    async invite({ email, role = 'member' }) {
      const cleanEmail = String(email ?? '')
        .trim()
        .toLowerCase()
      if (!EMAIL_RE.test(cleanEmail)) throw new ApiError('validation', 'Enter a valid email address.', 422)
      if (!ROLES.includes(role) || role === 'owner') throw new ApiError('validation', 'Choose a valid role.', 422)
      return ctx.mutate('member.invite', (tx, a) => {
        const state = tx.state
        const existing = Object.values(state.users).find((u) => u.email === cleanEmail)
        if (existing && state.memberships[`${a.orgId}:${existing.id}`])
          throw new ApiError('conflict', 'That person is already a member.', 409)
        const invite = tx.put('invitations', {
          id: uid('i'),
          orgId: a.orgId,
          email: cleanEmail,
          role,
          status: 'pending',
          invitedBy: a.user.id,
          createdAt: ctx.now(),
        })
        a.audit(tx, {
          action: 'member.invited',
          entityType: 'invitation',
          entityId: invite.id,
          after: invite,
          summary: `Invited ${cleanEmail} as ${role}`,
        })
        // Demo convenience: existing accounts join immediately (a real system emails a signed link)
        if (existing) {
          tx.put('memberships', {
            id: `${a.orgId}:${existing.id}`,
            orgId: a.orgId,
            userId: existing.id,
            role,
            joinedAt: ctx.now(),
          })
          tx.patch('invitations', invite.id, { status: 'accepted' })
          notify(tx, {
            orgId: a.orgId,
            userId: existing.id,
            type: 'invite',
            message: `You were added to ${state.orgs[a.orgId].name}`,
            now: ctx.now(),
          })
        }
        return invite
      })
    },

    async changeRole(userId, newRole) {
      return ctx.mutate('member.manage', (tx, a) => {
        const m = tx.state.memberships[`${a.orgId}:${userId}`]
        if (!m) throw new ApiError('not_found', 'Member not found.', 404)
        const ownerCount = Object.values(tx.state.memberships).filter(
          (x) => x.orgId === a.orgId && x.role === 'owner',
        ).length
        if (!canChangeRole({ actorRole: a.role, targetRole: m.role, newRole, ownerCount }))
          throw new ApiError(
            'forbidden',
            'That role change is not allowed (a workspace needs at least one owner).',
            403,
          )
        tx.patch('memberships', m.id, { role: newRole })
        a.audit(tx, {
          action: 'member.role_changed',
          entityType: 'member',
          entityId: userId,
          before: { role: m.role },
          after: { role: newRole },
          summary: `Changed ${tx.state.users[userId].name}'s role from ${m.role} to ${newRole}`,
        })
      })
    },

    async removeMember(userId) {
      return ctx.mutate('member.manage', (tx, a) => {
        const m = tx.state.memberships[`${a.orgId}:${userId}`]
        if (!m) throw new ApiError('not_found', 'Member not found.', 404)
        if (m.role === 'owner')
          throw new ApiError('forbidden', "Owners can't be removed. Change their role first.", 403)
        tx.remove('memberships', m.id)
        // Unassign their open tasks so nothing silently stalls
        for (const t of tx.all('tasks'))
          if (t.orgId === a.orgId && t.assigneeId === userId && t.status !== 'done')
            tx.patch('tasks', t.id, { assigneeId: null })
        a.audit(tx, {
          action: 'member.removed',
          entityType: 'member',
          entityId: userId,
          before: m,
          summary: `Removed ${tx.state.users[userId].name}`,
        })
      })
    },

    async cancelInvite(id) {
      return ctx.mutate('member.invite', (tx, a) => {
        ctx.inOrg('invitations', id, a.orgId)
        tx.patch('invitations', id, { status: 'cancelled' })
      })
    },

    async updateProfile({ name, title }) {
      const { user } = ctx.actor()
      db.transact((tx) =>
        tx.patch('users', user.id, {
          name: cleanText(name, { max: 60, required: true, field: 'Name' }),
          title: cleanText(title, { max: 60 }),
        }),
      )
    },
  }
}
