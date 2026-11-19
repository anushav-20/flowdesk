/**
 * Gamification: points, daily streaks and achievements.
 * Pure reducer over activity events, so the same rules run in the browser and on the server.
 */

export const POINTS = { task_completed: 10, task_completed_high: 15, pomodoro: 5, comment: 2, approval: 5 }

export const BADGES = {
  first_task: { name: 'First win', description: 'Complete your first task', icon: '🎯' },
  ten_tasks: { name: 'Closer', description: 'Complete 10 tasks', icon: '🏁' },
  focus_5: { name: 'Deep focus', description: 'Finish 5 Pomodoro sessions', icon: '🍅' },
  streak_3: { name: 'On a roll', description: '3-day activity streak', icon: '🔥' },
  streak_7: { name: 'Unstoppable', description: '7-day activity streak', icon: '⚡' },
  reviewer: { name: 'Gatekeeper', description: 'Approve 3 tasks', icon: '🛡️' },
  collaborator: { name: 'Team player', description: 'Write 5 comments', icon: '💬' },
}

export const emptyStats = () => ({
  points: 0,
  streak: 0,
  lastActiveDay: null,
  completed: 0,
  pomodoros: 0,
  approvals: 0,
  comments: 0,
  badges: [],
})

const dayKey = (ts) => new Date(ts).toISOString().slice(0, 10)
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)

/**
 * @param {ReturnType<typeof emptyStats>} stats
 * @param {{ type: 'task_completed'|'pomodoro'|'comment'|'approval', priority?: string, at: number }} event
 * @returns {{ stats: ReturnType<typeof emptyStats>, newBadges: string[], gained: number }}
 */
export function applyEvent(stats, event) {
  const s = { ...emptyStats(), ...stats, badges: [...(stats?.badges ?? [])] }
  let gained = 0
  if (event.type === 'task_completed') {
    gained = event.priority === 'high' ? POINTS.task_completed_high : POINTS.task_completed
    s.completed++
  } else if (event.type === 'pomodoro') {
    gained = POINTS.pomodoro
    s.pomodoros++
  } else if (event.type === 'comment') {
    gained = POINTS.comment
    s.comments++
  } else if (event.type === 'approval') {
    gained = POINTS.approval
    s.approvals++
  }
  s.points += gained

  const today = dayKey(event.at)
  if (s.lastActiveDay !== today) {
    s.streak = s.lastActiveDay && daysBetween(s.lastActiveDay, today) === 1 ? s.streak + 1 : 1
    s.lastActiveDay = today
  }

  const earned = []
  const award = (id, cond) => {
    if (cond && !s.badges.includes(id)) {
      s.badges.push(id)
      earned.push(id)
    }
  }
  award('first_task', s.completed >= 1)
  award('ten_tasks', s.completed >= 10)
  award('focus_5', s.pomodoros >= 5)
  award('streak_3', s.streak >= 3)
  award('streak_7', s.streak >= 7)
  award('reviewer', s.approvals >= 3)
  award('collaborator', s.comments >= 5)

  return { stats: s, newBadges: earned, gained }
}

export const level = (points) => Math.floor(Math.sqrt(points / 25)) + 1
