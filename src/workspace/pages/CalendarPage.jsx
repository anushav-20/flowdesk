import { useMemo, useState } from 'react'
import useNow from '@/hooks/useNow'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import { appActions } from '@/store/appStore'
import { toICS } from '@shared/exporters.js'
import { attempt, Modal, PageTitle } from '../ui/primitives'
import { ui } from '../uiStore'
import { useApi, useCurrent, useOrgCollection } from '../WorkspaceContext'
import './CalendarPage.css'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const pad = (n) => String(n).padStart(2, '0')
const isoOf = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`

function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function NewEventDialog({ date, onClose }) {
  const api = useApi()
  const projects = useOrgCollection('projects')
  const [form, setForm] = useState({ title: '', date, type: 'meeting', projectId: '' })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  return (
    <Modal
      title="Add to calendar"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="event-form">
            Save
          </Button>
        </>
      }
    >
      <form
        id="event-form"
        className="form-grid"
        onSubmit={async (e) => {
          e.preventDefault()
          if (await attempt(api.createEvent(form), { toast: appActions.toast, success: 'Added to the calendar' }))
            onClose()
        }}
      >
        <div className="full">
          <label className="label" htmlFor="ev-title">
            Title *
          </label>
          <input id="ev-title" value={form.title} onChange={set('title')} maxLength={100} required />
        </div>
        <div>
          <label className="label" htmlFor="ev-date">
            Date
          </label>
          <input id="ev-date" type="date" value={form.date} onChange={set('date')} required />
        </div>
        <div>
          <label className="label" htmlFor="ev-type">
            Type
          </label>
          <select id="ev-type" value={form.type} onChange={set('type')}>
            <option value="meeting">Meeting</option>
            <option value="milestone">Milestone</option>
          </select>
        </div>
        <div className="full">
          <label className="label" htmlFor="ev-proj">
            Project (optional)
          </label>
          <select id="ev-proj" value={form.projectId} onChange={set('projectId')}>
            <option value="">None</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </form>
    </Modal>
  )
}

/** Month calendar of task deadlines, meetings, milestones and project deadlines. Exports to .ics. */
export default function CalendarPage() {
  const api = useApi()
  const { can, org } = useCurrent()
  const tasks = useOrgCollection('tasks')
  const events = useOrgCollection('events')
  const projects = useOrgCollection('projects')
  const now = useNow()
  const today = new Date(now)
  const [cursor, setCursor] = useState(() => ({ y: new Date().getFullYear(), m: new Date().getMonth() }))
  const [adding, setAdding] = useState(null)
  const todayIso = isoOf(today.getFullYear(), today.getMonth(), today.getDate())

  const itemsByDate = useMemo(() => {
    const map = {}
    const add = (date, item) => (map[date] ??= []).push(item)
    for (const t of tasks)
      if (t.dueDate)
        add(t.dueDate, {
          kind: 'task',
          id: t.id,
          title: `${t.key} ${t.title}`,
          done: t.status === 'done',
          priority: t.priority,
        })
    for (const e of events) add(e.date, { kind: e.type, id: e.id, title: e.title })
    for (const p of projects)
      if (p.deadline && !p.archived)
        add(p.deadline, { kind: 'deadline', id: p.id, title: `${p.name} deadline`, color: p.color })
    return map
  }, [tasks, events, projects])

  const first = new Date(cursor.y, cursor.m, 1)
  const offset = (first.getDay() + 6) % 7 // Monday-first
  const days = new Date(cursor.y, cursor.m + 1, 0).getDate()
  const cells = [...Array(offset).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)]
  while (cells.length % 7) cells.push(null)

  const shift = (n) =>
    setCursor(({ y, m }) => {
      const d = new Date(y, m + n, 1)
      return { y: d.getFullYear(), m: d.getMonth() }
    })

  const exportIcs = () => {
    const evts = [
      ...tasks
        .filter((t) => t.dueDate && t.status !== 'done')
        .map((t) => ({ uid: t.id, title: `${t.key} ${t.title}`, date: t.dueDate, description: t.description })),
      ...events.map((e) => ({ uid: e.id, title: e.title, date: e.date })),
      ...projects.filter((p) => p.deadline).map((p) => ({ uid: p.id, title: `${p.name} deadline`, date: p.deadline })),
    ]
    download(`${org.slug}-flowdesk.ics`, toICS(evts, { name: `${org.name} — FlowDesk` }), 'text/calendar')
    appActions.toast('Calendar exported — import it into Google Calendar or Outlook')
  }

  const monthLabel = first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

  return (
    <div className="ws-page">
      <PageTitle
        title="Calendar"
        subtitle="Task deadlines, meetings and project milestones in one place."
        actions={
          <>
            <Button variant="secondary" iconLeft="download" onClick={exportIcs}>
              Export .ics
            </Button>
            {can('task.create') && (
              <Button iconLeft="plus" onClick={() => setAdding(todayIso)}>
                Add event
              </Button>
            )}
          </>
        }
      />

      <div className="cal-head">
        <button type="button" className="icon-btn" onClick={() => shift(-1)} aria-label="Previous month">
          <Icon name="arrowLeft" size={18} />
        </button>
        <h2 aria-live="polite">{monthLabel}</h2>
        <button type="button" className="icon-btn" onClick={() => shift(1)} aria-label="Next month">
          <Icon name="arrowRight" size={18} />
        </button>
        <Button variant="ghost" size="sm" onClick={() => setCursor({ y: today.getFullYear(), m: today.getMonth() })}>
          Today
        </Button>
        <ul className="cal-legend" aria-label="Legend">
          <li>
            <i className="cal-dot cal-dot--task" /> Task due
          </li>
          <li>
            <i className="cal-dot cal-dot--meeting" /> Meeting
          </li>
          <li>
            <i className="cal-dot cal-dot--milestone" /> Milestone
          </li>
          <li>
            <i className="cal-dot cal-dot--deadline" /> Project deadline
          </li>
        </ul>
      </div>

      <div className="cal" role="grid" aria-label={monthLabel}>
        <div className="cal__row cal__row--head" role="row">
          {WEEKDAYS.map((d) => (
            <span key={d} role="columnheader">
              {d}
            </span>
          ))}
        </div>
        {Array.from({ length: cells.length / 7 }, (_, w) => (
          <div className="cal__row" role="row" key={w}>
            {cells.slice(w * 7, w * 7 + 7).map((d, i) => {
              if (!d) return <div key={i} className="cal__cell is-empty" role="gridcell" aria-label="No date" />
              const iso = isoOf(cursor.y, cursor.m, d)
              const items = itemsByDate[iso] ?? []
              return (
                <div
                  key={i}
                  role="gridcell"
                  className={`cal__cell ${iso === todayIso ? 'is-today' : ''} ${iso < todayIso ? 'is-past' : ''}`}
                  aria-label={`${d} ${monthLabel}, ${items.length} items`}
                >
                  <div className="cal__date">
                    <span>{d}</span>
                    {can('task.create') && (
                      <button
                        type="button"
                        className="cal__add"
                        onClick={() => setAdding(iso)}
                        aria-label={`Add event on ${iso}`}
                      >
                        +
                      </button>
                    )}
                  </div>
                  <ul>
                    {items.slice(0, 4).map((it) => (
                      <li key={`${it.kind}-${it.id}`}>
                        {it.kind === 'task' ? (
                          <button
                            type="button"
                            className={`cal-item cal-item--task ${it.done ? 'is-done' : ''} ${!it.done && iso < todayIso ? 'is-overdue' : ''}`}
                            onClick={() => ui.openTask(it.id)}
                          >
                            {it.title}
                          </button>
                        ) : (
                          <span className={`cal-item cal-item--${it.kind}`}>
                            {it.kind === 'milestone' ? '◆ ' : it.kind === 'deadline' ? '⚑ ' : ''}
                            {it.title}
                            {(it.kind === 'meeting' || it.kind === 'milestone') && can('task.update') && (
                              <button
                                type="button"
                                className="cal-item__del"
                                aria-label={`Delete ${it.title}`}
                                onClick={() => attempt(api.deleteEvent(it.id), { toast: appActions.toast })}
                              >
                                ×
                              </button>
                            )}
                          </span>
                        )}
                      </li>
                    ))}
                    {items.length > 4 && <li className="muted small">+{items.length - 4} more</li>}
                  </ul>
                </div>
              )
            })}
          </div>
        ))}
      </div>
      {adding && <NewEventDialog date={adding} onClose={() => setAdding(null)} />}
    </div>
  )
}
