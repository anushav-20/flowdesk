import { Router } from 'express'
import { z } from 'zod'
import { fieldIdFromName, validateFieldDef } from '../../../shared/customFields.js'
import { DEFAULT_GITHUB_RULES, parseRepo, validateSlackUrl } from '../../../shared/integrations.js'
import { canChangeRole, ROLES } from '../../../shared/permissions.js'
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js'
import { id, randomToken, toCamel } from '../lib/util.js'
import { authorize } from '../middleware/auth.js'
import { body } from '../middleware/validate.js'
import { encryptSecret, githubClient, postToSlack, syncGitHub } from '../services/github.js'
import { withWrite } from '../services/write.js'

/**
 * Integration settings as the browser may see them: secrets (GitHub token, Slack URL) never leave
 * the server in full; non-admins don't see the Slack URL at all.
 */
export function publicIntegrations(integrations = {}, role) {
  const admin = ['owner', 'admin'].includes(role)
  const { tokenEnc, ...github } = integrations.github ?? {}
  const slackUrl = integrations.slack?.webhookUrl
  return {
    ...integrations,
    github: { ...github, hasToken: Boolean(tokenEnc) },
    slack: {
      ...integrations.slack,
      webhookUrl: admin && slackUrl ? `${slackUrl.slice(0, 33)}…` : '',
    },
  }
}

