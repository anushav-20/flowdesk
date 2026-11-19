import { memo, useCallback, useEffect, useRef, useState } from 'react'
import Icon from '@/components/ui/Icon'
import { COLUMNS, MAX_TITLE, boardActions, useBoard } from './boardStore'

/** Inline title editor: Enter or blur saves, Escape cancels. */
function TitleEditor({ task, onDone, onAnnounce }) {
  const [draft, setDraft] = useState(task.title)
  const inputRef = useRef(null)
  const cancelled = useRef(false)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const save = () => {
    if (cancelled.current) return
    const clean = draft.trim()
    if (clean && clean !== task.title) {
      boardActions.rename(task.id, clean)
      onAnnounce(`Renamed task to "${clean}".`)
    }
    onDone()
  }

  return (
    <input
      ref={inputRef}
      className="task__edit"
      value={draft}
      maxLength={MAX_TITLE}
      aria-label={`Edit name of "${task.title}"`}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          save()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          cancelled.current = true
          onDone()
        }
      }}
    />
  )
}

/**
 * One draggable task. Memoised and subscribed to *only its own task*,
 * so editing or moving other cards never re-renders this one.
 * Every drag action also has a keyboard/touch equivalent (the arrow buttons).
 */
function TaskCard({ id, columnId, index, onAnnounce, onDragStart }) {
  const task = useBoard(useCallback((s) => s.tasks[id], [id]))
  const [editing, setEditing] = useState(false)
  const editButtonRef = useRef(null)
  const colIndex = COLUMNS.findIndex((c) => c.id === columnId)
  const prev = COLUMNS[colIndex - 1]
  const next = COLUMNS[colIndex + 1]

  if (!task) return null

  const move = (to) => {
    boardActions.move(id, to.id)
    onAnnounce(`Moved "${task.title}" to ${to.title}.`)
  }

  const finishEditing = () => {
    setEditing(false)
    // Return focus to the edit button so keyboard users don't lose their place
    requestAnimationFrame(() => editButtonRef.current?.focus())
  }

  return (
    // Dragging is a pointer enhancement; the buttons below give keyboard and touch users the same actions.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <li
      className={`task task--${task.priority} ${editing ? 'is-editing' : ''}`}
      draggable={!editing}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', id)
        e.dataTransfer.effectAllowed = 'move'
        onDragStart(id)
      }}
      data-index={index}
      data-task-id={id}
    >
      <span className="task__grip" aria-hidden="true">
        <Icon name="grip" size={16} />
      </span>
      <div className="task__body">
        {editing ? (
          <TitleEditor task={task} onDone={finishEditing} onAnnounce={onAnnounce} />
        ) : (
          // Double-click is a mouse shortcut; keyboard users use the Edit button below.
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
          <p className="task__title" onDoubleClick={() => setEditing(true)} title="Double-click to edit">
            {task.title}
          </p>
        )}
        <span className={`task__priority task__priority--${task.priority}`}>
          <span className="sr-only">Priority: </span>
          {task.priority}
        </span>
      </div>
      {!editing && (
        <div className="task__actions">
          <button
            ref={editButtonRef}
            type="button"
            onClick={() => setEditing(true)}
            aria-label={`Edit "${task.title}"`}
          >
            <Icon name="pencil" size={15} />
          </button>
          {prev && (
            <button type="button" onClick={() => move(prev)} aria-label={`Move "${task.title}" to ${prev.title}`}>
              <Icon name="arrowLeft" size={15} />
            </button>
          )}
          {next && (
            <button type="button" onClick={() => move(next)} aria-label={`Move "${task.title}" to ${next.title}`}>
              <Icon name="arrowRight" size={15} />
            </button>
          )}
          <button
            type="button"
            className="task__delete"
            onClick={() => {
              boardActions.remove(id)
              onAnnounce(`Deleted "${task.title}".`)
            }}
            aria-label={`Delete "${task.title}"`}
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
      )}
    </li>
  )
}

export default memo(TaskCard)
