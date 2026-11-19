/**
 * Command definitions for the palette. Pure data + a pure filter function,
 * so adding a command is one object and the search logic is unit-tested.
 *
 * A command has either `to` (navigate) or `run(ctx)` (perform an action).
 */
export function buildCommands({ theme, billing }) {
  return [
    { id: 'nav-home', group: 'Pages', label: 'Home', icon: 'arrowRight', to: '/', keywords: 'start landing' },
    { id: 'nav-features', group: 'Pages', label: 'Features', icon: 'arrowRight', to: '/#features' },
    {
      id: 'nav-demo',
      group: 'Pages',
      label: 'Live board demo',
      icon: 'board',
      to: '/#demo',
      keywords: 'kanban try tasks',
    },
    {
      id: 'nav-pricing',
      group: 'Pages',
      label: 'Pricing',
      icon: 'arrowRight',
      to: '/pricing',
      keywords: 'plans cost price',
    },
    {
      id: 'nav-roi',
      group: 'Pages',
      label: 'ROI calculator',
      icon: 'calculator',
      to: '/pricing#roi',
      keywords: 'savings value',
    },
    {
      id: 'nav-compare',
      group: 'Pages',
      label: 'Compare plans',
      icon: 'chart',
      to: '/pricing#compare',
      keywords: 'features table',
    },
    { id: 'nav-blog', group: 'Pages', label: 'Blog', icon: 'arrowRight', to: '/blog', keywords: 'articles posts' },
    {
      id: 'nav-contact',
      group: 'Pages',
      label: 'Contact sales',
      icon: 'mail',
      to: '/contact',
      keywords: 'email support help',
    },
    {
      id: 'act-theme',
      group: 'Actions',
      label: `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`,
      icon: theme === 'dark' ? 'sun' : 'moon',
      keywords: 'theme dark light appearance',
      run: ({ actions }) => actions.toggleTheme(),
    },
    {
      id: 'act-billing',
      group: 'Actions',
      label: `Show ${billing === 'yearly' ? 'monthly' : 'yearly'} prices`,
      icon: 'refresh',
      keywords: 'billing annual monthly yearly',
      run: ({ actions }) => actions.setBilling(billing === 'yearly' ? 'monthly' : 'yearly'),
    },
  ]
}

/** Every word of the query must appear in the label or keywords (case-insensitive). */
export function filterCommands(commands, query) {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return commands
  return commands.filter((c) => {
    const haystack = `${c.label} ${c.keywords ?? ''} ${c.group}`.toLowerCase()
    return words.every((w) => haystack.includes(w))
  })
}
