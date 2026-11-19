import { memo, useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import { appActions } from '@/store/appStore'
import { isOverdue } from '@shared/analytics.js'
import { openBlockers } from '@shared/graph.js'
import { STATUS_LABELS } from '../engine/core'
import { attempt, Avatar, Empty, fmtDate, PageTitle, PriorityBadge } from '../ui/primitives'
import { ui } from '../uiStore'
import { useApi, useCurrent, useMembers, useOrgCollection, useWs } from '../WorkspaceContext'
import './BoardPage.css'

const COLUMNS = ['todo', 'progress', 'review', 'done']
const ORDER = { high: 0, medium: 1, low: 2 }

const Card = memo(function Card({ task, assignee, blocked, commentCount, subtasks, onDragStart, canMove, onMove }) {
  const idx = COLUMNS.indexOf(task.status)
  return (
    // Dragging is a pointer enhancement; the arrow buttons give keyboard and touch users the same moves.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <li
      className={`kcard kcard--${task.priority} ${blocked ? 'is-blocked' : ''}`}
      draggable={canMove}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', task.id)
        onDragStart(task.id)
      }}
    >
      <button type="button" className="kcard__open" onClick={() => ui.openTask(task.id)}>
        <span className="kcard__key">{task.key}</span>
        <span className="kcard__title">{task.title}</span>
      </button>
      <div className="kcard__meta">
        <PriorityBadge priority={task.priority} />
        {task.dueDate && (
          <span className={`kcard__due ${isOverdue(task) ? 'is-overdue' : ''}`}>
            <Icon name="calendar" size={13} /> {fmtDate(task.dueDate)}
          </span>
        )}
        {blocked && (
          <span className="kcard__icon" title="Blocked by unfinished prerequisites">
            <Icon name="lock" size={13} />
            <span className="sr-only">Blocked</span>
          </span>
        )}
        {task.approval.status === 'pending' && <span className="badge badge--brand">Approval</span>}
        {task.recurrence && (
          <span title="Recurring" aria-label="Recurring">
            ↻
          </span>
        )}
        {subtasks.total > 0 && (
          <span className="kcard__icon">
            ☑ {subtasks.done}/{subtasks.total}
          </span>
        )}
        {commentCount > 0 && (
          <span className="kcard__icon">
            <Icon name="message" size={13} /> {commentCount}
          </span>
        )}
        <span className="kcard__assignee">
          <Avatar user={assignee} size={24} />
        </span>
      </div>
      {canMove && (
        <div className="kcard__move">
          {idx > 0 && (
            <button
              type="button"
              onClick={() => onMove(task, COLUMNS[idx - 1])}
              aria-label={`Move ${task.key} to ${STATUS_LABELS[COLUMNS[idx - 1]]}`}
            >
              <Icon name="arrowLeft" size={14} />
            </button>
          )}
          {idx < COLUMNS.length - 1 && (
            <button
              type="button"
              onClick={() => onMove(task, COLUMNS[idx + 1])}
              aria-label={`Move ${task.key} to ${STATUS_LABELS[COLUMNS[idx + 1]]}`}
            >
              <Icon name="arrowRight" size={14} />
            </button>
          )}
        </div>
      )}
    </li>
  )
})

