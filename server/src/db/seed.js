import bcrypt from 'bcryptjs'
import { fileURLToPath } from 'node:url'
import { loadConfig } from '../config.js'
import { logger, randomToken } from '../lib/util.js'
import { migrate } from './migrate.js'
import { createDb, createPgPool } from './pool.js'

const DAY = 86_400_000
const iso = (now, d) => new Date(now + d * DAY).toISOString().slice(0, 10)

/** Demo data: one workspace, five people (one per role), two projects, tasks with dependencies. Password: demo1234 */
export async function seed(db, now = Date.now()) {
  const hash = await bcrypt.hash('demo1234', 10)
  const users = [
    ['u_priya', 'priya@acme.test', 'Priya Raman', 'Engineering Lead', '#6d5dfc', 'owner'],
    ['u_daniel', 'daniel@acme.test', 'Daniel Brooks', 'QA Engineer', '#0ea5e9', 'admin'],
    ['u_meera', 'meera@acme.test', 'Meera Joshi', 'Product Manager', '#f59e0b', 'admin'],
    ['u_ravi', 'ravi@acme.test', 'Ravi Kumar', 'Frontend Developer', '#12a37a', 'member'],
    ['u_sara', 'sara@acme.test', 'Sara Lee', 'Stakeholder', '#ec4899', 'viewer'],
  ]
  await db.tx(async (t) => {
    if (await t.one('SELECT 1 FROM orgs WHERE id = $1', ['o_acme'])) return
    for (const [id, email, name, title, color] of users)
      await t.query(
        'INSERT INTO users (id, email, name, title, color, password_hash, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [id, email, name, title, color, hash, now],
      )
    await t.query(
      'INSERT INTO orgs (id, name, slug, key_prefix, task_seq, approval_chain, integrations, github_secret, calendar_token, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [
        'o_acme',
        'Acme Labs',
        'acme',
        'FD',
        6,
        JSON.stringify([
          { id: 'lead', name: 'Team lead review', approverId: 'u_priya' },
          { id: 'qa', name: 'QA approval', approverId: 'u_daniel' },
          { id: 'pm', name: 'Final approval (PM)', approverId: 'u_meera' },
        ]),
        JSON.stringify({
          github: { connected: false },
          slack: { connected: false },
          email: { weeklyReport: true },
        }),
        randomToken(24),
        randomToken(24),
        now,
      ],
    )
    for (const [id, , , , , role] of users)
      await t.query('INSERT INTO memberships (org_id, user_id, role, joined_at) VALUES ($1,$2,$3,$4)', [
        'o_acme',
        id,
        role,
        now,
      ])
    await t.query(
      'INSERT INTO projects (id, org_id, name, description, deadline, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
      ['p_web', 'o_acme', 'Website relaunch', 'New marketing site and checkout.', iso(now, 12), now],
    )
    const tasks = [
      ['t_1', 'FD-1', 'Create product API', 'done', 'high', 'u_priya', null, 12, []],
      ['t_2', 'FD-2', 'Build shopping cart', 'progress', 'high', 'u_ravi', iso(now, 4), 12, ['t_1']],
      ['t_3', 'FD-3', 'Checkout page', 'todo', 'medium', 'u_ravi', iso(now, 7), 10, ['t_2']],
      ['t_4', 'FD-4', 'Test checkout end to end', 'todo', 'high', 'u_daniel', iso(now, 9), 6, ['t_3']],
      ['t_5', 'FD-5', 'Deploy to production', 'todo', 'high', 'u_priya', iso(now, 11), 3, ['t_4']],
      ['t_6', 'FD-6', 'Fix navbar overlap on Safari', 'todo', 'medium', 'u_ravi', iso(now, -2), 2, []],
    ]
    for (const [id, key, title, status, priority, assignee, due, est, deps] of tasks)
      await t.query(
        'INSERT INTO tasks (id, org_id, project_id, key, title, status, priority, assignee_id, due_date, estimate, blocked_by, created_by, created_at, updated_at, completed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',
        [
          id,
          'o_acme',
          'p_web',
          key,
          title,
          status,
          priority,
          assignee,
          due,
          est,
          JSON.stringify(deps),
          'u_priya',
          now - 5 * DAY,
          now,
          status === 'done' ? now - DAY : null,
        ],
      )
    await t.query(
      'INSERT INTO automation_rules (id, org_id, name, trigger, conditions, actions) VALUES ($1,$2,$3,$4,$5,$6)',
      [
        'r_1',
        'o_acme',
        'Auto-assign new tasks',
        JSON.stringify({ type: 'task.created' }),
        JSON.stringify([{ field: 'assigneeId', op: 'is_empty' }]),
        JSON.stringify([{ type: 'assign', params: { userId: 'least_loaded' } }]),
      ],
    )
    await t.query(
      'INSERT INTO automation_rules (id, org_id, name, trigger, conditions, actions) VALUES ($1,$2,$3,$4,$5,$6)',
      [
        'r_2',
        'o_acme',
        'Overdue reminder',
        JSON.stringify({ type: 'task.overdue' }),
        '[]',
        JSON.stringify([{ type: 'notify', params: { target: 'assignee', message: 'is overdue' } }]),
      ],
    )
    await t.query(
      'INSERT INTO docs (id, org_id, project_id, title, content, version, updated_by, updated_at) VALUES ($1,$2,$3,$4,$5,1,$6,$7)',
      ['d_1', 'o_acme', 'p_web', 'Project brief', '# Goals\nIncrease sign-ups by 25%.', 'u_meera', now],
    )
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pool = createPgPool(loadConfig().databaseUrl)
  await migrate(pool)
  await seed(createDb(pool))
  logger.info('seed_complete', { login: 'priya@acme.test / demo1234' })
  await pool.end()
}
