/* oxlint-disable react/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from 'react'
import { can as roleCan } from '@shared/permissions.js'
import { env } from '@/config/env'
import { appActions } from '@/store/appStore'
import { createWorkspace } from './engine'
import { createRemoteWorkspace } from './remote/remoteWorkspace'

const WorkspaceCtx = createContext(null)

let singleton = null
/**
 * One workspace engine per page load (shared across all /app routes).
 * VITE_WORKSPACE_API_URL set → talk to the Node backend; otherwise run fully in the browser (demo mode).
 */
export function getWorkspace() {
  if (!singleton)
    singleton = env.workspaceApiUrl
      ? createRemoteWorkspace({ baseUrl: env.workspaceApiUrl, toast: appActions.toast })
      : createWorkspace()
  return singleton
}

export function WorkspaceProvider({ children, workspace }) {
  const ws = workspace ?? getWorkspace()

  // Background worker: scheduler + job queue
  useEffect(() => ws.api.startWorker(), [ws])

  return <WorkspaceCtx.Provider value={ws}>{children}</WorkspaceCtx.Provider>
}

export function useWorkspace() {
  const ws = useContext(WorkspaceCtx)
  if (!ws) throw new Error('useWorkspace must be used inside <WorkspaceProvider>')
  return ws
}

export const useApi = () => useWorkspace().api

/**
 * Subscribe to a slice of workspace state. The selector must return a stable reference
 * (a collection or a primitive); derive filtered lists with useMemo in the component.
 */
export function useWs(selector) {
  const { db } = useWorkspace()
  return useSyncExternalStore(
    db.subscribe,
    () => selector(db.getState()),
    () => selector(db.getState()),
  )
}

export function useSession() {
  const { session } = useWorkspace()
  return useSyncExternalStore(session.subscribe, session.get, session.get)
}

/** Current user, organisation, role and a permission checker. */
export function useCurrent() {
  const { userId, orgId } = useSession()
  const user = useWs(useCallback((s) => (userId ? s.users[userId] : null), [userId]))
  const org = useWs(useCallback((s) => (orgId ? s.orgs[orgId] : null), [orgId]))
  const membership = useWs(
    useCallback((s) => (orgId && userId ? s.memberships[`${orgId}:${userId}`] : null), [orgId, userId]),
  )
  const role = membership?.role ?? null
  return useMemo(
    () => ({ user, org, orgId, userId, role, can: (p) => Boolean(role && roleCan(role, p)) }),
    [user, org, orgId, userId, role],
  )
}

/** Collection filtered to the current organisation (memoised; recomputes only when the collection changes). */
export function useOrgCollection(name) {
  const { orgId } = useSession()
  const coll = useWs(useCallback((s) => s[name], [name]))
  return useMemo(() => {
    const list = Array.isArray(coll) ? coll : Object.values(coll ?? {})
    return list.filter((x) => x.orgId === orgId)
  }, [coll, orgId])
}

export function useMembers() {
  const { orgId } = useSession()
  const memberships = useWs((s) => s.memberships)
  const users = useWs((s) => s.users)
  return useMemo(
    () =>
      Object.values(memberships)
        .filter((m) => m.orgId === orgId)
        .map((m) => ({ ...users[m.userId], role: m.role, joinedAt: m.joinedAt }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [memberships, users, orgId],
  )
}

/** Online peers (other tabs / people), via presence heartbeats. */
export function usePeers() {
  const { presence } = useWorkspace()
  const subscribe = useCallback((l) => presence?.subscribe(l) ?? (() => {}), [presence])
  const get = useCallback(() => presence?.getPeers() ?? EMPTY, [presence])
  return useSyncExternalStore(subscribe, get, get)
}
const EMPTY = []
