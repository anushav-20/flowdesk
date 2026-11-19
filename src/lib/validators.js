/**
 * Small composable validators. Each returns an error message string, or '' when valid.
 * Used by the useForm hook; pure functions → easy to unit-test and reuse on a server.
 */

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export const required =
  (message = 'This field is required.') =>
  (value) =>
    (typeof value === 'string' ? value.trim() : value) ? '' : message

export const email =
  (message = 'Enter a valid email, like name@company.com.') =>
  (value) =>
    !value || EMAIL_RE.test(String(value).trim()) ? '' : message

export const minLength = (n, message) => (value) =>
  !value || String(value).trim().length >= n ? '' : (message ?? `Must be at least ${n} characters.`)

export const maxLength = (n, message) => (value) =>
  !value || String(value).length <= n ? '' : (message ?? `Must be ${n} characters or fewer.`)

export const isChecked =
  (message = 'Please confirm to continue.') =>
  (value) =>
    value === true ? '' : message

/** Runs validators in order and returns the first error. */
export const compose =
  (...validators) =>
  (value, values) => {
    for (const v of validators) {
      const error = v(value, values)
      if (error) return error
    }
    return ''
  }

/** Validates a whole object against a { field: validator } schema. */
export function validate(schema, values) {
  const errors = {}
  for (const [field, validator] of Object.entries(schema)) {
    const error = validator(values[field], values)
    if (error) errors[field] = error
  }
  return errors
}
