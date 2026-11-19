/* oxlint-disable react/only-export-components */
import { useEffect, useId, useRef } from 'react'
import Icon from '@/components/ui/Icon'
import useFocusTrap from '@/hooks/useFocusTrap'

/** Initials avatar with the user's colour. */
export function Avatar({ user, size = 28, title = true }) {
  if (!user) {
    return (
      <span
        className="avatar avatar--empty"
        style={{ width: size, height: size }}
        title="Unassigned"
        aria-label="Unassigned"
      >
        ?
      </span>
    )
  }
  const initials = user.name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, background: user.color, fontSize: size * 0.4 }}
      title={title ? user.name : undefined}
      role="img"
      aria-label={user.name}
    >
      {initials}
    </span>
  )
}

/** Accessible modal dialog (focus trap, Escape to close, labelled, restores focus). */
export function Modal({ title, onClose, children, wide = false, footer, className = '' }) {
  const ref = useRef(null)
  const titleId = useId()
  useFocusTrap(ref, true)
  useEffect(() => {
    const first = ref.current?.querySelector('input, select, textarea, button:not(.modal__close)')
    ;(first ?? ref.current)?.focus()
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={`modal ${wide ? 'modal--wide' : ''} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="modal__head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn modal__close" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__foot">{footer}</footer>}
      </div>
    </div>
  )
}

export function PageTitle({ title, subtitle, actions }) {
  return (
    <header className="ws-page__head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="ws-page__actions">{actions}</div>}
    </header>
  )
}

export function Panel({ title, actions, children, className = '', id }) {
  const headingId = useId()
  return (
    <section className={`panel ${className}`} aria-labelledby={title ? headingId : undefined} id={id}>
      {(title || actions) && (
        <header className="panel__head">
          {title && <h2 id={headingId}>{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  )
}

export function Stat({ label, value, hint, tone }) {
  return (
    <div className={`stat ${tone ? `stat--${tone}` : ''}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
      {hint && <p className="stat__hint">{hint}</p>}
    </div>
  )
}

/** Consistent empty state: icon, what's missing, why, and (optionally) the action that fixes it. */
export function Empty({ icon = 'board', title, children, actions }) {
  return (
    <div className="empty">
      <Icon name={icon} size={28} />
      <p className="empty__title">{title}</p>
      {children && <div className="empty__body">{children}</div>}
      {actions && <div className="empty__actions">{actions}</div>}
    </div>
  )
}

const PR_BADGE = {
  open: ['badge--success', 'Open'],
  draft: ['', 'Draft'],
  merged: ['badge--brand', 'Merged'],
  closed: ['badge--danger', 'Closed'],
}

/** GitHub pull request state (open / draft / merged / closed). */
export function PrStateBadge({ state }) {
  const [cls, label] = PR_BADGE[state] ?? ['', 'PR']
  return <span className={`badge ${cls}`}>{label}</span>
}

export const PRIORITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low' }

export function PriorityBadge({ priority }) {
  return <span className={`badge badge--${priority}`}>{PRIORITY_LABEL[priority] ?? priority}</span>
}

export function StatusBadge({ status }) {
  const labels = { todo: 'To do', progress: 'In progress', review: 'Review', done: 'Completed' }
  return <span className={`badge badge--status-${status}`}>{labels[status]}</span>
}

/** Simple accessible SVG bar chart (with a hidden data table for screen readers). */
export function BarChart({
  data,
  height = 160,
  label,
  series = [{ key: 'value', name: 'Value', color: 'var(--brand)' }],
  formatX = (d) => d.label,
  emptyText = 'No data for this period yet. It will appear as your team creates and completes tasks.',
}) {
  const hasData = data.some((d) => series.some((s) => (d[s.key] ?? 0) > 0))
  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => d[s.key] ?? 0)))
  const w = 100 / data.length
  const barW = (w * 0.7) / series.length
  return (
    <figure className={`chart ${hasData ? '' : 'chart--empty'}`}>
      {!hasData && <p className="chart__empty">{emptyText}</p>}
      <svg
        viewBox={`0 0 100 ${height / 4}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
        style={{ height }}
      >
        {data.map((d, i) =>
          series.map((s, si) => {
            const v = d[s.key] ?? 0
            const h = (v / max) * (height / 4 - 2)
            return (
              <rect
                key={`${i}-${s.key}`}
                x={i * w + w * 0.15 + si * barW}
                y={height / 4 - h}
                width={barW * 0.92}
                height={h}
                rx="0.6"
                fill={s.color}
              >
                <title>{`${formatX(d)} · ${s.name}: ${v}`}</title>
              </rect>
            )
          }),
        )}
      </svg>
      <div className="chart__axis" aria-hidden="true">
        {data.map((d, i) => (
          <span key={i}>{formatX(d)}</span>
        ))}
      </div>
      {series.length > 1 && (
        <figcaption className="chart__legend">
          {series.map((s) => (
            <span key={s.key}>
              <i style={{ background: s.color }} /> {s.name}
            </span>
          ))}
        </figcaption>
      )}
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th>Period</th>
            {series.map((s) => (
              <th key={s.key}>{s.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((d, i) => (
            <tr key={i}>
              <td>{formatX(d)}</td>
              {series.map((s) => (
                <td key={s.key}>{d[s.key] ?? 0}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

export function Toggle({ checked, onChange, label, disabled }) {
  return (
    <label className={`switch ${disabled ? 'is-disabled' : ''}`}>
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      <span className="switch__track" aria-hidden="true" />
      <span className="switch__label">{label}</span>
    </label>
  )
}

export const fmtDate = (d) =>
  d
    ? new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    : '—'
export const fmtDateTime = (ts) =>
  new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export function timeAgo(ts, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

/**
 * Shows API errors as a toast, so every page handles failures consistently.
 * Resolves to the result (or `true` for void results) on success, `undefined` on failure.
 */
export async function attempt(promise, { toast, success } = {}) {
  try {
    const r = await promise
    if (success && toast) toast(success)
    return r === undefined ? true : r
  } catch (err) {
    toast?.(err.message ?? 'Something went wrong', 'error')
    return undefined
  }
}
