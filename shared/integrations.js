/**
 * Integration helpers shared by the browser and the server:
 * webhook event catalogue + payload builder, GitHub event interpretation, Slack message formatting.
 */

export const WEBHOOK_EVENTS = {
  'task.created': 'Task created',
  'task.updated': 'Task updated',
  'task.completed': 'Task completed',
  'task.deleted': 'Task deleted',
  'comment.created': 'Comment added',
  'approval.decided': 'Approval decision',
  'project.completed': 'Project completed',
}

export function webhookPayload(event, data, { orgId, id, at = Date.now() }) {
  return { id, event, orgId, createdAt: new Date(at).toISOString(), data }
}

/** Only allow https URLs to public hosts (blocks SSRF to localhost / private ranges). */
export function validateWebhookUrl(raw) {
  let u
  try {
    u = new URL(raw)
  } catch {
    return 'Enter a valid URL.'
  }
  if (u.protocol !== 'https:') return 'Webhook URLs must use https.'
  const h = u.hostname.toLowerCase()
  if (
    h === 'localhost' ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^169\.254\./.test(h) ||
    h === '0.0.0.0' ||
    h.startsWith('[')
  ) {
    return 'Webhook URLs must point to a public host.'
  }
  return ''
}

/** Finds task keys like FD-12 in commit messages, branch names and PR titles. */
export function extractTaskKeys(text) {
  return [
    ...new Set(
      String(text ?? '')
        .toUpperCase()
        .match(/\bFD-\d{1,6}\b/g) ?? [],
    ),
  ]
}

/**
 * Turns a GitHub webhook event into FlowDesk actions.
 *  - PR opened / ready → link PR, move task to Review
 *  - PR merged → link PR, move task to Done
 *  - push → link commits
 * @returns {{ key: string, link: {type:string,url:string,title:string}, status?: string }[]}
 */
export function interpretGitHubEvent(eventName, payload) {
  const out = []
  if (eventName === 'pull_request' && payload?.pull_request) {
    const pr = payload.pull_request
    const keys = extractTaskKeys(`${pr.title} ${pr.head?.ref ?? ''} ${pr.body ?? ''}`)
    let status
    if (payload.action === 'opened' || payload.action === 'ready_for_review' || payload.action === 'reopened')
      status = 'review'
    if (payload.action === 'closed' && pr.merged) status = 'done'
    for (const key of keys)
      out.push({
        key,
        link: {
          type: 'pull_request',
          url: pr.html_url,
          title: `#${pr.number} ${pr.title}`,
          number: pr.number,
          state: pr.merged ? 'merged' : pr.state === 'closed' ? 'closed' : pr.draft ? 'draft' : 'open',
        },
        status,
      })
  }
  if (eventName === 'push' && Array.isArray(payload?.commits)) {
    for (const c of payload.commits)
      for (const key of extractTaskKeys(c.message))
        out.push({ key, link: { type: 'commit', url: c.url, title: c.message.split('\n')[0].slice(0, 100) } })
  }
  return out
}

// ---------------------------------------------------------------- GitHub REST API (real connection)

const GITHUB_API = 'https://api.github.com'

/** Accepts "owner/repo" or a GitHub URL; returns "owner/repo" or null. */
export function parseRepo(input) {
  const m = String(input ?? '')
    .trim()
    .replace(/\.git$/, '')
    .match(/^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+)\/?$/i)
  return m ? `${m[1]}/${m[2]}` : null
}

/** Friendly messages for GitHub API failures. */
export function githubErrorMessage(status, body = {}, { hasToken = false } = {}) {
  if (status === 404)
    return hasToken
      ? 'Repository not found, or the token cannot access it.'
      : 'Repository not found. Check the name — private repositories need an access token.'
  if (status === 401) return 'GitHub rejected the access token.'
  if (status === 403 && /rate limit/i.test(body.message ?? ''))
    return 'GitHub rate limit reached. Try again in a few minutes (or add a token).'
  if (status === 0) return 'Could not reach GitHub. Check your connection.'
  return `GitHub responded ${status}${body.message ? `: ${body.message}` : ''}.`
}

/**
 * Minimal GitHub REST client that works in browsers and Node (both have fetch).
 * Public repositories work without a token (60 requests/hour); a token raises that and allows private repos.
 */
