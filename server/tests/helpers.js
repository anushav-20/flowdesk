import { newDb } from 'pg-mem'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { SCHEMA } from '../src/db/migrate.js'
import { createDb } from '../src/db/pool.js'
import { seed } from '../src/db/seed.js'
import { processDue } from '../src/services/worker.js'

/**
 * Spins up the real Express app against an in-memory PostgreSQL (pg-mem), seeded with demo data.
 * Every test file gets a fresh database. `fetch` is injectable so webhook delivery can be observed.
 */
export async function setup({ fetch } = {}) {
  const mem = newDb()
  mem.public.none(SCHEMA)
  const { Pool } = mem.adapters.createPg()
  const db = createDb(new Pool())
  const clock = { now: Date.parse('2026-11-20T09:00:00Z') }
  await seed(db, clock.now)
  const config = loadConfig({
    env: 'test',
    jwtSecret: 'test-secret-that-is-long-enough-1234567890',
    webhooks: { timeoutMs: 1000, allowPrivateHosts: true },
  })
  const { app, ctx } = createApp({ db, config, now: () => clock.now, fetch })
  const api = request(app)

  const login = async (email, password = 'demo1234') => {
    const res = await api.post('/api/auth/login').send({ email, password })
    if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`)
    return res.body
  }
  const as = async (email) => {
    const { accessToken } = await login(email)
    const auth = (r) => r.set('Authorization', `Bearer ${accessToken}`)
    return {
      get: (url) => auth(api.get(url)),
      post: (url, body) => auth(api.post(url)).send(body ?? {}),
      patch: (url, body) => auth(api.patch(url)).send(body ?? {}),
      put: (url, body) => auth(api.put(url)).send(body ?? {}),
      del: (url) => auth(api.delete(url)),
      token: accessToken,
    }
  }
  return { api, db, ctx, clock, login, as, runJobs: () => processDue(ctx) }
}

export const O = '/api/orgs/o_acme'
