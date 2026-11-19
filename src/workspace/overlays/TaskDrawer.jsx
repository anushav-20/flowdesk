import { useCallback, useMemo, useState } from 'react'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import { appActions } from '@/store/appStore'
import { currentStep } from '@shared/approval.js'
import { openBlockers } from '@shared/graph.js'
import { describeRecurrence, FREQUENCIES } from '@shared/recurrence.js'
import CustomFieldsForm from '../components/CustomFieldsForm'
import { ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES } from '../engine/modules/collaboration'
import {
  attempt,
  Avatar,
  fmtDate,
  fmtDateTime,
  Modal,
  PriorityBadge,
  PrStateBadge,
  StatusBadge,
  timeAgo,
} from '../ui/primitives'
import { ui } from '../uiStore'
import { useApi, useCurrent, useMembers, useOrgCollection, useWs } from '../WorkspaceContext'
import './TaskDrawer.css'

const toast = appActions.toast

function DetailsTab({ task, canEdit }) {
  const api = useApi()
  const members = useMembers()
  const projects = useOrgCollection('projects')
  const defs = useOrgCollection('fieldDefs')
  const [cf, setCf] = useState(task.customFields)
  const save = (changes) => attempt(api.updateTask(task.id, changes), { toast })

  return (
    <div className="drawer-section">
      <div className="form-grid">
        <div>
          <label className="label" htmlFor="td-status">
            Status
          </label>
          <select
            id="td-status"
            value={task.status}
            disabled={!canEdit}
            onChange={(e) => save({ status: e.target.value })}
          >
            <option value="todo">To do</option>
            <option value="progress">In progress</option>
            <option value="review">Review</option>
            <option value="done">Completed</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="td-priority">
            Priority
          </label>
          <select
            id="td-priority"
            value={task.priority}
            disabled={!canEdit}
            onChange={(e) => save({ priority: e.target.value })}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="td-assignee">
            Assignee
          </label>
          <select
            id="td-assignee"
            value={task.assigneeId ?? ''}
            disabled={!canEdit}
            onChange={(e) => save({ assigneeId: e.target.value || null })}
          >
            <option value="">Unassigned</option>
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
          <label className="label" htmlFor="td-project">
            Project
          </label>
          <select
            id="td-project"
            value={task.projectId}
            disabled={!canEdit}
            onChange={(e) => save({ projectId: e.target.value })}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="td-due">
            Due date
          </label>
          <input
            id="td-due"
            type="date"
            value={task.dueDate ?? ''}
            disabled={!canEdit}
            onChange={(e) => save({ dueDate: e.target.value || null })}
          />
        </div>
        <div>
          <label className="label" htmlFor="td-est">
            Estimate (hours)
          </label>
          <input
            id="td-est"
            type="number"
            min="0"
            defaultValue={task.estimate}
            disabled={!canEdit}
            onBlur={(e) => Number(e.target.value) !== task.estimate && save({ estimate: e.target.value })}
          />
        </div>
        <div>
          <label className="label" htmlFor="td-rec">
            Repeat
          </label>
          <select
            id="td-rec"
            value={task.recurrence?.freq ?? ''}
            disabled={!canEdit}
            onChange={(e) => save({ recurrence: e.target.value ? { freq: e.target.value, interval: 1 } : null })}
          >
            <option value="">Does not repeat</option>
            {Object.entries(FREQUENCIES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <span className="label">Time tracked</span>
          <p className="td-static">
            {Math.round((task.timeSpent ?? 0) / 60) > 0
              ? `${Math.floor(task.timeSpent / 60)}h ${task.timeSpent % 60}m`
              : `${task.timeSpent ?? 0} min`}
          </p>
        </div>
        <div className="full">
          <label className="label" htmlFor="td-desc">
            Description
          </label>
          <textarea
            id="td-desc"
            rows={4}
            defaultValue={task.description}
            disabled={!canEdit}
            maxLength={4000}
            placeholder="Add more detail…"
            onBlur={(e) => e.target.value !== task.description && save({ description: e.target.value })}
          />
        </div>
      </div>

      {defs.length > 0 && (
        <fieldset className="fieldset">
          <legend>Custom fields</legend>
          <CustomFieldsForm defs={defs} values={cf} onChange={setCf} disabled={!canEdit} />
          {canEdit && JSON.stringify(cf) !== JSON.stringify(task.customFields) && (
            <Button size="sm" onClick={() => save({ customFields: cf })} className="td-save">
              Save fields
            </Button>
          )}
        </fieldset>
      )}

      {task.links.length > 0 && (
        <div>
          <p className="label">Linked from GitHub</p>
          <ul className="list">
            {[...task.links]
              .sort((a, b) => (a.type === b.type ? 0 : a.type === 'pull_request' ? -1 : 1))
              .map((l) => (
                <li key={l.url} className="list-item">
                  <Icon name="link" size={16} />
                  <a href={l.url} target="_blank" rel="noopener noreferrer" className="list-item__main">
                    {l.title}
                  </a>
                  {l.type === 'pull_request' ? (
                    l.state ? (
                      <PrStateBadge state={l.state} />
                    ) : (
                      <span className="badge">PR</span>
                    )
                  ) : (
                    <span className="badge">{l.sha ? `commit ${l.sha}` : 'commit'}</span>
                  )}
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function DependenciesTab({ task, canEdit }) {
  const api = useApi()
  const tasks = useOrgCollection('tasks')
  const byId = useMemo(() => Object.fromEntries(tasks.map((t) => [t.id, t])), [tasks])
  const [pick, setPick] = useState('')
  const blockers = openBlockers(task, byId)
  const dependents = tasks.filter((t) => t.blockedBy.includes(task.id))
  const subtasks = tasks.filter((t) => t.parentId === task.id)
  const candidates = tasks.filter(
    (t) => t.id !== task.id && !task.blockedBy.includes(t.id) && t.projectId === task.projectId,
  )

  return (
    <div className="drawer-section">
      {blockers.length > 0 && (
        <p className="callout callout--warn">
          <Icon name="lock" size={18} /> This task can't start until {blockers.map((id) => byId[id].key).join(', ')}{' '}
          {blockers.length > 1 ? 'are' : 'is'} completed.
        </p>
      )}
      <div>
        <p className="label">Blocked by (prerequisites)</p>
        {task.blockedBy.length === 0 ? (
          <p className="muted small">No prerequisites.</p>
        ) : (
          <ul className="list">
            {task.blockedBy.map(
              (id) =>
                byId[id] && (
                  <li key={id} className="list-item">
                    <StatusBadge status={byId[id].status} />
                    <button type="button" className="link-btn list-item__main" onClick={() => ui.openTask(id)}>
                      {byId[id].key} {byId[id].title}
                    </button>
                    {canEdit && (
                      <button
                        type="button"
                        className="icon-btn icon-btn--sm icon-btn--danger"
                        aria-label={`Remove dependency on ${byId[id].key}`}
                        onClick={() => attempt(api.removeDependency(task.id, id), { toast })}
                      >
                        <Icon name="close" size={15} />
                      </button>
                    )}
                  </li>
                ),
            )}
          </ul>
        )}
        {canEdit && (
          <form
            className="field-inline td-add-dep"
            onSubmit={async (e) => {
              e.preventDefault()
              if (pick && (await attempt(api.addDependency(task.id, pick), { toast }))) setPick('')
            }}
          >
            <label className="sr-only" htmlFor="td-dep">
              Add prerequisite
            </label>
            <select id="td-dep" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Add a prerequisite…</option>
              {candidates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.key} {t.title}
                </option>
              ))}
            </select>
            <Button type="submit" size="sm" variant="secondary" disabled={!pick}>
              Add
            </Button>
          </form>
        )}
        <p className="muted small">Circular dependencies are detected and rejected automatically.</p>
      </div>

      <div>
        <p className="label">Blocks</p>
        {dependents.length === 0 ? (
          <p className="muted small">Nothing depends on this task.</p>
        ) : (
          <ul className="list">
            {dependents.map((t) => (
              <li key={t.id} className="list-item">
                <StatusBadge status={t.status} />
                <button type="button" className="link-btn list-item__main" onClick={() => ui.openTask(t.id)}>
                  {t.key} {t.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="td-row">
          <p className="label">
            Subtasks{' '}
            {subtasks.length > 0 && `(${subtasks.filter((s) => s.status === 'done').length}/${subtasks.length})`}
          </p>
          {canEdit && (
            <Button
              size="sm"
              variant="ghost"
              iconLeft="plus"
              onClick={() => ui.newTask({ parentId: task.id, projectId: task.projectId })}
            >
              Add subtask
            </Button>
          )}
        </div>
        {subtasks.length === 0 ? (
          <p className="muted small">No subtasks. When all subtasks are done, an automation completes the parent.</p>
        ) : (
          <ul className="list">
            {subtasks.map((t) => (
              <li key={t.id} className="list-item">
                <input
                  type="checkbox"
                  checked={t.status === 'done'}
                  disabled={!canEdit}
                  aria-label={`Mark ${t.title} as ${t.status === 'done' ? 'not done' : 'done'}`}
                  onChange={(e) => attempt(api.moveTask(t.id, e.target.checked ? 'done' : 'todo'), { toast })}
                />
                <button type="button" className="link-btn list-item__main" onClick={() => ui.openTask(t.id)}>
                  {t.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function ApprovalTab({ task }) {
  const api = useApi()
  const { org, user, role, can } = useCurrent()
  const users = useWs((s) => s.users)
  const [reason, setReason] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const chain = org.approvalChain
  const a = task.approval
  const step = currentStep(a, chain)
  const myTurn = step && (step.approverId === user.id || role === 'owner')

  const act = async (type) => {
    const r = await attempt(api.approvalAction(task.id, type, reason), {
      toast,
      success: { submit: 'Submitted for approval', resubmit: 'Resubmitted', approve: 'Approved', reject: 'Rejected' }[
        type
      ],
    })
    if (r) {
      setRejecting(false)
      setReason('')
    }
  }

  return (
    <div className="drawer-section">
      <ol className="approval-steps">
        {chain.map((s, i) => {
          const state =
            a.status === 'approved' || (a.status === 'pending' && i < a.step)
              ? 'done'
              : a.status === 'pending' && i === a.step
                ? 'current'
                : a.status === 'rejected' && i === a.step
                  ? 'rejected'
                  : 'waiting'
          return (
            <li key={s.id} className={`approval-steps__item is-${state}`}>
              <span className="approval-steps__dot" aria-hidden="true">
                {state === 'done' ? '✓' : state === 'rejected' ? '✕' : i + 1}
              </span>
              <span>
                <strong>{s.name}</strong>
                <small>{users[s.approverId]?.name ?? 'Any admin'}</small>
              </span>
              <span className="sr-only">— {state}</span>
            </li>
          )
        })}
      </ol>

      <p className="td-approval-status">
        Status:{' '}
        <strong>
          {
            {
              none: 'Not submitted',
              pending: `Waiting for ${step?.name}`,
              approved: 'Fully approved ✅',
              rejected: 'Rejected — changes requested',
            }[a.status]
          }
        </strong>
      </p>

      <div className="td-row">
        {a.status === 'none' && can('task.update') && (
          <Button iconLeft="send" onClick={() => act('submit')}>
            Submit for review
          </Button>
        )}
        {a.status === 'rejected' && can('task.update') && (
          <Button iconLeft="refresh" onClick={() => act('resubmit')}>
            Resubmit
          </Button>
        )}
        {a.status === 'pending' && myTurn && !rejecting && (
          <>
            <Button iconLeft="check" onClick={() => act('approve')}>
              Approve
            </Button>
            <Button variant="danger" onClick={() => setRejecting(true)}>
              Reject…
            </Button>
          </>
        )}
        {a.status === 'pending' && !myTurn && (
          <p className="muted small">Waiting for {users[step?.approverId]?.name ?? 'an approver'}.</p>
        )}
      </div>

      {rejecting && (
        <form
          className="td-reject"
          onSubmit={(e) => {
            e.preventDefault()
            act('reject')
          }}
        >
          <label className="label" htmlFor="td-reason">
            Reason for rejection *
          </label>
          <textarea
            id="td-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            required
          />
          <div className="td-row">
            <Button type="submit" variant="danger" size="sm">
              Reject
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setRejecting(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {a.history.length > 0 && (
        <div>
          <p className="label">Approval history</p>
          <ol className="timeline">
            {[...a.history].reverse().map((h, i) => (
              <li key={i}>
                <Avatar user={users[h.actorId]} size={28} />
                <div className="timeline__body">
                  <strong>{users[h.actorId]?.name}</strong>{' '}
                  {
                    {
                      submit: 'submitted for review',
                      resubmit: 'resubmitted',
                      approve: `approved “${chain[h.step]?.name}”`,
                      reject: `rejected at “${chain[h.step]?.name}”`,
                    }[h.type]
                  }
                  {h.reason && <q className="td-reason-text">{h.reason}</q>}
                  <time>{fmtDateTime(h.at)}</time>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

function CommentsTab({ task }) {
  const api = useApi()
  const { can, user } = useCurrent()
  const allComments = useOrgCollection('comments')
  const users = useWs((s) => s.users)
  const members = useMembers()
  const comments = useMemo(
    () => allComments.filter((c) => c.taskId === task.id).sort((a, b) => a.createdAt - b.createdAt),
    [allComments, task.id],
  )
  const [body, setBody] = useState('')
  const [files, setFiles] = useState([])
  const [fileError, setFileError] = useState('')
  const [busy, setBusy] = useState(false)

  const onFiles = async (e) => {
    setFileError('')
    const picked = [...e.target.files].slice(0, 3)
    const ok = []
    for (const f of picked) {
      if (!ATTACHMENT_TYPES.includes(f.type)) {
        setFileError(`${f.name}: only images, PDF, TXT and CSV are allowed.`)
        continue
      }
      if (f.size > MAX_ATTACHMENT_BYTES) {
        setFileError(`${f.name}: files must be under 1 MB.`)
        continue
      }
      const dataUrl = await new Promise((res) => {
        const r = new FileReader()
        r.onload = () => res(r.result)
        r.readAsDataURL(f)
      })
      ok.push({ name: f.name, type: f.type, size: f.size, dataUrl })
    }
    setFiles(ok)
    e.target.value = ''
  }

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    const r = await attempt(api.addComment(task.id, { body, attachments: files }), { toast })
    setBusy(false)
    if (r) {
      setBody('')
      setFiles([])
    }
  }

  return (
    <div className="drawer-section">
      {comments.length === 0 && (
        <p className="muted small">No comments yet. Start the discussion — use @name to mention someone.</p>
      )}
      <ul className="comments-list">
        {comments.map((c) => (
          <li key={c.id} className="comment-item">
            {c.authorId === 'system' ? (
              <span className="avatar avatar--system">⚡</span>
            ) : (
              <Avatar user={users[c.authorId]} size={32} />
            )}
            <div className="comment-item__main">
              <p className="comment-item__head">
                <strong>{c.authorId === 'system' ? 'Automation' : users[c.authorId]?.name}</strong>
                <time dateTime={new Date(c.createdAt).toISOString()}>{timeAgo(c.createdAt)}</time>
                {(c.authorId === user.id || can('task.delete')) && c.authorId !== 'system' && (
                  <button
                    type="button"
                    className="icon-btn icon-btn--sm icon-btn--danger"
                    aria-label="Delete comment"
                    onClick={() => attempt(api.deleteComment(c.id), { toast })}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                )}
              </p>
              {c.body && <p className="comment-item__body">{c.body}</p>}
              {c.attachments.length > 0 && (
                <ul className="attachments">
                  {c.attachments.map((f) => (
                    <li key={f.id}>
                      {f.status === 'ready' && f.type.startsWith('image/') ? (
                        <a href={f.dataUrl} download={f.name}>
                          <img src={f.dataUrl} alt={f.name} loading="lazy" />
                        </a>
                      ) : f.status === 'ready' ? (
                        <a href={f.dataUrl} download={f.name} className="attachment-file">
                          <Icon name="paperclip" size={15} /> {f.name}
                        </a>
                      ) : (
                        <span className="attachment-file is-pending">
                          <Icon name="paperclip" size={15} /> {f.name} —{' '}
                          {f.status === 'rejected' ? 'rejected by file check' : 'processing…'}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ul>

      {can('comment.create') && (
        <form className="comment-form" onSubmit={submit}>
          <label className="sr-only" htmlFor="td-comment">
            Write a comment
          </label>
          <textarea
            id="td-comment"
            rows={3}
            value={body}
            maxLength={2000}
            onChange={(e) => setBody(e.target.value)}
            placeholder={`Comment… mention with @${members[0]?.name.split(' ')[0] ?? 'name'}`}
            onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && submit(e)}
          />
          {files.length > 0 && (
            <p className="small muted">
              Attaching: {files.map((f) => f.name).join(', ')}{' '}
              <button type="button" className="link-btn" onClick={() => setFiles([])}>
                remove
              </button>
            </p>
          )}
          {fileError && <p className="error-text">{fileError}</p>}
          <div className="td-row">
            <label className="btn btn--ghost btn--sm attach-btn">
              <Icon name="paperclip" size={16} /> Attach
              <input type="file" multiple accept={ATTACHMENT_TYPES.join(',')} onChange={onFiles} className="sr-only" />
            </label>
            <Button type="submit" size="sm" loading={busy} disabled={!body.trim() && !files.length}>
              Comment
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}

function HistoryTab({ task }) {
  const api = useApi()
  const { can } = useCurrent()
  const audit = useOrgCollection('audit')
  const users = useWs((s) => s.users)
  const entries = useMemo(() => audit.filter((e) => e.entityId === task.id), [audit, task.id])

  return (
    <div className="drawer-section">
      {entries.length === 0 ? (
        <p className="muted small">No changes recorded yet.</p>
      ) : (
        <ol className="timeline">
          {entries.map((e) => (
            <li key={e.id}>
              {e.actorId === 'system' ? (
                <span className="avatar avatar--system">⚡</span>
              ) : (
                <Avatar user={users[e.actorId]} size={28} />
              )}
              <div className="timeline__body">
                <strong>{e.actorId === 'system' ? e.actorLabel : users[e.actorId]?.name}</strong> {e.summary}
                <time>{fmtDateTime(e.at)}</time>
                {can('audit.restore') && e.before && e.action === 'task.updated' && (
                  <button
                    type="button"
                    className="link-btn small"
                    onClick={() =>
                      attempt(api.restoreFromAudit(e.id), { toast, success: 'Restored the previous version' })
                    }
                  >
                    Restore version before this change
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/** Task detail dialog with tabs. */
export default function TaskDrawer({ taskId }) {
  const api = useApi()
  const { can } = useCurrent()
  const task = useWs(useCallback((s) => s.tasks[taskId], [taskId]))
  const users = useWs((s) => s.users)
  const project = useWs(useCallback((s) => (task ? s.projects[task.projectId] : null), [task]))
  const comments = useOrgCollection('comments')
  const [tab, setTab] = useState('details')
  const [title, setTitle] = useState(task?.title ?? '')
  const close = () => ui.close('taskId')

  if (!task) {
    return (
      <Modal title="Task not found" onClose={close}>
        <p>This task was deleted or you don't have access to it.</p>
      </Modal>
    )
  }

  const canEdit = can('task.update')
  const commentCount = comments.filter((c) => c.taskId === task.id).length
  const tabs = [
    ['details', 'Details'],
    ['deps', 'Dependencies & subtasks'],
    ['approval', `Approval${task.approval.status === 'pending' ? ' •' : ''}`],
    ['comments', `Comments (${commentCount})`],
    ['history', 'History'],
  ]

  return (
    <Modal title={`${task.key} · ${project?.name ?? ''}`} onClose={close} wide className="task-modal">
      <div className="td-head">
        <label className="sr-only" htmlFor="td-title">
          Task title
        </label>
        <input
          id="td-title"
          className="td-title"
          value={title}
          disabled={!canEdit}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== task.title && attempt(api.updateTask(task.id, { title }), { toast })}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <div className="td-meta">
          <StatusBadge status={task.status} />
          <PriorityBadge priority={task.priority} />
          {task.recurrence && <span className="badge">↻ {describeRecurrence(task.recurrence)}</span>}
          <span className="muted small">
            Created by {users[task.createdBy]?.name ?? 'Automation'} · due {fmtDate(task.dueDate)}
          </span>
          <span className="td-actions">
            <Button
              size="sm"
              variant="secondary"
              iconLeft="play"
              onClick={() => {
                sessionStorage.setItem('flowdesk-focus-task', task.id)
                ui.close('taskId')
                ui.open('focus')
              }}
            >
              Focus
            </Button>
            {can('task.delete') && (
              <Button
                size="sm"
                variant="danger"
                onClick={async () => {
                  if (await attempt(api.deleteTask(task.id), { toast, success: `Deleted ${task.key}` })) close()
                }}
              >
                Delete
              </Button>
            )}
          </span>
        </div>
      </div>

      <div className="tabs td-tabs" role="tablist" aria-label="Task sections">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'is-active' : ''}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'details' && <DetailsTab task={task} canEdit={canEdit} key={task.version} />}
        {tab === 'deps' && <DependenciesTab task={task} canEdit={canEdit} />}
        {tab === 'approval' && <ApprovalTab task={task} />}
        {tab === 'comments' && <CommentsTab task={task} />}
        {tab === 'history' && <HistoryTab task={task} />}
      </div>
    </Modal>
  )
}
