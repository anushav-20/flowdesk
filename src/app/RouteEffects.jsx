import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'

/**
 * Side effects that a single-page app must handle itself on navigation:
 *  1. Scroll: jump to `#hash` targets (waiting for lazy sections to mount), or to the top on a new page
 *  2. Focus: move focus to the new page's <h1> so keyboard users start at the content
 *  3. Announce: tell screen-reader users the page changed (SPAs don't trigger a page load)
 */
export default function RouteEffects() {
  const { pathname, hash } = useLocation()
  const [announcement, setAnnouncement] = useState('')
  const isFirstRender = useRef(true)

  // 1. Scroll handling
  useEffect(() => {
    if (!hash) {
      window.scrollTo({ top: 0, behavior: 'instant' })
      return
    }
    const id = decodeURIComponent(hash.slice(1))
    let frame
    const started = performance.now()
    const tryScroll = () => {
      const el = document.getElementById(id)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      else if (performance.now() - started < 3000) frame = requestAnimationFrame(tryScroll)
    }
    tryScroll()
    return () => cancelAnimationFrame(frame)
    // `pathname` is a deliberate trigger: a new page must scroll to top even though it isn't read here
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [pathname, hash])

  // 2 + 3. Focus and announce on page change (not on first load, not on in-page hash jumps)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    // Wait a tick so the new page (and its document title) has rendered
    const t = setTimeout(() => {
      if (!hash) {
        const heading = document.querySelector('main h1')
        if (heading) {
          heading.setAttribute('tabindex', '-1')
          heading.focus({ preventScroll: true })
        }
      }
      setAnnouncement(`Navigated to ${document.title}`)
    }, 120)
    return () => clearTimeout(t)
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [pathname, hash])

  return (
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {announcement}
    </p>
  )
}
