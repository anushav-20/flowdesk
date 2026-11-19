import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadConfig } from '../config.js'
import { logger } from '../lib/util.js'
import { createPgPool } from './pool.js'

export const SCHEMA = readFileSync(fileURLToPath(new URL('./schema.sql', import.meta.url)), 'utf8')

/** Idempotent: every statement uses IF NOT EXISTS, so it's safe to run on every deploy. */
export async function migrate(pool) {
  await pool.query(SCHEMA)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pool = createPgPool(loadConfig().databaseUrl)
  await migrate(pool)
  logger.info('migrations_applied')
  await pool.end()
}
