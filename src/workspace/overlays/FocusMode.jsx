import { useEffect, useMemo, useRef, useState } from 'react'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import { appActions } from '@/store/appStore'
import { prioritize } from '@shared/assistant.js'
import { attempt, PriorityBadge } from '../ui/primitives'
import { ui } from '../uiStore'
import { useApi, useCurrent, useOrgCollection } from '../WorkspaceContext'

const MODES = {
  focus: { label: 'Focus', minutes: 25 },
  short: { label: 'Short break', minutes: 5 },
  long: { label: 'Long break', minutes: 15 },
}

/** Distraction-free workspace with a Pomodoro timer. Completed sessions log time and earn points. */
export default function FocusMode() {
  const api = useApi()
  const { user } = useCurrent()
  const tasks = useOrgCollection('tasks')
  const top = useMemo(() => prioritize(tasks, { userId: user.id, limit: 5 }), [tasks, user.id])
  const [taskId, setTaskId] = useState(() => sessionStorage.getItem('flowdesk-focus-task') || top[0]?.task.id || '')
  const [mode, setMode] = useState('focus')
  const [left, setLeft] = useState(MODES.focus.minutes * 60)
  const [running, setRunning] = useState(false)
  const [sessions, setSessions] = useState(0)
  const endAt = useRef(null)
  const task = tasks.find((t) => t.id === taskId)

  // Timer based on an absolute end time, so it stays accurate even if the tab is throttled
  useEffect(() => {
    if (!running) return
    endAt.current = Date.now() + left * 1000
    const id = setInterval(() => {
      const remaining = Math.max(0, Math.round((endAt.current - Date.now()) / 1000))
      setLeft(remaining)
      if (remaining === 0) {
        setRunning(false)
        if (mode === 'focus') {
          setSessions((s) => s + 1)
          attempt(api.logFocusSession(taskId || null, MODES.focus.minutes), {
            toast: appActions.toast,
            success: '🍅 Focus session complete! +5 points',
          })
        }
      }
    }, 250)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running])

  useEffect(() => {
    document.title = running
      ? `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')} · Focus`
      : 'FlowDesk workspace'
  }, [left, running])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && ui.close('focus')
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const switchMode = (m) => {
    setMode(m)
    setRunning(false)
    setLeft(MODES[m].minutes * 60)
  }

  const total = MODES[mode].minutes * 60
  const pct = 1 - left / total
  const r = 90
  const circ = 2 * Math.PI * r

  return (
    <div className="focus" role="dialog" aria-modal="true" aria-label="Focus mode">
      <button type="button" className="btn btn--ghost btn--sm focus__exit" onClick={() => ui.close('focus')}>
        <Icon name="close" size={16} /> Exit focus <kbd>Esc</kbd>
      </button>
      <div className="focus__inner">
        <div className="tabs" role="tablist" aria-label="Timer mode">
          {Object.entries(MODES).map(([k, v]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={mode === k}
              className={mode === k ? 'is-active' : ''}
              onClick={() => switchMode(k)}
            >
              {v.label}
            </button>
          ))}
        </div>

        <div className="focus__timer">
          <svg viewBox="0 0 200 200" aria-hidden="true">
            <circle cx="100" cy="100" r={r} className="focus__ring-bg" />
            <circle
              cx="100"
              cy="100"
              r={r}
              className="focus__ring"
              strokeDasharray={circ}
              strokeDashoffset={circ * (1 - pct)}
            />
          </svg>
          <p className="focus__time" role="timer" aria-live="off">
            {String(Math.floor(left / 60)).padStart(2, '0')}:{String(left % 60).padStart(2, '0')}
          </p>
        </div>

        <div className="focus__controls">
          <Button size="lg" iconLeft={running ? 'pause' : 'play'} onClick={() => setRunning((isRunning) => !isRunning)}>
            {running ? 'Pause' : left === total ? 'Start' : 'Resume'}
          </Button>
          <Button size="lg" variant="secondary" onClick={() => switchMode(mode)}>
            Reset
          </Button>
        </div>
        <p className="muted">
          🍅 {sessions} session{sessions === 1 ? '' : 's'} today
        </p>

        <div className="focus__task">
          <label className="label" htmlFor="focus-task">
            Working on
          </label>
          <select id="focus-task" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
            <option value="">No specific task</option>
            {top.map(({ task: t }) => (
              <option key={t.id} value={t.id}>
                {t.key} {t.title}
              </option>
            ))}
            {task && !top.some((x) => x.task.id === task.id) && (
              <option value={task.id}>
                {task.key} {task.title}
              </option>
            )}
          </select>
          {task && (
            <div className="focus__task-card">
              <PriorityBadge priority={task.priority} />
              <strong>{task.title}</strong>
              {task.status !== 'done' && (
                <Button
                  size="sm"
                  variant="secondary"
                  iconLeft="check"
                  onClick={() =>
                    attempt(api.moveTask(task.id, 'done'), {
                      toast: appActions.toast,
                      success: `Completed ${task.key} 🎉`,
                    })
                  }
                >
                  Mark done
                </Button>
              )}
            </div>
          )}
          <p className="muted small">
            Your queue is ranked by the assistant: overdue first, then due soon, priority and what it unblocks.
          </p>
        </div>
      </div>
    </div>
  )
}
