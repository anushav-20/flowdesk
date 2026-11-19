import { createJob, JOB_PRIORITY, markFailed, markSucceeded } from '../../../shared/jobs.js'
import { id, toCamel } from '../lib/util.js'

/**
 * Postgres-backed job queue. Semantics (priority, backoff, dead-letter) come from shared/jobs.js.
 * Claiming uses an atomic conditional UPDATE, so multiple worker processes can share the
 * queue safely: only one UPDATE can flip a given job from 'queued' to 'running'.
 */
export function createQueue(db, now = () => Date.now()) {
  const row = (r) => (r ? toCamel(r) : null)
  const save = (t, j) =>
    t.query(
      `UPDATE jobs SET status=$2, attempts=$3, run_at=$4, last_error=$5, result=$6, started_at=$7, finished_at=$8 WHERE id=$1`,
      [
        j.id,
        j.status,
        j.attempts,
        j.runAt,
        j.lastError,
        j.result == null ? null : String(j.result).slice(0, 500),
        j.startedAt ?? null,
        j.finishedAt ?? null,
      ],
    )

  return {
    async enqueue(t, { orgId = null, type, payload = {}, priority = 'normal', runAt, maxAttempts = 4 }) {
      const j = createJob({ id: id('j'), orgId, type, payload, priority, runAt: runAt ?? now(), maxAttempts })
      await (t ?? db).query(
        'INSERT INTO jobs (id, org_id, type, payload, priority, status, attempts, max_attempts, run_at, created_at) VALUES ($1,$2,$3,$4,$5,$6,0,$7,$8,$9)',
        [
          j.id,
          orgId,
          type,
          JSON.stringify(payload),
          JOB_PRIORITY[priority] ?? 5,
          'queued',
          maxAttempts,
          j.runAt,
          now(),
        ],
      )
      return j
    },

    /** Claims the next due job (highest priority, oldest first). Returns null if none. */
    async claim() {
      const candidates = await db.query(
        "SELECT id FROM jobs WHERE status = 'queued' AND run_at <= $1 ORDER BY priority DESC, run_at ASC LIMIT 5",
        [now()],
      )
      for (const c of candidates) {
        const job = await db.one(
          "UPDATE jobs SET status = 'running', attempts = attempts + 1, started_at = $2 WHERE id = $1 AND status = 'queued' RETURNING *",
          [c.id, now()],
        )
        if (job) return row(job) // we won the race for this job
      }
      return null
    },

    async succeed(job, result) {
      await save(db, markSucceeded(job, result, now()))
    },

    /** claim() already counted this attempt; markFailed decides: retry with backoff, or dead-letter. */
    async fail(job, error) {
      const failed = markFailed(job, error, now())
      await save(db, failed)
      return failed
    },

    async retry(orgId, jobId) {
      return db.exec(
        "UPDATE jobs SET status = 'queued', attempts = 0, run_at = $3, last_error = NULL, finished_at = NULL WHERE id = $1 AND org_id = $2 AND status = 'dead'",
        [jobId, orgId, now()],
      )
    },
  }
}
