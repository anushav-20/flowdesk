/**
 * Central, validated access to environment configuration.
 * Only VITE_* variables are exposed to the browser — never put secrets here.
 */

const ROUTER_MODES = ['browser', 'hash', 'memory']

const rawMode = import.meta.env.VITE_ROUTER_MODE
const routerMode = ROUTER_MODES.includes(rawMode) ? rawMode : 'browser'

export const env = Object.freeze({
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || 'https://dummyjson.com',
  /** 'browser' (clean URLs, needs SPA rewrites), 'hash' (GitHub Pages), 'memory' (sandboxed embeds) */
  routerMode,
  isDev: import.meta.env.DEV,
  isTest: import.meta.env.MODE === 'test',
  siteUrl: import.meta.env.VITE_SITE_URL || 'https://flowdesk.example.com',
  /** Set to e.g. http://localhost:4000/api to run the /app workspace against the Node backend. */
  workspaceApiUrl: import.meta.env.VITE_WORKSPACE_API_URL || '',
})
