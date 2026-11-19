import { describe, expect, it, vi } from 'vitest'
import { predictCompletion } from '../analytics.js'
import { createGitHubClient, parseRepo, planGitHubSync, validateSlackUrl } from '../integrations.js'

const task = (key, status = 'todo', links = []) => ({ id: `t_${key}`, key, status, links })
const pr = (n, title, extra = {}) => ({
  number: n,
  title,
  html_url: `https://github.com/acme/web/pull/${n}`,
  state: 'open',
  draft: false,
  merged_at: null,
  head: { ref: 'main' },
  ...extra,
})

describe('parseRepo', () => {
  it('accepts owner/repo and GitHub URLs', () => {
    expect(parseRepo('facebook/react')).toBe('facebook/react')
    expect(parseRepo('https://github.com/facebook/react.git')).toBe('facebook/react')
    expect(parseRepo('not a repo')).toBeNull()
    expect(parseRepo('https://evil.com/a/b')).toBeNull()
  })
})

describe('planGitHubSync', () => {
  it('links PRs by task key and moves tasks: opened → Review, merged → Completed', () => {
    const plans = planGitHubSync({
      pulls: [pr(1, 'FD-1 checkout'), pr(2, 'FD-2 cart', { state: 'closed', merged_at: '2026-11-01' })],
      tasks: [task('FD-1', 'progress'), task('FD-2', 'review')],
    })
    expect(plans.find((p) => p.key === 'FD-1')).toMatchObject({
      status: 'review',
      links: [{ state: 'open', number: 1 }],
    })
    expect(plans.find((p) => p.key === 'FD-2')).toMatchObject({ status: 'done', links: [{ state: 'merged' }] })
  })

  it('finds keys in branch names and links commits', () => {
    const plans = planGitHubSync({
      pulls: [pr(3, 'Add search', { head: { ref: 'feature/fd-3-search' } })],
      commits: [
        {
          sha: 'abcdef123',
          html_url: 'https://github.com/acme/web/commit/abcdef1',
          commit: { message: 'FD-3: tests\n\nmore' },
        },
      ],
      tasks: [task('FD-3')],
    })
    expect(plans[0].links.map((l) => l.type)).toEqual(['pull_request', 'commit'])
    expect(plans[0].links[1]).toMatchObject({ title: 'FD-3: tests', sha: 'abcdef1' })
  })

  it('is idempotent and does not push a task back when the PR state has not changed', () => {
    const tasks = [task('FD-1', 'progress')]
    const [first] = planGitHubSync({ pulls: [pr(1, 'FD-1 x')], tasks })
    const synced = [{ ...tasks[0], status: 'todo', links: first.links }] // someone moved it back by hand
    expect(planGitHubSync({ pulls: [pr(1, 'FD-1 x')], tasks: synced })).toEqual([])
  })

  it('respects rules (null = do not move) and ignores drafts and unknown keys', () => {
    const plans = planGitHubSync({
      pulls: [pr(1, 'FD-1', { state: 'closed', merged_at: 'x' }), pr(2, 'FD-2 wip', { draft: true }), pr(3, 'FD-99')],
      tasks: [task('FD-1'), task('FD-2')],
      rules: { onOpen: 'review', onMerge: null },
    })
    expect(plans).toHaveLength(2)
    expect(plans.every((p) => p.status === undefined)).toBe(true)
  })
})

describe('createGitHubClient', () => {
  it('calls the GitHub REST API with the right headers and maps errors', async () => {
    const fetchImpl = vi.fn(async (url) =>
      url.endsWith('/repos/acme/web')
        ? {
            ok: true,
            json: async () => ({
              full_name: 'acme/web',
              html_url: 'https://github.com/acme/web',
              private: false,
              default_branch: 'main',
            }),
          }
        : { ok: false, status: 404, json: async () => ({ message: 'Not Found' }) },
    )
    const gh = createGitHubClient({ token: 't0k', fetchImpl })
    await expect(gh.repo('acme/web')).resolves.toMatchObject({ fullName: 'acme/web', defaultBranch: 'main' })
    expect(fetchImpl.mock.calls[0][1].headers).toMatchObject({
      Authorization: 'Bearer t0k',
      'X-GitHub-Api-Version': '2022-11-28',
    })
    await expect(gh.repo('acme/nope')).rejects.toThrow(/not found/i)
  })
})

describe('validateSlackUrl', () => {
  it('only accepts Slack incoming webhooks', () => {
    expect(validateSlackUrl('https://hooks.slack.com/services/T0/B0/xyz')).toBe('')
    expect(validateSlackUrl('https://example.com/services/x')).toMatch(/Slack/)
    expect(validateSlackUrl('http://hooks.slack.com/services/x')).toMatch(/Slack/)
  })
})

describe('predictCompletion', () => {
  it('reports an empty project as empty, not done', () => {
    expect(predictCompletion([], { deadline: '2026-12-01' }).risk).toBe('empty')
  })
})
