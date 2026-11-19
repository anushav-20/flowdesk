import { boardSeed } from '@/data/content'
import { createStore } from '@/lib/createStore'

export const COLUMNS = [
  { id: 'todo', title: 'To do', color: '#f59e0b' },
  { id: 'progress', title: 'In progress', color: '#6d5dfc' },
  { id: 'done', title: 'Done', color: '#12a37a' },
]
export const PRIORITIES = ['low', 'medium', 'high']
export const MAX_TITLE = 80
export const MAX_ACTIVITY = 6

const columnTitle = (id) => COLUMNS.find((c) => c.id === id)?.title ?? id

/**
 * Normalised state shape (like a database):
 *   tasks:    { [id]: task }          – O(1) lookup; each card subscribes to only its own task
 *   columns:  { [columnId]: [ids] }   – ordering lives separately from task data
 *   activity: [{ id, text, at }]      – newest first, capped at MAX_ACTIVITY
 * This keeps references stable, so moving one card re-renders only the 2 affected columns.
 */
export function buildInitialState(seed = boardSeed) {
  const tasks = {}
  const columns = Object.fromEntries(COLUMNS.map((c) => [c.id, []]))
  for (const t of seed) {
    tasks[t.id] = { id: t.id, title: t.title, priority: t.priority }
    columns[t.column].push(t.id)
  }
  return { tasks, columns, filter: 'all', activity: [] }
}

const findColumn = (columns, taskId) => Object.keys(columns).find((c) => columns[c].includes(taskId))

/** Reducers stay pure: the timestamp comes in with the action, never from Date.now() here. */
const log = (state, text, at = 0) =>
  [{ id: `${at}-${state.activity.length}-${text}`, text, at }, ...state.activity].slice(0, MAX_ACTIVITY)

export function boardReducer(state, action) {
  const at = action.meta?.at

  switch (action.type) {
    case 'task/add': {
      const { id, title, priority = 'medium', column = 'todo' } = action.payload
      const clean = String(title).trim().slice(0, MAX_TITLE)
      if (!clean || state.tasks[id] || !state.columns[column]) return state
      return {
        ...state,
        tasks: {
          ...state.tasks,
          [id]: { id, title: clean, priority: PRIORITIES.includes(priority) ? priority : 'medium' },
        },
        columns: { ...state.columns, [column]: [...state.columns[column], id] },
        activity: log(state, `Added “${clean}” to ${columnTitle(column)}`, at),
      }
    }

    case 'task/rename': {
      const { id, title } = action.payload
      const task = state.tasks[id]
      const clean = String(title).trim().slice(0, MAX_TITLE)
      if (!task || !clean || clean === task.title) return state
      return {
        ...state,
        tasks: { ...state.tasks, [id]: { ...task, title: clean } },
        activity: log(state, `Renamed “${task.title}” to “${clean}”`, at),
      }
    }

    case 'task/remove': {
      const id = action.payload
      const col = findColumn(state.columns, id)
      if (!col) return state
      const { [id]: removed, ...tasks } = state.tasks
      return {
        ...state,
        tasks,
        columns: { ...state.columns, [col]: state.columns[col].filter((t) => t !== id) },
        activity: log(state, `Deleted “${removed.title}”`, at),
      }
    }

    case 'task/move': {
      const { id, to, index } = action.payload
      const from = findColumn(state.columns, id)
      if (!from || !state.columns[to]) return state

      const source = state.columns[from].filter((t) => t !== id)
      const target = from === to ? source : [...state.columns[to]]
      const pos = index == null ? target.length : Math.max(0, Math.min(index, target.length))
      target.splice(pos, 0, id)

      if (from === to && target.every((t, i) => t === state.columns[from][i])) return state // no-op move
      return {
        ...state,
        columns: { ...state.columns, [from]: source, [to]: target },
        activity:
          from === to
            ? state.activity
            : log(state, `Moved “${state.tasks[id].title}” from ${columnTitle(from)} → ${columnTitle(to)}`, at),
      }
    }

    case 'filter/set':
      return state.filter === action.payload ? state : { ...state, filter: action.payload }

    case 'board/reset':
      return buildInitialState()

    default:
      return state
  }
}

export const boardStore = createStore(buildInitialState(), boardReducer, {
  persist: {
    key: 'flowdesk-board',
    version: 2, // bumped when `activity` was added, so old saved boards are ignored safely
    pick: ({ tasks, columns, activity }) => ({ tasks, columns, activity }),
  },
})

export const useBoard = boardStore.useStore

let counter = 0
const { dispatch } = boardStore
const meta = () => ({ at: Date.now() })
export const boardActions = {
  add: (title, priority) =>
    dispatch({ type: 'task/add', payload: { id: `t-${Date.now()}-${++counter}`, title, priority }, meta: meta() }),
  rename: (id, title) => dispatch({ type: 'task/rename', payload: { id, title }, meta: meta() }),
  remove: (id) => dispatch({ type: 'task/remove', payload: id, meta: meta() }),
  move: (id, to, index) => dispatch({ type: 'task/move', payload: { id, to, index }, meta: meta() }),
  setFilter: (filter) => dispatch({ type: 'filter/set', payload: filter }),
  reset: () => dispatch({ type: 'board/reset' }),
}

// Selectors
export const selectFilter = (s) => s.filter
export const selectTasks = (s) => s.tasks
export const selectColumns = (s) => s.columns
export const selectActivity = (s) => s.activity
