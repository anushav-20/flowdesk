import { useEffect, useMemo, useState } from 'react'
import Button from '@/components/ui/Button'
import { queueStats } from '@shared/jobs.js'
import { STORAGE_KEY } from '../engine/db'
import { BarChart, Empty, fmtDateTime, PageTitle, Panel, Stat } from '../ui/primitives'
import { useCurrent, useOrgCollection, usePeers, useWorkspace } from '../WorkspaceContext'

const pct = (arr, p) => {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
}

/** Observability dashboard: API latency, error log, job failures, active users, storage, Web Vitals. */
export default function HealthPage() {
  const { metrics } = useWorkspace()
  const { can, orgId } = useCurrent()
  const jobs = useOrgCollection('jobs')
  const peers = usePeers()
  const [tick, setTick] = useState(0)
  const [vitals, setVitals] = useState({})

  // Metrics live outside React state; refresh the view every 2s
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 2000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    let active = true
    import('web-vitals').then(({ onLCP, onCLS, onINP, onFCP, onTTFB }) => {
      const set = ({ name, value, rating }) => active && setVitals((v) => ({ ...v, [name]: { value, rating } }))
      ;[onLCP, onCLS, onINP, onFCP, onTTFB].forEach((fn) => fn(set, { reportAllChanges: true }))
    })
    return () => {
      active = false
    }
  }, [])

  const data = useMemo(() => {
    const calls = metrics.calls
    const byName = {}
    for (const c of calls) (byName[c.name] ??= []).push(c)
    const ops = Object.entries(byName)
      .map(([name, list]) => ({
        name,
        count: list.length,
        avg: list.reduce((s, c) => s + c.ms, 0) / list.length,
        p95: pct(
          list.map((c) => c.ms),
          95,
        ),
        errors: list.filter((c) => !c.ok).length,
      }))
      .sort((a, b) => b.count - a.count)
    const failures = calls.filter((c) => !c.ok).length
    const now = Date.now()
    const perMinute = Array.from({ length: 10 }, (_, i) => {
      const from = now - (10 - i) * 60_000
      const inWin = calls.filter((c) => c.at >= from && c.at < from + 60_000)
      return { label: `${10 - i}m`, value: inWin.length, errors: inWin.filter((c) => !c.ok).length }
    })
    return {
      ops,
      failures,
      total: calls.length,
      p95: pct(
        calls.map((c) => c.ms),
        95,
      ),
      perMinute,
    }
    // tick forces a refresh of mutable metrics
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metrics, tick])

  const js = queueStats(jobs)
  let storageKb = 0
  try {
    storageKb = Math.round((localStorage.getItem(STORAGE_KEY)?.length ?? 0) / 1024)
  } catch {
    storageKb = 0
  }
  const online = peers.filter((p) => p.orgId === orgId).length + 1

  if (!can('health.read'))
    return (
      <div className="ws-page">
        <Empty
          icon="lock"
          title="Admins only"
          actions={
            <Button variant="secondary" to="/app">
              Back to dashboard
            </Button>
          }
        >
          System health shows API latency, error rates and the job queue. Ask an owner or admin if you need access.
        </Empty>
      </div>
    )

  return (
    <div className="ws-page">
      <PageTitle
        title="System health"
        subtitle="What happens after deploy: latency, failures, background jobs and real-user performance. (Server mode adds database health from /api/health.)"
      />

      <dl className="stats">
        <Stat label="API calls (session)" value={data.total} />
        <Stat label="p95 latency" value={`${data.p95.toFixed(1)} ms`} tone="brand" />
        <Stat
          label="Failed requests"
          value={data.failures}
          tone={data.failures ? 'danger' : 'success'}
          hint="Validation + permission errors included"
        />
        <Stat label="Job failures (DLQ)" value={js.dead} tone={js.dead ? 'danger' : 'success'} />
        <Stat label="Active users" value={online} hint="Tabs online in this workspace" />
        <Stat label="Storage used" value={`${storageKb} KB`} hint="localStorage (≈5 MB limit)" />
      </dl>

      <div className="grid-2">
        <Panel title="Requests per minute (last 10 min)">
          <BarChart
            data={data.perMinute}
            label="Requests and errors per minute"
            series={[
              { key: 'value', name: 'Requests', color: 'var(--brand)' },
              { key: 'errors', name: 'Errors', color: 'var(--danger)' },
            ]}
          />
        </Panel>
        <Panel title="Core Web Vitals (this page load)">
          <ul className="list">
            {['LCP', 'INP', 'CLS', 'FCP', 'TTFB'].map((k) => {
              const v = vitals[k]
              const fmt = !v ? 'measuring…' : k === 'CLS' ? v.value.toFixed(3) : `${Math.round(v.value)} ms`
              return (
                <li key={k} className="list-item">
                  <strong style={{ width: 60 }}>{k}</strong>
                  <span className="list-item__main">{fmt}</span>
                  {v && (
                    <span
                      className={`badge ${v.rating === 'good' ? 'badge--success' : v.rating === 'poor' ? 'badge--danger' : 'badge--medium'}`}
                    >
                      {v.rating}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
          <p className="muted small" style={{ marginTop: '0.5rem' }}>
            INP appears after you interact with the page.
          </p>
        </Panel>
      </div>

      <Panel title="Endpoint performance">
        {data.ops.length === 0 ? (
          <p className="muted small">Use the app to generate traffic.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Operation</th>
                  <th className="num">Calls</th>
                  <th className="num">Avg</th>
                  <th className="num">p95</th>
                  <th className="num">Errors</th>
                </tr>
              </thead>
              <tbody>
                {data.ops.map((o) => (
                  <tr key={o.name}>
                    <td>
                      <code>{o.name}</code>
                    </td>
                    <td className="num">{o.count}</td>
                    <td className="num">{o.avg.toFixed(1)} ms</td>
                    <td className="num">{o.p95.toFixed(1)} ms</td>
                    <td className="num">{o.errors ? <span className="badge badge--danger">{o.errors}</span> : 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Error log">
        {metrics.errors.length === 0 ? (
          <p className="muted small">No errors recorded. 🎉</p>
        ) : (
          <ul className="list">
            {metrics.errors.slice(0, 20).map((e, i) => (
              <li key={i} className="list-item">
                <span className={`badge ${e.level === 'warn' ? 'badge--medium' : 'badge--danger'}`}>
                  {e.level ?? 'error'}
                </span>
                <div className="list-item__main">
                  <p className="list-item__title">
                    <code>{e.name}</code> — {e.message}
                  </p>
                  <p className="list-item__meta">{fmtDateTime(e.at)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
