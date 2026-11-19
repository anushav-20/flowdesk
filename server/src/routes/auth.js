import bcrypt from 'bcryptjs'
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { HttpError } from '../lib/errors.js'
import { id, randomToken, sha256 } from '../lib/util.js'
import { requireAuth } from '../middleware/auth.js'
import { body } from '../middleware/validate.js'

const DAY = 86_400_000
const email = z.string().trim().toLowerCase().email('Enter a valid email address.').max(254)

/**
 * Authentication:
 *  - passwords hashed with bcrypt (cost 12)
 *  - short-lived JWT access token (15 min) + long-lived refresh token (7 days)
 *  - refresh tokens are random, stored only as SHA-256 hashes, and ROTATED on every use;
 *    reusing an old one revokes the whole family (theft detection)
 *  - strict rate limits on login/register against brute force
 */
// A real bcrypt hash used to compare against when the email doesn't exist (constant-time login)
let dummyHash
const getDummyHash = async () => (dummyHash ??= await bcrypt.hash('not-a-real-password', 12))

export function authRoutes(ctx) {
  const r = Router()
  const limiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: ctx.config.env === 'test' ? 1000 : 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'rate_limited', message: 'Too many attempts. Try again later.' } },
  })

  const issueTokens = async (t, userId) => {
    const accessToken = jwt.sign({}, ctx.config.jwtSecret, {
      subject: userId,
      expiresIn: ctx.config.accessTokenTtl,
      issuer: 'flowdesk',
      algorithm: 'HS256',
    })
    const refreshToken = randomToken()
    await t.query(
      'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at) VALUES ($1,$2,$3,$4,$5)',
      [id('rt'), userId, sha256(refreshToken), ctx.now() + ctx.config.refreshTokenDays * DAY, ctx.now()],
    )
    return { accessToken, refreshToken, expiresIn: ctx.config.accessTokenTtl }
  }

  const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, title: u.title, color: u.color })

  r.post(
    '/register',
    limiter,
    body(
      z.object({
        name: z.string().trim().min(1, 'Name is required.').max(60),
        email,
        password: z.string().min(8, 'Password must be at least 8 characters.').max(200),
        orgName: z.string().trim().max(60).optional(),
      }),
    ),
    async (req, res) => {
      const { name, password, orgName } = req.body
      const exists = await ctx.db.one('SELECT 1 FROM users WHERE email = $1', [req.body.email])
      if (exists) throw new HttpError(409, 'conflict', 'An account with this email already exists.')
      const passwordHash = await bcrypt.hash(password, 12)
      const result = await ctx.db.tx(async (t) => {
        const userId = id('u')
        const orgId = id('o')
        const ws = orgName || `${name.split(' ')[0]}'s team`
        await t.query('INSERT INTO users (id, email, name, password_hash, created_at) VALUES ($1,$2,$3,$4,$5)', [
          userId,
          req.body.email,
          name,
          passwordHash,
          ctx.now(),
        ])
        await t.query(
          'INSERT INTO orgs (id, name, slug, key_prefix, approval_chain, integrations, github_secret, calendar_token, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [
            orgId,
            ws,
            ws.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            ws
              .replace(/[^A-Za-z]/g, '')
              .slice(0, 2)
              .toUpperCase() || 'WS',
            JSON.stringify([{ id: 'review', name: 'Owner review', approverId: userId }]),
            JSON.stringify({
              github: { connected: false },
              slack: { connected: false },
              email: { weeklyReport: false },
            }),
            randomToken(24),
            randomToken(24),
            ctx.now(),
          ],
        )
        await t.query("INSERT INTO memberships (org_id, user_id, role, joined_at) VALUES ($1,$2,'owner',$3)", [
          orgId,
          userId,
          ctx.now(),
        ])
        await t.query('INSERT INTO projects (id, org_id, name, created_at) VALUES ($1,$2,$3,$4)', [
          id('p'),
          orgId,
          'My first project',
          ctx.now(),
        ])
        return { userId, orgId, tokens: await issueTokens(t, userId) }
      })
      const user = await ctx.db.one('SELECT * FROM users WHERE id = $1', [result.userId])
      res.status(201).json({ user: publicUser(user), orgId: result.orgId, ...result.tokens })
    },
  )

  r.post('/login', limiter, body(z.object({ email, password: z.string().min(1).max(200) })), async (req, res) => {
    const user = await ctx.db.one('SELECT * FROM users WHERE email = $1', [req.body.email])
    // Always run bcrypt (even for unknown emails) so response time doesn't reveal which accounts exist
    const ok = await bcrypt.compare(req.body.password, user?.password_hash ?? (await getDummyHash()))
    if (!user || !ok) throw new HttpError(401, 'invalid_credentials', 'Email or password is incorrect.')
    const tokens = await ctx.db.tx((t) => issueTokens(t, user.id))
    res.json({ user: publicUser(user), ...tokens })
  })

  r.post('/refresh', limiter, body(z.object({ refreshToken: z.string().min(20).max(200) })), async (req, res) => {
    const hash = sha256(req.body.refreshToken)
    const tokens = await ctx.db.tx(async (t) => {
      const row = await t.one('SELECT * FROM refresh_tokens WHERE token_hash = $1', [hash])
      if (!row || row.expires_at < ctx.now())
        throw new HttpError(401, 'invalid_token', 'Session expired. Please sign in again.')
      if (row.revoked) {
        // Reuse of a rotated token = likely theft → revoke every session for this user
        await t.query('UPDATE refresh_tokens SET revoked = true WHERE user_id = $1', [row.user_id])
        throw new HttpError(401, 'token_reused', 'Session invalidated for security. Please sign in again.')
      }
      await t.query('UPDATE refresh_tokens SET revoked = true WHERE id = $1', [row.id])
      return issueTokens(t, row.user_id)
    })
    res.json(tokens)
  })

  r.post('/logout', body(z.object({ refreshToken: z.string().max(200).optional() })), async (req, res) => {
    if (req.body.refreshToken)
      await ctx.db.query('UPDATE refresh_tokens SET revoked = true WHERE token_hash = $1', [
        sha256(req.body.refreshToken),
      ])
    res.status(204).end()
  })

  r.get('/me', requireAuth(ctx), async (req, res) => {
    const orgs = await ctx.db.query(
      'SELECT o.id, o.name, m.role FROM memberships m JOIN orgs o ON o.id = m.org_id WHERE m.user_id = $1 ORDER BY o.created_at',
      [req.user.id],
    )
    res.json({ user: req.user, orgs })
  })

  return r
}
