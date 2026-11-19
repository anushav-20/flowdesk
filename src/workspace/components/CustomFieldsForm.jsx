import { validateFieldValue } from '@shared/customFields.js'

/**
 * Dynamic form generated from the organisation's custom field definitions.
 * The same definitions drive validation (shared/customFields.js) on client and server.
 */
export default function CustomFieldsForm({ defs, values, onChange, disabled, errors = {} }) {
  if (!defs.length) return <p className="muted small">No custom fields yet. Admins can add them in Settings.</p>

  const set = (id, v) => onChange({ ...values, [id]: v })

  return (
    <div className="form-grid">
      {defs.map((def) => {
        const id = `cf-${def.id}`
        const value = values?.[def.id]
        const error = errors[def.id] ?? (value !== undefined && value !== '' ? validateFieldValue(def, value) : '')
        const common = {
          id,
          disabled,
          'aria-invalid': Boolean(error) || undefined,
          'aria-describedby': error ? `${id}-err` : undefined,
        }
        return (
          <div key={def.id} className={def.type === 'text' && /steps|description/i.test(def.name) ? 'full' : ''}>
            {def.type === 'checkbox' ? (
              <label className="checkbox" htmlFor={id}>
                <input
                  type="checkbox"
                  checked={Boolean(value)}
                  onChange={(e) => set(def.id, e.target.checked)}
                  {...common}
                />
                <span>{def.name}</span>
              </label>
            ) : (
              <>
                <label className="label" htmlFor={id}>
                  {def.name}
                  {def.required && <span aria-hidden="true"> *</span>}
                </label>
                {def.type === 'select' ? (
                  <select value={value ?? ''} onChange={(e) => set(def.id, e.target.value)} {...common}>
                    <option value="">—</option>
                    {def.options.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                ) : def.type === 'text' && /steps|description/i.test(def.name) ? (
                  <textarea
                    rows={3}
                    value={value ?? ''}
                    maxLength={500}
                    onChange={(e) => set(def.id, e.target.value)}
                    {...common}
                  />
                ) : (
                  <input
                    type={
                      def.type === 'number'
                        ? 'number'
                        : def.type === 'date'
                          ? 'date'
                          : def.type === 'url'
                            ? 'url'
                            : 'text'
                    }
                    value={value ?? ''}
                    onChange={(e) => set(def.id, e.target.value)}
                    {...common}
                  />
                )}
              </>
            )}
            {error && (
              <p id={`${id}-err`} className="error-text">
                {error}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
