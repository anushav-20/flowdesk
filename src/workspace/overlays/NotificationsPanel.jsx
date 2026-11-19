import { useMemo } from 'react'
import Icon from '@/components/ui/Icon'
import { timeAgo } from '../ui/primitives'
import { ui } from '../uiStore'
import { useApi, useCurrent, useOrgCollection } from '../WorkspaceContext'

const ICONS = {
  mention: 'message',
  assignment: 'user',
  approval: 'check',
  automation: 'bolt',
  badge: 'spark',
  comment: 'message',
  announcement: 'bell',
  invite: 'user',
}

/** Smart notifications: deadlines, assignments, mentions, approvals, automations, achievements. */
export default function NotificationsPanel() {
  const api = useApi()
  const { user } = useCurrent()
  const all = useOrgCollection('notifications')
  const mine = useMemo(
    () =>
      all
        .filter((n) => n.userId === user.id)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 40),
    [all, user.id],
  )
  const unread = mine.filter((n) => !n.read).length

  return (
    <aside className="side-panel" aria-label="Notifications">
      <header className="side-panel__head">
        <h2>
          <Icon name="bell" size={18} /> Notifications{' '}
          {unread > 0 && <span className="badge badge--brand">{unread} new</span>}
        </h2>
        <div>
          {unread > 0 && (
            <button type="button" className="link-btn small" onClick={() => api.markAllNotificationsRead()}>
              Mark all read
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            onClick={() => ui.close('notifications')}
            aria-label="Close notifications"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      </header>
      <div className="side-panel__body">
        {mine.length === 0 ? (
          <p className="muted">You're all caught up.</p>
        ) : (
          <ul className="list">
            {mine.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className={`list-item notif ${n.read ? '' : 'is-unread'}`}
                  onClick={() => {
                    api.markNotificationRead(n.id)
                    if (n.link?.taskId) ui.openTask(n.link.taskId)
                  }}
                >
                  <Icon name={ICONS[n.type] ?? 'bell'} size={18} />
                  <span className="list-item__main">
                    <span className="list-item__title">{n.message}</span>
                    <span className="list-item__meta">{timeAgo(n.createdAt)}</span>
                  </span>
                  {!n.read && <span className="notif__dot" aria-label="Unread" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}
