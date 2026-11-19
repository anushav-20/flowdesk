import './FormField.css'

/**
 * Label + control + hint + error, wired together for screen readers.
 * The control is passed as children so any input type works.
 */
export default function FormField({ name, label, error, hint, optional = false, children, className = '' }) {
  return (
    <div className={`field ${error ? 'has-error' : ''} ${className}`}>
      <label htmlFor={`field-${name}`} className="field__label">
        {label}
        {optional && <span className="field__optional"> (optional)</span>}
      </label>
      {hint && (
        <p id={`field-${name}-hint`} className="field__hint">
          {hint}
        </p>
      )}
      {children}
      {error && (
        <p id={`field-${name}-error`} className="field__error">
          <span aria-hidden="true">⚠ </span>
          {error}
        </p>
      )}
    </div>
  )
}
