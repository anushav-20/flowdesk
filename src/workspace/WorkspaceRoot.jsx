import { lazy, Suspense, useEffect, useMemo, useRef } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import ThemeSync from '@/app/ThemeSync'
import ErrorBoundary from '@/components/ErrorBoundary'
import Icon from '@/components/ui/Icon'
import Logo from '@/components/ui/Logo'
import PageLoader from '@/components/ui/PageLoader'
import ThemeToggle from '@/components/ui/ThemeToggle'
import ToastRegion from '@/components/ui/Toast'
import LoginPage from './LoginPage'
import { NAV } from './nav'
import { Avatar } from './ui/primitives'
import { ui, useUi } from './uiStore'
import {
  useApi,
  useCurrent,
  useOrgCollection,
  usePeers,
  useSession,
  useWorkspace,
  useWs,
  WorkspaceProvider,
} from './WorkspaceContext'
import './workspace.css'

const TaskDrawer = lazy(() => import('./overlays/TaskDrawer'))
const CreateTaskDialog = lazy(() => import('./overlays/CreateTaskDialog'))
const SearchDialog = lazy(() => import('./overlays/SearchDialog'))
const AssistantPanel = lazy(() => import('./overlays/AssistantPanel'))
const NotificationsPanel = lazy(() => import('./overlays/NotificationsPanel'))
const ShortcutsDialog = lazy(() => import('./overlays/ShortcutsDialog'))
const FocusMode = lazy(() => import('./overlays/FocusMode'))

const isTyping = (el) => el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))

