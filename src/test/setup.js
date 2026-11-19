import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import { clearCache } from '@/lib/queryCache'
import { appStore, initialAppState } from '@/store/appStore'
import { boardStore, buildInitialState } from '@/features/board/boardStore'

// ----- Browser APIs that jsdom doesn't implement -----
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })
}
window.scrollTo = vi.fn()
Element.prototype.scrollIntoView = vi.fn()

// ----- Isolate every test: fresh stores, cache and storage -----
beforeEach(() => {
  localStorage.clear()
  clearCache()
  appStore.setState({ ...initialAppState, toasts: [] })
  boardStore.setState(buildInitialState())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
