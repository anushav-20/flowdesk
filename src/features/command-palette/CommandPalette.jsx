import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import Icon from '@/components/ui/Icon'
import useFocusTrap from '@/hooks/useFocusTrap'
import { appActions, selectBilling, selectTheme, useAppStore } from '@/store/appStore'
import { buildCommands, filterCommands } from './commands'
import './CommandPalette.css'

/**
 * ⌘K / Ctrl+K command menu, built on the WAI-ARIA combobox + listbox pattern:
 * focus stays in the input while ↑/↓ move a virtual selection (aria-activedescendant).
 */
export default function CommandPalette() {
  const theme = useAppStore(selectTheme)
  const billing = useAppStore(selectBilling)
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const dialogRef = useRef(null)
  const inputRef = useRef(null)
  const listId = useId()

  useFocusTrap(dialogRef, true)

  useEffect(() => {
    inputRef.current?.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [])

  const results = useMemo(() => {
    const filtered = filterCommands(buildCommands({ theme, billing }), query)
    const q = query.trim()
    // Always offer a blog search for whatever was typed
    if (q.length >= 2) {
      filtered.push({
        id: 'search-blog',
        group: 'Search',
        label: `Search the blog for “${q}”`,
        icon: 'search',
        to: `/blog?q=${encodeURIComponent(q)}`,
      })
    }
    return filtered
  }, [query, theme, billing])

  // Reset the highlighted row whenever the result list changes
  const [lastResults, setLastResults] = useState(results)
  if (lastResults !== results) {
    setLastResults(results)
    setActive(0)
  }

  const runCommand = (cmd) => {
    if (!cmd) return
    appActions.closePalette()
    if (cmd.to) navigate(cmd.to)
    else cmd.run?.({ actions: appActions })
  }

  const onKeyDown = (e) => {
    const last = results.length - 1
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActive((i) => (i >= last ? 0 : i + 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActive((i) => (i <= 0 ? last : i - 1))
        break
      case 'Home':
        e.preventDefault()
        setActive(0)
        break
      case 'End':
        e.preventDefault()
        setActive(last)
        break
      case 'Enter':
        e.preventDefault()
        runCommand(results[active])
        break
      case 'Escape':
        e.preventDefault()
        appActions.closePalette()
        break
      default:
    }
  }

  // Keep the highlighted option scrolled into view
  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, listId])

  return (
    <div
      className="palette-backdrop"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && appActions.closePalette()}
    >
      <div ref={dialogRef} className="palette" role="dialog" aria-modal="true" aria-label="Command menu">
        <div className="palette__search">
          <Icon name="search" size={20} />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={results.length ? `${listId}-${active}` : undefined}
            aria-label="Type a command or search"
            placeholder="Type a command or search…"
            value={query}
            maxLength={100}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <kbd>Esc</kbd>
        </div>

        <div id={listId} role="listbox" className="palette__list" aria-label="Commands">
          {results.length === 0 && (
            <p className="palette__empty" role="presentation">
              No results for “{query}”
            </p>
          )}
          {results.map((cmd, i) => {
            const showGroup = i === 0 || results[i - 1].group !== cmd.group
            return (
              <div key={cmd.id} role="presentation">
                {showGroup && (
                  <p className="palette__group" aria-hidden="true">
                    {cmd.group}
                  </p>
                )}
                {/* Keyboard selection is handled by the combobox input (aria-activedescendant), so options stay out of the tab order */}
                {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events */}
                <div
                  id={`${listId}-${i}`}
                  role="option"
                  tabIndex={-1}
                  aria-selected={i === active}
                  className={`palette__option ${i === active ? 'is-active' : ''}`}
                  onMouseMove={() => i !== active && setActive(i)}
                  onClick={() => runCommand(cmd)}
                >
                  <Icon name={cmd.icon} size={18} />
                  <span>{cmd.label}</span>
                  {i === active && <kbd aria-hidden="true">↵</kbd>}
                </div>
              </div>
            )
          })}
        </div>

        <p className="palette__footer" aria-hidden="true">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> select
          </span>
          <span>
            <kbd>Esc</kbd> close
          </span>
        </p>
      </div>
    </div>
  )
}
