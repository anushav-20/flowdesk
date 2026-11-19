/** Workspace navigation. `key` is the second key of the "G then X" shortcut. */
export const NAV = [
  {
    group: 'Work',
    items: [
      { to: '/app', label: 'Dashboard', icon: 'chart', end: true, key: 'd' },
      { to: '/app/board', label: 'Board', icon: 'board', key: 'b' },
      { to: '/app/calendar', label: 'Calendar', icon: 'calendar', key: 'c' },
      { to: '/app/dependencies', label: 'Dependencies', icon: 'graph', key: 'g' },
      { to: '/app/docs', label: 'Docs', icon: 'doc', key: 'o' },
    ],
  },
  {
    group: 'Insights',
    items: [
      { to: '/app/analytics', label: 'Analytics', icon: 'chart', key: 'a' },
      { to: '/app/workload', label: 'Workload', icon: 'user', key: 'w' },
      { to: '/app/activity', label: 'Activity & audit', icon: 'refresh', key: 'l' },
    ],
  },
  {
    group: 'Workflow',
    items: [
      { to: '/app/approvals', label: 'Approvals', icon: 'check', key: 'p' },
      { to: '/app/automations', label: 'Automations', icon: 'bolt', key: 'u' },
      { to: '/app/integrations', label: 'Integrations', icon: 'plug', key: 'i' },
    ],
  },
  {
    group: 'Admin',
    items: [
      { to: '/app/team', label: 'Team & roles', icon: 'user', key: 't' },
      { to: '/app/jobs', label: 'Background jobs', icon: 'refresh', key: 'j' },
      { to: '/app/health', label: 'System health', icon: 'eye', key: 'h' },
      { to: '/app/settings', label: 'Settings', icon: 'lock', key: 's' },
    ],
  },
]
