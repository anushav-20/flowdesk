/**
 * Custom fields: each organisation defines its own task fields without schema changes.
 * Definitions are data; values are stored per task in a JSON map { [fieldId]: value }.
 */

export const FIELD_TYPES = {
  text: 'Text',
  number: 'Number',
  select: 'Dropdown',
  date: 'Date',
  checkbox: 'Checkbox',
  url: 'Link',
}

const ID_RE = /^[a-z][a-z0-9_]{1,30}$/

/** Validates a field *definition* created by an admin. Returns an error string or ''. */
export function validateFieldDef(def, existing = []) {
  if (!def.name || def.name.trim().length < 2) return 'Field name must be at least 2 characters.'
  if (def.name.length > 40) return 'Field name must be 40 characters or fewer.'
  if (!FIELD_TYPES[def.type]) return 'Choose a valid field type.'
  if (!ID_RE.test(def.id)) return 'Invalid field id.'
  if (existing.some((f) => f.id !== def.id && f.name.toLowerCase() === def.name.trim().toLowerCase()))
    return 'A field with this name already exists.'
  if (def.type === 'select') {
    const opts = (def.options ?? []).map((o) => o.trim()).filter(Boolean)
    if (opts.length < 2) return 'Dropdowns need at least two options.'
    if (new Set(opts).size !== opts.length) return 'Options must be unique.'
  }
  return ''
}

export const fieldIdFromName = (name) =>
  `f_${
    String(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 26) || 'field'
  }`

/** Validates one *value* against its definition. Returns an error string or ''. */
export function validateFieldValue(def, value) {
  const empty = value == null || value === '' || (def.type === 'checkbox' && value === false)
  if (empty) return def.required && def.type !== 'checkbox' ? `${def.name} is required.` : ''
  switch (def.type) {
    case 'text':
      return String(value).length > 500 ? `${def.name} must be 500 characters or fewer.` : ''
    case 'number':
      return Number.isFinite(Number(value)) ? '' : `${def.name} must be a number.`
    case 'select':
      return def.options.includes(value) ? '' : `Choose a valid ${def.name}.`
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
        ? ''
        : `${def.name} must be a valid date.`
    case 'checkbox':
      return typeof value === 'boolean' ? '' : `${def.name} must be yes or no.`
    case 'url':
      try {
        const u = new URL(value)
        return u.protocol === 'https:' || u.protocol === 'http:' ? '' : `${def.name} must be a web link.`
      } catch {
        return `${def.name} must be a valid link.`
      }
    default:
      return ''
  }
}

/** Validates all values; unknown keys are dropped so stale data never leaks through. */
export function validateCustomValues(defs, values = {}) {
  const errors = {}
  const clean = {}
  for (const def of defs) {
    const err = validateFieldValue(def, values[def.id])
    if (err) errors[def.id] = err
    else if (values[def.id] !== undefined && values[def.id] !== '') {
      clean[def.id] = def.type === 'number' ? Number(values[def.id]) : values[def.id]
    }
  }
  return { errors, values: clean, valid: Object.keys(errors).length === 0 }
}