/** Organisations (tenants), members & roles, invitations, settings, custom fields, integrations. */
export function orgRoutes(ctx) {
  const r = Router({ mergeParams: true })

  // ---------------------------------------------------------------- org + settings
  r.get('/', async (req, res) => {
    const { github_secret, calendar_token, ...org } = req.org
    res.json({
      ...toCamel(org),
      integrations: publicIntegrations(org.integrations, req.role),
      role: req.role,
      ...(['owner', 'admin'].includes(req.role) && { githubSecret: github_secret, calendarToken: calendar_token }),
    })
  })

  r.patch(
    '/',
    authorize('settings.manage'),
    body(
      z.object({
        name: z.string().trim().min(1).max(60).optional(),
        capacity: z.number().int().min(1).max(30).optional(),
        approvalChain: z
          .array(
            z.object({
              id: z.string().max(40).optional(),
              name: z.string().trim().min(1).max(60),
              approverId: z.string().max(60).nullable().optional(),
            }),
          )
          .min(1)
          .max(6)
          .optional(),
      }),
    ),
    async (req, res) => {
      const { name, capacity, approvalChain } = req.body
      if (approvalChain) {
        for (const s of approvalChain)
          if (
            s.approverId &&
            !(await ctx.db.one('SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2', [req.org.id, s.approverId]))
          )
            throw badRequest('Approvers must be members.')
      }
      await withWrite(ctx, req.actor, async (w) => {
        await w.t.query(
          'UPDATE orgs SET name = COALESCE($2, name), capacity = COALESCE($3, capacity), approval_chain = COALESCE($4, approval_chain) WHERE id = $1',
          [
            req.org.id,
            name ?? null,
            capacity ?? null,
            approvalChain
              ? JSON.stringify(
                  approvalChain.map((s, i) => ({
                    id: s.id || `step${i}`,
                    name: s.name,
                    approverId: s.approverId ?? null,
                  })),
                )
              : null,
          ],
        )
        await w.audit({
          action: 'settings.updated',
          entityType: 'org',
          entityId: req.org.id,
          after: req.body,
          summary: 'Updated workspace settings',
        })
      })
      res.json({ ok: true })
    },
  )

  r.patch(
    '/integrations/:name',
    authorize('settings.manage'),
    body(
      z.object({
        connected: z.boolean().optional(),
        webhookUrl: z.string().max(500).optional(),
        repo: z.string().max(200).optional(),
        token: z.string().trim().max(255).optional(),
        rules: z
          .object({
            onOpen: z.enum(['review', 'progress']).nullable().optional(),
            onMerge: z.enum(['done', 'review']).nullable().optional(),
          })
          .optional(),
        weeklyReport: z.boolean().optional(),
      }),
    ),
    async (req, res) => {
      const name = req.params.name
      if (!['github', 'slack', 'email'].includes(name)) throw notFound('Integration')
      const current = req.org.integrations?.[name] ?? {}
      let next = { ...current }
      const { token, ...input } = req.body

      if (name === 'github') {
        if (input.connected) {
          // Talk to GitHub before saving: the repository must exist and be readable
          const repo = parseRepo(input.repo)
          if (!repo) throw badRequest('Enter a repository like owner/name or its GitHub URL.')
          const tokenEnc = token ? encryptSecret(ctx.config, token) : current.tokenEnc
          const info = await githubClient(ctx, { tokenEnc })
            .repo(repo)
            .catch((err) => {
              throw badRequest(err.message)
            })
          next = {
            connected: true,
            verified: true,
            repo: info.fullName,
            repoInfo: info,
            rules: current.rules ?? DEFAULT_GITHUB_RULES,
            connectedAt: ctx.now(),
            lastSync: null,
            ...(tokenEnc && { tokenEnc }),
          }
        } else if (input.connected === false) next = { connected: false, rules: current.rules }
        if (input.rules) next.rules = { ...DEFAULT_GITHUB_RULES, ...input.rules }
      } else if (name === 'slack') {
        if (input.connected) {
          const err = validateSlackUrl(input.webhookUrl ?? '')
          if (err) throw badRequest(err)
          await postToSlack(ctx, input.webhookUrl, {
            text: '✅ FlowDesk is now connected to this channel. You will get updates when tasks are completed and approvals are decided.',
          })
          next = { connected: true, webhookUrl: input.webhookUrl, connectedAt: ctx.now() }
        } else if (input.connected === false) next = { connected: false }
      } else next = { ...current, ...input }

      const integrations = { ...req.org.integrations, [name]: next }
      await withWrite(ctx, req.actor, async (w) => {
        await w.t.query('UPDATE orgs SET integrations = $2 WHERE id = $1', [req.org.id, JSON.stringify(integrations)])
        await w.audit({
          action: 'integration.updated',
          entityType: 'integration',
          entityId: name,
          before: { connected: Boolean(current.connected) },
          after: { ...input, webhookUrl: input.webhookUrl ? '••••' : undefined, token: token ? '••••' : undefined },
          summary: `${input.connected ? 'Connected' : input.connected === false ? 'Disconnected' : 'Updated'} ${name}`,
        })
      })
      if (name === 'github' && input.connected) await syncGitHub(ctx, req.org.id).catch(() => {})
      const fresh = await ctx.db.one('SELECT integrations FROM orgs WHERE id = $1', [req.org.id])
      res.json(publicIntegrations(fresh.integrations, req.role)[name])
    },
  )

  r.post('/integrations/github/sync', authorize('task.update'), async (req, res) => {
    res.json(await syncGitHub(ctx, req.org.id))
  })

  // ---------------------------------------------------------------- members & roles
  r.get('/members', async (req, res) => {
    const rows = await ctx.db.query(
      'SELECT u.id, u.name, u.email, u.title, u.color, m.role, m.joined_at FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = $1 ORDER BY u.name',
      [req.org.id],
    )
    res.json(rows.map(toCamel))
  })

  r.patch('/members/:userId', authorize('member.manage'), body(z.object({ role: z.enum(ROLES) })), async (req, res) => {
    const m = await ctx.db.one('SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2', [
      req.org.id,
      req.params.userId,
    ])
    if (!m) throw notFound('Member')
    const owners = (await ctx.db.query("SELECT 1 FROM memberships WHERE org_id = $1 AND role = 'owner'", [req.org.id]))
      .length
    if (!canChangeRole({ actorRole: req.role, targetRole: m.role, newRole: req.body.role, ownerCount: owners }))
      throw forbidden('A workspace needs at least one owner.')
    await withWrite(ctx, req.actor, async (w) => {
      await w.t.query('UPDATE memberships SET role = $3 WHERE org_id = $1 AND user_id = $2', [
        req.org.id,
        req.params.userId,
        req.body.role,
      ])
      await w.audit({
        action: 'member.role_changed',
        entityType: 'member',
        entityId: req.params.userId,
        before: { role: m.role },
        after: { role: req.body.role },
        summary: `Changed a member's role from ${m.role} to ${req.body.role}`,
      })
    })
    res.json({ ok: true })
  })

  r.delete('/members/:userId', authorize('member.manage'), async (req, res) => {
    const m = await ctx.db.one('SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2', [
      req.org.id,
      req.params.userId,
    ])
    if (!m) throw notFound('Member')
    if (m.role === 'owner') throw forbidden("Owners can't be removed. Change their role first.")
    await withWrite(ctx, req.actor, async (w) => {
      await w.t.query('DELETE FROM memberships WHERE org_id = $1 AND user_id = $2', [req.org.id, req.params.userId])
      await w.t.query(
        "UPDATE tasks SET assignee_id = NULL WHERE org_id = $1 AND assignee_id = $2 AND status <> 'done'",
        [req.org.id, req.params.userId],
      )
      await w.audit({
        action: 'member.removed',
        entityType: 'member',
        entityId: req.params.userId,
        before: m,
        summary: 'Removed a member',
      })
    })
    res.status(204).end()
  })

  r.post(
    '/invitations',
    authorize('member.invite'),
    body(z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(['admin', 'member', 'viewer']) })),
    async (req, res) => {
      const existing = await ctx.db.one('SELECT id FROM users WHERE email = $1', [req.body.email])
      if (
        existing &&
        (await ctx.db.one('SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2', [req.org.id, existing.id]))
      )
        throw conflict('conflict', 'That person is already a member.')
      const invite = await withWrite(ctx, req.actor, async (w) => {
        const inv = {
          id: id('i'),
          email: req.body.email,
          role: req.body.role,
          status: existing ? 'accepted' : 'pending',
        }
        await w.t.query(
          'INSERT INTO invitations (id, org_id, email, role, status, invited_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [inv.id, req.org.id, inv.email, inv.role, inv.status, req.user.id, ctx.now()],
        )
        if (existing) {
          await w.t.query('INSERT INTO memberships (org_id, user_id, role, joined_at) VALUES ($1,$2,$3,$4)', [
            req.org.id,
            existing.id,
            inv.role,
            ctx.now(),
          ])
          await w.notify({ userId: existing.id, type: 'invite', message: `You were added to ${req.org.name}` })
        }
        // In production: email a signed, expiring invitation link here (job: notifications.bulk / email provider)
        await w.audit({
          action: 'member.invited',
          entityType: 'invitation',
          entityId: inv.id,
          after: inv,
          summary: `Invited ${inv.email} as ${inv.role}`,
        })
        return inv
      })
      res.status(201).json(invite)
    },
  )

  // ---------------------------------------------------------------- custom fields
  r.get('/fields', async (req, res) =>
    res.json((await ctx.db.query('SELECT * FROM field_defs WHERE org_id = $1', [req.org.id])).map(toCamel)),
  )

  r.post(
    '/fields',
    authorize('settings.manage'),
    body(
      z.object({
        name: z.string().trim().max(40),
        type: z.string(),
        options: z.array(z.string().max(40)).max(30).default([]),
        required: z.boolean().default(false),
      }),
    ),
    async (req, res) => {
      const existing = (await ctx.db.query('SELECT * FROM field_defs WHERE org_id = $1', [req.org.id])).map(toCamel)
      const def = {
        id: fieldIdFromName(req.body.name),
        name: req.body.name,
        type: req.body.type,
        options: req.body.options.map((o) => o.trim()).filter(Boolean),
        required: req.body.required,
      }
      if (existing.some((f) => f.id === def.id))
        def.id = `${def.id}_${randomToken(2)
          .toLowerCase()
          .replace(/[^a-z0-9]/g, 'x')}`
      const err = validateFieldDef(def, existing)
      if (err) throw badRequest(err)
      await withWrite(ctx, req.actor, async (w) => {
        await w.t.query(
          'INSERT INTO field_defs (id, org_id, name, type, options, required) VALUES ($1,$2,$3,$4,$5,$6)',
          [def.id, req.org.id, def.name, def.type, JSON.stringify(def.options), def.required],
        )
        await w.audit({
          action: 'field.created',
          entityType: 'field',
          entityId: def.id,
          after: def,
          summary: `Added custom field “${def.name}”`,
        })
      })
      res.status(201).json(def)
    },
  )

  r.delete('/fields/:fieldId', authorize('settings.manage'), async (req, res) => {
    const n = await ctx.db.exec('DELETE FROM field_defs WHERE org_id = $1 AND id = $2', [
      req.org.id,
      req.params.fieldId,
    ])
    if (!n) throw notFound('Field')
    res.status(204).end()
  })

  return r
}

