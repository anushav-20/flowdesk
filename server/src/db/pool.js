import pg from 'pg'

// BIGINT (epoch millis) comes back from pg as a string by default; parse it to a number
pg.types.setTypeParser(20, (v) => Number(v))

/**
 * Thin data-access helper around a pg Pool.
 *  - db.query(sql, params) → rows
 *  - db.one(sql, params)   → first row or null
 *  - db.tx(async (t) => …) → runs in a transaction (BEGIN/COMMIT, ROLLBACK on error)
 * All SQL is parameterised ($1, $2…) — never string-concatenated — so it's safe from SQL injection.
 */
export function createDb(pool) {
  const wrap = (client) => ({
    query: async (sql, params) => (await client.query(sql, params)).rows,
    one: async (sql, params) => (await client.query(sql, params)).rows[0] ?? null,
    exec: async (sql, params) => (await client.query(sql, params)).rowCount,
  })
  return {
    pool,
    ...wrap(pool),
    async tx(fn) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await fn(wrap(client))
        await client.query('COMMIT')
        return result
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {})
        throw err
      } finally {
        client.release()
      }
    },
  }
}

export function createPgPool(databaseUrl) {
  return new pg.Pool({ connectionString: databaseUrl, max: 10, idleTimeoutMillis: 30_000 })
}
