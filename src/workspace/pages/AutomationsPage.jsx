import { useState } from 'react'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import { appActions } from '@/store/appStore'
import { ACTIONS, CONDITION_FIELDS, describeRule, OPERATORS, TRIGGERS } from '@shared/automation.js'
import { attempt, Empty, fmtDateTime, Modal, PageTitle, Panel, Toggle } from '../ui/primitives'
import { useApi, useCurrent, useMembers, useOrgCollection } from '../WorkspaceContext'

const toast = appActions.toast
const blankRule = () => ({
  name: '',
  enabled: true,
  trigger: { type: 'task.created', threshold: 80 },
  conditions: [],
  actions: [{ type: 'notify', params: { target: 'assignee' } }],
})

/** Visual rule builder: When [trigger] If [conditions] Then [actions]. */
function RuleBuilder({ initial, onClose }) {
  const api = useApi()
  const members = useMembers()
  const projects = useOrgCollection('projects')
  const [rule, setRule] = useState(initial ?? blankRule())
  const [error, setError] = useState('')
  const set = (patch) => setRule((r) => ({ ...r, ...patch }))
  const setCond = (i, patch) => set({ conditions: rule.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) })
  const setAct = (i, patch) => set({ actions: rule.actions.map((a, j) => (j === i ? { ...a, ...patch } : a)) })

  const valueInput = (c, i) => {
    if (['is_empty', 'is_not_empty'].includes(c.op)) return null
    const common = {
      'aria-label': 'Value',
      value: c.value ?? '',
      onChange: (e) => setCond(i, { value: e.target.value }),
    }
    if (c.field === 'priority')
      return (
        <select {...common}>
          <option value="">—</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      )
    if (c.field === 'status')
      return (
        <select {...common}>
          <option value="">—</option>
          <option value="todo">To do</option>
          <option value="progress">In progress</option>
          <option value="review">Review</option>
          <option value="done">Completed</option>
        </select>
      )
    if (c.field === 'decision')
      return (
        <select {...common}>
          <option value="">—</option>
          <option value="approve">Approved</option>
          <option value="reject">Rejected</option>
        </select>
      )
    if (c.field === 'projectId')
      return (
        <select {...common}>
          <option value="">—</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )
    if (c.field === 'assigneeId')
      return (
        <select {...common}>
          <option value="">—</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      )
    return <input {...common} type={c.field === 'progress' ? 'number' : 'text'} />
  }

  const actionParams = (a, i) => {
    const p = a.params ?? {}
    const setP = (patch) => setAct(i, { params: { ...p, ...patch } })
    switch (a.type) {
      case 'assign':
        return (
          <select
            aria-label="Assign to"
            value={p.userId ?? 'least_loaded'}
            onChange={(e) => setP({ userId: e.target.value })}
          >
            <option value="least_loaded">Least busy member (auto-balance)</option>
            {members
              .filter((m) => m.role !== 'viewer')
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
        )
      case 'notify':
        return (
          <>
            <select
              aria-label="Who to notify"
              value={p.target ?? 'assignee'}
              onChange={(e) => setP({ target: e.target.value })}
            >
              <option value="assignee">The assignee</option>
              <option value="admins">Admins / managers</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <input
              aria-label="Message"
              placeholder="Message (optional)"
              value={p.message ?? ''}
              maxLength={120}
              onChange={(e) => setP({ message: e.target.value })}
            />
          </>
        )
      case 'set_priority':
        return (
          <select
            aria-label="Priority"
            value={p.priority ?? 'high'}
            onChange={(e) => setP({ priority: e.target.value })}
          >
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        )
      case 'set_status':
        return (
          <select aria-label="Status" value={p.status ?? 'progress'} onChange={(e) => setP({ status: e.target.value })}>
            <option value="todo">To do</option>
            <option value="progress">In progress</option>
            <option value="review">Review</option>
            <option value="done">Completed</option>
          </select>
        )
      case 'add_comment':
        return (
          <input
            aria-label="Comment"
            placeholder="Comment text"
            value={p.text ?? ''}
            maxLength={300}
            onChange={(e) => setP({ text: e.target.value })}
          />
        )
      default:
        return null
    }
  }

  return (
    <Modal
      title={initial ? 'Edit automation' : 'New automation'}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={async () => {
              setError('')
              try {
                await api.saveRule(rule)
                toast('Automation saved')
                onClose()
              } catch (err) {
                setError(err.message)
              }
            }}
          >
            Save automation
          </Button>
        </>
      }
    >
      <div className="rule-builder">
        <div>
          <label className="label" htmlFor="rb-name">
            Name *
          </label>
          <input
            id="rb-name"
            value={rule.name}
            onChange={(e) => set({ name: e.target.value })}
            maxLength={80}
            placeholder="e.g. Escalate critical bugs"
          />
        </div>

        <fieldset className="rb-block">
          <legend>
            <span className="rb-tag rb-tag--when">When</span>
          </legend>
          <div className="field-inline">
            <select
              aria-label="Trigger"
              value={rule.trigger.type}
              onChange={(e) => set({ trigger: { ...rule.trigger, type: e.target.value } })}
            >
              {Object.entries(TRIGGERS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            {rule.trigger.type === 'project.progress' && (
              <label className="field-inline">
                <span>Threshold %</span>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={rule.trigger.threshold ?? 80}
                  onChange={(e) => set({ trigger: { ...rule.trigger, threshold: e.target.value } })}
                />
              </label>
            )}
          </div>
        </fieldset>

        <fieldset className="rb-block">
          <legend>
            <span className="rb-tag rb-tag--if">If</span>{' '}
            <span className="muted small">(optional — all must match)</span>
          </legend>
          {rule.conditions.map((c, i) => (
            <div key={i} className="field-inline rb-row">
              <select
                aria-label="Field"
                value={c.field}
                onChange={(e) => setCond(i, { field: e.target.value, value: '' })}
              >
                {Object.entries(CONDITION_FIELDS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <select aria-label="Operator" value={c.op} onChange={(e) => setCond(i, { op: e.target.value })}>
                {Object.entries(OPERATORS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              {valueInput(c, i)}
              <button
                type="button"
                className="icon-btn icon-btn--danger"
                aria-label="Remove condition"
                onClick={() => set({ conditions: rule.conditions.filter((_, j) => j !== i) })}
              >
                <Icon name="trash" size={16} />
              </button>
            </div>
          ))}
          {rule.conditions.length < 5 && (
            <Button
              size="sm"
              variant="ghost"
              iconLeft="plus"
              onClick={() =>
                set({ conditions: [...rule.conditions, { field: 'priority', op: 'equals', value: 'high' }] })
              }
            >
              Add condition
            </Button>
          )}
        </fieldset>

        <fieldset className="rb-block">
          <legend>
            <span className="rb-tag rb-tag--then">Then</span>
          </legend>
          {rule.actions.map((a, i) => (
            <div key={i} className="field-inline rb-row">
              <select
                aria-label="Action"
                value={a.type}
                onChange={(e) => setAct(i, { type: e.target.value, params: {} })}
              >
                {Object.entries(ACTIONS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              {actionParams(a, i)}
              {rule.actions.length > 1 && (
                <button
                  type="button"
                  className="icon-btn icon-btn--danger"
                  aria-label="Remove action"
                  onClick={() => set({ actions: rule.actions.filter((_, j) => j !== i) })}
                >
                  <Icon name="trash" size={16} />
                </button>
              )}
            </div>
          ))}
          {rule.actions.length < 5 && (
            <Button
              size="sm"
              variant="ghost"
              iconLeft="plus"
              onClick={() => set({ actions: [...rule.actions, { type: 'notify', params: { target: 'admins' } }] })}
            >
              Add action
            </Button>
          )}
        </fieldset>

        <p className="callout">
          <Icon name="spark" size={18} />
          <span>
            {describeRule(rule, {
              nameOf: (id) => members.find((m) => m.id === id)?.name ?? projects.find((p) => p.id === id)?.name ?? id,
            })}
          </span>
        </p>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}

export default function AutomationsPage() {
  const api = useApi()
  const { can } = useCurrent()
  const rules = useOrgCollection('rules')
  const runs = useOrgCollection('ruleRuns')
  const members = useMembers()
  const projects = useOrgCollection('projects')
  const [editing, setEditing] = useState(null)
  const manage = can('automation.manage')
  const nameOf = (id) => members.find((m) => m.id === id)?.name ?? projects.find((p) => p.id === id)?.name ?? id

  return (
    <div className="ws-page">
      <PageTitle
        title="Workflow automations"
        subtitle="Rules run automatically when things happen: triggers, conditions and actions. Chains are limited to 3 levels so rules can't loop forever."
        actions={
          manage && (
            <Button iconLeft="plus" onClick={() => setEditing('new')}>
              New automation
            </Button>
          )
        }
      />
      {!manage && <p className="callout">Only owners and admins can create or change automations.</p>}

      <div className="grid-3">
        <Panel title={`Rules (${rules.length})`} className="span-2">
          {rules.length === 0 ? (
            <Empty icon="bolt" title="No automations yet" />
          ) : (
            <ul className="list">
              {rules.map((r) => (
                <li key={r.id} className={`list-item rule-item ${r.enabled ? '' : 'is-off'}`}>
                  <Icon name="bolt" size={20} />
                  <div className="list-item__main">
                    <p className="list-item__title">{r.name}</p>
                    <p className="small">{describeRule(r, { nameOf })}</p>
                    <p className="list-item__meta">
                      Ran {r.runs ?? 0} time{r.runs === 1 ? '' : 's'}
                      {r.lastRunAt ? ` · last ${fmtDateTime(r.lastRunAt)}` : ''}
                    </p>
                  </div>
                  <Toggle
                    checked={r.enabled}
                    disabled={!manage}
                    label={<span className="sr-only">Enable {r.name}</span>}
                    onChange={(v) => attempt(api.toggleRule(r.id, v), { toast })}
                  />
                  {manage && (
                    <>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Edit ${r.name}`}
                        onClick={() => setEditing(r)}
                      >
                        <Icon name="pencil" size={16} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn icon-btn--danger"
                        aria-label={`Delete ${r.name}`}
                        onClick={() => attempt(api.deleteRule(r.id), { toast, success: 'Automation deleted' })}
                      >
                        <Icon name="trash" size={16} />
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Execution history">
          {runs.length === 0 ? (
            <p className="muted small">Create or complete a task to see automations run.</p>
          ) : (
            <ul className="list">
              {runs.slice(0, 15).map((r) => (
                <li key={r.id} className="list-item">
                  <span className={`badge ${r.status === 'success' ? 'badge--success' : 'badge--danger'}`}>
                    {r.status}
                  </span>
                  <div className="list-item__main">
                    <p className="list-item__title">{r.ruleName}</p>
                    <p className="list-item__meta">
                      {r.subject} · {fmtDateTime(r.at)}
                    </p>
                    <p className="small">{r.error ?? r.actions.join('; ')}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {editing && <RuleBuilder initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
