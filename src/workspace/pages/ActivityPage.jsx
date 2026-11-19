import { useMemo, useState } from 'react'
import Button from '@/components/ui/Button'
import { appActions } from '@/store/appStore'
import { STATUS_LABELS } from '../engine/core'
import { attempt, Avatar, Empty, fmtDateTime, Modal, PageTitle, Panel } from '../ui/primitives'
import { useApi, useCurrent, useMembers, useOrgCollection, useWs } from '../WorkspaceContext'

const HIDDEN_FIELDS = new Set(['updatedAt', 'version', 'orgId', 'id', 'createdAt'])

/** Shows exactly which fields changed between two versions of a record. */
const FIELD_LABELS = {
  status: 'Status',
  title: 'Title',
  assigneeId: 'Assignee',
  priority: 'Priority',
  dueDate: 'Due date',
  description: 'Description',
  estimate: 'Estimate (h)',
  blockedBy: 'Blocked by',
  links: 'GitHub links',
}

function Diff({ before, after, nameOf = () => null }) {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].filter(
    (k) => !HIDDEN_FIELDS.has(k),
  )
  const changed = keys.filter((k) => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]))
  if (!changed.length) return <p className="muted small">No field-level changes recorded.</p>
  const show = (k, v) =>
    v == null || v === ''
      ? '—'
      : k === 'status' && STATUS_LABELS[v]
        ? STATUS_LABELS[v]
        : k === 'assigneeId'
          ? (nameOf(v) ?? v)
          : typeof v === 'object'
            ? JSON.stringify(v)
            : String(v)
  return (
    <table className="table diff">
      <thead>
        <tr>
          <th>Field</th>
          <th>Before</th>
          <th>After</th>
        </tr>
      </thead>
      <tbody>
        {changed.map((k) => (
          <tr key={k}>
            <th scope="row">{FIELD_LABELS[k] ?? k}</th>
            <td className="diff__old">{show(k, before?.[k])}</td>
            <td className="diff__new">{show(k, after?.[k])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Audit log: who changed what, when, the previous value, and restore. */
export default function ActivityPage() {
  const api = useApi()
  const { can } = useCurrent()
  const audit = useOrgCollection('audit')
  const ruleRuns = useOrgCollection('ruleRuns')
  const members = useMembers()
  const users = useWs((s) => s.users)
  const [actor, setActor] = useState('')
  const [type, setType] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(null)

  const entries = useMemo(
    () =>
      audit.filter(
        (e) =>
          (!actor || e.actorId === actor) &&
          (!type || e.entityType === type) &&
          (!q || e.summary.toLowerCase().includes(q.toLowerCase())),
      ),
    [audit, actor, type, q],
  )
  const types = [...new Set(audit.map((e) => e.entityType))]
  const canSeeAudit = can('audit.read')

  return (
    <div className="ws-page">
      <PageTitle
        title="Activity & audit log"
        subtitle="Every change is recorded with who made it, when, and the previous value. Admins can restore earlier versions."
      />

      {!canSeeAudit && (
        <p className="callout">
          You can see the activity timeline. Before/after values and restore are available to admins.
        </p>
      )}

      <div className="field-inline">
        <label>
          <span className="label">Search</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="e.g. deadline, FD-4, role"
          />
        </label>
        <label>
          <span className="label">Who</span>
          <select value={actor} onChange={(e) => setActor(e.target.value)}>
            <option value="">Anyone</option>
            <option value="system">Automations & system</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Record type</span>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All</option>
            {types.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid-3">
        <Panel title={`Timeline (${entries.length})`} className="span-2">
          {entries.length === 0 ? (
            <Empty icon="refresh" title="No activity yet">
              Changes you and your team make will be listed here.
            </Empty>
          ) : (
            <ol className="timeline">
              {entries.slice(0, 150).map((e) => (
                <li key={e.id}>
                  {e.actorId === 'system' ? (
                    <span className="avatar avatar--system">⚡</span>
                  ) : (
                    <Avatar user={users[e.actorId]} size={28} />
                  )}
                  <div className="timeline__body">
                    <strong>{e.actorId === 'system' ? e.actorLabel : users[e.actorId]?.name}</strong> {e.summary}
                    <time>
                      {fmtDateTime(e.at)} · <code>{e.action}</code>
                    </time>
                    {canSeeAudit && (e.before || e.after) && (
                      <button type="button" className="link-btn small" onClick={() => setOpen(e)}>
                        View changes
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Panel>

        <Panel title="Automation runs">
          {ruleRuns.length === 0 ? (
            <p className="muted small">No automation has run yet in this session.</p>
          ) : (
            <ul className="list">
              {ruleRuns.slice(0, 20).map((r) => (
                <li key={r.id} className="list-item">
                  <div className="list-item__main">
                    <p className="list-item__title">{r.ruleName}</p>
                    <p className="list-item__meta">
                      on {r.eventType} · {r.subject} · {fmtDateTime(r.at)}
                    </p>
                    <p className="small">
                      {r.status === 'failed' ? <span className="error-text">{r.error}</span> : r.actions.join('; ')}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {open && (
        <Modal
          title="Change details"
          onClose={() => setOpen(null)}
          wide
          footer={
            can('audit.restore') && ['task', 'project', 'rule'].includes(open.entityType) && open.before ? (
              <Button
                onClick={async () => {
                  if (
                    await attempt(api.restoreFromAudit(open.id), {
                      toast: appActions.toast,
                      success: 'Previous version restored',
                    })
                  )
                    setOpen(null)
                }}
              >
                Restore previous version
              </Button>
            ) : null
          }
        >
          <p>
            <strong>{open.actorId === 'system' ? open.actorLabel : users[open.actorId]?.name}</strong> {open.summary}
          </p>
          <p className="muted small" style={{ margin: '0.25rem 0 1rem' }}>
            {fmtDateTime(open.at)} · {open.action}
          </p>
          <Diff before={open.before} after={open.after} nameOf={(id) => members.find((m) => m.id === id)?.name} />
        </Modal>
      )}
    </div>
  )
}
