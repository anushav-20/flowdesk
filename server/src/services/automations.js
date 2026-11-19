import { evaluateRules, leastLoaded, TRIGGERS } from '../../../shared/automation.js'
import { logger, id, toCamel } from '../lib/util.js'
import { applyChange, orgTasks } from './tasks.js'
import { systemActor, withWrite } from './write.js'

/**
 * Automation engine (server side). Subscribes to committed domain events, evaluates the
 * org's rules with the shared engine, and executes actions as the system actor at depth+1
 * (MAX_DEPTH in the shared engine stops infinite rule loops). Every run is recorded.
 */
export function registerAutomations(ctx) {
  ctx.bus.on(async (event) => {
    const rules = (
      await ctx.db.query('SELECT * FROM automation_rules WHERE org_id = $1 AND enabled = true', [event.orgId])
    ).map(toCamel)
    for (const { ruleId, actions } of evaluateRules(event, rules)) {
      const rule = rules.find((r) => r.id === ruleId)
      const executed = []
      let status = 'success'
      let error = null
      try {
        await withWrite(
          ctx,
          systemActor(event.orgId, `Automation: ${rule.name}`),
          async (w) => {
            for (const action of actions) executed.push(await execute(w, action, event))
            await w.t.query('UPDATE automation_rules SET runs = runs + 1, last_run_at = $2 WHERE id = $1', [
              rule.id,
              w.now,
            ])
          },
          { depth: (event.depth ?? 0) + 1, label: `Automation: ${rule.name}` },
        )
      } catch (err) {
        status = 'failed'
        error = err.message
        logger.warn('automation_failed', { ruleId, message: err.message })
      }
      await ctx.db.query(
        'INSERT INTO automation_runs (id, org_id, rule_id, rule_name, event_type, subject, actions, status, error, at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [
          id('rr'),
          event.orgId,
          rule.id,
          rule.name,
          event.type,
          event.subject.key ?? event.subject.name ?? event.subject.id,
          JSON.stringify(executed),
          status,
          error,
          ctx.now(),
        ],
      )
    }
  })
}

async function execute(w, action, event) {
  const { t, actor } = w
  const p = action.params ?? {}
  const task = event.subject?.key
    ? await t.one('SELECT * FROM tasks WHERE org_id=$1 AND id=$2', [actor.orgId, event.subject.id])
    : null
  const current = task ? toCamel(task) : null
  const members = await t.query("SELECT user_id, role FROM memberships WHERE org_id = $1 AND role <> 'viewer'", [
    actor.orgId,
  ])
  const admins = members.filter((m) => ['owner', 'admin'].includes(m.role)).map((m) => m.user_id)

  switch (action.type) {
    case 'assign': {
      if (!current) return 'skipped'
      const userId =
        p.userId === 'least_loaded'
          ? leastLoaded(
              members.map((m) => m.user_id),
              await orgTasks(t, actor.orgId),
            )
          : p.userId
      if (!userId) return 'skipped (no assignee)'
      await applyChange(w, current, { assigneeId: userId })
      return `assigned ${current.key}`
    }
    case 'set_priority':
      if (!current) return 'skipped'
      await applyChange(w, current, { priority: p.priority })
      return `set ${current.key} priority to ${p.priority}`
    case 'set_status':
      if (!current) return 'skipped'
      await applyChange(w, current, { status: p.status })
      return `moved ${current.key} to ${p.status}`
    case 'notify': {
      const targets = p.target === 'assignee' ? [current?.assigneeId] : p.target === 'admins' ? admins : [p.target]
      const what = current ? `${current.key} ${current.title}` : (event.subject.name ?? 'Project')
      for (const userId of targets.filter(Boolean))
        await w.notify({
          userId,
          type: 'automation',
          message: `⚡ ${what} ${p.message ?? `— ${TRIGGERS[event.type]}`}`,
          link: current ? { taskId: current.id } : null,
        })
      return `notified ${targets.filter(Boolean).length}`
    }
    case 'add_comment':
      if (!current) return 'skipped'
      await t.query(
        'INSERT INTO comments (id, org_id, task_id, author_id, body, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
        [id('c'), actor.orgId, current.id, 'system', String(p.text ?? 'Automated comment').slice(0, 500), w.now],
      )
      return `commented on ${current.key}`
    case 'complete_parent': {
      const parent = toCamel(
        await t.one('SELECT * FROM tasks WHERE org_id=$1 AND id=$2', [actor.orgId, event.subject.id]),
      )
      if (!parent || parent.status === 'done') return 'skipped'
      await applyChange(w, parent, { status: 'done' })
      return `completed ${parent.key}`
    }
    default:
      throw new Error(`Unknown action ${action.type}`)
  }
}
