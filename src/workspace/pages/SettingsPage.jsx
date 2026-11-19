import { useState } from 'react'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import { appActions } from '@/store/appStore'
import { FIELD_TYPES } from '@shared/customFields.js'
import CustomFieldsForm from '../components/CustomFieldsForm'
import { attempt, PageTitle, Panel } from '../ui/primitives'
import { useApi, useCurrent, useMembers, useOrgCollection } from '../WorkspaceContext'

const toast = appActions.toast

function FieldBuilder() {
  const api = useApi()
  const defs = useOrgCollection('fieldDefs')
  const [form, setForm] = useState({ name: '', type: 'text', options: '', required: false })
  const [preview, setPreview] = useState({})
  const [error, setError] = useState('')

  return (
    <Panel title="Custom fields" id="fields">
      <p className="muted small" style={{ marginBottom: '0.75rem' }}>
        Add fields your team needs — bug severity, browser version, budget… They're stored as flexible JSON, so no
        database migration is needed, and the same rules validate them on the client and server.
      </p>
      <ul className="list">
        {defs.map((d) => (
          <li key={d.id} className="list-item">
            <span className="badge">{FIELD_TYPES[d.type]}</span>
            <span className="list-item__main">
              <span className="list-item__title">
                {d.name}
                {d.required && ' *'}
              </span>
              {d.type === 'select' && <span className="list-item__meta">{d.options.join(' · ')}</span>}
            </span>
            <button
              type="button"
              className="icon-btn icon-btn--danger"
              aria-label={`Delete ${d.name}`}
              onClick={() => attempt(api.deleteField(d.id), { toast, success: 'Field deleted' })}
            >
              <Icon name="trash" size={16} />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="form-grid field-builder"
        onSubmit={async (e) => {
          e.preventDefault()
          setError('')
          try {
            await api.saveField({
              name: form.name,
              type: form.type,
              options: form.options.split(','),
              required: form.required,
            })
            toast(`Added “${form.name}”`)
            setForm({ name: '', type: 'text', options: '', required: false })
          } catch (err) {
            setError(err.message)
          }
        }}
      >
        <label>
          <span className="label">Field name</span>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            maxLength={40}
            placeholder="e.g. Customer"
          />
        </label>
        <label>
          <span className="label">Type</span>
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            {Object.entries(FIELD_TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        {form.type === 'select' && (
          <label className="full">
            <span className="label">Options (comma-separated)</span>
            <input
              value={form.options}
              onChange={(e) => setForm({ ...form, options: e.target.value })}
              placeholder="Low, Medium, High"
            />
          </label>
        )}
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.required}
            onChange={(e) => setForm({ ...form, required: e.target.checked })}
          />
          <span>Required</span>
        </label>
        <div>
          <Button type="submit" size="sm" iconLeft="plus">
            Add field
          </Button>
        </div>
        {error && (
          <p className="full error-text" role="alert">
            {error}
          </p>
        )}
      </form>
      {defs.length > 0 && (
        <details className="preview">
          <summary>Preview the generated form</summary>
          <CustomFieldsForm defs={defs} values={preview} onChange={setPreview} />
        </details>
      )}
    </Panel>
  )
}

function ApprovalChainEditor() {
  const api = useApi()
  const { org } = useCurrent()
  const members = useMembers()
  const [steps, setSteps] = useState(org.approvalChain)
  const set = (i, patch) => setSteps((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const move = (i, d) =>
    setSteps((s) => {
      const n = [...s]
      ;[n[i], n[i + d]] = [n[i + d], n[i]]
      return n
    })

  return (
    <Panel title="Approval workflow" id="approvals">
      <p className="muted small" style={{ marginBottom: '0.75rem' }}>
        Tasks submitted for review pass through these steps in order. Each approver can approve or reject with a reason;
        rejected tasks can be resubmitted.
      </p>
      <ol className="chain-editor">
        {steps.map((s, i) => (
          <li key={s.id}>
            <span className="chain-editor__n">{i + 1}</span>
            <label>
              <span className="sr-only">Step {i + 1} name</span>
              <input value={s.name} onChange={(e) => set(i, { name: e.target.value })} maxLength={60} />
            </label>
            <label>
              <span className="sr-only">Step {i + 1} approver</span>
              <select value={s.approverId ?? ''} onChange={(e) => set(i, { approverId: e.target.value || null })}>
                <option value="">Any owner</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <span className="chain-editor__btns">
              <button
                type="button"
                className="icon-btn icon-btn--sm"
                disabled={i === 0}
                aria-label="Move up"
                onClick={() => move(i, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="icon-btn icon-btn--sm"
                disabled={i === steps.length - 1}
                aria-label="Move down"
                onClick={() => move(i, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                className="icon-btn icon-btn--sm icon-btn--danger"
                disabled={steps.length === 1}
                aria-label="Remove step"
                onClick={() => setSteps((x) => x.filter((_, j) => j !== i))}
              >
                <Icon name="trash" size={14} />
              </button>
            </span>
          </li>
        ))}
      </ol>
      <div className="td-row" style={{ marginTop: '0.75rem' }}>
        <Button
          size="sm"
          variant="ghost"
          iconLeft="plus"
          disabled={steps.length >= 6}
          onClick={() => setSteps((s) => [...s, { id: `step${Date.now()}`, name: 'New step', approverId: null }])}
        >
          Add step
        </Button>
        <Button
          size="sm"
          onClick={() => attempt(api.updateApprovalChain(steps), { toast, success: 'Approval workflow saved' })}
        >
          Save workflow
        </Button>
      </div>
    </Panel>
  )
}

export default function SettingsPage() {
  const api = useApi()
  const { org, can } = useCurrent()
  const projects = useOrgCollection('projects')
  const [name, setName] = useState(org.name)
  const [capacity, setCapacity] = useState(org.capacity)
  const [announce, setAnnounce] = useState('')
  const [project, setProject] = useState({ name: '', deadline: '' })

  if (!can('settings.manage')) {
    return (
      <div className="ws-page">
        <PageTitle title="Settings" />
        <p className="callout">Only owners and admins can change workspace settings.</p>
      </div>
    )
  }

  return (
    <div className="ws-page">
      <PageTitle title="Settings" subtitle={`Configure ${org.name}.`} />
      <div className="grid-2">
        <Panel title="Workspace">
          <form
            className="drawer-section"
            onSubmit={(e) => {
              e.preventDefault()
              attempt(api.updateOrgSettings({ name, capacity }), { toast, success: 'Settings saved' })
            }}
          >
            <label>
              <span className="label">Workspace name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
            </label>
            <label>
              <span className="label">Capacity per person (open tasks before “overloaded”)</span>
              <input type="number" min="1" max="30" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
            </label>
            <Button type="submit" size="sm">
              Save
            </Button>
          </form>
        </Panel>

        <Panel title="Projects">
          <ul className="list">
            {projects.map((p) => (
              <li key={p.id} className="list-item">
                <span className="forecast__dot" style={{ background: p.color }} aria-hidden="true" />
                <span className="list-item__main">
                  <span className="list-item__title">
                    {p.name} {p.archived && <span className="badge">Archived</span>}
                  </span>
                  <span className="list-item__meta">{p.deadline ? `Deadline ${p.deadline}` : 'No deadline'}</span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => attempt(api.updateProject(p.id, { archived: !p.archived }), { toast })}
                >
                  {p.archived ? 'Unarchive' : 'Archive'}
                </Button>
              </li>
            ))}
          </ul>
          <form
            className="field-inline"
            style={{ marginTop: '0.75rem' }}
            onSubmit={async (e) => {
              e.preventDefault()
              if (await attempt(api.createProject(project), { toast, success: `Created ${project.name}` }))
                setProject({ name: '', deadline: '' })
            }}
          >
            <label>
              <span className="label">New project</span>
              <input
                value={project.name}
                onChange={(e) => setProject({ ...project, name: e.target.value })}
                maxLength={80}
                required
              />
            </label>
            <label style={{ maxWidth: 170 }}>
              <span className="label">Deadline</span>
              <input
                type="date"
                value={project.deadline}
                onChange={(e) => setProject({ ...project, deadline: e.target.value })}
              />
            </label>
            <Button type="submit" variant="secondary">
              Add
            </Button>
          </form>
        </Panel>
      </div>

      <FieldBuilder />
      <ApprovalChainEditor />

      <div className="grid-2">
        <Panel title="Announcement">
          <p className="muted small" style={{ marginBottom: '0.5rem' }}>
            Sends a notification to every member through the bulk-notification background job.
          </p>
          <form
            className="field-inline"
            onSubmit={async (e) => {
              e.preventDefault()
              if (await attempt(api.announce(announce), { toast, success: 'Announcement queued' })) setAnnounce('')
            }}
          >
            <label>
              <span className="sr-only">Message</span>
              <input
                value={announce}
                onChange={(e) => setAnnounce(e.target.value)}
                maxLength={200}
                placeholder="e.g. Release freeze starts Friday"
                required
              />
            </label>
            <Button type="submit" variant="secondary">
              Send
            </Button>
          </form>
        </Panel>

        <Panel title="Demo data">
          <p className="muted small" style={{ marginBottom: '0.75rem' }}>
            Everything is stored in this browser. Reset to start over with fresh example data (signs you out).
          </p>
          <Button variant="danger" onClick={() => api.resetDemo()}>
            Reset demo data
          </Button>
        </Panel>
      </div>
    </div>
  )
}
