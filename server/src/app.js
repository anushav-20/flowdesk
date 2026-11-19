import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { errorHandler, HttpError } from './lib/errors.js'
import { logger, safeEqual } from './lib/util.js'
import { requireAuth, requireMembership } from './middleware/auth.js'
import { createMetrics } from './middleware/observability.js'
import { authRoutes } from './routes/auth.js'
import { myOrgRoutes, orgRoutes } from './routes/orgs.js'
import { publicRoutes } from './routes/public.js'
import { taskRoutes } from './routes/tasks.js'
import { workspaceRoutes } from './routes/workspace.js'
import { registerAutomations } from './services/automations.js'
import { createQueue } from './services/queue.js'
import { registerWebhooks } from './services/webhooks.js'

/** Simple async event bus: handlers run after a transaction commits; one failing handler never breaks the request. */
export function createBus() {
  const handlers = []
  return {
    on: (h) => handlers.push(h),
    async dispatch(event) {
      for (const h of handlers) {
        try {
          await h(event)
        } catch (err) {
          logger.error('event_handler_failed', { event: event.type, message: err.message })
        }
      }
    },
  }
}

/**
 * Builds the Express app. All dependencies are injected (database, clock, fetch),
 * so tests run the real app against an in-memory Postgres.
 */
export function createApp({ db, config, now = () => Date.now(), fetch: fetchImpl }) {
  const metrics = createMetrics()
  const ctx = { db, config, now, bus: createBus(), metrics, fetch: fetchImpl }
  ctx.queue = createQueue(db, now)
  registerAutomations(ctx)
  registerWebhooks(ctx)

  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 1)
  app.use(metrics.middleware.bind(metrics))
  app.use(helmet())
  app.use(cors({ origin: config.corsOrigins, credentials: false, maxAge: 600 }))

  // Public integration endpoints need the raw body, so they're mounted before express.json()
  app.use('/api', publicRoutes(ctx))
  app.use(express.json({ limit: '2mb' }))
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: config.env === 'test' ? 10_000 : 300,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
  )

  app.get('/api/health', async (_req, res) => {
    const t0 = Date.now()
    try {
      await db.query('SELECT 1')
      res.json({
        status: 'ok',
        database: 'ok',
        dbLatencyMs: Date.now() - t0,
        uptimeSeconds: metrics.snapshot().uptimeSeconds,
      })
    } catch {
      res.status(503).json({ status: 'degraded', database: 'unreachable' })
    }
  })
  app.get('/api/metrics', (req, res) => {
    if (!config.metricsToken || !safeEqual(req.get('authorization') ?? '', `Bearer ${config.metricsToken}`))
      throw new HttpError(401, 'unauthorized', 'Metrics token required.')
    res.json(metrics.snapshot())
  })
  const openapi = readFileSync(fileURLToPath(new URL('../openapi.yaml', import.meta.url)), 'utf8')
  app.get('/api/openapi.yaml', (_req, res) => res.type('text/yaml').send(openapi))

  app.use('/api/auth', authRoutes(ctx))
  app.use('/api/orgs', requireAuth(ctx), myOrgRoutes(ctx))
  const scoped = express.Router({ mergeParams: true })
  scoped.use(requireAuth(ctx), requireMembership(ctx))
  scoped.use('/', orgRoutes(ctx))
  scoped.use('/tasks', taskRoutes(ctx))
  scoped.use('/', workspaceRoutes(ctx))
  app.use('/api/orgs/:orgId', scoped)

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'not_found', 'Endpoint not found.')))
  app.use(errorHandler)

  return { app, ctx }
}