/** Global keyboard shortcuts: c / ? f . and two-key "g then x" navigation. */
function useShortcuts() {
  const navigate = useNavigate()
  const pending = useRef(null)
  useEffect(() => {
    const onKey = (e) => {
      if (
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        isTyping(document.activeElement) ||
        document.querySelector('.modal-backdrop')
      )
        return
      const k = e.key.toLowerCase()
      if (pending.current) {
        const item = NAV.flatMap((g) => g.items).find((i) => i.key === k)
        pending.current = null
        if (item) {
          e.preventDefault()
          navigate(item.to)
        }
        return
      }
      if (k === 'g') {
        pending.current = setTimeout(() => (pending.current = null), 1200)
      } else if (k === 'c') {
        e.preventDefault()
        ui.newTask()
      } else if (k === '/') {
        e.preventDefault()
        ui.open('search')
      } else if (e.key === '?') {
        ui.open('shortcuts')
      } else if (k === 'f') {
        ui.toggle('focus')
      } else if (k === '.') {
        ui.toggle('assistant')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])
}

function OrgSwitcher() {
  const api = useApi()
  const { userId, orgId } = useSession()
  const memberships = useWs((s) => s.memberships)
  const orgs = useWs((s) => s.orgs)
  const mine = useMemo(() => Object.values(memberships).filter((m) => m.userId === userId), [memberships, userId])
  return (
    <label className="org-switcher">
      <span className="sr-only">Workspace</span>
      <select value={orgId ?? ''} onChange={(e) => api.switchOrg(e.target.value)}>
        {mine.map((m) => (
          <option key={m.orgId} value={m.orgId}>
            {orgs[m.orgId]?.name}
          </option>
        ))}
      </select>
    </label>
  )
}

function PresenceBar() {
  const { orgId } = useSession()
  const peers = usePeers()
  const here = peers.filter((p) => p.orgId === orgId)
  if (!here.length) return null
  return (
    <div className="presence" aria-label={`${here.length} other ${here.length === 1 ? 'person' : 'people'} online`}>
      {here.slice(0, 4).map((p) => (
        <span key={p.tabId} className="presence__item" title={`${p.name} — ${p.location || 'online'}`}>
          <Avatar user={{ name: p.name, color: p.color }} size={28} title={false} />
          <span className="presence__dot" aria-hidden="true" />
        </span>
      ))}
    </div>
  )
}

function Shell() {
  const api = useApi()
  const { presence } = useWorkspace()
  const { user, org, can } = useCurrent()
  const location = useLocation()
  const overlay = useUi((s) => s)
  const notifications = useOrgCollection('notifications')
  const unread = notifications.filter((n) => n.userId === user?.id && !n.read).length
  useShortcuts()

  // Broadcast which page we're on (presence)
  useEffect(() => {
    presence?.update({ location: location.pathname.replace('/app', '') || '/dashboard' })
  }, [location.pathname, presence])

  // Close the mobile sidebar on navigation (pathname is the trigger, not a value used inside)
  useEffect(() => {
    ui.close('sidebar')
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [location.pathname])

  if (!org) return <PageLoader />

  const hidden = (to) => (to === '/app/health' && !can('health.read')) || (to === '/app/jobs' && !can('jobs.manage'))

  return (
    <div className={`ws ${overlay.focus ? 'is-focus' : ''}`}>
      <a href="#ws-main" className="skip-link">
        Skip to main content
      </a>
      <aside className={`ws-sidebar ${overlay.sidebar ? 'is-open' : ''}`} aria-label="Workspace navigation">
        <div className="ws-sidebar__top">
          <NavLink to="/" className="ws-sidebar__logo" aria-label="FlowDesk website">
            <Logo size={28} />
          </NavLink>
          <OrgSwitcher />
        </div>
        <button
          type="button"
          className="ws-sidebar__new btn btn--primary btn--md"
          onClick={() => ui.newTask()}
          disabled={!can('task.create')}
        >
          <Icon name="plus" size={18} /> New task <kbd>C</kbd>
        </button>
        <nav className="ws-nav">
          {NAV.map((g) => (
            <div key={g.group} className="ws-nav__group">
              <p className="ws-nav__label">{g.group}</p>
              <ul>
                {g.items
                  .filter((i) => !hidden(i.to))
                  .map((i) => (
                    <li key={i.to}>
                      <NavLink
                        to={i.to}
                        end={i.end}
                        className={({ isActive }) => `ws-nav__link ${isActive ? 'is-active' : ''}`}
                      >
                        <Icon name={i.icon} size={18} />
                        {i.label}
                      </NavLink>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
      {overlay.sidebar && <div className="ws-scrim" onClick={() => ui.close('sidebar')} aria-hidden="true" />}

      <div className="ws-main">
        <header className="ws-topbar">
          <button
            type="button"
            className="icon-btn ws-topbar__menu"
            onClick={() => ui.toggle('sidebar')}
            aria-label="Open navigation"
            aria-expanded={overlay.sidebar}
          >
            <Icon name="menu" size={20} />
          </button>
          <button type="button" className="ws-search-trigger" onClick={() => ui.open('search')}>
            <Icon name="search" size={17} />
            <span>Search tasks, projects, people…</span>
            <kbd>/</kbd>
          </button>
          <div className="ws-topbar__actions">
            <PresenceBar />
            <button
              type="button"
              className="btn btn--secondary btn--sm ws-ai-btn"
              onClick={() => ui.toggle('assistant')}
              aria-pressed={overlay.assistant}
            >
              <Icon name="spark" size={16} /> <span>Ask AI</span>
            </button>
            <button
              type="button"
              className={`icon-btn ${overlay.focus ? 'is-on' : ''}`}
              onClick={() => ui.toggle('focus')}
              aria-pressed={overlay.focus}
              aria-label="Focus mode (F)"
              title="Focus mode (F)"
            >
              <Icon name="target" size={19} />
            </button>
            <button
              type="button"
              className="icon-btn ws-bell"
              onClick={() => ui.toggle('notifications')}
              aria-label={`Notifications, ${unread} unread`}
              aria-expanded={overlay.notifications}
            >
              <Icon name="bell" size={19} />
              {unread > 0 && <span className="ws-bell__count">{unread > 9 ? '9+' : unread}</span>}
            </button>
            <ThemeToggle />
            <details className="user-menu">
              <summary aria-label="Account menu">
                <Avatar user={user} size={34} />
              </summary>
              <div className="user-menu__panel">
                <p>
                  <strong>{user.name}</strong>
                  <span>{user.email}</span>
                </p>
                <button type="button" onClick={() => ui.open('shortcuts')}>
                  Keyboard shortcuts <kbd>?</kbd>
                </button>
                <button type="button" onClick={() => api.logout()}>
                  Sign out
                </button>
              </div>
            </details>
          </div>
        </header>

        <main id="ws-main" className="ws-content" tabIndex={-1}>
          <ErrorBoundary key={location.pathname}>
            <Suspense fallback={<PageLoader />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>

      <Suspense fallback={null}>
        {overlay.focus && <FocusMode />}
        {overlay.taskId && <TaskDrawer taskId={overlay.taskId} key={overlay.taskId} />}
        {overlay.createTask && <CreateTaskDialog defaults={overlay.createTask} />}
        {overlay.search && <SearchDialog />}
        {overlay.assistant && <AssistantPanel />}
        {overlay.notifications && <NotificationsPanel />}
        {overlay.shortcuts && <ShortcutsDialog />}
      </Suspense>
    </div>
  )
}

function Gate() {
  const { userId } = useSession()
  const user = useWs((s) => (userId ? s.users[userId] : null))
  useEffect(() => {
    document.title = user ? 'FlowDesk workspace' : 'Sign in · FlowDesk'
  }, [user])
  return user ? <Shell /> : <LoginPage />
}

/** Entry for every /app route. */
export default function WorkspaceRoot() {
  return (
    <WorkspaceProvider>
      <ThemeSync />
      <Gate />
      <ToastRegion />
    </WorkspaceProvider>
  )
}