export function createGitHubClient({ token, fetchImpl = globalThis.fetch } = {}) {
  async function get(path) {
    let res
    try {
      res = await fetchImpl(`${GITHUB_API}${path}`, {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
      })
    } catch {
      throw Object.assign(new Error(githubErrorMessage(0)), { status: 0 })
    }
    const body = await res.json().catch(() => ({}))
    if (!res.ok)
      throw Object.assign(new Error(githubErrorMessage(res.status, body, { hasToken: Boolean(token) })), {
        status: res.status,
      })
    return body
  }
  return {
    /** Verifies the repository exists and is reachable. */
    async repo(fullName) {
      const r = await get(`/repos/${fullName}`)
      return {
        fullName: r.full_name,
        url: r.html_url,
        private: r.private,
        defaultBranch: r.default_branch,
        description: r.description ?? '',
      }
    },
    pulls: (fullName) => get(`/repos/${fullName}/pulls?state=all&sort=updated&direction=desc&per_page=50`),
    commits: (fullName) => get(`/repos/${fullName}/commits?per_page=50`),
  }
}

export const prState = (pr) =>
  pr.merged_at || pr.merged ? 'merged' : pr.state === 'closed' ? 'closed' : pr.draft ? 'draft' : 'open'

export const DEFAULT_GITHUB_RULES = { onOpen: 'review', onMerge: 'done' }

/**
 * Plans a sync from the GitHub API: links every PR/commit that mentions a task key, refreshes PR state,
 * and moves tasks according to the rules — but only when a PR's state actually changed since the last sync,
 * so a task someone moved by hand isn't pushed back on every sync.
 * @returns {{ taskId: string, key: string, links: object[], status?: string, notes: string[] }[]}
 */
export function planGitHubSync({ pulls = [], commits = [], tasks = [], rules = DEFAULT_GITHUB_RULES }) {
  const byKey = new Map(tasks.map((t) => [t.key, t]))
  const plans = new Map()
  const planFor = (task) => {
    if (!plans.has(task.id))
      plans.set(task.id, { taskId: task.id, key: task.key, links: [...(task.links ?? [])], notes: [], changed: false })
    return plans.get(task.id)
  }

  for (const pr of pulls) {
    const state = prState(pr)
    const link = {
      type: 'pull_request',
      url: pr.html_url,
      title: `#${pr.number} ${pr.title}`,
      number: pr.number,
      state,
    }
    for (const key of extractTaskKeys(`${pr.title} ${pr.head?.ref ?? ''} ${pr.body ?? ''}`)) {
      const task = byKey.get(key)
      if (!task) continue
      const p = planFor(task)
      const i = p.links.findIndex((l) => l.url === link.url)
      const prev = i >= 0 ? p.links[i] : null
      if (!prev || prev.state !== state || prev.title !== link.title) {
        p.changed = true
        if (i >= 0) p.links[i] = link
        else p.links.push(link)
        p.notes.push(prev ? `PR #${pr.number} is now ${state}` : `linked PR #${pr.number} (${state})`)
        if (prev?.state === state) continue
        if (state === 'merged' && rules.onMerge && task.status !== 'done') p.status = rules.onMerge
        else if (
          state === 'open' &&
          rules.onOpen &&
          (task.status === 'todo' || task.status === 'progress') &&
          p.status !== 'done'
        )
          p.status = rules.onOpen
      }
    }
  }

  for (const c of commits) {
    const message = c.commit?.message ?? c.message ?? ''
    const url = c.html_url ?? c.url
    for (const key of extractTaskKeys(message)) {
      const task = byKey.get(key)
      if (!task) continue
      const p = planFor(task)
      if (p.links.some((l) => l.url === url)) continue
      p.links.push({ type: 'commit', url, title: message.split('\n')[0].slice(0, 100), sha: (c.sha ?? '').slice(0, 7) })
      p.notes.push(`linked commit ${(c.sha ?? '').slice(0, 7)}`)
      p.changed = true
    }
  }

  return [...plans.values()].filter((p) => p.changed).map(({ changed: _changed, ...p }) => p)
}

/** Slack incoming-webhook URLs only (they are secrets: anyone with the URL can post to the channel). */
export function validateSlackUrl(raw) {
  let u
  try {
    u = new URL(raw)
  } catch {
    return 'Enter the incoming webhook URL from Slack.'
  }
  if (u.protocol !== 'https:' || u.hostname !== 'hooks.slack.com' || !u.pathname.startsWith('/services/'))
    return 'Use a Slack incoming webhook URL (https://hooks.slack.com/services/…).'
  return ''
}

/** Slack "blocks" message for a FlowDesk event (sent to an incoming-webhook URL). */
export function slackMessage(event, data) {
  const title = WEBHOOK_EVENTS[event] ?? event
  const text = data?.task ? `*${title}:* ${data.task.key ?? ''} ${data.task.title}` : `*${title}*`
  return { text, blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }] }
}