/** Routes that don't belong to a single org: list my orgs, create a new one. */
export function myOrgRoutes(ctx) {
  const r = Router()
  r.get('/', async (req, res) => {
    res.json(
      await ctx.db.query(
        'SELECT o.id, o.name, o.slug, m.role FROM memberships m JOIN orgs o ON o.id = m.org_id WHERE m.user_id = $1 ORDER BY o.created_at',
        [req.user.id],
      ),
    )
  })
  r.post('/', body(z.object({ name: z.string().trim().min(1).max(60) })), async (req, res) => {
    const orgId = id('o')
    await ctx.db.tx(async (t) => {
      await t.query(
        'INSERT INTO orgs (id, name, slug, key_prefix, approval_chain, integrations, github_secret, calendar_token, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [
          orgId,
          req.body.name,
          req.body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          req.body.name
            .replace(/[^A-Za-z]/g, '')
            .slice(0, 2)
            .toUpperCase() || 'WS',
          JSON.stringify([{ id: 'review', name: 'Owner review', approverId: req.user.id }]),
          JSON.stringify({ github: { connected: false }, slack: { connected: false }, email: { weeklyReport: false } }),
          randomToken(24),
          randomToken(24),
          ctx.now(),
        ],
      )
      await t.query("INSERT INTO memberships (org_id, user_id, role, joined_at) VALUES ($1,$2,'owner',$3)", [
        orgId,
        req.user.id,
        ctx.now(),
      ])
    })
    res.status(201).json({ id: orgId, name: req.body.name, role: 'owner' })
  })
  return r
}