/** Kanban board: To do → In progress → Review → Completed, with filters and drag and drop. */
export default function BoardPage() {
  const api = useApi()
  const { can } = useCurrent()
  const tasks = useOrgCollection('tasks')
  const projects = useOrgCollection('projects')
  const comments = useOrgCollection('comments')
  const members = useMembers()
  const users = useWs((s) => s.users)
  const [params, setParams] = useSearchParams()
  const [dragging, setDragging] = useState(null)
  const [over, setOver] = useState(null)
  const [message, setMessage] = useState('')

  const filters = {
    project: params.get('project') ?? '',
    assignee: params.get('assignee') ?? '',
    priority: params.get('priority') ?? '',
    q: params.get('q') ?? '',
  }
  const setFilter = (k, v) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    setParams(next, { replace: true })
  }

  const byId = useMemo(() => Object.fromEntries(tasks.map((t) => [t.id, t])), [tasks])
  const commentCounts = useMemo(() => {
    const m = {}
    for (const c of comments) m[c.taskId] = (m[c.taskId] ?? 0) + 1
    return m
  }, [comments])
  const subtaskCounts = useMemo(() => {
    const m = {}
    for (const t of tasks)
      if (t.parentId) {
        m[t.parentId] ??= { done: 0, total: 0 }
        m[t.parentId].total++
        if (t.status === 'done') m[t.parentId].done++
      }
    return m
  }, [tasks])

  const visible = useMemo(() => {
    const q = filters.q.toLowerCase()
    return tasks
      .filter((t) => !t.parentId || filters.q) // subtasks live inside their parent
      .filter((t) => !filters.project || t.projectId === filters.project)
      .filter(
        (t) => !filters.assignee || (filters.assignee === 'none' ? !t.assigneeId : t.assigneeId === filters.assignee),
      )
      .filter((t) => !filters.priority || t.priority === filters.priority)
      .filter((t) => !q || `${t.key} ${t.title}`.toLowerCase().includes(q))
      .sort((a, b) => ORDER[a.priority] - ORDER[b.priority] || (a.dueDate ?? '9').localeCompare(b.dueDate ?? '9'))
  }, [tasks, filters.project, filters.assignee, filters.priority, filters.q])

  const move = useCallback(
    async (task, status) => {
      const ok = await attempt(api.moveTask(task.id, status), { toast: appActions.toast })
      if (ok) setMessage(`Moved ${task.key} to ${STATUS_LABELS[status]}.`)
    },
    [api],
  )

  const onDrop = (status) => (e) => {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/plain') || dragging
    setOver(null)
    setDragging(null)
    const task = byId[id]
    if (task && task.status !== status) move(task, status)
  }

  const canMove = can('task.update')
  const activeFilters = Object.values(filters).filter(Boolean).length

  return (
    <div className="ws-page ws-page--wide">
      <PageTitle
        title="Board"
        subtitle="Drag cards between columns, or use the arrow buttons. Blocked cards can't start until their prerequisites are done."
        actions={
          can('task.create') && (
            <Button iconLeft="plus" onClick={() => ui.newTask({ projectId: filters.project || undefined })}>
              New task
            </Button>
          )
        }
      />

      {tasks.length === 0 && (
        <Empty
          icon="board"
          title="No tasks yet"
          actions={
            can('task.create') && (
              <>
                <Button iconLeft="plus" onClick={() => ui.newTask()}>
                  Create your first task
                </Button>
                <Button variant="secondary" iconLeft="spark" onClick={() => ui.open('assistant')}>
                  Generate a plan with AI
                </Button>
              </>
            )
          }
        >
          {can('task.create')
            ? 'Add a task, or describe a goal to the AI assistant (e.g. “Create a project plan for an online store”) and it will create the tasks and dependencies for you.'
            : 'Tasks your team creates will appear here.'}
        </Empty>
      )}

      <div className="board-filters" role="search">
        <label>
          <span className="sr-only">Filter tasks</span>
          <input
            type="search"
            placeholder="Filter by title or key…"
            value={filters.q}
            onChange={(e) => setFilter('q', e.target.value)}
          />
        </label>
        <label>
          <span className="sr-only">Project</span>
          <select value={filters.project} onChange={(e) => setFilter('project', e.target.value)}>
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.archived ? ' (archived)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Assignee</span>
          <select value={filters.assignee} onChange={(e) => setFilter('assignee', e.target.value)}>
            <option value="">Everyone</option>
            <option value="none">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Priority</span>
          <select value={filters.priority} onChange={(e) => setFilter('priority', e.target.value)}>
            <option value="">Any priority</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        {activeFilters > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setParams({}, { replace: true })}>
            Clear filters
          </Button>
        )}
      </div>

      <div className={`kanban ${dragging ? 'is-dragging' : ''}`}>
        {COLUMNS.map((status) => {
          const list = visible.filter((t) => t.status === status)
          return (
            // Drag & drop is a pointer enhancement; each card's arrow buttons do the same by keyboard.
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
            <section
              key={status}
              className={`kcol kcol--${status} ${over === status ? 'is-over' : ''}`}
              aria-labelledby={`kcol-${status}`}
              onDragOver={(e) => {
                e.preventDefault()
                setOver(status)
              }}
              onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget) && setOver(null)}
              onDrop={onDrop(status)}
            >
              <header className="kcol__head">
                <h2 id={`kcol-${status}`}>{STATUS_LABELS[status]}</h2>
                <span className="kcol__count">{list.length}</span>
                {can('task.create') && status !== 'done' && (
                  <button
                    type="button"
                    className="icon-btn icon-btn--sm"
                    onClick={() => ui.newTask({ status, projectId: filters.project || undefined })}
                    aria-label={`Add task to ${STATUS_LABELS[status]}`}
                  >
                    <Icon name="plus" size={16} />
                  </button>
                )}
              </header>
              {list.length === 0 ? (
                <p className="kcol__empty">{dragging ? 'Drop here' : 'No tasks'}</p>
              ) : (
                <ul className="kcol__list">
                  {list.map((t) => (
                    <Card
                      key={t.id}
                      task={t}
                      assignee={users[t.assigneeId]}
                      blocked={t.status !== 'done' && openBlockers(t, byId).length > 0}
                      commentCount={commentCounts[t.id] ?? 0}
                      subtasks={subtaskCounts[t.id] ?? { done: 0, total: 0 }}
                      onDragStart={setDragging}
                      canMove={canMove}
                      onMove={move}
                    />
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {message}
      </p>
    </div>
  )
}
