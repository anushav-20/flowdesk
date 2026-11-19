import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router'
import { navLinks } from '@/data/content'
import useScrollPosition from '@/hooks/useScrollPosition'
import { appActions } from '@/store/appStore'
import Button from '../ui/Button'
import Icon from '../ui/Icon'
import Logo from '../ui/Logo'
import ThemeToggle from '../ui/ThemeToggle'
import './Navbar.css'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

export default function Navbar() {
  const [open, setOpen] = useState(false)
  const scrolled = useScrollPosition() > 10
  const location = useLocation()
  const toggleRef = useRef(null)

  // Close the mobile menu whenever the route changes ("adjust state on prop change" pattern)
  const [lastPath, setLastPath] = useState(location.pathname + location.hash)
  if (lastPath !== location.pathname + location.hash) {
    setLastPath(location.pathname + location.hash)
    setOpen(false)
  }

  // Escape closes the menu; page scroll is locked while it's open
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false)
        toggleRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open])

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 900px)')
    const onChange = (e) => e.matches && setOpen(false)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  /** Hash links ("/#demo") are "active" only when that hash is showing; route links by path. */
  const isActive = (to) => {
    const [path, hash] = to.split('#')
    if (hash) return location.pathname === path && location.hash === `#${hash}`
    return location.pathname.startsWith(path)
  }

  return (
    <header className={`navbar ${scrolled || open ? 'navbar--scrolled' : ''}`}>
      <nav className="navbar__inner container" aria-label="Main">
        <Link to="/" className="navbar__brand" aria-label="FlowDesk home">
          <Logo />
        </Link>

        <ul id="primary-menu" className={`navbar__links ${open ? 'is-open' : ''}`}>
          {navLinks.map((link) => {
            const active = isActive(link.to)
            return (
              <li key={link.to}>
                <NavLink
                  to={link.to}
                  className={`navbar__link ${active ? 'is-active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                >
                  {link.label}
                </NavLink>
              </li>
            )
          })}
          <li className="navbar__mobile-cta">
            <Button to="/app" fullWidth>
              Open the app
            </Button>
          </li>
        </ul>

        <div className="navbar__actions">
          <button
            type="button"
            className="navbar__search"
            onClick={appActions.openPalette}
            aria-label="Open command menu"
            aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
          >
            <Icon name="search" size={17} />
            <span className="navbar__search-label">Search</span>
            <kbd>{isMac ? '⌘' : 'Ctrl'} K</kbd>
          </button>
          <ThemeToggle />
          <Button to="/app" size="sm" className="navbar__cta" icon="arrowRight">
            Open the app
          </Button>
          <button
            ref={toggleRef}
            type="button"
            className="navbar__toggle"
            aria-expanded={open}
            aria-controls="primary-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((o) => !o)}
          >
            <Icon name={open ? 'close' : 'menu'} size={22} />
          </button>
        </div>
      </nav>
      {open && <div className="navbar__backdrop" onClick={() => setOpen(false)} aria-hidden="true" />}
    </header>
  )
}
