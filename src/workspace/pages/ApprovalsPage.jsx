import { useMemo } from 'react'
import { currentStep } from '@shared/approval.js'
import { Avatar, Empty, fmtDateTime, PageTitle, Panel, PriorityBadge } from '../ui/primitives'
import { ui } from '../uiStore'
import { useCurrent, useOrgCollection, useWs } from '../WorkspaceContext'

function ApprovalRow({ t, chain, users }) {
  const step = currentStep(t.approval, chain)
  return (
    <li>
      <button type="button" className="list-item" onClick={() => ui.openTask(t.id)}>
        <PriorityBadge priority={t.priority} />
        <span className="list-item__main">
          <span className="list-item__title">
            {t.key} {t.title}
          </span>
          <span className="list-item__meta">
            Step {t.approval.step + 1} of {chain.length}: {step?.name} · waiting for{' '}
            {users[step?.approverId]?.name ?? 'any admin'}
          </span>
        </span>
        <Avatar user={users[t.assigneeId]} size={26} />
      </button>
    </li>
  )
}

/** Approval queue: what's waiting for me, everything in flight, and recent decisions. */
export default function ApprovalsPage() {
  const { user, org, role } = useCurrent()
  const tasks = useOrgCollection('tasks')
  const users = useWs((s) => s.users)
  const chain = org.approvalChain

  const pending = useMemo(() => tasks.filter((t) => t.approval.status === 'pending'), [tasks])
  const mine = pending.filter(
    (t) =>
      currentStep(t.approval, chain)?.approverId === user.id ||
      (role === 'owner' && !currentStep(t.approval, chain)?.approverId),
  )
  const decided = useMemo(
    () =>
      tasks
        .flatMap((t) =>
          t.approval.history.filter((h) => h.type === 'approve' || h.type === 'reject').map((h) => ({ ...h, task: t })),
        )
        .sort((a, b) => b.at - a.at)
        .slice(0, 15),
    [tasks],
  )

  return (
    <div className="ws-page">
      <PageTitle
        title="Approvals"
        subtitle={`Workflow: ${chain.map((s) => s.name).join(' → ')}. Configure the steps in Settings.`}
      />

      <div className="grid-2">
        <Panel title={`Waiting for you (${mine.length})`}>
          {mine.length === 0 ? (
            <Empty icon="check" title="Nothing needs your approval" />
          ) : (
            <ul className="list">
              {mine.map((t) => (
                <ApprovalRow key={t.id} t={t} chain={chain} users={users} />
              ))}
            </ul>
          )}
        </Panel>
        <Panel title={`All pending (${pending.length})`}>
          {pending.length === 0 ? (
            <p className="muted small">No tasks are in review. Open a task and choose “Submit for review”.</p>
          ) : (
            <ul className="list">
              {pending.map((t) => (
                <ApprovalRow key={t.id} t={t} chain={chain} users={users} />
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Recent decisions">
        {decided.length === 0 ? (
          <p className="muted small">No approvals or rejections yet.</p>
        ) : (
          <ol className="timeline">
            {decided.map((d, i) => (
              <li key={i}>
                <Avatar user={users[d.actorId]} size={28} />
                <div className="timeline__body">
                  <strong>{users[d.actorId]?.name}</strong> {d.type === 'approve' ? 'approved' : 'rejected'} “
                  {chain[d.step]?.name}” for{' '}
                  <button type="button" className="link-btn" onClick={() => ui.openTask(d.task.id)}>
                    {d.task.key} {d.task.title}
                  </button>
                  {d.reason && <q className="td-reason-text">{d.reason}</q>}
                  <time>{fmtDateTime(d.at)}</time>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  )
}
