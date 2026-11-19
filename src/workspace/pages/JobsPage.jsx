import { useMemo, useState } from 'react'
import useNow from '@/hooks/useNow'
import Button from '@/components/ui/Button'
import { appActions } from '@/store/appStore'
import { JOB_TYPES, queueStats } from '@shared/jobs.js'
import { attempt, Empty, fmtDateTime, PageTitle, Panel, Stat, timeAgo } from '../ui/primitives'
import { useApi, useCurrent, useOrgCollection } from '../WorkspaceContext'

const toast = appActions.toast
const MANUAL = ['reminders.overdue', 'tasks.recurring', 'reports.weekly', 'projects.archive']
const PRIORITY_NAME = { 10: 'high', 5: 'normal', 1: 'low' }

/** Background job engine: queue, priorities, retries with backoff, dead-letter queue, scheduler. */
export default function JobsPage() {
  const api = useApi()
  const { can } = useCurrent()
  const jobs = useOrgCollection('jobs')
  const [tab, setTab] = useState('all')
  const [type, setType] = useState('reports.weekly')
  const [priority, setPriority] = useState('normal')
  const now = useNow(5000)
  const stats = useMemo(() => queueStats(jobs), [jobs])
  const list = useMemo(
    () =>
      jobs
        .filter((j) => tab === 'all' || j.status === tab)
        .sort((a, b) => (b.finishedAt ?? b.runAt) - (a.finishedAt ?? a.runAt))
        .slice(0, 60),
    [jobs, tab],
  )

  if (!can('jobs.manage'))
    return (
      <Empty icon="lock" title="Admins only">
        Background jobs are visible to owners and admins.
      </Empty>
    )

  return (
    <div className="ws-page">
      <PageTitle
        title="Background jobs"
        subtitle="An in-app job queue with priorities, scheduled runs, retries with exponential backoff, and a dead-letter queue for jobs that keep failing."
      />

      <dl className="stats">
        <Stat label="Queued" value={stats.queued} />
        <Stat label="Running" value={stats.running} tone="brand" />
        <Stat label="Succeeded" value={stats.done} tone="success" />
        <Stat
          label="Dead-letter queue"
          value={stats.dead}
          tone={stats.dead ? 'danger' : undefined}
          hint="Failed after 4 attempts"
        />
      </dl>

      <div className="grid-3">
        <Panel title="Run a job" className="jobs-run">
          <div className="drawer-section">
            <label>
              <span className="label">Job</span>
              <select value={type} onChange={(e) => setType(e.target.value)}>
                {MANUAL.map((t) => (
                  <option key={t} value={t}>
                    {JOB_TYPES[t]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="label">Priority</span>
              <select value={priority} onChange={(e) => setPriority(e.target.value)}>
                <option value="high">High</option>
                <option value="normal">Normal</option>
                <option value="low">Low</option>
              </select>
            </label>
            <Button onClick={() => attempt(api.enqueueJob(type, { priority }), { toast, success: 'Job queued' })}>
              Queue job
            </Button>
            <div>
              <p className="label">Schedule</p>
              <ul className="small muted schedule">
                <li>Overdue reminders — every minute</li>
                <li>Recurring tasks check — every 5 minutes</li>
                <li>Archive inactive projects — hourly</li>
                <li>Weekly report — weekly (if enabled)</li>
              </ul>
            </div>
          </div>
        </Panel>

        <Panel
          title="Jobs"
          className="span-2"
          actions={
            <div className="tabs" role="tablist" aria-label="Filter jobs">
              {['all', 'queued', 'running', 'done', 'dead'].map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  className={tab === t ? 'is-active' : ''}
                  onClick={() => setTab(t)}
                >
                  {t === 'dead' ? 'Dead-letter' : t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          }
        >
          {list.length === 0 ? (
            <p className="muted small">No jobs here.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Status</th>
                    <th>Priority</th>
                    <th className="num">Attempts</th>
                    <th>Result / error</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((j) => (
                    <tr key={j.id}>
                      <td>
                        <strong className="small">{JOB_TYPES[j.type] ?? j.type}</strong>
                        <div className="muted small">
                          {j.finishedAt
                            ? `finished ${timeAgo(j.finishedAt)}`
                            : j.runAt > now
                              ? `retry at ${fmtDateTime(j.runAt)}`
                              : `queued ${timeAgo(j.createdAt)}`}
                        </div>
                      </td>
                      <td>
                        <span
                          className={`badge ${{ done: 'badge--success', dead: 'badge--danger', running: 'badge--brand' }[j.status] ?? ''}`}
                        >
                          {j.status === 'dead' ? 'dead-letter' : j.status}
                        </span>
                      </td>
                      <td className="small">{PRIORITY_NAME[j.priority] ?? j.priority}</td>
                      <td className="num">
                        {j.attempts}/{j.maxAttempts}
                      </td>
                      <td className="small">
                        {j.lastError ? <span className="error-text">{j.lastError}</span> : (j.result ?? '—')}
                        {j.durationMs != null && <span className="muted"> · {j.durationMs} ms</span>}
                      </td>
                      <td className="num">
                        {j.status === 'dead' && (
                          <>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => attempt(api.retryJob(j.id), { toast, success: 'Job re-queued' })}
                            >
                              Retry
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => attempt(api.discardJob(j.id), { toast })}>
                              Discard
                            </Button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}
