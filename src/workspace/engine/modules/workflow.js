import { transition, ApprovalError } from '@shared/approval.js'
import { ACTIONS, evaluateRules, leastLoaded, TRIGGERS } from '@shared/automation.js'
import {
  createGitHubClient,
  DEFAULT_GITHUB_RULES,
  interpretGitHubEvent,
  parseRepo,
  planGitHubSync,
  slackMessage,
  validateSlackUrl,
  validateWebhookUrl,
  webhookPayload,
  WEBHOOK_EVENTS,
} from '@shared/integrations.js'
import { createJob } from '@shared/jobs.js'
import { ApiError, cleanText, notify, uid } from '../core'
import { award } from './tasks'

/** Approvals, automation rules (+ executor), webhooks, Slack and GitHub integrations. */
export function workflowModule(ctx, tasksApi) {
  const { db } = ctx

  /**
   * Posts to a Slack incoming webhook from the browser. Slack doesn't send CORS headers, so this is a
   * "simple" form POST (payload=<json>), which Slack accepts; the response can't be read, so delivery is
   * reported as "sent". The Node backend posts JSON and checks the response.
   */
  async function postToSlack(url, message) {
    try {
      await (ctx.fetch ?? globalThis.fetch)(url, {
        method: 'POST',
        mode: 'no-cors',
        body: new URLSearchParams({ payload: JSON.stringify(message) }),
      })
    } catch {
      throw new ApiError('integration', 'Could not reach Slack. Check the webhook URL and your connection.', 422)
    }
  }
  ctx.postToSlack = postToSlack

  /** Real GitHub sync: fetch PRs + commits, plan links/status changes (shared logic), apply as "GitHub". */
  async function syncGitHubOrg(orgId) {
    const gh = db.getState().orgs[orgId]?.integrations?.github
    if (!gh?.connected || !gh.verified) throw new ApiError('integration', 'Connect a GitHub repository first.', 422)
    const client = createGitHubClient({ fetchImpl: ctx.fetch })
    let pulls, commits
    try {
      ;[pulls, commits] = await Promise.all([client.pulls(gh.repo), client.commits(gh.repo)])
    } catch (err) {
      db.transact((tx) => {
        const org = tx.state.orgs[orgId]
        tx.patch('orgs', orgId, {
          integrations: {
            ...org.integrations,
            github: { ...org.integrations.github, lastSync: { at: ctx.now(), ok: false, error: err.message } },
          },
        })
      })
      throw new ApiError('integration', err.message, 422)
    }
    const tasks = Object.values(db.getState().tasks).filter((t) => t.orgId === orgId)
    const plans = planGitHubSync({ pulls, commits, tasks, rules: gh.rules ?? DEFAULT_GITHUB_RULES })
    const results = []
    ctx.systemMutate(
      orgId,
      (tx, sys) => {
        for (const p of plans) {
          const task = tx.state.tasks[p.taskId]
          const changes = { links: p.links, ...(p.status && { status: p.status }) }
          try {
            tasksApi._applyTaskChange(tx, sys, task, changes)
            results.push(`${p.key}: ${p.notes.join(', ')}${p.status ? ` → moved to ${p.status}` : ''}`)
          } catch (err) {
            tasksApi._applyTaskChange(tx, sys, task, { links: p.links })
            results.push(`${p.key}: ${p.notes.join(', ')} (not moved: ${err.message})`)
          }
        }
        const org = tx.state.orgs[orgId]
        tx.patch('orgs', orgId, {
          integrations: {
            ...org.integrations,
            github: {
              ...org.integrations.github,
              lastSync: {
                at: ctx.now(),
                ok: true,
                pulls: pulls.length,
                commits: commits.length,
                updated: plans.length,
                results: results.slice(0, 10),
              },
            },
          },
        })
      },
      { label: 'GitHub' },
    )
    return { pulls: pulls.length, commits: commits.length, updated: plans.length, results }
  }
  ctx.syncGitHubOrg = syncGitHubOrg

  // ================================================================ automation executor
  /** Runs after every committed event: evaluate rules, then perform their actions as the system. */
  function runAutomations(event) {
    const state = db.getState()
    const rules = Object.values(state.rules).filter((r) => r.orgId === event.orgId)
    const matches = evaluateRules(event, rules)
    for (const { ruleId, actions } of matches) {
      const rule = state.rules[ruleId]
      const executed = []
      let status = 'success'
      let error = null
      try {
        ctx.systemMutate(
          event.orgId,
          (tx, sys) => {
            for (const action of actions) executed.push(executeAction(tx, sys, action, event, rule))
            tx.patch('rules', ruleId, { runs: (rule.runs ?? 0) + 1, lastRunAt: ctx.now() })
          },
          { depth: (event.depth ?? 0) + 1, label: `Automation: ${rule.name}` },
        )
      } catch (err) {
        status = 'failed'
        error = err.message
      }
      db.transact((tx) =>
        tx.log('ruleRuns', {
          id: uid('rr'),
          orgId: event.orgId,
          ruleId,
          ruleName: rule.name,
          eventType: event.type,
          subject: event.subject.key ?? event.subject.name ?? event.subject.id,
          actions: executed,
          status,
          error,
          at: ctx.now(),
        }),
      )
    }
  }

  function executeAction(tx, sys, action, event, rule) {
    const p = action.params ?? {}
    const state = tx.state
    const task = event.subject?.key ? tx.state.tasks[event.subject.id] : null
    const memberIds = Object.values(state.memberships)
      .filter((m) => m.orgId === event.orgId && m.role !== 'viewer')
      .map((m) => m.userId)
    const admins = Object.values(state.memberships)
      .filter((m) => m.orgId === event.orgId && ['owner', 'admin'].includes(m.role))
      .map((m) => m.userId)

    switch (action.type) {
      case 'assign': {
        if (!task) return 'skipped (no task)'
        const orgTasks = Object.values(state.tasks).filter((t) => t.orgId === event.orgId)
        const userId = p.userId === 'least_loaded' ? leastLoaded(memberIds, orgTasks) : p.userId
        if (!userId || !memberIds.includes(userId)) return 'skipped (no valid assignee)'
        tasksApi._applyTaskChange(tx, sys, tx.state.tasks[task.id], { assigneeId: userId })
        return `assigned ${task.key} to ${state.users[userId].name}`
      }
      case 'set_priority':
        if (!task) return 'skipped'
        tasksApi._applyTaskChange(tx, sys, tx.state.tasks[task.id], { priority: p.priority })
        return `set ${task.key} priority to ${p.priority}`
      case 'set_status':
        if (!task) return 'skipped'
        tasksApi._applyTaskChange(tx, sys, tx.state.tasks[task.id], { status: p.status })
        return `moved ${task.key} to ${p.status}`
      case 'notify': {
        const targets = p.target === 'assignee' ? [task?.assigneeId] : p.target === 'admins' ? admins : [p.target]
        const what = task ? `${task.key} ${task.title}` : (event.subject.name ?? 'Project')
        const message = `⚡ ${what} ${p.message ?? `— ${TRIGGERS[event.type]}`}`
        for (const userId of targets.filter(Boolean))
          notify(tx, {
            orgId: event.orgId,
            userId,
            type: 'automation',
            message,
            link: task ? { taskId: task.id } : null,
            now: ctx.now(),
          })
        return `notified ${targets.filter(Boolean).length} people`
      }
      case 'add_comment':
        if (!task) return 'skipped'
        tx.put('comments', {
          id: uid('c'),
          orgId: event.orgId,
          taskId: task.id,
          authorId: 'system',
          body: cleanText(p.text ?? 'Automated comment', { max: 500 }),
          mentions: [],
          attachments: [],
          createdAt: ctx.now(),
        })
        return `commented on ${task.key}`
      case 'complete_parent': {
        // For subtasks.completed the subject *is* the parent
        const parent = tx.state.tasks[event.subject.id]
        if (!parent || parent.status === 'done') return 'skipped'
        tasksApi._applyTaskChange(tx, sys, parent, { status: 'done' })
        return `completed parent ${parent.key}`
      }
      default:
        throw new Error(`Unknown action ${action.type} in rule ${rule.name}`)
    }
  }

  // ================================================================ webhooks (outgoing)
  const EVENT_TO_WEBHOOK = {
    'task.created': 'task.created',
    'task.updated': 'task.updated',
    'task.completed': 'task.completed',
    'task.deleted': 'task.deleted',
    'comment.created': 'comment.created',
    'approval.decided': 'approval.decided',
    'project.completed': 'project.completed',
  }

  function enqueueWebhooks(event) {
    const hookEvent = EVENT_TO_WEBHOOK[event.type]
    if (!hookEvent) return
    const state = db.getState()
    const hooks = Object.values(state.webhooks).filter(
      (w) => w.orgId === event.orgId && w.active && w.events.includes(hookEvent),
    )
    const slack = state.orgs[event.orgId]?.integrations?.slack
    const subject = event.subject
    const data = subject.key
      ? {
          task: {
            id: subject.id,
            key: subject.key,
            title: subject.title,
            status: subject.status,
            priority: subject.priority,
          },
        }
      : { subject: { id: subject.id, name: subject.name } }
    if (
      !hooks.length &&
      !(slack?.connected && ['task.completed', 'approval.decided', 'project.completed'].includes(hookEvent))
    )
      return
    db.transact((tx) => {
      for (const w of hooks) {
        const payload = webhookPayload(hookEvent, data, { orgId: event.orgId, id: uid('evt'), at: ctx.now() })
        tx.put(
          'jobs',
          createJob({
            id: uid('j'),
            orgId: event.orgId,
            type: 'webhook.deliver',
            payload: { webhookId: w.id, event: hookEvent, body: payload },
            priority: 'normal',
            runAt: ctx.now(),
          }),
        )
      }
      if (slack?.connected && ['task.completed', 'approval.decided', 'project.completed'].includes(hookEvent)) {
        tx.put(
          'jobs',
          createJob({
            id: uid('j'),
            orgId: event.orgId,
            type: 'webhook.deliver',
            payload: { slack: true, event: hookEvent, body: slackMessage(hookEvent, data) },
            priority: 'low',
            runAt: ctx.now(),
          }),
        )
      }
    })
  }

  ctx.eventHandlers.push(runAutomations, enqueueWebhooks)

  // ================================================================ public API
  return {
    // ------------------------------------------------------------ approvals
    async approvalAction(taskId, type, reason) {
      return ctx.mutate(type === 'submit' || type === 'resubmit' ? 'task.update' : 'task.read', (tx, a) => {
        const task = ctx.inOrg('tasks', taskId, a.orgId)
        const org = tx.state.orgs[a.orgId]
        let approval
        try {
          approval = transition(
            task.approval,
            { type, actorId: a.user.id, reason, at: ctx.now() },
            { chain: org.approvalChain, isOwner: a.role === 'owner' },
          )
        } catch (err) {
          if (err instanceof ApprovalError) throw new ApiError('approval', err.message, 409)
          throw err
        }
        const changes = { approval }
        if (type === 'submit' || type === 'resubmit') changes.status = 'review'
        if (approval.status === 'approved') {
          changes.status = 'done'
          changes._approved = true
        }
        if (approval.status === 'rejected') changes.status = 'progress'
        const next = tasksApi._applyTaskChange(tx, a, task, changes)

        const step = org.approvalChain[approval.step]
        if (approval.status === 'pending' && step?.approverId)
          notify(tx, {
            orgId: a.orgId,
            userId: step.approverId,
            type: 'approval',
            message: `${task.key} ${task.title} is waiting for your ${step.name}`,
            link: { taskId },
            now: ctx.now(),
          })
        if (type === 'reject' && task.assigneeId)
          notify(tx, {
            orgId: a.orgId,
            userId: task.assigneeId,
            type: 'approval',
            message: `${a.user.name} rejected ${task.key}: “${reason}”`,
            link: { taskId },
            now: ctx.now(),
          })
        if (approval.status === 'approved' && task.assigneeId)
          notify(tx, {
            orgId: a.orgId,
            userId: task.assigneeId,
            type: 'approval',
            message: `✅ ${task.key} was fully approved`,
            link: { taskId },
            now: ctx.now(),
          })
        if (type === 'approve') award(tx, { orgId: a.orgId, userId: a.user.id, now: ctx.now() }, { type: 'approval' })
        if (type === 'approve' || type === 'reject') a.emit('approval.decided', { ...next, decision: type })
        if (type === 'submit') a.emit('approval.requested', next)
        return next
      })
    },

    async updateApprovalChain(steps) {
      return ctx.mutate('settings.manage', (tx, a) => {
        if (!Array.isArray(steps) || steps.length === 0 || steps.length > 6)
          throw new ApiError('validation', 'Use 1–6 approval steps.', 422)
        const clean = steps.map((s, i) => {
          if (s.approverId && !tx.state.memberships[`${a.orgId}:${s.approverId}`])
            throw new ApiError('validation', 'Approvers must be members.', 422)
          return {
            id: s.id || `step${i}`,
            name: cleanText(s.name, { max: 60, required: true, field: 'Step name' }),
            approverId: s.approverId || null,
          }
        })
        const before = tx.state.orgs[a.orgId].approvalChain
        tx.patch('orgs', a.orgId, { approvalChain: clean })
        a.audit(tx, {
          action: 'settings.approval_chain',
          entityType: 'org',
          entityId: a.orgId,
          before,
          after: clean,
          summary: `Updated the approval workflow (${clean.map((s) => s.name).join(' → ')})`,
        })
      })
    },

    // ------------------------------------------------------------ automation rules
    async saveRule(rule) {
      return ctx.mutate('automation.manage', (tx, a) => {
        if (!TRIGGERS[rule.trigger?.type]) throw new ApiError('validation', 'Choose a trigger.', 422)
        if (!rule.actions?.length) throw new ApiError('validation', 'Add at least one action.', 422)
        for (const act of rule.actions) if (!ACTIONS[act.type]) throw new ApiError('validation', 'Unknown action.', 422)
        const existing = rule.id ? ctx.inOrg('rules', rule.id, a.orgId) : null
        const saved = tx.put('rules', {
          id: existing?.id ?? uid('r'),
          orgId: a.orgId,
          name: cleanText(rule.name, { max: 80, required: true, field: 'Rule name' }),
          enabled: rule.enabled !== false,
          trigger: {
            type: rule.trigger.type,
            ...(rule.trigger.type === 'project.progress' && {
              threshold: Math.max(1, Math.min(100, Number(rule.trigger.threshold) || 80)),
            }),
          },
          conditions: (rule.conditions ?? []).slice(0, 5),
          actions: rule.actions.slice(0, 5),
          runs: existing?.runs ?? 0,
          lastRunAt: existing?.lastRunAt ?? null,
        })
        a.audit(tx, {
          action: existing ? 'automation.updated' : 'automation.created',
          entityType: 'rule',
          entityId: saved.id,
          before: existing,
          after: saved,
          summary: `${existing ? 'Updated' : 'Created'} automation “${saved.name}”`,
        })
        return saved
      })
    },

    async toggleRule(id, enabled) {
      return ctx.mutate('automation.manage', (tx, a) => {
        const r = ctx.inOrg('rules', id, a.orgId)
        tx.patch('rules', id, { enabled })
        a.audit(tx, {
          action: 'automation.toggled',
          entityType: 'rule',
          entityId: id,
          before: { enabled: r.enabled },
          after: { enabled },
          summary: `${enabled ? 'Enabled' : 'Paused'} automation “${r.name}”`,
        })
      })
    },

    async deleteRule(id) {
      return ctx.mutate('automation.manage', (tx, a) => {
        const r = ctx.inOrg('rules', id, a.orgId)
        tx.remove('rules', id)
        a.audit(tx, {
          action: 'automation.deleted',
          entityType: 'rule',
          entityId: id,
          before: r,
          summary: `Deleted automation “${r.name}”`,
        })
      })
    },

    // ------------------------------------------------------------ webhooks
    async saveWebhook({ id, url, events, active = true }) {
      const err = validateWebhookUrl(url)
      if (err) throw new ApiError('validation', err, 422)
      const evts = (events ?? []).filter((e) => WEBHOOK_EVENTS[e])
      if (!evts.length) throw new ApiError('validation', 'Choose at least one event.', 422)
      return ctx.mutate('webhook.manage', (tx, a) => {
        const existing = id ? ctx.inOrg('webhooks', id, a.orgId) : null
        const secret =
          existing?.secret ??
          `whsec_${[...globalThis.crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('')}`
        const w = tx.put('webhooks', {
          id: existing?.id ?? uid('w'),
          orgId: a.orgId,
          url,
          events: evts,
          secret,
          active,
          createdAt: existing?.createdAt ?? ctx.now(),
        })
        a.audit(tx, {
          action: existing ? 'webhook.updated' : 'webhook.created',
          entityType: 'webhook',
          entityId: w.id,
          after: { url, events: evts },
          summary: `${existing ? 'Updated' : 'Added'} webhook ${new URL(url).host}`,
        })
        return w
      })
    },

    async deleteWebhook(id) {
      return ctx.mutate('webhook.manage', (tx, a) => {
        const w = ctx.inOrg('webhooks', id, a.orgId)
        tx.remove('webhooks', id)
        a.audit(tx, {
          action: 'webhook.deleted',
          entityType: 'webhook',
          entityId: id,
          before: { url: w.url },
          summary: `Removed webhook ${new URL(w.url).host}`,
        })
      })
    },

    async testWebhook(id) {
      return ctx.mutate('webhook.manage', (tx, a) => {
        const w = ctx.inOrg('webhooks', id, a.orgId)
        tx.put(
          'jobs',
          createJob({
            id: uid('j'),
            orgId: a.orgId,
            type: 'webhook.deliver',
            payload: {
              webhookId: w.id,
              event: 'ping',
              body: webhookPayload('ping', { message: 'Hello from FlowDesk' }, { orgId: a.orgId, id: uid('evt') }),
            },
            priority: 'high',
            runAt: ctx.now(),
          }),
        )
      })
    },

    // ------------------------------------------------------------ integrations
    /**
     * Connecting talks to the real service first:
     *  - GitHub: the repository is looked up on api.github.com (public repos; no token in the browser demo)
     *  - Slack: a test message is posted to the incoming webhook
     */
    async updateIntegration(name, input) {
      ctx.authorize('settings.manage')
      let settings = { ...input }
      if (name === 'github' && settings.connected) {
        const repo = parseRepo(settings.repo)
        if (!repo) throw new ApiError('validation', 'Enter a repository like owner/name or its GitHub URL.', 422)
        let info
        try {
          info = await createGitHubClient({ fetchImpl: ctx.fetch }).repo(repo)
        } catch (err) {
          throw new ApiError('integration', err.message, 422)
        }
        const current = db.getState().orgs[ctx.session.get().orgId]?.integrations?.github ?? {}
        settings = {
          connected: true,
          verified: true,
          repo: info.fullName,
          repoInfo: info,
          rules: current.rules ?? DEFAULT_GITHUB_RULES,
          connectedAt: ctx.now(),
          lastSync: null,
        }
      }
      if (name === 'github' && input.rules) settings = { rules: { ...DEFAULT_GITHUB_RULES, ...input.rules } }
      if (name === 'slack' && settings.connected) {
        const err = validateSlackUrl(settings.webhookUrl ?? '')
        if (err) throw new ApiError('validation', err, 422)
        await postToSlack(settings.webhookUrl, {
          text: '✅ FlowDesk is now connected to this channel. You will get updates when tasks are completed and approvals are decided.',
        })
        settings.connectedAt = ctx.now()
      }
      const result = await ctx.mutate('settings.manage', (tx, a) => {
        const org = tx.state.orgs[a.orgId]
        const next = { ...org.integrations, [name]: { ...org.integrations[name], ...settings } }
        tx.patch('orgs', a.orgId, { integrations: next })
        a.audit(tx, {
          action: 'integration.updated',
          entityType: 'integration',
          entityId: name,
          after: { ...settings, repoInfo: undefined, webhookUrl: settings.webhookUrl ? '••••' : undefined },
          summary: `${settings.connected ? 'Connected' : settings.connected === false ? 'Disconnected' : 'Updated'} ${name}`,
        })
      })
      if (name === 'github' && settings.connected) await syncGitHubOrg(ctx.session.get().orgId).catch(() => {})
      return result
    },

    /** Pulls PRs and commits from the GitHub API and links them to tasks (also runs every 10 minutes). */
    async syncGitHub() {
      const { orgId } = ctx.authorize('task.update')
      return syncGitHubOrg(orgId)
    },

    /**
     * Processes a GitHub webhook payload (in the browser demo this is triggered by a "Simulate" button;
     * on the server it's the signed POST /integrations/github/webhook endpoint).
     */
    async handleGitHubEvent(eventName, payload) {
      const { orgId } = ctx.authorize('settings.manage')
      const actions = interpretGitHubEvent(eventName, payload)
      const results = []
      ctx.systemMutate(
        orgId,
        (tx, sys) => {
          for (const act of actions) {
            const task = Object.values(tx.state.tasks).find((t) => t.orgId === orgId && t.key === act.key)
            if (!task) {
              results.push(`${act.key}: no matching task`)
              continue
            }
            const links = task.links.some((l) => l.url === act.link.url) ? task.links : [...task.links, act.link]
            const changes = { links }
            if (
              act.status &&
              task.status !== act.status &&
              !(act.status === 'done' && task.approval?.status === 'pending')
            )
              changes.status = act.status
            try {
              tasksApi._applyTaskChange(tx, sys, task, changes)
              results.push(`${act.key}: linked ${act.link.type}${changes.status ? `, moved to ${changes.status}` : ''}`)
            } catch (err) {
              tasksApi._applyTaskChange(tx, sys, task, { links })
              results.push(`${act.key}: linked (${err.message})`)
            }
          }
        },
        { label: 'GitHub' },
      )
      return results
    },
  }
}
