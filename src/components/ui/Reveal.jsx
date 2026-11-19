import useInView from '@/hooks/useInView'
import './Reveal.css'

/**
 * Wraps children and fades/slides them in when scrolled into view.
 * `delay` (ms) lets you stagger items in a grid.
 */
export default function Reveal({ children, as: Tag = 'div', delay = 0, direction = 'up', className = '', ...rest }) {
  const [ref, inView] = useInView()

  return (
    <Tag
      ref={ref}
      className={`reveal reveal--${direction} ${inView ? 'is-visible' : ''} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
      {...rest}
    >
      {children}
    </Tag>
  )
}
