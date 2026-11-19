import useScrollPosition from '@/hooks/useScrollPosition'
import Icon from './Icon'
import './BackToTop.css'

export default function BackToTop() {
  const y = useScrollPosition()
  const visible = y > 700

  const scrollUp = () => {
    window.scrollTo({ top: 0 })
    document.getElementById('main')?.focus({ preventScroll: true })
  }

  return (
    <button
      type="button"
      className={`back-to-top ${visible ? 'is-visible' : ''}`}
      onClick={scrollUp}
      aria-label="Back to top"
      tabIndex={visible ? 0 : -1}
      aria-hidden={!visible}
    >
      <Icon name="arrowUp" size={20} />
    </button>
  )
}
