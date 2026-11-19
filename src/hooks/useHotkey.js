import { useEffect, useRef } from 'react'

/**
 * Registers a global keyboard shortcut.
 * `combo` like 'mod+k' — `mod` means ⌘ on macOS and Ctrl elsewhere.
 */
export default function useHotkey(combo, handler) {
  const handlerRef = useRef(handler)
  useEffect(() => {
    handlerRef.current = handler
  })

  useEffect(() => {
    const parts = combo.toLowerCase().split('+')
    const key = parts.pop()
    const needsMod = parts.includes('mod')
    const needsShift = parts.includes('shift')

    const onKeyDown = (e) => {
      const mod = e.metaKey || e.ctrlKey
      if (e.key.toLowerCase() === key && mod === needsMod && e.shiftKey === needsShift) {
        e.preventDefault()
        handlerRef.current(e)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [combo])
}
