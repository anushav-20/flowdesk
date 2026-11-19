import { useCallback, useMemo, useState } from 'react'
import Button from '@/components/ui/Button'
import Reveal from '@/components/ui/Reveal'
import SectionHeading from '@/components/ui/SectionHeading'
import ActivityFeed from './ActivityFeed'
import AddTaskForm from './AddTaskForm'
import BoardColumn from './BoardColumn'
import { COLUMNS, PRIORITIES, boardActions, selectColumns, selectFilter, useBoard } from './boardStore'
import './board.css'

function Progress() {
  const columns = useBoard(selectColumns)
  const { done, total } = useMemo(() => {
    return { done: columns.done.length, total: Object.values(columns).reduce((n, ids) => n + ids.length, 0) }
  }, [columns])
  const pct = total ? Math.round((done / total) * 100) : 0

  return (
    <div className="board__progress">
      <span>
        <strong>{pct}%</strong> complete · {done} of {total} tasks done
      </span>
      <div
        className="board__progress-bar"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Sprint progress"
      >
        <span style={{ transform: `scaleX(${pct / 100})` }} />
      </div>
    </div>
  )
}

function FilterBar() {
  const filter = useBoard(selectFilter)
  const options = ['all', ...PRIORITIES]
  return (
    <div className="board__filters" role="group" aria-label="Filter by priority">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          className={`chip ${filter === o ? 'is-active' : ''}`}
          aria-pressed={filter === o}
          onClick={() => boardActions.setFilter(o)}
        >
          {o === 'all' ? 'All' : o[0].toUpperCase() + o.slice(1)}
        </button>
      ))}
    </div>
  )
}

/** Interactive product demo: a working Kanban board saved in the visitor's browser. */
export default function BoardDemo() {
  const [message, setMessage] = useState('')
  const [draggingId, setDraggingId] = useState(null)

  // Stable callbacks → memoised columns/cards don't re-render because of new function props
  const announce = useCallback((msg) => setMessage(msg), [])
  const handleDragEnd = useCallback(() => setDraggingId(null), [])

  return (
    <section id="demo" className="section section--alt" aria-labelledby="demo-title">
      <div className="container">
        <SectionHeading
          id="demo-title"
          eyebrow="Live demo"
          title="Don't take our word for it — try it"
          subtitle="This board really works. Add tasks, double-click to rename, drag them between columns (or use the arrow buttons) and filter by priority. Your board is saved in this browser."
        />
        <Reveal className="board" onDragEnd={handleDragEnd}>
          <div className="board__toolbar">
            <AddTaskForm onAnnounce={announce} />
            <div className="board__meta">
              <FilterBar />
              <Button
                variant="ghost"
                size="sm"
                iconLeft="refresh"
                onClick={() => {
                  boardActions.reset()
                  announce('Board reset to the example tasks.')
                }}
              >
                Reset
              </Button>
            </div>
            <Progress />
          </div>

          <div className={`board__columns ${draggingId ? 'is-dragging' : ''}`}>
            {COLUMNS.map((column) => (
              <BoardColumn
                key={column.id}
                column={column}
                draggingId={draggingId}
                onAnnounce={announce}
                onDragStart={setDraggingId}
                onDragEnd={handleDragEnd}
              />
            ))}
          </div>

          <ActivityFeed />

          <p className="sr-only" role="status" aria-live="polite">
            {message}
          </p>
        </Reveal>
      </div>
    </section>
  )
}
