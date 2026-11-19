import { describe, expect, it } from 'vitest'
import { validateCustomValues, validateFieldDef, validateFieldValue } from '../customFields.js'
import { csvCell, toCSV, toICS } from '../exporters.js'
import { applyEvent, emptyStats } from '../gamification.js'
import { extractTaskKeys, interpretGitHubEvent, validateWebhookUrl } from '../integrations.js'
import { backoffMs, createJob, markFailed, markRunning, pickNext, requeue } from '../jobs.js'
import { mergeRecord, threeWayMerge } from '../merge.js'
import { nextOccurrence } from '../recurrence.js'
import { buildIndex, highlight, search } from '../search.js'

describe('recurrence', () => {
  it('computes the next date and clamps month ends', () => {
    expect(nextOccurrence('2026-11-20', { freq: 'daily' })).toBe('2026-11-21')
    expect(nextOccurrence('2026-11-20', { freq: 'weekly', interval: 2 })).toBe('2026-12-04')
    expect(nextOccurrence('2026-01-31', { freq: 'monthly' })).toBe('2026-02-28')
  })
})

describe('custom fields', () => {
  const defs = [
    { id: 'f_severity', name: 'Severity', type: 'select', options: ['S1', 'S2'], required: true },
    { id: 'f_hours', name: 'Hours', type: 'number' },
    { id: 'f_link', name: 'Link', type: 'url' },
  ]
  it('validates definitions', () => {
    expect(validateFieldDef({ id: 'f_x', name: 'X', type: 'text' })).toMatch(/at least 2/)
    expect(validateFieldDef({ id: 'f_s', name: 'Size', type: 'select', options: ['a'] })).toMatch(/two options/)
    expect(validateFieldDef({ id: 'f_s', name: 'Severity', type: 'text' }, defs)).toMatch(/already exists/)
  })
  it('validates values and drops unknown keys', () => {
    const r = validateCustomValues(defs, { f_severity: 'S1', f_hours: '3', hacker: 'x' })
    expect(r).toMatchObject({ valid: true, values: { f_severity: 'S1', f_hours: 3 } })
    expect(validateCustomValues(defs, {}).errors.f_severity).toMatch(/required/)
    expect(validateFieldValue(defs[2], 'javascript:alert(1)')).toMatch(/web link/)
  })
})

describe('exports', () => {
  it('neutralises spreadsheet formulas and escapes CSV', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(toCSV(['a', 'b'], [['1,2', 'ok']])).toBe('a,b\r\n"1,2",ok')
  })
  it('builds a valid iCalendar file', () => {
    const ics = toICS([{ uid: 't1', title: 'Launch; v2', date: '2026-12-01' }], {
      now: new Date('2026-11-20T00:00:00Z'),
    })
    expect(ics).toContain('DTSTART;VALUE=DATE:20261201')
    expect(ics).toContain('DTEND;VALUE=DATE:20261202')
    expect(ics).toContain('SUMMARY:Launch\\; v2')
  })
})

describe('job queue', () => {
  it('picks by priority then age, and only due jobs', () => {
    const jobs = [
      { ...createJob({ id: 'a', type: 'x', priority: 'low', runAt: 1 }) },
      { ...createJob({ id: 'b', type: 'x', priority: 'high', runAt: 5 }) },
      { ...createJob({ id: 'c', type: 'x', priority: 'high', runAt: 999 }) },
    ]
    expect(pickNext(jobs, 10).id).toBe('b')
  })
  it('retries with backoff, then dead-letters', () => {
    let job = createJob({ id: 'j', type: 'x', maxAttempts: 2 })
    job = markFailed(markRunning(job, 0), new Error('boom'), 0, () => 0.5)
    expect(job).toMatchObject({ status: 'queued', attempts: 1, runAt: 2000, lastError: 'boom' })
    job = markFailed(markRunning(job, 0), new Error('boom'), 0)
    expect(job.status).toBe('dead')
    expect(requeue(job, 5)).toMatchObject({ status: 'queued', attempts: 0 })
    expect(backoffMs(20, () => 0.5)).toBe(300_000)
  })
})

