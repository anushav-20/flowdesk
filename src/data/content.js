/**
 * All static copy lives here so sections stay purely presentational.
 * Change text in one place without touching components.
 */

export const navLinks = [
  { label: 'Features', to: '/#features' },
  { label: 'Live demo', to: '/#demo' },
  { label: 'Pricing', to: '/pricing' },
  { label: 'Blog', to: '/blog' },
  { label: 'Contact', to: '/contact' },
]

export const appLink = { label: 'Open the app', to: '/app' }

export const hero = {
  badge: 'New · AI task summaries are here',
  title: 'Plan, track and ship work',
  highlight: 'without the chaos',
  subtitle:
    'FlowDesk is the project workspace for fast-moving teams. Plan sprints on visual boards, automate busywork and get AI summaries of what changed — so everyone knows what to do next.',
  primaryCta: { label: 'Get started free', to: '/pricing' },
  secondaryCta: { label: 'Open the full app', to: '/app' },
  trustNote: 'Free forever for up to 5 people · No credit card required',
  stats: [
    { value: '12k+', label: 'Teams onboard' },
    { value: '4.9/5', label: 'Average rating' },
    { value: '38%', label: 'Faster delivery' },
  ],
}

export const logos = ['Northwind', 'Acme Co', 'Globex', 'Umbrella', 'Initech', 'Hooli']

export const features = [
  {
    icon: 'board',
    title: 'Visual boards',
    text: 'Drag tasks across Kanban, list and timeline views. Every teammate sees the same source of truth.',
  },
  {
    icon: 'spark',
    title: 'AI summaries',
    text: 'Catch up in seconds. FlowDesk summarises long threads and suggests the next action.',
  },
  {
    icon: 'bolt',
    title: 'Automations',
    text: 'Move cards, assign owners and send reminders automatically with no-code rules.',
  },
  {
    icon: 'chart',
    title: 'Live reports',
    text: 'Track velocity, workload and deadlines with dashboards that update in real time.',
  },
  {
    icon: 'lock',
    title: 'Secure by default',
    text: 'SSO, role-based access and encrypted storage keep your company data safe.',
  },
  {
    icon: 'plug',
    title: '50+ integrations',
    text: 'Connect GitHub, Slack, Google Drive and more so work flows between your tools.',
  },
]

export const steps = [
  { title: 'Create a workspace', text: 'Sign up in under a minute and invite your team with one link.' },
  { title: 'Import or add tasks', text: 'Bring work in from spreadsheets or other tools, or start fresh.' },
  { title: 'Ship together', text: 'Track progress, automate busywork and celebrate every release.' },
]

export const plans = [
  {
    name: 'Starter',
    description: 'For individuals and small teams getting started.',
    monthly: 0,
    yearly: 0,
    features: ['Up to 5 members', 'Unlimited tasks', 'Board & list views', 'Community support'],
    cta: 'Get started',
    featured: false,
  },
  {
    name: 'Pro',
    description: 'For growing teams that need more power.',
    monthly: 12,
    yearly: 10,
    features: [
      'Unlimited members',
      'Timeline & reports',
      'AI summaries',
      'Automations (1k runs/mo)',
      'Priority support',
    ],
    cta: 'Start 14-day trial',
    featured: true,
  },
  {
    name: 'Business',
    description: 'For organisations with advanced needs.',
    monthly: 24,
    yearly: 20,
    features: ['Everything in Pro', 'SSO & audit logs', 'Unlimited automations', 'Dedicated manager'],
    cta: 'Contact sales',
    featured: false,
  },
]

// Sample testimonials for this demo brand (placeholder content).
export const testimonials = [
  {
    quote: 'We replaced three tools with FlowDesk. Stand-ups went from 30 minutes to 10.',
    name: 'Priya Raman',
    role: 'Engineering Lead (sample)',
  },
  {
    quote: 'The AI summaries are a lifesaver after a week off. I am caught up before my coffee is done.',
    name: 'Daniel Brooks',
    role: 'Product Manager (sample)',
  },
  {
    quote: 'Setup took one afternoon and the whole design team adopted it the same week.',
    name: 'Meera Joshi',
    role: 'Design Director (sample)',
  },
]

