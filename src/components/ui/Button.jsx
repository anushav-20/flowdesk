import { Link } from 'react-router'
import Icon from './Icon'
import './Button.css'

/**
 * Polymorphic button.
 *  - `to`   → client-side route link (React Router <Link>)
 *  - `href` → regular anchor (external links / in-page anchors)
 *  - none   → <button>
 *
 * @param {{ variant?: 'primary'|'secondary'|'ghost'|'danger', size?: 'sm'|'md'|'lg', icon?: string,
 *           iconLeft?: string, fullWidth?: boolean, loading?: boolean, to?: string, href?: string }} props
 */
export default function Button({
  children,
  to,
  href,
  variant = 'primary',
  size = 'md',
  icon,
  iconLeft,
  fullWidth = false,
  loading = false,
  className = '',
  ...rest
}) {
  const classes = [
    'btn',
    `btn--${variant}`,
    `btn--${size}`,
    fullWidth && 'btn--full',
    loading && 'is-loading',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  const content = (
    <>
      {loading && <span className="btn__spinner" aria-hidden="true" />}
      {iconLeft && !loading && <Icon name={iconLeft} size={18} />}
      <span>{children}</span>
      {icon && <Icon name={icon} size={18} className="btn__icon" />}
    </>
  )

  if (to) {
    return (
      <Link to={to} className={classes} {...rest}>
        {content}
      </Link>
    )
  }

  if (href) {
    return (
      <a href={href} className={classes} {...rest}>
        {content}
      </a>
    )
  }

  return (
    <button
      type="button"
      className={classes}
      {...rest}
      disabled={loading || rest.disabled}
      aria-busy={loading || undefined}
    >
      {content}
    </button>
  )
}
