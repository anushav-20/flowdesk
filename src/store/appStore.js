import { createStore } from '@/lib/createStore'

/**
 * Global UI state: theme, pricing billing period, toast notifications, command palette.
 * Theme + billing are persisted; toasts and palette state are session-only.
 */

const initialTheme =
  typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'

export const initialAppState = {
  theme: initialTheme,
  billing: 'monthly',
  toasts: [],
  paletteOpen: false,
}

let toastId = 0

export function appReducer(state, action) {
  switch (action.type) {
    case 'theme/toggle':
      return { ...state, theme: state.theme === 'dark' ? 'light' : 'dark' }
    case 'billing/set':
      return state.billing === action.payload ? state : { ...state, billing: action.payload }
    case 'toast/show':
      // Keep at most 3 toasts on screen
      return { ...state, toasts: [...state.toasts.slice(-2), { id: ++toastId, ...action.payload }] }
    case 'toast/dismiss':
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.payload) }
    case 'palette/open':
      return { ...state, paletteOpen: true }
    case 'palette/close':
      return state.paletteOpen ? { ...state, paletteOpen: false } : state
    default:
      return state
  }
}

export const appStore = createStore(initialAppState, appReducer, {
  persist: {
    key: 'flowdesk-app',
    version: 1,
    pick: ({ theme, billing }) => ({ theme, billing }),
  },
})

// ----- Selectors (stable functions → components re-render only on their slice) -----
export const selectTheme = (s) => s.theme
export const selectBilling = (s) => s.billing
export const selectToasts = (s) => s.toasts
export const selectPaletteOpen = (s) => s.paletteOpen

// ----- Action creators -----
const { dispatch } = appStore
export const appActions = {
  toggleTheme: () => dispatch({ type: 'theme/toggle' }),
  setBilling: (billing) => dispatch({ type: 'billing/set', payload: billing }),
  toast: (message, variant = 'success') => dispatch({ type: 'toast/show', payload: { message, variant } }),
  dismissToast: (id) => dispatch({ type: 'toast/dismiss', payload: id }),
  openPalette: () => dispatch({ type: 'palette/open' }),
  closePalette: () => dispatch({ type: 'palette/close' }),
}

export const useAppStore = appStore.useStore
