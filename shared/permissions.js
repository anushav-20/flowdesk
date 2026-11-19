/**
 * Role-based access control. One table, used by both the browser app and the API,
 * so the UI can hide what the server would reject anyway.
 */

export const ROLES = ['owner', 'admin', 'member', 'viewer']

export const ROLE_LABELS = { owner: 'Owner', admin: 'Admin', member: 'Member', viewer: 'Viewer' }

const PERMISSIONS = {
  'task.read': ['owner', 'admin', 'member', 'viewer'],
  'task.create': ['owner', 'admin', 'member'],
  'task.update': ['owner', 'admin', 'member'],
  'task.delete': ['owner', 'admin'],
  'comment.create': ['owner', 'admin', 'member'],
  'project.manage': ['owner', 'admin'],
  'member.invite': ['owner', 'admin'],
  'member.manage': ['owner'],
  'automation.manage': ['owner', 'admin'],
  'webhook.manage': ['owner', 'admin'],
  'settings.manage': ['owner', 'admin'],
  'audit.read': ['owner', 'admin'],
  'audit.restore': ['owner', 'admin'],
  'jobs.manage': ['owner', 'admin'],
  'health.read': ['owner', 'admin'],
  'doc.edit': ['owner', 'admin', 'member'],
}

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS)

/** @param {string} role @param {keyof typeof PERMISSIONS} permission */
export function can(role, permission) {
  return Boolean(PERMISSIONS[permission]?.includes(role))
}

/** An owner can't be demoted below another owner by an admin, and nobody can remove the last owner. */
export function canChangeRole({ actorRole, targetRole, newRole, ownerCount }) {
  if (!can(actorRole, 'member.manage')) return false
  if (targetRole === 'owner' && newRole !== 'owner' && ownerCount <= 1) return false
  return ROLES.includes(newRole)
}
