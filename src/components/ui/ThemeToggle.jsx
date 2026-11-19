import { appActions, selectTheme, useAppStore } from '@/store/appStore'
import Icon from './Icon'
import './ThemeToggle.css'

export default function ThemeToggle() {
  const theme = useAppStore(selectTheme)
  const isDark = theme === 'dark'
  const label = `Switch to ${isDark ? 'light' : 'dark'} mode`

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={appActions.toggleTheme}
      aria-label={label}
      aria-pressed={isDark}
      title={label}
    >
      <span className={`theme-toggle__icon ${isDark ? 'is-hidden' : ''}`}>
        <Icon name="moon" size={19} />
      </span>
      <span className={`theme-toggle__icon ${isDark ? '' : 'is-hidden'}`}>
        <Icon name="sun" size={19} />
      </span>
    </button>
  )
}
