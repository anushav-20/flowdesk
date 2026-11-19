import { isOverdue, predictCompletion, summarize } from './analytics.js'
import { openBlockers } from './graph.js'

/**
 * FlowDesk Assistant — a deterministic, explainable "AI" that answers questions
 * about the workspace and generates project plans. It needs no API key, so the
 * demo always works. The server swaps in a real LLM when one is configured,
 * using these answers as grounded context.
 */

const DAY = 86_400_000
const PRIORITY_WEIGHT = { high: 30, medium: 15, low: 5 }

export const INTENTS = {
  overdue: [/overdue/, /late/, /behind/, /missed/],
  summary: [/summar/, /progress/, /this week/, /status/, /how are we/, /report/],
  prioritize: [/priorit/, /what should i/, /focus/, /next/, /important/],
  plan: [/plan/, /create (a )?project/, /generate/, /break.*down/, /tasks for/, /build /],
  risk: [/deadline/, /on track/, /risk/, /finish/, /predict/],
  workload: [/workload/, /busy/, /overload/, /capacity/, /who has/],
  help: [/help/, /what can you/],
}

export function detectIntent(text) {
  const q = String(text).toLowerCase()
  for (const [intent, patterns] of Object.entries(INTENTS)) if (patterns.some((p) => p.test(q))) return intent
  return 'unknown'
}

/** Priority score: urgency (due date) + importance + how many tasks it unblocks. Exported for tests. */
export function scoreTask(task, tasks, now = Date.now()) {
  if (task.status === 'done') return -Infinity
  let score = PRIORITY_WEIGHT[task.priority] ?? 10
  if (task.dueDate) {
    const days = (new Date(task.dueDate).getTime() - now) / DAY
    score += days < 0 ? 70 : days < 2 ? 35 : days < 7 ? 15 : 0 // overdue work always rises to the top
  }
  const unblocks = tasks.filter((t) => t.status !== 'done' && (t.blockedBy ?? []).includes(task.id)).length
  score += unblocks * 10
  if (task.status === 'progress') score += 8 // finish what's started
  return score
}

