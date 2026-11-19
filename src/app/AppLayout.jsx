import { lazy, Suspense } from 'react'
import { Outlet, useLocation } from 'react-router'
import ErrorBoundary from '@/components/ErrorBoundary'
import Footer from '@/components/layout/Footer'
import Navbar from '@/components/layout/Navbar'
import BackToTop from '@/components/ui/BackToTop'
import PageLoader from '@/components/ui/PageLoader'
import ToastRegion from '@/components/ui/Toast'
import useHotkey from '@/hooks/useHotkey'
import { appActions, selectPaletteOpen, useAppStore } from '@/store/appStore'
import RouteEffects from './RouteEffects'
import ThemeSync from './ThemeSync'

// The command palette is only downloaded the first time someone opens it
const CommandPalette = lazy(() => import('@/features/command-palette/CommandPalette'))

export default function AppLayout() {
  const paletteOpen = useAppStore(selectPaletteOpen)
  const { pathname } = useLocation()
  useHotkey('mod+k', appActions.openPalette)

  return (
    <>
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <ThemeSync />
      <RouteEffects />
      <Navbar />
      <main id="main" tabIndex={-1}>
        {/* Keyed by path so an error on one page resets when the user navigates away */}
        <ErrorBoundary key={pathname}>
          <Suspense fallback={<PageLoader />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>
      <Footer />
      <BackToTop />
      <ToastRegion />
      {paletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette />
        </Suspense>
      )}
    </>
  )
}
