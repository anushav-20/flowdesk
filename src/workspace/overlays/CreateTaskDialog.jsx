import { useMemo, useState } from 'react'
import Button from '@/components/ui/Button'
import { appActions } from '@/store/appStore'
import { FREQUENCIES } from '@shared/recurrence.js'
import CustomFieldsForm from '../components/CustomFieldsForm'
import { Modal } from '../ui/primitives'
import { ui } from '../uiStore'
import { useApi, useMembers, useOrgCollection } from '../WorkspaceContext'

/** "New task" dialog (shortcut: C). */
export default function CreateTaskDialog({ defaults }) {
  const api = useApi()
  const projects = useOrgCollection('projects')
  const members = useMembers()
  const allDefs = useOrgCollection('fieldDefs')
  const active = useMemo(() => projects.filter((p) => !p.archived), [projects])
  const [form, setForm] = useState({
    title: '',
    description: '',
    projectId: defaults.projectId ?? active[0]?.id ?? '',
    status: defaults.status ?? 'todo',
    priority: 'medium',
    assigneeId: '',
    dueDate: defaults.dueDate ?? '',
    estimate: 4,
    recurrence: '',
    customFields: {},
    parentId: defaults.parentId ?? null,
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const close = () => ui.close('createTask')

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const t = await api.createTask({
        ...form,
        recurrence: form.recurrence ? { freq: form.recurrence, interval: 1 } : null,
      })
      appActions.toast(`Created ${t.key}`)
      close()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={defaults.parentId ? 'New subtask' : 'New task'}
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="create-task-form" loading={busy}>
            Create task
          </Button>
        </>
      }
    >
      <form id="create-task-form" className="form-grid" onSubmit={submit} noValidate>
        <div className="full">
          <label className="label" htmlFor="nt-title">
            Title *
          </label>
          <input
            id="nt-title"
            value={form.title}
            onChange={set('title')}
            maxLength={120}
            required
            placeholder="What needs to be done?"
          />
        </div>
        <div className="full">
          <label className="label" htmlFor="nt-desc">
            Description
          </label>
          <textarea id="nt-desc" rows={3} value={form.description} onChange={set('description')} maxLength={4000} />
        </div>
        <div>
          <label className="label" htmlFor="nt-project">
            Project
          </label>
          <select id="nt-project" value={form.projectId} onChange={set('projectId')}>
            {active.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="nt-assignee">
            Assignee
          </label>
          <select id="nt-assignee" value={form.assigneeId} onChange={set('assigneeId')}>
            <option value="">Unassigned (automation picks)</option>
            {members
              .filter((m) => m.role !== 'viewer')
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="nt-priority">
            Priority
          </label>
          <select id="nt-priority" value={form.priority} onChange={set('priority')}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="nt-due">
            Due date
          </label>
          <input id="nt-due" type="date" value={form.dueDate} onChange={set('dueDate')} />
        </div>
        <div>
          <label className="label" htmlFor="nt-est">
            Estimate (hours)
          </label>
          <input id="nt-est" type="number" min="0" max="999" value={form.estimate} onChange={set('estimate')} />
        </div>
        <div>
          <label className="label" htmlFor="nt-rec">
            Repeat
          </label>
          <select id="nt-rec" value={form.recurrence} onChange={set('recurrence')}>
            <option value="">Does not repeat</option>
            {Object.entries(FREQUENCIES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        {allDefs.length > 0 && (
          <fieldset className="full fieldset">
            <legend>Custom fields</legend>
            <CustomFieldsForm
              defs={allDefs}
              values={form.customFields}
              onChange={(v) => setForm((f) => ({ ...f, customFields: v }))}
            />
          </fieldset>
        )}
        {error && (
          <p className="full error-text" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}
