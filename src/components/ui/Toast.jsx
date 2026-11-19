import { memo, useEffect } from 'react'
import { appActions, selectToasts, useAppStore } from '@/store/appStore'
import Icon from './Icon'
import './Toast.css'

const AUTO_DISMISS_MS = 4500

const ToastItem = memo(function ToastItem({ id, message, variant }) {
  useEffect(() => {
    const t = setTimeout(() => appActions.dismissToast(id), AUTO_DISMISS_MS)
    return () => clearTimeout(t)
  }, [id])

  return (
    <li className={`toast toast--${variant}`}>
      <span className="toast__icon" aria-hidden="true">
        <Icon name={variant === 'error' ? 'close' : 'check'} size={16} strokeWidth={2.6} />
      </span>
      <p>{message}</p>
      <button
        type="button"
        className="toast__close"
        onClick={() => appActions.dismissToast(id)}
        aria-label="Dismiss notification"
      >
        <Icon name="close" size={16} />
      </button>
    </li>
  )
})

/** Toast stack. The live region is always mounted so screen readers announce new messages. */
export default function ToastRegion() {
  const toasts = useAppStore(selectToasts)

  return (
    <ol className="toast-region" role="status" aria-live="polite" aria-label="Notifications">
      {toasts.map((t) => (
        <ToastItem key={t.id} {...t} />
      ))}
    </ol>
  )
}
