import { createContext } from './core'
import { createDB } from './db'
import { accountsModule } from './modules/accounts'
import { collaborationModule } from './modules/collaboration'
import { operationsModule } from './modules/operations'
import { tasksModule } from './modules/tasks'
import { workflowModule } from './modules/workflow'
import { createPresence } from './presence'
import { buildSeed } from './seed'
import { createSession } from './session'

/**
 * Assembles the workspace engine: database + session + domain modules.
 *
 * The UI only talks to `api` (async methods) and reads state through `db`.
 * This is the same contract as the HTTP client for the Node backend,
 * so the app can run fully in the browser (demo) or against the server.
 */
/** `fetch` is injectable so tests can stand in for GitHub and Slack. */
export function createWorkspace({
  persist = true,
  clock,
  seed,
  sessionStorage: storage,
  presence = true,
  fetch: fetchImpl,
} = {}) {
  const db = createDB(seed ?? buildSeed(clock?.() ?? Date.now()), { persist })
  const session = createSession(storage === undefined ? undefined : { storage })
  const ctx = createContext({ db, session, clock })
  ctx.fetch = fetchImpl

  const tasks = tasksModule(ctx)
  const modules = {
    ...accountsModule(ctx),
    ...tasks,
    ...collaborationModule(ctx),
    ...workflowModule(ctx, tasks),
    ...operationsModule(ctx),
  }

  // Public API: every non-internal method is instrumented for the Health dashboard
  const api = {}
  for (const [name, fn] of Object.entries(modules)) {
    api[name] = name.startsWith('_') || name === 'startWorker' ? fn : ctx.instrument(name, fn.bind(modules))
  }
  api.resetDemo = async () => {
    db.reset(buildSeed(ctx.now()))
    session.set({})
  }

  const presenceApi = presence
    ? createPresence({
        getIdentity: () => {
          const { userId, orgId } = session.get()
          const user = userId && db.getState().users[userId]
          return user ? { userId, orgId, name: user.name, color: user.color } : null
        },
      })
    : null

  return { db, session, ctx, api, presence: presenceApi, metrics: ctx.metrics }
}
