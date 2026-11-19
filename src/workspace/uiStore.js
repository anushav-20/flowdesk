import { createStore } from '@/lib/createStore'

/** Workspace UI state (which overlay is open). Kept separate from data so data updates don't re-render overlays. */
const initial = {
  taskId: null, // task drawer
  createTask: null, // { status, projectId } when the create dialog is open
  search: false,
  assistant: false,
  notifications: false,
  shortcuts: false,
  focus: false,
  sidebar: false, // mobile
}

function reducer(state, { type, payload }) {
  switch (type) {
    case 'open':
      return { ...state, ...payload }
    case 'close':
      return { ...state, [payload]: payload === 'createTask' || payload === 'taskId' ? null : false }
    case 'closeAll':
      return { ...initial, focus: state.focus }
    default:
      return state
  }
}

export const uiStore = createStore(initial, reducer)
export const useUi = uiStore.useStore
export const ui = {
  openTask: (taskId) => uiStore.dispatch({ type: 'open', payload: { taskId, notifications: false, search: false } }),
  newTask: (defaults = {}) => uiStore.dispatch({ type: 'open', payload: { createTask: defaults } }),
  open: (name) => uiStore.dispatch({ type: 'open', payload: { [name]: true } }),
  close: (name) => uiStore.dispatch({ type: 'close', payload: name }),
  toggle: (name) => uiStore.dispatch({ type: 'open', payload: { [name]: !uiStore.getState()[name] } }),
  closeAll: () => uiStore.dispatch({ type: 'closeAll' }),
}
