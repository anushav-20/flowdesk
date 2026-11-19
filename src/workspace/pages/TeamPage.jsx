import { useMemo, useState } from 'react'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import { appActions } from '@/store/appStore'
import { ALL_PERMISSIONS, can as roleCan, ROLE_LABELS, ROLES } from '@shared/permissions.js'
import { attempt, Avatar, fmtDate, PageTitle, Panel } from '../ui/primitives'
import { useApi, useCurrent, useMembers, useOrgCollection, useSession, useWs } from '../WorkspaceContext'

const toast = appActions.toast

/** Team workspace: members, roles (RBAC), invitations, and the organisations you belong to (multi-tenant). */
export default function TeamPage() {
  const api = useApi()
  const { user, can } = useCurrent()
  const { userId } = useSession()
  const members = useMembers()
  const tasks = useOrgCollection('tasks')
  const invitations = useOrgCollection('invitations').filter((i) => i.status === 'pending')
  const memberships = useWs((s) => s.memberships)
  const orgs = useWs((s) => s.orgs)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('member')
  const [orgName, setOrgName] = useState('')
  const myOrgs = useMemo(() => Object.values(memberships).filter((m) => m.userId === userId), [memberships, userId])
  const openCount = (id) => tasks.filter((t) => t.assigneeId === id && t.status !== 'done').length

  return (
    <div className="ws-page">
      <PageTitle
        title="Team & roles"
        subtitle="Invite people, assign roles, and manage the workspaces you belong to. Each workspace's data is completely separate."
      />

      <Panel title={`Members (${members.length})`}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th className="num">Open tasks</th>
                <th>Joined</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td>
                    <span className="cell-user">
                      <Avatar user={m} size={32} />
                      <span>
                        <strong>
                          {m.name}
                          {m.id === user.id && ' (you)'}
                        </strong>
                        <span className="muted small" style={{ display: 'block' }}>
                          {m.email}
                          {m.title && ` · ${m.title}`}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td>
                    {can('member.manage') && m.id !== user.id ? (
                      <label>
                        <span className="sr-only">Role for {m.name}</span>
                        <select
                          value={m.role}
                          onChange={(e) =>
                            attempt(api.changeRole(m.id, e.target.value), {
                              toast,
                              success: `${m.name} is now ${ROLE_LABELS[e.target.value]}`,
                            })
                          }
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <span className="badge badge--brand">{ROLE_LABELS[m.role]}</span>
                    )}
                  </td>
                  <td className="num">{openCount(m.id)}</td>
                  <td>{m.joinedAt ? fmtDate(new Date(m.joinedAt).toISOString()) : '—'}</td>
                  <td className="num">
                    {can('member.manage') && m.id !== user.id && m.role !== 'owner' && (
                      <button
                        type="button"
                        className="icon-btn icon-btn--danger"
                        aria-label={`Remove ${m.name}`}
                        onClick={() =>
                          attempt(api.removeMember(m.id), {
                            toast,
                            success: `${m.name} removed; their open tasks were unassigned`,
                          })
                        }
                      >
                        <Icon name="trash" size={16} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid-2">
        <Panel title="Invite a teammate">
          {can('member.invite') ? (
            <form
              className="drawer-section"
              onSubmit={async (e) => {
                e.preventDefault()
                if (await attempt(api.invite({ email, role }), { toast, success: `Invitation sent to ${email}` }))
                  setEmail('')
              }}
            >
              <div className="field-inline">
                <label>
                  <span className="label">Email</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@company.com"
                    required
                  />
                </label>
                <label style={{ maxWidth: 150 }}>
                  <span className="label">Role</span>
                  <select value={role} onChange={(e) => setRole(e.target.value)}>
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </label>
                <Button type="submit">Invite</Button>
              </div>
              <p className="muted small">
                Tip: invite omar@nimbus.test (a demo account from another workspace) to see them join instantly.
              </p>
              {invitations.length > 0 && (
                <ul className="list">
                  {invitations.map((i) => (
                    <li key={i.id} className="list-item">
                      <Icon name="mail" size={16} />
                      <span className="list-item__main">
                        {i.email} <span className="muted small">· {ROLE_LABELS[i.role]} · pending</span>
                      </span>
                      <Button size="sm" variant="ghost" onClick={() => attempt(api.cancelInvite(i.id), { toast })}>
                        Cancel
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </form>
          ) : (
            <p className="muted small">Only owners and admins can invite people.</p>
          )}
        </Panel>

        <Panel title="Your workspaces">
          <ul className="list">
            {myOrgs.map((m) => (
              <li key={m.orgId} className="list-item">
                <Icon name="board" size={18} />
                <span className="list-item__main">
                  <span className="list-item__title">{orgs[m.orgId].name}</span>
                  <span className="list-item__meta">Your role: {ROLE_LABELS[m.role]}</span>
                </span>
                <Button size="sm" variant="ghost" onClick={() => api.switchOrg(m.orgId)}>
                  Switch
                </Button>
              </li>
            ))}
          </ul>
          <form
            className="field-inline"
            style={{ marginTop: '1rem' }}
            onSubmit={async (e) => {
              e.preventDefault()
              if (await attempt(api.createOrg({ name: orgName }), { toast, success: `Created ${orgName}` }))
                setOrgName('')
            }}
          >
            <label>
              <span className="label">New workspace</span>
              <input
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="e.g. Side project"
                maxLength={60}
                required
              />
            </label>
            <Button type="submit" variant="secondary">
              Create
            </Button>
          </form>
        </Panel>
      </div>

      <Panel title="What each role can do">
        <div className="table-wrap">
          <table className="table perm-table">
            <caption className="sr-only">Permissions by role</caption>
            <thead>
              <tr>
                <th>Permission</th>
                {ROLES.map((r) => (
                  <th key={r} className="num">
                    {ROLE_LABELS[r]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ALL_PERMISSIONS.map((p) => (
                <tr key={p}>
                  <th scope="row">
                    <code>{p}</code>
                  </th>
                  {ROLES.map((r) => (
                    <td key={r} className="num">
                      {roleCan(r, p) ? (
                        <span className="perm-yes">
                          ✓<span className="sr-only">allowed</span>
                        </span>
                      ) : (
                        <span className="muted">
                          –<span className="sr-only">not allowed</span>
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}
