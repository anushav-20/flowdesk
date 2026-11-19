import { useMemo } from 'react'
import useNow from '@/hooks/useNow'
import { Link } from 'react-router'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import { isOverdue, predictCompletion, projectProgress, summarize, weeklyProgress } from '@shared/analytics.js'
import { prioritize } from '@shared/assistant.js'
import { BADGES, level } from '@shared/gamification.js'
import { Avatar, BarChart, fmtDate, PageTitle, Panel, PriorityBadge, Stat, timeAgo } from '../ui/primitives'
import { ui } from '../uiStore'
import { useCurrent, useMembers, useOrgCollection, useWs } from '../WorkspaceContext'

const RISK = {
  high: ['danger', 'At risk'],
  medium: ['warn', 'Tight'],
  low: ['success', 'On track'],
  done: ['success', 'Done'],
  unknown: ['', 'No deadline'],
  empty: ['', 'No tasks yet'],
}

export default function DashboardPage() {
  const { user, org, orgId } = useCurrent()
  const tasks = useOrgCollection('tasks')
  const projects = useOrgCollection('projects')
  const audit = useOrgCollection('audit')
  const members = useMembers()
  const stats = useWs((s) => s.stats)
  const users = useWs((s) => s.users)
  const now = useNow()

  const summary = useMemo(() => summarize(tasks, now), [tasks, now])
  const mine = useMemo(() => prioritize(tasks, { userId: user.id, limit: 6 }), [tasks, user.id])
  const weekly = useMemo(() => weeklyProgress(tasks, { weeks: 6 }), [tasks])
  const forecasts = useMemo(
    () =>
      projects
        .filter((p) => !p.archived)
        .map((p) => {
          const pt = tasks.filter((t) => t.projectId === p.id)
          return {
            project: p,
            progress: projectProgress(pt),
            forecast: predictCompletion(pt, { deadline: p.deadline }),
          }
        }),
    [projects, tasks],
  )
  const leaderboard = useMemo(
    () =>
      members
        .map((m) => ({ m, s: stats[`${orgId}:${m.id}`] }))
        .filter((x) => x.s)
        .sort((a, b) => b.s.points - a.s.points)
        .slice(0, 5),
    [members, stats, orgId],
  )
  const myStats = stats[`${orgId}:${user.id}`]
  const hour = new Date(now).getHours()

  return (
    <div className="ws-page">
      <PageTitle
        title={`Good ${hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}, ${user.name.split(' ')[0]}`}
        subtitle={`Here's what's happening in ${org.name}.`}
        actions={
          <>
            <Button variant="secondary" iconLeft="spark" onClick={() => ui.open('assistant')}>
              Ask AI
            </Button>
            <Button iconLeft="plus" onClick={() => ui.newTask()}>
              New task
            </Button>
          </>
        }
      />

      <dl className="stats">
        <Stat label="Open tasks" value={summary.pending} />
        <Stat label="Completed" value={summary.done} tone="success" hint={`${summary.completionRate}% of all tasks`} />
        <Stat label="Overdue" value={summary.overdue} tone={summary.overdue ? 'danger' : undefined} />
        <Stat label="Waiting for review" value={summary.inReview} tone="brand" />
      </dl>

      <div className="grid-3">
        <Panel
          title="Your next tasks"
          className="span-2"
          actions={
            <Link to="/app/board" className="link-btn small">
              Open board
            </Link>
          }
        >
          {mine.length === 0 ? (
            <p className="muted">Nothing assigned to you that can start now. 🎉</p>
          ) : (
            <ul className="list">
              {mine.map(({ task }) => (
                <li key={task.id}>
                  <button type="button" className="list-item" onClick={() => ui.openTask(task.id)}>
                    <PriorityBadge priority={task.priority} />
                    <span className="list-item__main">
                      <span className="list-item__title">
                        {task.key} {task.title}
                      </span>
                      <span className={`list-item__meta ${isOverdue(task) ? 'text-danger' : ''}`}>
                        {task.dueDate
                          ? `Due ${fmtDate(task.dueDate)}${isOverdue(task) ? ' · overdue' : ''}`
                          : 'No due date'}
                      </span>
                    </span>
                    <Icon name="arrowRight" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Your progress">
          {myStats ? (
            <div className="gamify">
              <p className="gamify__level">
                Level {level(myStats.points)} <span>· {myStats.points} pts</span>
              </p>
              <p className="gamify__streak">🔥 {myStats.streak}-day streak</p>
              <ul className="gamify__badges" aria-label="Badges">
                {Object.entries(BADGES).map(([id, b]) => (
                  <li
                    key={id}
                    className={myStats.badges.includes(id) ? 'is-earned' : ''}
                    title={`${b.name} — ${b.description}`}
                  >
                    <span aria-hidden="true">{b.icon}</span>
                    <span className="sr-only">
                      {b.name}: {myStats.badges.includes(id) ? 'earned' : 'locked'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="muted small">Complete a task or a focus session to start earning points.</p>
          )}
          {leaderboard.length > 0 && (
            <>
              <p className="label" style={{ marginTop: '1rem' }}>
                Leaderboard
              </p>
              <ol className="leaderboard">
                {leaderboard.map(({ m, s }, i) => (
                  <li key={m.id}>
                    <span className="leaderboard__rank">{i + 1}</span>
                    <Avatar user={m} size={24} />
                    <span>{m.name.split(' ')[0]}</span>
                    <strong>{s.points}</strong>
                  </li>
                ))}
              </ol>
            </>
          )}
        </Panel>
      </div>

      <div className="grid-2">
        <Panel
          title="Smart deadline prediction"
          actions={
            <Link to="/app/analytics" className="link-btn small">
              Details
            </Link>
          }
        >
          <ul className="forecast">
            {forecasts.map(({ project, progress, forecast }) => {
              const [tone, label] = RISK[forecast.risk]
              return (
                <li key={project.id}>
                  <div className="forecast__head">
                    <span className="forecast__dot" style={{ background: project.color }} aria-hidden="true" />
                    <strong>{project.name}</strong>
                    <span className={`badge badge--${tone === 'warn' ? 'medium' : tone || ''}`}>{label}</span>
                  </div>
                  <div className={`meter ${forecast.risk === 'high' ? 'meter--danger' : 'meter--success'}`}>
                    <span style={{ width: `${progress}%` }} />
                  </div>
                  <p className="muted small">
                    {progress}% done · {forecast.remaining} open
                    {project.deadline && ` · deadline ${fmtDate(project.deadline)}`}
                    {forecast.predictedDate &&
                      forecast.risk !== 'done' &&
                      ` · forecast ${fmtDate(new Date(forecast.predictedDate).toISOString())}`}
                    {forecast.daysLate > 0 && ` (~${forecast.daysLate} days late)`}
                  </p>
                </li>
              )
            })}
          </ul>
        </Panel>

        <Panel title="Weekly progress">
          <BarChart
            data={weekly}
            label="Tasks created and completed per week"
            series={[
              { key: 'created', name: 'Created', color: 'var(--border-strong)' },
              { key: 'completed', name: 'Completed', color: 'var(--brand)' },
            ]}
            formatX={(d) => fmtDate(new Date(d.from).toISOString())}
          />
        </Panel>
      </div>

      <Panel
        title="Activity timeline"
        actions={
          <Link to="/app/activity" className="link-btn small">
            Full audit log
          </Link>
        }
      >
        {audit.length === 0 ? (
          <p className="muted small">Activity will appear here as your team works.</p>
        ) : (
          <ol className="timeline">
            {audit.slice(0, 8).map((e) => (
              <li key={e.id}>
                {e.actorId === 'system' ? (
                  <span className="avatar avatar--system">⚡</span>
                ) : (
                  <Avatar user={users[e.actorId]} size={28} />
                )}
                <div className="timeline__body">
                  <strong>{e.actorId === 'system' ? e.actorLabel : users[e.actorId]?.name}</strong> {e.summary}
                  <time>{timeAgo(e.at)}</time>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  )
}