describe('merging', () => {
  it('merges non-overlapping line edits', () => {
    const base = 'a\nb\nc'
    expect(threeWayMerge(base, 'A\nb\nc', 'a\nb\nC')).toEqual({ merged: 'A\nb\nC', conflicts: 0 })
  })
  it('merges a replaced line with a line appended after it', () => {
    expect(threeWayMerge('a\nb', 'a\nB', 'a\nb\nc')).toEqual({ merged: 'a\nB\nc', conflicts: 0 })
  })
  it('marks overlapping edits as conflicts and keeps both', () => {
    const r = threeWayMerge('a\nb', 'a\nX', 'a\nY')
    expect(r.conflicts).toBe(1)
    expect(r.merged).toContain('X')
    expect(r.merged).toContain('Y')
  })
  it('merges record fields and reports real conflicts', () => {
    const base = { id: 1, version: 1, title: 'T', priority: 'low', status: 'todo' }
    const client = { ...base, title: 'Client title', status: 'done' }
    const server = { ...base, version: 2, priority: 'high', status: 'review' }
    const r = mergeRecord(base, client, server)
    expect(r.record).toMatchObject({ title: 'Client title', priority: 'high', status: 'review', version: 3 })
    expect(r.conflicts).toEqual(['status'])
  })
})

describe('integrations', () => {
  it('blocks SSRF-prone webhook URLs', () => {
    expect(validateWebhookUrl('https://hooks.slack.com/x')).toBe('')
    expect(validateWebhookUrl('http://example.com')).toMatch(/https/)
    expect(validateWebhookUrl('https://127.0.0.1/x')).toMatch(/public/)
    expect(validateWebhookUrl('https://192.168.1.4/x')).toMatch(/public/)
  })
  it('maps GitHub pull requests to task status changes', () => {
    expect(extractTaskKeys('fix: login (fd-12, FD-12, FD-7)')).toEqual(['FD-12', 'FD-7'])
    const merged = interpretGitHubEvent('pull_request', {
      action: 'closed',
      pull_request: {
        merged: true,
        number: 4,
        title: 'FD-3 Add cart',
        html_url: 'https://github.com/x/y/pull/4',
        head: { ref: 'feat' },
      },
    })
    expect(merged).toEqual([{ key: 'FD-3', status: 'done', link: expect.objectContaining({ type: 'pull_request' }) }])
  })
})

describe('gamification', () => {
  it('awards points, streaks and badges', () => {
    const day = 86_400_000
    let s = emptyStats()
    let r = applyEvent(s, { type: 'task_completed', priority: 'high', at: 0 })
    expect(r).toMatchObject({ gained: 15, newBadges: ['first_task'] })
    s = r.stats
    s = applyEvent(s, { type: 'pomodoro', at: day }).stats
    r = applyEvent(s, { type: 'comment', at: 2 * day })
    expect(r.stats.streak).toBe(3)
    expect(r.newBadges).toContain('streak_3')
    expect(applyEvent(r.stats, { type: 'comment', at: 5 * day }).stats.streak).toBe(1) // streak broken
  })
})

describe('search', () => {
  const index = buildIndex({
    tasks: [
      { id: 't1', key: 'FD-1', title: 'Fix checkout bug', status: 'todo', createdAt: 0 },
      { id: 't2', key: 'FD-2', title: 'Write tests', description: 'cover checkout', status: 'done', createdAt: 0 },
    ],
    members: [{ id: 'm1', name: 'Priya Raman', email: 'priya@x.com' }],
  })
  it('ranks title matches above body matches and applies filters', () => {
    expect(search(index, 'checkout').map((r) => r.id)).toEqual(['t1', 't2'])
    expect(search(index, 'checkout', { status: 'done' }).map((r) => r.id)).toEqual(['t2'])
    expect(search(index, 'priya', { types: ['member'] })).toHaveLength(1)
  })
  it('highlights without HTML', () => {
    expect(highlight('Fix checkout bug', 'checkout')).toEqual([
      { text: 'Fix ', match: false },
      { text: 'checkout', match: true },
      { text: ' bug', match: false },
    ])
  })
})
