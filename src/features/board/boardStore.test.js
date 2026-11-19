import { describe, expect, it } from 'vitest'
import { boardReducer, buildInitialState } from './boardStore'

const seed = [
  { id: 'a', title: 'A', column: 'todo', priority: 'low' },
  { id: 'b', title: 'B', column: 'todo', priority: 'high' },
  { id: 'c', title: 'C', column: 'done', priority: 'medium' },
]
const initial = () => buildInitialState(seed)

describe('boardReducer', () => {
  it('normalises the seed into tasks + column order', () => {
    const s = initial()
    expect(s.columns).toEqual({ todo: ['a', 'b'], progress: [], done: ['c'] })
    expect(s.tasks.a).toEqual({ id: 'a', title: 'A', priority: 'low' })
  })

  it('adds a trimmed task to the end of To do', () => {
    const s = boardReducer(initial(), { type: 'task/add', payload: { id: 'n', title: '  New  ', priority: 'high' } })
    expect(s.columns.todo).toEqual(['a', 'b', 'n'])
    expect(s.tasks.n.title).toBe('New')
  })

  it('rejects empty titles and invalid priorities', () => {
    const s0 = initial()
    expect(boardReducer(s0, { type: 'task/add', payload: { id: 'x', title: '   ' } })).toBe(s0)
    const s1 = boardReducer(s0, { type: 'task/add', payload: { id: 'y', title: 'Y', priority: 'urgent!!' } })
    expect(s1.tasks.y.priority).toBe('medium')
  })

  it('moves a task between columns at a given index', () => {
    const s = boardReducer(initial(), { type: 'task/move', payload: { id: 'b', to: 'done', index: 0 } })
    expect(s.columns.todo).toEqual(['a'])
    expect(s.columns.done).toEqual(['b', 'c'])
  })

  it('reorders within the same column', () => {
    const s = boardReducer(initial(), { type: 'task/move', payload: { id: 'a', to: 'todo', index: 1 } })
    expect(s.columns.todo).toEqual(['b', 'a'])
  })

  it('returns the same state for a no-op move (avoids re-renders)', () => {
    const s0 = initial()
    expect(boardReducer(s0, { type: 'task/move', payload: { id: 'a', to: 'todo', index: 0 } })).toBe(s0)
  })

  it('keeps untouched columns referentially equal', () => {
    const s0 = initial()
    const s1 = boardReducer(s0, { type: 'task/move', payload: { id: 'a', to: 'progress' } })
    expect(s1.columns.done).toBe(s0.columns.done)
  })

  it('removes a task from both maps', () => {
    const s = boardReducer(initial(), { type: 'task/remove', payload: 'c' })
    expect(s.tasks.c).toBeUndefined()
    expect(s.columns.done).toEqual([])
  })

  it('renames a task (trimmed) and ignores empty or unchanged names', () => {
    const s0 = initial()
    const s1 = boardReducer(s0, { type: 'task/rename', payload: { id: 'a', title: '  Renamed  ' } })
    expect(s1.tasks.a.title).toBe('Renamed')
    expect(boardReducer(s1, { type: 'task/rename', payload: { id: 'a', title: '   ' } })).toBe(s1)
    expect(boardReducer(s1, { type: 'task/rename', payload: { id: 'a', title: 'Renamed' } })).toBe(s1)
  })

  it('records status changes in the activity log, newest first and capped', () => {
    let s = initial()
    s = boardReducer(s, { type: 'task/move', payload: { id: 'a', to: 'done' }, meta: { at: 1000 } })
    expect(s.activity[0]).toMatchObject({ text: 'Moved “A” from To do → Done', at: 1000 })

    for (let i = 0; i < 10; i++) s = boardReducer(s, { type: 'task/add', payload: { id: `n${i}`, title: `N${i}` } })
    expect(s.activity).toHaveLength(6)
    expect(s.activity[0].text).toBe('Added “N9” to To do')
  })

  it('does not log reordering inside the same column', () => {
    const s = boardReducer(initial(), { type: 'task/move', payload: { id: 'a', to: 'todo', index: 1 } })
    expect(s.activity).toEqual([])
  })
})