export const faqs = [
  {
    q: 'Is there really a free plan?',
    a: 'Yes. The Starter plan is free forever for teams of up to 5 people, with unlimited tasks.',
  },
  {
    q: 'Can I switch plans later?',
    a: 'Absolutely. Upgrade, downgrade or cancel at any time from your billing settings — changes are prorated.',
  },
  {
    q: 'Do you offer discounts for students and non-profits?',
    a: 'We offer 50% off Pro for verified students, educators and registered non-profits.',
  },
  {
    q: 'How is my data protected?',
    a: 'All data is encrypted in transit and at rest. Business plans add SSO, audit logs and custom retention.',
  },
]

export const footerLinks = [
  {
    heading: 'Product',
    links: [
      { label: 'Features', to: '/#features' },
      { label: 'Live demo', to: '/#demo' },
      { label: 'Pricing', to: '/pricing' },
      { label: 'ROI calculator', to: '/pricing#roi' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'Blog', to: '/blog' },
      { label: 'Contact', to: '/contact' },
      { label: 'FAQ', to: '/#faq' },
    ],
  },
  {
    heading: 'Resources',
    links: [
      { label: 'Compare plans', to: '/pricing#compare' },
      { label: 'How it works', to: '/#how-it-works' },
      { label: 'Keyboard shortcuts', to: '/#demo' },
    ],
  },
]

/** Feature comparison matrix for the pricing page. true/false render as ✓ / –. */
export const comparison = {
  plans: ['Starter', 'Pro', 'Business'],
  groups: [
    {
      name: 'Core',
      rows: [
        { feature: 'Team members', values: ['Up to 5', 'Unlimited', 'Unlimited'] },
        { feature: 'Tasks & projects', values: ['Unlimited', 'Unlimited', 'Unlimited'] },
        { feature: 'Board & list views', values: [true, true, true] },
        { feature: 'Timeline view', values: [false, true, true] },
      ],
    },
    {
      name: 'Productivity',
      rows: [
        { feature: 'AI summaries', values: [false, true, true] },
        { feature: 'Automation runs / month', values: ['100', '1,000', 'Unlimited'] },
        { feature: 'Live reports', values: [false, true, true] },
      ],
    },
    {
      name: 'Security & support',
      rows: [
        { feature: 'SSO (SAML)', values: [false, false, true] },
        { feature: 'Audit logs', values: [false, false, true] },
        { feature: 'Support', values: ['Community', 'Priority', 'Dedicated manager'] },
      ],
    },
  ],
}

export const contactTopics = [
  { value: 'sales', label: 'Sales & pricing' },
  { value: 'support', label: 'Product support' },
  { value: 'partnership', label: 'Partnerships' },
]

export const teamSizes = ['1–5', '6–20', '21–100', '100+']

/** Starting tasks for the interactive board demo. */
export const boardSeed = [
  { id: 't1', title: 'Write launch announcement', column: 'todo', priority: 'medium' },
  { id: 't2', title: 'Interview 5 beta users', column: 'todo', priority: 'high' },
  { id: 't3', title: 'Pricing page v2', column: 'progress', priority: 'high' },
  { id: 't4', title: 'Fix API rate limits', column: 'progress', priority: 'low' },
  { id: 't5', title: 'Set up onboarding emails', column: 'done', priority: 'medium' },
]

export const blogTags = ['history', 'love', 'crime', 'fiction', 'mystery', 'magical', 'french', 'english']
// Shown in the Blog section if the live API can't be reached.
export const fallbackPosts = [
  {
    id: 'f1',
    title: 'How we cut our stand-ups in half',
    excerpt:
      'Async updates, clear owners and one shared board: the three changes that gave our team back two hours a week.',
    tag: 'productivity',
    likes: 214,
    views: 3120,
    readTime: 4,
  },
  {
    id: 'f2',
    title: 'Automations every team should set up on day one',
    excerpt: 'Five no-code rules that remove busywork, from auto-assigning reviewers to nudging overdue tasks.',
    tag: 'guides',
    likes: 187,
    views: 2675,
    readTime: 5,
  },
  {
    id: 'f3',
    title: 'Writing tasks your teammates can actually finish',
    excerpt: 'A simple template for task descriptions that cuts back-and-forth and gets work moving faster.',
    tag: 'teamwork',
    likes: 152,
    views: 1980,
    readTime: 3,
  },
]
