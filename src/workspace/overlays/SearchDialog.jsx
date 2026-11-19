import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import Icon from '@/components/ui/Icon'
import useDebounce from '@/hooks/useDebounce'
import { appActions } from '@/store/appStore'
import { buildIndex, highlight, search, SEARCH_TYPES } from '@shared/search.js'
import { attempt, Modal, StatusBadge, timeAgo } from '../ui/primitives'
import { ui } from '../uiStore'
import { useApi, useCurrent, useMembers, useOrgCollection } from '../WorkspaceContext'

function Highlighted({ text, query }) {
  return highlight(text, query).map((p, i) => (p.match ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))
}

/** Global search across tasks, projects, comments, people, docs and activity (shortcut: /). */
export default function SearchDialog() {
  const api = useApi()
  const navigate = useNavigate()
  const { user } = useCurrent()
  const tasks = useOrgCollection('tasks')
  const projects = useOrgCollection('projects')
  const comments = useOrgCollection('comments')
  const docs = useOrgCollection('docs')
  const audit = useOrgCollection('audit')
  const saved = useOrgCollection('savedSearches').filter((s) => s.userId === user.id)
  const members = useMembers()
  const [query, setQuery] = useState('')
  const [types, setTypes] = useState([])
  const [status, setStatus] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [sort, setSort] = useState('relevance')
  const [active, setActive] = useState(0)
  const debounced = useDebounce(query, 150)

  // The index is rebuilt only when underlying data changes, not on every keystroke
  const index = useMemo(
    () => buildIndex({ tasks, projects, comments, members, docs, activity: audit.slice(0, 200) }),
    [tasks, projects, comments, members, docs, audit],
  )
  const hasFilter = Boolean(debounced.trim() || types.length || status || assigneeId)
  const results = useMemo(
    () =>
      hasFilter
        ? search(index, debounced, {
            types,
            status: status || undefined,
            assigneeId: assigneeId || undefined,
            sort,
            limit: 40,
          })
        : [],
    [index, debounced, types, status, assigneeId, sort, hasFilter],
  )

  const open = (r) => {
    ui.close('search')
    if (r.type === 'task') ui.openTask(r.id)
    else if (r.type === 'comment') ui.openTask(r.ref.taskId)
    else if (r.type === 'project') navigate(`/app/board?project=${r.id}`)
    else if (r.type === 'doc') navigate(`/app/docs/${r.id}`)
    else if (r.type === 'member') navigate('/app/team')
    else if (r.type === 'activity') navigate('/app/activity')
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(results.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault()
      open(results[active])
    }
  }

  const toggleType = (t) => {
    setTypes((ts) => (ts.includes(t) ? ts.filter((x) => x !== t) : [...ts, t]))
    setActive(0)
  }

  const applySaved = (s) => {
    setQuery(s.query)
    setTypes(s.filters.types ?? [])
    setStatus(s.filters.status ?? '')
    setAssigneeId(s.filters.assigneeId ?? '')
  }

  return (
    <Modal title="Search" onClose={() => ui.close('search')} wide className="search-modal">
      <div className="search">
        <div className="search__box">
          <Icon name="search" size={20} />
          <input
            type="search"
            aria-label="Search the workspace"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="search-results"
            aria-activedescendant={results[active] ? `sr-${active}` : undefined}
            value={query}
            maxLength={100}
            placeholder="Search tasks, projects, comments, people, docs, activity…"
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
          />
        </div>

        <div className="search__filters">
          <div className="search__types" role="group" aria-label="Result types">
            {Object.entries(SEARCH_TYPES).map(([t, label]) => (
              <button
                key={t}
                type="button"
                className={`chip ${types.includes(t) ? 'is-active' : ''}`}
                aria-pressed={types.includes(t)}
                onClick={() => toggleType(t)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="field-inline">
            <label>
              <span className="sr-only">Status</span>
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Any status</option>
                <option value="todo">To do</option>
                <option value="progress">In progress</option>
                <option value="review">Review</option>
                <option value="done">Completed</option>
              </select>
            </label>
            <label>
              <span className="sr-only">Person</span>
              <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                <option value="">Anyone</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Sort</span>
              <select value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="relevance">Most relevant</option>
                <option value="recent">Most recent</option>
              </select>
            </label>
          </div>
        </div>

        {saved.length > 0 && (
          <div className="search__saved">
            <span className="muted small">Saved:</span>
            {saved.map((s) => (
              <span key={s.id} className="saved-chip">
                <button type="button" onClick={() => applySaved(s)}>
                  {s.name}
                </button>
                <button
                  type="button"
                  aria-label={`Delete saved search ${s.name}`}
                  onClick={() => api.deleteSavedSearch(s.id)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <p className="search__count muted small" role="status" aria-live="polite">
          {hasFilter
            ? `${results.length} result${results.length === 1 ? '' : 's'}`
            : 'Start typing or pick a filter. Use ↑ ↓ and Enter.'}
          {hasFilter && (
            <button
              type="button"
              className="link-btn small"
              onClick={async () => {
                const label = query.trim() || [status, ...types].filter(Boolean).join(' ') || 'My search'
                await attempt(
                  api.saveSearch({ name: label.slice(0, 40), query, filters: { types, status, assigneeId } }),
                  { toast: appActions.toast, success: 'Search saved' },
                )
              }}
            >
              Save this search
            </button>
          )}
        </p>

        <div id="search-results" role="listbox" aria-label="Search results" className="search__results">
          {results.map((r, i) => (
            // Keyboard selection happens in the search box (aria-activedescendant), so options aren't tab stops
            // oxlint-disable-next-line jsx-a11y/click-events-have-key-events
            <div
              key={`${r.type}-${r.id}`}
              id={`sr-${i}`}
              role="option"
              tabIndex={-1}
              aria-selected={i === active}
              className={i === active ? 'is-active' : ''}
              onMouseEnter={() => setActive(i)}
              onClick={() => open(r)}
            >
              <span className="badge">{SEARCH_TYPES[r.type].replace(/s$/, '')}</span>
              <span className="search__title">
                <Highlighted text={r.title} query={debounced} />
              </span>
              {r.type === 'task' && <StatusBadge status={r.status} />}
              {r.at > 0 && <span className="muted small">{timeAgo(r.at)}</span>}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}
