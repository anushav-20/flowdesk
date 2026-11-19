import { useMemo, useState } from 'react'
import { computeLevels, criticalPath, deadlineImpact, findCycle } from '@shared/graph.js'
import Button from '@/components/ui/Button'
import { Empty, fmtDate, PageTitle, Panel, Stat, StatusBadge } from '../ui/primitives'
import { ui } from '../uiStore'
import { useOrgCollection } from '../WorkspaceContext'
import './DependenciesPage.css'

const NODE_W = 190
const NODE_H = 54
const COL_GAP = 70
const ROW_GAP = 18

/**
 * Dependency graph: layered layout (topological levels), critical path highlighted,
 * plus deadline-impact analysis showing which tasks will miss their due date.
 */
export default function DependenciesPage() {
  const tasks = useOrgCollection('tasks')
  const projects = useOrgCollection('projects')
  const withDeps = projects.filter((p) => tasks.some((t) => t.projectId === p.id && t.blockedBy.length))
  const [projectId, setProjectId] = useState(withDeps[0]?.id ?? projects[0]?.id ?? '')
  const [hoursPerDay, setHoursPerDay] = useState(6)

  const projectTasks = useMemo(() => tasks.filter((t) => t.projectId === projectId && !t.parentId), [tasks, projectId])

  const analysis = useMemo(() => {
    const cycle = findCycle(projectTasks)
    if (cycle) return { cycle }
    const levels = computeLevels(projectTasks)
    const cp = criticalPath(projectTasks)
    const impact = deadlineImpact(projectTasks, { hoursPerDay })
    // Position nodes: x by level, y by order within level
    const cols = {}
    const pos = {}
    for (const t of projectTasks) {
      const l = levels.get(t.id)
      cols[l] = (cols[l] ?? 0) + 1
      pos[t.id] = { x: l * (NODE_W + COL_GAP), y: (cols[l] - 1) * (NODE_H + ROW_GAP) }
    }
    const maxRows = Math.max(1, ...Object.values(cols))
    const maxLevel = Math.max(0, ...levels.values())
    return {
      levels,
      cp,
      impact,
      pos,
      width: (maxLevel + 1) * (NODE_W + COL_GAP) - COL_GAP,
      height: maxRows * (NODE_H + ROW_GAP) - ROW_GAP,
    }
  }, [projectTasks, hoursPerDay])

  const critical = new Set(analysis.cp?.path ?? [])
  const criticalEdges = new Set((analysis.cp?.path ?? []).slice(1).map((id, i) => `${analysis.cp.path[i]}>${id}`))
  const atRisk = analysis.impact?.filter((i) => i.atRisk) ?? []
  const byId = Object.fromEntries(projectTasks.map((t) => [t.id, t]))

  return (
    <div className="ws-page">
      <PageTitle
        title="Dependencies"
        subtitle="See how tasks depend on each other, the critical path, and which deadlines are at risk."
      />

      <div className="field-inline deps-controls">
        <label>
          <span className="label">Project</span>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Working hours per day</span>
          <input
            type="number"
            min="1"
            max="12"
            value={hoursPerDay}
            onChange={(e) => setHoursPerDay(Math.max(1, Math.min(12, Number(e.target.value) || 6)))}
          />
        </label>
      </div>

      {analysis.cycle ? (
        <p className="callout callout--danger">
          Circular dependency detected: {analysis.cycle.map((id) => byId[id]?.key).join(' → ')}
        </p>
      ) : (
        <>
          <dl className="stats">
            <Stat label="Tasks" value={projectTasks.length} />
            <Stat
              label="Critical path"
              value={`${analysis.cp.duration}h`}
              hint={`${analysis.cp.path.length} tasks · ~${Math.ceil(analysis.cp.duration / hoursPerDay)} working days`}
              tone="brand"
            />
            <Stat label="Deadlines at risk" value={atRisk.length} tone={atRisk.length ? 'danger' : 'success'} />
          </dl>

          <Panel title="Dependency graph" className="panel--flush">
            {projectTasks.length === 0 ? (
              <Empty
                icon="graph"
                title="No tasks in this project yet"
                actions={
                  <Button iconLeft="plus" onClick={() => ui.newTask({ projectId })}>
                    Add a task
                  </Button>
                }
              >
                Add tasks and set “Blocked by” on them to see the dependency graph, critical path and deadline risks.
              </Empty>
            ) : (
              <div className="graph-wrap">
                <svg
                  className="graph"
                  width={analysis.width + 40}
                  height={analysis.height + 40}
                  viewBox={`-20 -20 ${analysis.width + 40} ${analysis.height + 40}`}
                  role="img"
                  aria-label={`Dependency graph for ${projects.find((p) => p.id === projectId)?.name}. Critical path: ${analysis.cp.path.map((id) => byId[id].key).join(', ')}`}
                >
                  <defs>
                    <marker
                      id="arrow"
                      viewBox="0 0 10 10"
                      refX="9"
                      refY="5"
                      markerWidth="7"
                      markerHeight="7"
                      orient="auto-start-reverse"
                    >
                      <path d="M0 0L10 5L0 10z" className="graph__arrow" />
                    </marker>
                    <marker
                      id="arrow-crit"
                      viewBox="0 0 10 10"
                      refX="9"
                      refY="5"
                      markerWidth="7"
                      markerHeight="7"
                      orient="auto-start-reverse"
                    >
                      <path d="M0 0L10 5L0 10z" className="graph__arrow graph__arrow--crit" />
                    </marker>
                  </defs>
                  {projectTasks.flatMap((t) =>
                    t.blockedBy
                      .filter((p) => analysis.pos[p])
                      .map((p) => {
                        const a = analysis.pos[p]
                        const b = analysis.pos[t.id]
                        const x1 = a.x + NODE_W
                        const y1 = a.y + NODE_H / 2
                        const x2 = b.x
                        const y2 = b.y + NODE_H / 2
                        const mid = (x1 + x2) / 2
                        const crit = criticalEdges.has(`${p}>${t.id}`)
                        return (
                          <path
                            key={`${p}-${t.id}`}
                            d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2 - 4},${y2}`}
                            className={`graph__edge ${crit ? 'is-critical' : ''}`}
                            markerEnd={`url(#${crit ? 'arrow-crit' : 'arrow'})`}
                          />
                        )
                      }),
                  )}
                  {projectTasks.map((t) => {
                    const { x, y } = analysis.pos[t.id]
                    const risk = analysis.impact.find((i) => i.id === t.id)
                    return (
                      <g
                        key={t.id}
                        transform={`translate(${x},${y})`}
                        className={`graph__node is-${t.status} ${critical.has(t.id) ? 'is-critical' : ''} ${risk?.atRisk ? 'is-risk' : ''}`}
                        role="button"
                        tabIndex={0}
                        aria-label={`${t.key} ${t.title}, ${t.status}${critical.has(t.id) ? ', on critical path' : ''}${risk?.atRisk ? ', deadline at risk' : ''}`}
                        onClick={() => ui.openTask(t.id)}
                        onKeyDown={(e) =>
                          (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), ui.openTask(t.id))
                        }
                      >
                        <rect width={NODE_W} height={NODE_H} rx="10" />
                        <text x="12" y="21" className="graph__key">
                          {t.key} · {t.estimate}h{risk?.atRisk ? ' · ⚠' : ''}
                        </text>
                        <text x="12" y="40" className="graph__title">
                          {t.title.length > 24 ? `${t.title.slice(0, 23)}…` : t.title}
                        </text>
                      </g>
                    )
                  })}
                </svg>
              </div>
            )}
            <p className="graph-legend muted small">
              <span className="graph-legend__crit" /> Critical path (longest chain of remaining work) ·{' '}
              <span className="graph-legend__risk" /> Deadline at risk · faded = completed. Click a task to open it.
            </p>
          </Panel>

          <Panel title="Deadline impact analysis">
            <p className="muted small" style={{ marginBottom: '0.75rem' }}>
              Projected finish dates assume prerequisites run in sequence at {hoursPerDay} focused hours per day,
              starting today.
            </p>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Status</th>
                    <th>Due</th>
                    <th>Projected finish</th>
                    <th>Impact</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.impact.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <button type="button" className="link-btn" onClick={() => ui.openTask(i.id)}>
                          {byId[i.id].key} {byId[i.id].title}
                        </button>
                      </td>
                      <td>
                        <StatusBadge status={byId[i.id].status} />
                      </td>
                      <td>{fmtDate(i.dueDate)}</td>
                      <td>{fmtDate(new Date(i.projectedFinish).toISOString())}</td>
                      <td>
                        {i.atRisk ? (
                          <span className="badge badge--danger">
                            ~{i.lateByDays} day{i.lateByDays > 1 ? 's' : ''} late
                          </span>
                        ) : (
                          <span className="badge badge--success">On time</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  )
}
