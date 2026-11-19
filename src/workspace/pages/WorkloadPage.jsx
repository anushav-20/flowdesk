import { useMemo } from 'react'
import Button from '@/components/ui/Button'
import { appActions } from '@/store/appStore'
import { isOverdue, workload } from '@shared/analytics.js'
import { attempt, Avatar, PageTitle, Panel, PriorityBadge } from '../ui/primitives'
import { ui } from '../uiStore'
import { useApi, useCurrent, useMembers, useOrgCollection, useWs } from '../WorkspaceContext'

/** Workload management: open tasks and hours per person vs capacity, with rebalancing suggestions. */
export default function WorkloadPage() {
  const api = useApi()
  const { org, can } = useCurrent()
  const tasks = useOrgCollection('tasks')
  const members = useMembers()
  const users = useWs((s) => s.users)
  const workers = members.filter((m) => m.role !== 'viewer')
  const rows = useMemo(() => workload(tasks, workers, { capacity: org.capacity }), [tasks, workers, org.capacity])
  const least = [...rows].sort((a, b) => a.open - b.open)[0]
  const unassigned = tasks.filter((t) => !t.assigneeId && t.status !== 'done')

  return (
    <div className="ws-page">
      <PageTitle
        title="Workload"
        subtitle={`Each person's open work against a capacity of ${org.capacity} open tasks. Change capacity in Settings.`}
      />

      {rows.some((r) => r.overloaded) && (
        <p className="callout callout--warn">
          ⚠{' '}
          {rows
            .filter((r) => r.overloaded)
            .map((r) => r.name)
            .join(', ')}{' '}
          {rows.filter((r) => r.overloaded).length > 1 ? 'are' : 'is'} over capacity. Consider moving work to{' '}
          {least?.name}, who has the most room.
        </p>
      )}

      <div className="grid-2">
        {rows.map((r) => {
          const open = tasks.filter((t) => t.assigneeId === r.memberId && t.status !== 'done')
          const pct = Math.min(100, r.utilisation)
          return (
            <Panel key={r.memberId} title={null} className="workload-card">
              <div className="workload-card__head">
                <Avatar user={users[r.memberId]} size={40} />
                <div>
                  <strong>{r.name}</strong>
                  <p className="muted small">
                    {users[r.memberId].title || members.find((m) => m.id === r.memberId)?.role}
                  </p>
                </div>
                {r.overloaded ? (
                  <span className="badge badge--danger">Overloaded</span>
                ) : r.utilisation >= 80 ? (
                  <span className="badge badge--medium">Busy</span>
                ) : (
                  <span className="badge badge--success">Has capacity</span>
                )}
              </div>
              <div
                className={`meter ${r.overloaded ? 'meter--danger' : r.utilisation >= 80 ? 'meter--warn' : 'meter--success'}`}
                role="meter"
                aria-valuenow={r.open}
                aria-valuemin={0}
                aria-valuemax={org.capacity}
                aria-label={`${r.name}: ${r.open} of ${org.capacity} tasks`}
              >
                <span style={{ width: `${pct}%` }} />
              </div>
              <p className="small muted">
                {r.open} open task{r.open === 1 ? '' : 's'} · {r.hours}h estimated · {r.overdue} overdue ·{' '}
                {r.completedThisWeek} done this week
              </p>
              {open.length > 0 && (
                <ul className="list workload-card__tasks">
                  {open.slice(0, 4).map((t) => (
                    <li key={t.id} className="list-item">
                      <PriorityBadge priority={t.priority} />
                      <button type="button" className="link-btn list-item__main" onClick={() => ui.openTask(t.id)}>
                        {t.key} {t.title}
                        {isOverdue(t) && <span className="badge badge--danger"> overdue</span>}
                      </button>
                      {r.overloaded && can('task.update') && least && least.memberId !== r.memberId && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            attempt(api.updateTask(t.id, { assigneeId: least.memberId }), {
                              toast: appActions.toast,
                              success: `Moved ${t.key} to ${least.name}`,
                            })
                          }
                        >
                          → {least.name.split(' ')[0]}
                        </Button>
                      )}
                    </li>
                  ))}
                  {open.length > 4 && <li className="muted small">+{open.length - 4} more</li>}
                </ul>
              )}
            </Panel>
          )
        })}
      </div>

      {unassigned.length > 0 && (
        <Panel title={`Unassigned (${unassigned.length})`}>
          <ul className="list">
            {unassigned.map((t) => (
              <li key={t.id} className="list-item">
                <PriorityBadge priority={t.priority} />
                <button type="button" className="link-btn list-item__main" onClick={() => ui.openTask(t.id)}>
                  {t.key} {t.title}
                </button>
                {can('task.update') && least && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      attempt(api.updateTask(t.id, { assigneeId: least.memberId }), {
                        toast: appActions.toast,
                        success: `Assigned to ${least.name}`,
                      })
                    }
                  >
                    Assign to {least.name.split(' ')[0]}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  )
}
