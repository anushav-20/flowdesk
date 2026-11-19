import { useEffect, useMemo, useRef, useState } from 'react'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import { appActions } from '@/store/appStore'
import { answer } from '@shared/assistant.js'
import { attempt, fmtDate } from '../ui/primitives'
import { ui } from '../uiStore'
import { useApi, useCurrent, useMembers, useOrgCollection } from '../WorkspaceContext'

const SUGGESTIONS = [
  'What tasks are overdue?',
  "Summarize this week's progress",
  'Which tasks should I prioritize?',
  'Are we on track for our deadlines?',
  'Who is overloaded?',
  'Create a project plan for building an e-commerce website',
]

function PlanPreview({ plan }) {
  const api = useApi()
  const { can } = useCurrent()
  const projects = useOrgCollection('projects').filter((p) => !p.archived)
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const [added, setAdded] = useState(false)

  return (
    <div className="ai-plan">
      <ol>
        {plan.tasks.map((t) => (
          <li key={t.ref}>
            <span className="badge">{t.phase}</span> {t.title}{' '}
            <span className="muted small">
              · {t.estimate}h · due {fmtDate(t.dueDate)}
            </span>
          </li>
        ))}
      </ol>
      {can('task.create') && !added && (
        <div className="field-inline">
          <label>
            <span className="sr-only">Add to project</span>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            size="sm"
            iconLeft="plus"
            onClick={async () => {
              const r = await attempt(api.createTasksBulk(projectId, plan.tasks), {
                toast: appActions.toast,
                success: `Added ${plan.tasks.length} tasks with dependencies`,
              })
              if (r) setAdded(true)
            }}
          >
            Add {plan.tasks.length} tasks
          </Button>
        </div>
      )}
      {added && (
        <p className="small" style={{ color: 'var(--success)' }}>
          ✓ Added to the board with dependencies between phases.
        </p>
      )}
    </div>
  )
}

/**
 * AI Project Assistant. Answers come from shared/assistant.js — a grounded, explainable
 * engine over your real workspace data (works offline, no API key). With the Node backend
 * and an LLM key configured, the server can rephrase these grounded answers with a model.
 */
export default function AssistantPanel() {
  const { user } = useCurrent()
  const tasks = useOrgCollection('tasks')
  const projects = useOrgCollection('projects')
  const members = useMembers()
  const [messages, setMessages] = useState([
    {
      from: 'ai',
      text: `Hi ${user.name.split(' ')[0]}! I can analyse your workspace and plan projects. Try one of these:`,
      suggestions: true,
    },
  ])
  const [input, setInput] = useState('')
  const listRef = useRef(null)
  const ctx = useMemo(
    () => ({ tasks, members, projects: projects.filter((p) => !p.archived), userId: user.id }),
    [tasks, members, projects, user.id],
  )

  // Scroll to the newest message whenever one is added
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [messages])

  const ask = (q) => {
    const text = q.trim()
    if (!text) return
    const res = answer(text, { ...ctx, now: Date.now() })
    setMessages((m) => [...m, { from: 'me', text }, { from: 'ai', ...res }])
    setInput('')
  }

  return (
    <aside className="side-panel ai-panel" aria-label="AI assistant">
      <header className="side-panel__head">
        <h2>
          <Icon name="spark" size={18} /> FlowDesk Assistant
        </h2>
        <button type="button" className="icon-btn" onClick={() => ui.close('assistant')} aria-label="Close assistant">
          <Icon name="close" size={18} />
        </button>
      </header>
      <div className="side-panel__body ai-messages" ref={listRef} aria-live="polite">
        {messages.map((m, i) => (
          <div key={i} className={`ai-msg ai-msg--${m.from}`}>
            <p>{m.text}</p>
            {m.items && (
              <ul>
                {m.items.map((it) => (
                  <li key={it.id + it.label}>
                    {tasks.some((t) => t.id === it.id) ? (
                      <button type="button" className="link-btn" onClick={() => ui.openTask(it.id)}>
                        {it.label}
                      </button>
                    ) : (
                      it.label
                    )}
                  </li>
                ))}
              </ul>
            )}
            {m.plan && <PlanPreview plan={m.plan} />}
            {m.suggestions && (
              <div className="ai-suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" className="chip" onClick={() => ask(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <form
        className="ai-input"
        onSubmit={(e) => {
          e.preventDefault()
          ask(input)
        }}
      >
        <label htmlFor="ai-q" className="sr-only">
          Ask the assistant
        </label>
        <input
          id="ai-q"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your projects…"
          maxLength={300}
          autoComplete="off"
        />
        <button type="submit" className="icon-btn is-on" aria-label="Send">
          <Icon name="send" size={18} />
        </button>
      </form>
      <p className="ai-note">Answers are computed from your workspace data — no data leaves your browser.</p>
    </aside>
  )
}
