import { memo, useCallback, useMemo, useState } from 'react'
import { boardActions, selectFilter, selectTasks, useBoard } from './boardStore'
import TaskCard from './TaskCard'

/** A droppable column. Subscribes to its own id list, so moving a card between two
 *  columns never re-renders the third one. */
function BoardColumn({ column, draggingId, onAnnounce, onDragStart, onDragEnd }) {
  const ids = useBoard(useCallback((s) => s.columns[column.id], [column.id]))
  const filter = useBoard(selectFilter)
  const tasks = useBoard(selectTasks)
  const [dropIndex, setDropIndex] = useState(null)

  const visibleIds = useMemo(
    () => (filter === 'all' ? ids : ids.filter((id) => tasks[id]?.priority === filter)),
    [ids, tasks, filter],
  )

  const handleDragOver = (e) => {
    if (!draggingId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    // Find the card under the pointer to show where the task will land
    const card = e.target.closest('[data-task-id]')
    if (card) {
      const rect = card.getBoundingClientRect()
      const idx = ids.indexOf(card.dataset.taskId)
      setDropIndex(e.clientY > rect.top + rect.height / 2 ? idx + 1 : idx)
    } else if (e.target === e.currentTarget || !card) {
      setDropIndex(ids.length)
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/plain') || draggingId
    if (id) {
      boardActions.move(id, column.id, dropIndex ?? undefined)
      onAnnounce(`Moved task to ${column.title}.`)
    }
    setDropIndex(null)
    onDragEnd()
  }

  const headingId = `col-${column.id}`

  return (
    // Drag & drop is a pointer enhancement; keyboard/touch users move tasks with the arrow buttons on each card.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <section
      className={`column ${dropIndex !== null ? 'is-drop-target' : ''}`}
      aria-labelledby={headingId}
      onDragOver={handleDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDropIndex(null)
      }}
      onDrop={handleDrop}
    >
      <h3 id={headingId} className="column__title">
        <span className="column__dot" style={{ background: column.color }} aria-hidden="true" />
        {column.title}
        <span className="column__count" aria-label={`${visibleIds.length} tasks`}>
          {visibleIds.length}
        </span>
      </h3>

      {visibleIds.length === 0 ? (
        <p className="column__empty">{filter === 'all' ? 'Drop tasks here' : 'No tasks match this filter'}</p>
      ) : (
        <ul className="column__list">
          {visibleIds.map((id, i) => (
            <TaskCard
              key={id}
              id={id}
              index={i}
              columnId={column.id}
              onAnnounce={onAnnounce}
              onDragStart={onDragStart}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

export default memo(BoardColumn)
