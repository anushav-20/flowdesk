import { createServer } from 'node:http'
import { createApp } from './app.js'
import { loadConfig } from './config.js'
import { migrate } from './db/migrate.js'
import { createDb, createPgPool } from './db/pool.js'
import { logger } from './lib/util.js'
import { attachRealtime } from './services/realtime.js'
import { startWorker } from './services/worker.js'

const config = loadConfig()

/**
 * DATABASE_URL=memory runs on an in-memory PostgreSQL (pg-mem) with demo data —
 * handy for trying the API without installing Postgres. Data resets on restart.
 */
async function createPool() {
  if (config.databaseUrl !== 'memory') {
    const pool = createPgPool(config.databaseUrl)
    await migrate(pool)
    // SEED_DEMO=true → add the demo workspace on start-up (skipped if it already exists)
    if (process.env.SEED_DEMO === 'true') {
      const { seed } = await import('./db/seed.js')
      await seed(createDb(pool))
      logger.info('demo_data_ready', { login: 'priya@acme.test / demo1234' })
    }
    return pool
  }
  const { newDb } = await import('pg-mem')
  const { SCHEMA } = await import('./db/migrate.js')
  const { seed } = await import('./db/seed.js')
  const mem = newDb()
  mem.public.none(SCHEMA)
  const { Pool } = mem.adapters.createPg()
  const pool = new Pool()
  await seed(createDb(pool))
  logger.warn('using_in_memory_database', { note: 'Data is lost on restart. Demo login: priya@acme.test / demo1234' })
  return pool
}

const pool = await createPool()

const { app, ctx } = createApp({ db: createDb(pool), config })
const server = createServer(app)
const wss = attachRealtime(server, ctx)
const stopWorker = config.worker.enabled ? startWorker(ctx) : () => {}

server.listen(config.port, () => logger.info('server_started', { port: config.port, env: config.env }))

/** Graceful shutdown: stop accepting work, finish in-flight requests, close the pool. */
async function shutdown(signal) {
  logger.info('shutting_down', { signal })
  stopWorker()
  wss.close()
  server.close(async () => {
    await pool.end()
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 10_000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
