/**
 * Offline fallback content. Used only when the API is unreachable (network error /
 * blocked by the host), so the blog degrades gracefully instead of showing an error.
 */
export const fallbackPosts = [
  {
    id: 'f1',
    title: 'How we cut our stand-ups in half',
    body: 'Async updates, clear owners and one shared board: the three changes that gave our team back two hours a week. We stopped reading status aloud and started using the meeting only for blockers. Everyone posts a short update on their cards before 10am, so the stand-up is about decisions, not reporting.',
    tags: ['productivity', 'teamwork'],
    reactions: { likes: 214, dislikes: 3 },
    views: 3120,
    userId: 1,
  },
  {
    id: 'f2',
    title: 'Automations every team should set up on day one',
    body: 'Five no-code rules that remove busywork, from auto-assigning reviewers to nudging overdue tasks. Start with the rule that moves a card to Done when its pull request merges, then add reminders for tasks that sit untouched for three days.',
    tags: ['guides', 'automation'],
    reactions: { likes: 187, dislikes: 2 },
    views: 2675,
    userId: 2,
  },
  {
    id: 'f3',
    title: 'Writing tasks your teammates can actually finish',
    body: 'A simple template for task descriptions that cuts back-and-forth and gets work moving faster. Every task answers three questions: what does done look like, why does it matter, and who can unblock it if it gets stuck.',
    tags: ['teamwork', 'guides'],
    reactions: { likes: 152, dislikes: 1 },
    views: 1980,
    userId: 3,
  },
  {
    id: 'f4',
    title: 'The case for fewer, better meetings',
    body: 'Most recurring meetings exist because information is hard to find. Put the information somewhere everyone can see it and half of those meetings disappear on their own.',
    tags: ['productivity'],
    reactions: { likes: 133, dislikes: 4 },
    views: 1712,
    userId: 1,
  },
  {
    id: 'f5',
    title: 'Planning a sprint in 30 minutes',
    body: 'A repeatable agenda: review what shipped, pull the top of the backlog, size it together, and stop when the team is confident. Anything that needs more discussion becomes its own task.',
    tags: ['guides', 'planning'],
    reactions: { likes: 121, dislikes: 0 },
    views: 1540,
    userId: 2,
  },
  {
    id: 'f6',
    title: 'Measuring delivery without micromanaging',
    body: 'Track flow, not people. Cycle time and work in progress tell you where work gets stuck, and they make a much better conversation starter than individual output.',
    tags: ['planning', 'productivity'],
    reactions: { likes: 98, dislikes: 2 },
    views: 1302,
    userId: 3,
  },
]

export const fallbackAuthors = {
  1: { firstName: 'Priya', lastName: 'Raman' },
  2: { firstName: 'Daniel', lastName: 'Brooks' },
  3: { firstName: 'Meera', lastName: 'Joshi' },
}
