import { useEffect } from 'react'
import { selectTheme, useAppStore } from '@/store/appStore'

/** Mirrors the theme from the store onto <html data-theme> and the browser UI colour. */
export default function ThemeSync() {
  const theme = useAppStore(selectTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#0b0d17' : '#6d5dfc')
  }, [theme])

  return null
}
