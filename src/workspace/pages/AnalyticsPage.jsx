import { useMemo, useState } from 'react'
import useNow from '@/hooks/useNow'
import Button from '@/components/ui/Button'
import { appActions } from '@/store/appStore'
import {
  completedPerDay,
  predictCompletion,
  projectProgress,
  summarize,
  weeklyProgress,
  workload,
} from '@shared/analytics.js'
import { toCSV } from '@shared/exporters.js'
import { STATUS_LABELS } from '../engine/core'
import { Avatar, BarChart, fmtDate, PageTitle, Panel, Stat } from '../ui/primitives'
import { useCurrent, useMembers, useOrgCollection, useWs } from '../WorkspaceContext'

function downloadText(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Productivity analytics + reports (CSV export, print-ready PDF). */
export default function AnalyticsPage() {
  const { org } = useCurrent()
  const tasks = useOrgCollection('tasks')
  const projects = useOrgCollection('projects')
  const defs = useOrgCollection('fieldDefs')
  const members = useMembers()
  const users = useWs((s) => s.users)
  const [projectId, setProjectId] = useState('')
  const now = useNow()
  const scoped = useMemo(() => (projectId ? tasks.filter((t) => t.projectId === projectId) : tasks), [tasks, projectId])

  const s = useMemo(() => summarize(scoped), [scoped])
  const daily = useMemo(() => completedPerDay(scoped, { days: 14 }), [scoped])
  const weekly = useMemo(() => weeklyProgress(scoped, { weeks: 8 }), [scoped])
  const people = useMemo(() => workload(scoped, members, { capacity: org.capacity }), [scoped, members, org.capacity])
  const projectRows = useMemo(
    () =>
      projects
        .filter((p) => !projectId || p.id === projectId)
        .map((p) => {
          const pt = tasks.filter((t) => t.projectId === p.id)
          return {
            p,
            progress: projectProgress(pt),
            f: predictCompletion(pt, { deadline: p.deadline }),
            count: pt.length,
          }
        }),
    [projects, tasks, projectId],
  )

  const exportCsv = () => {
    const projName = Object.fromEntries(projects.map((p) => [p.id, p.name]))
    const csv = toCSV(
      [
        'Key',
        'Title',
        'Project',
        'Status',
        'Priority',
        'Assignee',
        'Due date',
        'Estimate (h)',
        'Time tracked (min)',
        'Created',
        'Completed',
        ...defs.map((d) => d.name),
      ],
      scoped.map((t) => [
        t.key,
        t.title,
        projName[t.projectId],
        STATUS_LABELS[t.status],
        t.priority,
        users[t.assigneeId]?.name ?? '',
        t.dueDate ?? '',
        t.estimate,
        t.timeSpent ?? 0,
        new Date(t.createdAt).toISOString().slice(0, 10),
        t.completedAt ? new Date(t.completedAt).toISOString().slice(0, 10) : '',
        ...defs.map((d) => t.customFields?.[d.id] ?? ''),
      ]),
    )
    downloadText(
      `${org.slug}-tasks-${new Date(now).toISOString().slice(0, 10)}.csv`,
      `﻿${csv}`,
      'text/csv;charset=utf-8',
    )
    appActions.toast(`Exported ${scoped.length} tasks to CSV`)
  }

  return (
    <div className="ws-page report">
      <PageTitle
        title="Analytics & reports"
        subtitle="Team productivity, project forecasts and exportable reports."
        actions={
          <div className="no-print ws-page__actions">
            <label>
              <span className="sr-only">Project</span>
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">All projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <Button variant="secondary" iconLeft="download" onClick={exportCsv}>
              Export CSV
            </Button>
            <Button variant="secondary" iconLeft="download" onClick={() => window.print()}>
              Save as PDF
            </Button>
          </div>
        }
      />
      <p className="print-only">
        {org.name} — report generated {new Date(now).toLocaleString('en-IN')}
      </p>

      <dl className="stats">
        <Stat label="Tasks completed" value={s.done} tone="success" hint={`${s.completionRate}% completion`} />
        <Stat label="Pending" value={s.pending} />
        <Stat label="Overdue" value={s.overdue} tone={s.overdue ? 'danger' : undefined} />
        <Stat
          label="Completed (14 days)"
          value={daily.reduce((n, d) => n + d.count, 0)}
          hint={`${(daily.reduce((n, d) => n + d.count, 0) / 14).toFixed(1)} per day`}
          tone="brand"
        />
      </dl>

      <div className="grid-2">
        <Panel title="Tasks completed per day (last 14 days)">
          <BarChart
            data={daily.map((d) => ({ ...d, value: d.count }))}
            label="Tasks completed per day"
            formatX={(d) => new Date(d.day).getDate()}
          />
        </Panel>
        <Panel title="Weekly progress: created vs completed">
          <BarChart
            data={weekly}
            label="Tasks created and completed per week"
            series={[
              { key: 'created', name: 'Created', color: 'var(--border-strong)' },
              { key: 'completed', name: 'Completed', color: 'var(--success)' },
            ]}
            formatX={(d) => fmtDate(new Date(d.from).toISOString())}
          />
        </Panel>
      </div>

      <Panel title="Individual productivity">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Member</th>
                <th className="num">Open</th>
                <th className="num">Completed this week</th>
                <th className="num">Overdue</th>
                <th className="num">Open hours</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.memberId}>
                  <td>
                    <span className="cell-user">
                      <Avatar user={users[p.memberId]} size={26} /> {p.name}
                    </span>
                  </td>
                  <td className="num">{p.open}</td>
                  <td className="num">{p.completedThisWeek}</td>
                  <td className="num">{p.overdue ? <span className="badge badge--danger">{p.overdue}</span> : 0}</td>
                  <td className="num">{p.hours}h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Project forecasts">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Progress</th>
                <th>Deadline</th>
                <th>Velocity</th>
                <th>Forecast</th>
                <th>Risk</th>
              </tr>
            </thead>
            <tbody>
              {projectRows.map(({ p, progress, f, count }) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.name}</strong>
                    <div className="muted small">{count} tasks</div>
                  </td>
                  <td style={{ minWidth: 140 }}>
                    <div className="meter meter--success">
                      <span style={{ width: `${progress}%` }} />
                    </div>
                    <span className="small">{progress}%</span>
                  </td>
                  <td>{fmtDate(p.deadline)}</td>
                  <td>{f.velocity} / day</td>
                  <td>{f.predictedDate ? fmtDate(new Date(f.predictedDate).toISOString()) : '—'}</td>
                  <td>
                    {
                      {
                        high: (
                          <span className="badge badge--danger">At risk{f.daysLate ? ` (+${f.daysLate}d)` : ''}</span>
                        ),
                        medium: <span className="badge badge--medium">Tight</span>,
                        low: <span className="badge badge--success">On track</span>,
                        done: <span className="badge badge--success">Done</span>,
                        unknown: <span className="badge">No deadline</span>,
                        empty: <span className="badge">No tasks yet</span>,
                      }[f.risk]
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small" style={{ marginTop: '0.75rem' }}>
          Forecast = remaining tasks ÷ tasks completed per day over the last 14 days.
        </p>
      </Panel>
    </div>
  )
}
