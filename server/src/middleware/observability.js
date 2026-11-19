import { randomUUID } from 'node:crypto'

/**
 * Request IDs + in-memory metrics (latency per route, error counts) for the health dashboard.
 * In production you'd export these to Prometheus/Datadog; the shape is the same.
 */
export function createMetrics() {
  const routes = new Map() // "GET /orgs/:orgId/tasks" → { count, errors, durations[] }
  const errors = []
  const started = Date.now()

  const record = (key, ms, failed) => {
    const r = routes.get(key) ?? { count: 0, errors: 0, durations: [] }
    r.count++
    if (failed) r.errors++
    r.durations.push(ms)
    if (r.durations.length > 500) r.durations.shift()
    routes.set(key, r)
  }

  return {
    middleware(req, res, next) {
      req.id = req.get('x-request-id')?.slice(0, 64) || randomUUID()
      res.set('X-Request-Id', req.id)
      req.metrics = this
      const t0 = process.hrtime.bigint()
      res.on('finish', () => {
        const ms = Number(process.hrtime.bigint() - t0) / 1e6
        const route = req.route ? `${req.method} ${req.baseUrl}${req.route.path}` : `${req.method} (unmatched)`
        record(route.replace(/\/orgs\/[^/]+/, '/orgs/:orgId'), ms, res.statusCode >= 500)
      })
      next()
    },
    recordError(req, err) {
      errors.unshift({
        at: Date.now(),
        requestId: req.id,
        path: req.path,
        message: String(err?.message ?? err).slice(0, 300),
      })
      errors.length = Math.min(errors.length, 100)
    },
    snapshot() {
      const pct = (arr, p) => {
        if (!arr.length) return 0
        const s = [...arr].sort((a, b) => a - b)
        return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
      }
      return {
        uptimeSeconds: Math.round((Date.now() - started) / 1000),
        memoryMb: Math.round(process.memoryUsage().rss / 1048576),
        routes: [...routes.entries()]
          .map(([route, r]) => ({
            route,
            count: r.count,
            errors: r.errors,
            avgMs: +(r.durations.reduce((a, b) => a + b, 0) / r.durations.length).toFixed(1),
            p95Ms: +pct(r.durations, 95).toFixed(1),
          }))
          .sort((a, b) => b.count - a.count),
        recentErrors: errors.slice(0, 20),
      }
    },
  }
}
