// Route config module (not a component file), so the fast-refresh rule doesn't apply here.
// oxlint-disable react/only-export-components
import { lazy, Suspense } from 'react'
import { createBrowserRouter, createHashRouter, createMemoryRouter } from 'react-router'
import { env } from '@/config/env'
import PageLoader from '@/components/ui/PageLoader'
import HomePage from '@/pages/HomePage'
import AppLayout from './AppLayout'
import RouteError from './RouteError'

// Route-level code splitting: each page is its own JS chunk, downloaded on first visit.
// The home page is imported eagerly because it's the most common landing route.
const PricingPage = lazy(() => import('@/pages/PricingPage'))
const BlogPage = lazy(() => import('@/pages/BlogPage'))
const PostPage = lazy(() => import('@/pages/PostPage'))
const ContactPage = lazy(() => import('@/pages/ContactPage'))
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'))

// The workspace app is a separate bundle: website visitors never download it
const WorkspaceRoot = lazy(() => import('@/workspace/WorkspaceRoot'))
const ws = {
  Dashboard: lazy(() => import('@/workspace/pages/DashboardPage')),
  Board: lazy(() => import('@/workspace/pages/BoardPage')),
  Calendar: lazy(() => import('@/workspace/pages/CalendarPage')),
  Dependencies: lazy(() => import('@/workspace/pages/DependenciesPage')),
  Docs: lazy(() => import('@/workspace/pages/DocsPage')),
  Analytics: lazy(() => import('@/workspace/pages/AnalyticsPage')),
  Workload: lazy(() => import('@/workspace/pages/WorkloadPage')),
  Activity: lazy(() => import('@/workspace/pages/ActivityPage')),
  Approvals: lazy(() => import('@/workspace/pages/ApprovalsPage')),
  Automations: lazy(() => import('@/workspace/pages/AutomationsPage')),
  Integrations: lazy(() => import('@/workspace/pages/IntegrationsPage')),
  Team: lazy(() => import('@/workspace/pages/TeamPage')),
  Jobs: lazy(() => import('@/workspace/pages/JobsPage')),
  Health: lazy(() => import('@/workspace/pages/HealthPage')),
  Settings: lazy(() => import('@/workspace/pages/SettingsPage')),
}

export const routes = [
  {
    path: '/',
    element: <AppLayout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'pricing', element: <PricingPage /> },
      { path: 'blog', element: <BlogPage /> },
      { path: 'blog/:postId', element: <PostPage /> },
      { path: 'contact', element: <ContactPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  {
    path: '/app',
    element: (
      <Suspense fallback={<PageLoader />}>
        <WorkspaceRoot />
      </Suspense>
    ),
    errorElement: <RouteError />,
    children: [
      { index: true, element: <ws.Dashboard /> },
      { path: 'board', element: <ws.Board /> },
      { path: 'calendar', element: <ws.Calendar /> },
      { path: 'dependencies', element: <ws.Dependencies /> },
      { path: 'docs', element: <ws.Docs /> },
      { path: 'docs/:docId', element: <ws.Docs /> },
      { path: 'analytics', element: <ws.Analytics /> },
      { path: 'workload', element: <ws.Workload /> },
      { path: 'activity', element: <ws.Activity /> },
      { path: 'approvals', element: <ws.Approvals /> },
      { path: 'automations', element: <ws.Automations /> },
      { path: 'integrations', element: <ws.Integrations /> },
      { path: 'team', element: <ws.Team /> },
      { path: 'jobs', element: <ws.Jobs /> },
      { path: 'health', element: <ws.Health /> },
      { path: 'settings', element: <ws.Settings /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]

/** Router type is chosen per deployment target (see .env.example). */
export function createAppRouter(mode = env.routerMode) {
  if (mode === 'hash') return createHashRouter(routes)
  if (mode === 'memory') return createMemoryRouter(routes)
  return createBrowserRouter(routes)
}
