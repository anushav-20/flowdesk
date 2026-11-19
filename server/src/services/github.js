import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { createGitHubClient, DEFAULT_GITHUB_RULES, planGitHubSync } from '../../../shared/integrations.js'
import { HttpError } from '../lib/errors.js'
import { applyChange, orgTasks } from './tasks.js'
import { systemActor, withWrite } from './write.js'

/**
 * GitHub tokens are stored encrypted (AES-256-GCM) with a key derived from the server secret,
 * and are never sent back to the browser.
 */
const keyFrom = (config) => createHash('sha256').update(`${config.jwtSecret}:integrations`).digest()

export function encryptSecret(config, plain) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyFrom(config), iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join('.')
}

export function decryptSecret(config, sealed) {
  const [iv, tag, data] = sealed.split('.').map((s) => Buffer.from(s, 'base64url'))
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(config), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

export const githubClient = (ctx, gh) =>
  createGitHubClient({
    token: gh?.tokenEnc ? decryptSecret(ctx.config, gh.tokenEnc) : undefined,
    fetchImpl: ctx.fetch ?? fetch,
  })

const integrationError = (message) => new HttpError(502, 'integration_error', message)

async function saveLastSync(t, orgId, lastSync) {
  const { integrations } = await t.one('SELECT integrations FROM orgs WHERE id = $1', [orgId])
  await t.query('UPDATE orgs SET integrations = $2 WHERE id = $1', [
    orgId,
    JSON.stringify({ ...integrations, github: { ...integrations.github, lastSync } }),
  ])
}

/** Fetches PRs + commits from the GitHub API and links them to tasks (same rules as the browser engine). */
export async function syncGitHub(ctx, orgId) {
  const org = await ctx.db.one('SELECT integrations FROM orgs WHERE id = $1', [orgId])
  const gh = org?.integrations?.github
  if (!gh?.connected || !gh.verified) throw new HttpError(422, 'validation', 'Connect a GitHub repository first.')
  const client = githubClient(ctx, gh)
  let pulls, commits
  try {
    ;[pulls, commits] = await Promise.all([client.pulls(gh.repo), client.commits(gh.repo)])
  } catch (err) {
    await saveLastSync(ctx.db, orgId, { at: ctx.now(), ok: false, error: err.message })
    throw integrationError(err.message)
  }
  const results = []
  let updated = 0
  await withWrite(
    ctx,
    systemActor(orgId, 'GitHub'),
    async (w) => {
      const plans = planGitHubSync({
        pulls,
        commits,
        tasks: await orgTasks(w.t, orgId),
        rules: gh.rules ?? DEFAULT_GITHUB_RULES,
      })
      updated = plans.length
      const tasks = Object.fromEntries((await orgTasks(w.t, orgId)).map((t) => [t.id, t]))
      for (const p of plans) {
        const task = tasks[p.taskId]
        try {
          await applyChange(w, task, { links: p.links, ...(p.status && { status: p.status }) })
          results.push(`${p.key}: ${p.notes.join(', ')}${p.status ? ` → moved to ${p.status}` : ''}`)
        } catch (err) {
          await applyChange(w, task, { links: p.links })
          results.push(`${p.key}: ${p.notes.join(', ')} (not moved: ${err.message})`)
        }
      }
      await saveLastSync(w.t, orgId, {
        at: ctx.now(),
        ok: true,
        pulls: pulls.length,
        commits: commits.length,
        updated,
        results: results.slice(0, 10),
      })
    },
    { label: 'GitHub' },
  )
  return { pulls: pulls.length, commits: commits.length, updated, results }
}

/** Posts JSON to a Slack incoming webhook and checks the response. */
export async function postToSlack(ctx, url, message) {
  let res
  try {
    res = await (ctx.fetch ?? fetch)(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
      redirect: 'manual',
      signal: AbortSignal.timeout(ctx.config.webhooks.timeoutMs),
    })
  } catch {
    throw integrationError('Could not reach Slack.')
  }
  if (!res.ok) throw integrationError(`Slack rejected the message (${res.status}). Check the webhook URL.`)
}
