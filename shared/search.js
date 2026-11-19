/**
 * Workspace-wide search over tasks, projects, comments, members, docs and activity.
 * Builds a flat index of documents, then ranks matches:
 *   exact phrase in title > all words in title > words anywhere; recent items get a small boost.
 */

export const SEARCH_TYPES = {
  task: 'Tasks',
  project: 'Projects',
  comment: 'Comments',
  member: 'People',
  doc: 'Docs',
  activity: 'Activity',
}

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')

/**
 * @param {{ tasks:any[], projects:any[], comments:any[], members:any[], docs:any[], activity:any[] }} data
 */
export function buildIndex({ tasks = [], projects = [], comments = [], members = [], docs = [], activity = [] }) {
  const docsOut = []
  for (const t of tasks)
    docsOut.push({
      type: 'task',
      id: t.id,
      title: `${t.key ?? ''} ${t.title}`.trim(),
      body: t.description ?? '',
      ref: t,
      at: t.updatedAt ?? t.createdAt,
      status: t.status,
      assigneeId: t.assigneeId,
      priority: t.priority,
      projectId: t.projectId,
    })
  for (const p of projects)
    docsOut.push({ type: 'project', id: p.id, title: p.name, body: p.description ?? '', ref: p, at: p.createdAt })
  for (const c of comments)
    docsOut.push({
      type: 'comment',
      id: c.id,
      title: c.body.slice(0, 80),
      body: c.body,
      ref: c,
      at: c.createdAt,
      assigneeId: c.authorId,
    })
  for (const m of members)
    docsOut.push({
      type: 'member',
      id: m.id,
      title: m.name,
      body: `${m.email ?? ''} ${m.title ?? ''} ${m.role ?? ''}`,
      ref: m,
      at: 0,
    })
  for (const d of docs)
    docsOut.push({ type: 'doc', id: d.id, title: d.title, body: d.content ?? '', ref: d, at: d.updatedAt })
  for (const a of activity)
    docsOut.push({ type: 'activity', id: a.id, title: a.summary ?? a.action, body: '', ref: a, at: a.at })
  return docsOut.map((d) => ({ ...d, _title: norm(d.title), _body: norm(d.body) }))
}

/**
 * @param {ReturnType<typeof buildIndex>} index
 * @param {string} query
 * @param {{ types?: string[], status?: string, assigneeId?: string, priority?: string, projectId?: string, sort?: 'relevance'|'recent', limit?: number, now?: number }} [opts]
 */
export function search(index, query, opts = {}) {
  const { types, status, assigneeId, priority, projectId, sort = 'relevance', limit = 50, now = Date.now() } = opts
  const q = norm(query).trim()
  const words = q.split(/\s+/).filter(Boolean)
  const results = []

  for (const d of index) {
    if (types?.length && !types.includes(d.type)) continue
    if (status && d.status !== status) continue
    if (assigneeId && d.assigneeId !== assigneeId) continue
    if (priority && d.priority !== priority) continue
    if (projectId && d.projectId !== projectId) continue

    let score = 0
    if (words.length) {
      const hay = `${d._title} ${d._body}`
      if (!words.every((w) => hay.includes(w))) continue
      if (d._title.includes(q)) score += 100
      if (d._title.startsWith(q)) score += 25
      score += words.filter((w) => d._title.includes(w)).length * 20
      score += words.filter((w) => d._body.includes(w)).length * 5
    }
    if (d.at) score += Math.max(0, 10 - (now - d.at) / 86_400_000) // recency boost, up to 10
    results.push({ ...d, score })
  }

  results.sort(sort === 'recent' ? (a, b) => (b.at ?? 0) - (a.at ?? 0) : (a, b) => b.score - a.score)
  return results.slice(0, limit)
}

/** Splits text into parts so the UI can highlight matches without using innerHTML. */
export function highlight(text, query) {
  const words = norm(query)
    .split(/\s+/)
    .filter((w) => w.length > 1)
  if (!words.length) return [{ text, match: false }]
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`(${escaped.join('|')})`, 'gi')
  return String(text)
    .split(re)
    .filter(Boolean)
    .map((part) => ({ text: part, match: words.includes(norm(part)) }))
}