export function prioritize(tasks, { userId, now = Date.now(), limit = 5 } = {}) {
  const byId = Object.fromEntries(tasks.map((t) => [t.id, t]))
  return tasks
    .filter((t) => t.status !== 'done' && (!userId || t.assigneeId === userId))
    .filter((t) => openBlockers(t, byId).length === 0) // only tasks that can actually start
    .map((t) => ({ task: t, score: scoreTask(t, tasks, now) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

// ---------------------------------------------------------------- Task generator

const TEMPLATES = [
  {
    match: /e-?commerce|shop|store|cart|checkout/,
    name: 'E-commerce website',
    phases: [
      ['Discovery', ['Define target customers and product catalogue', 'Write requirements and success metrics']],
      [
        'Design',
        ['Design homepage', 'Design product listing and product detail pages', 'Design cart and checkout flow'],
      ],
      [
        'Backend',
        [
          'Set up database schema for products and orders',
          'Create product API',
          'Implement authentication',
          'Integrate payment gateway',
        ],
      ],
      ['Frontend', ['Build homepage', 'Build product pages', 'Build shopping cart', 'Build checkout flow']],
      ['Quality', ['Test checkout end to end', 'Load test product API', 'Accessibility review']],
      ['Launch', ['Set up hosting and CI/CD', 'Configure analytics', 'Launch and monitor']],
    ],
  },
  {
    match: /mobile|android|ios|app\b/,
    name: 'Mobile app',
    phases: [
      ['Discovery', ['Define user personas', 'Prioritise MVP features']],
      ['Design', ['Create wireframes', 'Design UI kit', 'Prototype main flows']],
      [
        'Build',
        [
          'Set up project and navigation',
          'Implement authentication',
          'Build core screens',
          'Connect to API',
          'Add push notifications',
        ],
      ],
      ['Quality', ['Write unit tests', 'Test on real devices', 'Fix accessibility issues']],
      ['Release', ['Prepare store listings', 'Submit to app stores', 'Monitor crash reports']],
    ],
  },
  {
    match: /api|backend|service|microservice/,
    name: 'Backend API',
    phases: [
      ['Design', ['Write API specification (OpenAPI)', 'Design database schema']],
      [
        'Build',
        [
          'Set up project, linting and CI',
          'Implement authentication and authorisation',
          'Implement core endpoints',
          'Add input validation and error handling',
        ],
      ],
      ['Quality', ['Write integration tests', 'Add logging and metrics', 'Security review']],
      ['Release', ['Containerise with Docker', 'Deploy to staging', 'Deploy to production']],
    ],
  },
  {
    match: /market|campaign|launch|social/,
    name: 'Marketing campaign',
    phases: [
      ['Plan', ['Define goals and target audience', 'Set budget and channels']],
      ['Create', ['Write campaign copy', 'Design visuals', 'Build landing page']],
      ['Run', ['Schedule social posts', 'Launch email sequence', 'Run paid ads']],
      ['Measure', ['Track conversions', 'Write results report']],
    ],
  },
  {
    match: /website|landing|site|portfolio|blog/,
    name: 'Website',
    phases: [
      ['Plan', ['Define site goals and pages', 'Collect content']],
      ['Design', ['Create wireframes', 'Design visual style', 'Design responsive layouts']],
      ['Build', ['Set up project', 'Build page templates', 'Add contact form', 'Add SEO metadata']],
      ['Quality', ['Test on mobile and desktop', 'Accessibility and performance audit']],
      ['Launch', ['Deploy', 'Set up analytics']],
    ],
  },
]

const GENERIC = {
  name: 'Project',
  phases: [
    ['Plan', ['Define goals and scope', 'Identify stakeholders', 'Break work into milestones']],
    ['Execute', ['Complete first milestone', 'Review progress with stakeholders', 'Complete remaining milestones']],
    ['Wrap up', ['Test and review deliverables', 'Write handover notes', 'Run retrospective']],
  ],
}

/**
 * Turns a goal like "Build an e-commerce website" into ordered tasks with
 * estimates, priorities and dependencies (each phase depends on the previous one).
 */
export function generatePlan(goal, { startDate = Date.now(), hoursPerTask = 6 } = {}) {
  const text = String(goal).toLowerCase()
  const template = TEMPLATES.find((t) => t.match.test(text)) ?? GENERIC
  const tasks = []
  let prevPhaseIds = []
  let dayOffset = 0
  template.phases.forEach(([phase, titles], phaseIndex) => {
    const ids = []
    titles.forEach((title) => {
      const ref = `gen-${tasks.length + 1}`
      ids.push(ref)
      tasks.push({
        ref,
        title,
        phase,
        estimate: hoursPerTask,
        priority: phaseIndex === 0 ? 'high' : phaseIndex === template.phases.length - 1 ? 'medium' : 'medium',
        blockedBy: [...prevPhaseIds],
        dueDate: new Date(startDate + (dayOffset + 2) * DAY).toISOString().slice(0, 10),
      })
    })
    dayOffset += Math.ceil((titles.length * hoursPerTask) / 6)
    prevPhaseIds = ids
  })
  return { name: template.name, phases: template.phases.map((p) => p[0]), tasks }
}

// ---------------------------------------------------------------- Answering

const fmtDate = (ts) => new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

/**
 * @param {string} question
 * @param {{ tasks: any[], members: {id:string,name:string}[], projects: any[], userId?: string, now?: number }} ctx
 * @returns {{ intent: string, text: string, items?: any[], plan?: any }}
 */
export function answer(question, ctx) {
  const { tasks, members = [], projects = [], userId, now = Date.now() } = ctx
  const nameOf = (id) => members.find((m) => m.id === id)?.name ?? 'Unassigned'
  const intent = detectIntent(question)

  switch (intent) {
    case 'overdue': {
      const list = tasks.filter((t) => isOverdue(t, now))
      if (!list.length) return { intent, text: 'Good news — nothing is overdue right now. 🎉' }
      return {
        intent,
        text: `${list.length} task${list.length > 1 ? 's are' : ' is'} overdue:`,
        items: list.map((t) => ({
          id: t.id,
          label: `${t.title} — due ${fmtDate(t.dueDate)}, ${nameOf(t.assigneeId)}`,
        })),
      }
    }
    case 'summary': {
      const s = summarize(tasks, now)
      const weekAgo = now - 7 * DAY
      const doneWeek = tasks.filter((t) => t.completedAt >= weekAgo)
      const createdWeek = tasks.filter((t) => t.createdAt >= weekAgo).length
      return {
        intent,
        text:
          `This week the team completed ${doneWeek.length} task${doneWeek.length === 1 ? '' : 's'} and created ${createdWeek}. ` +
          `Overall ${s.done}/${s.total} tasks are done (${s.completionRate}%), ${s.inReview} are in review and ${s.overdue} overdue.`,
        items: doneWeek.slice(0, 5).map((t) => ({ id: t.id, label: `✓ ${t.title} (${nameOf(t.assigneeId)})` })),
      }
    }
    case 'prioritize': {
      const mine = prioritize(tasks, { userId, now })
      const list = mine.length ? mine : prioritize(tasks, { now })
      if (!list.length) return { intent, text: 'There is nothing open that can be started right now.' }
      return {
        intent,
        text: `Here's what I'd work on next${mine.length ? '' : ' (team-wide)'}, ranked by deadline, priority and how much each task unblocks:`,
        items: list.map(({ task, score }) => ({
          id: task.id,
          label: `${task.title} · ${task.priority} priority`,
          score,
        })),
      }
    }
    case 'plan': {
      const goal =
        question.replace(/^(please\s+)?(create|make|generate|build)( me)?( a)?( project)?( plan)?( for)?:?\s*/i, '') ||
        question
      const plan = generatePlan(goal, { startDate: now })
      return {
        intent,
        text: `I drafted a ${plan.tasks.length}-task plan for "${goal}" across ${plan.phases.length} phases (${plan.phases.join(' → ')}). Review it and add it to a project.`,
        plan,
      }
    }
    case 'risk': {
      const lines = projects.map((p) => {
        const pt = tasks.filter((t) => t.projectId === p.id)
        const f = predictCompletion(pt, { deadline: p.deadline, now })
        const when = f.predictedDate ? fmtDate(f.predictedDate) : 'unknown (no recent progress)'
        return {
          id: p.id,
          label: `${p.name}: ${f.remaining} open, forecast ${when}${f.risk === 'high' ? ` — ⚠ at risk${f.daysLate ? `, ~${f.daysLate} days late` : ''}` : f.risk === 'medium' ? ' — tight' : ''}`,
        }
      })
      return { intent, text: 'Deadline forecast based on the last 2 weeks of velocity:', items: lines }
    }
    case 'workload': {
      const counts = members
        .map((m) => ({ m, n: tasks.filter((t) => t.assigneeId === m.id && t.status !== 'done').length }))
        .sort((a, b) => b.n - a.n)
      return {
        intent,
        text: 'Open tasks per person:',
        items: counts.map(({ m, n }) => ({ id: m.id, label: `${m.name}: ${n}${n > 5 ? ' — overloaded' : ''}` })),
      }
    }
    case 'help':
    default:
      return {
        intent: intent === 'help' ? 'help' : 'unknown',
        text:
          (intent === 'unknown' ? "I'm not sure about that one yet. " : '') +
          'Try: "What tasks are overdue?", "Summarize this week", "What should I prioritize?", "Are we on track?", "Who is overloaded?" or "Create a plan for building a mobile app".',
      }
  }
}
