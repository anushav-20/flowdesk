import { useCallback, useMemo, useRef, useState } from 'react'
import { validate } from '@/lib/validators'

/**
 * Lightweight form state manager (a mini React Hook Form / Formik).
 *
 *  - Validates a field when it loses focus, then live as the user fixes it
 *  - On submit: validates everything and focuses the first invalid field
 *  - Tracks submitting state and prevents double submits
 *
 * @param {{ initialValues: Record<string, any>, schema: Record<string, Function>, onSubmit: (values) => Promise<void>|void }} config
 */
export default function useForm({ initialValues, schema, onSubmit }) {
  const [values, setValues] = useState(initialValues)
  const [errors, setErrors] = useState({})
  const [touched, setTouched] = useState({})
  const [status, setStatus] = useState('idle') // idle | submitting | success | error
  const [submitCount, setSubmitCount] = useState(0)
  const fieldRefs = useRef({})

  const validateField = useCallback(
    (name, nextValues) => (schema[name] ? schema[name](nextValues[name], nextValues) : ''),
    [schema],
  )

  const setFieldValue = useCallback(
    (name, value) => {
      const next = { ...values, [name]: value }
      setValues(next)
      // Re-validate live only after the field has been touched, so we don't nag while the user types
      if (touched[name]) setErrors((e) => ({ ...e, [name]: validateField(name, next) }))
    },
    [values, touched, validateField],
  )

  const handleBlur = useCallback(
    (name) => {
      setTouched((t) => ({ ...t, [name]: true }))
      setErrors((e) => ({ ...e, [name]: validateField(name, values) }))
    },
    [validateField, values],
  )

  const handleSubmit = useCallback(
    async (event) => {
      event?.preventDefault()
      if (status === 'submitting') return

      const allErrors = validate(schema, values)
      setErrors(allErrors)
      setTouched(Object.fromEntries(Object.keys(schema).map((k) => [k, true])))
      setSubmitCount((n) => n + 1)

      const firstInvalid = Object.keys(schema).find((k) => allErrors[k])
      if (firstInvalid) {
        fieldRefs.current[firstInvalid]?.focus()
        return
      }

      setStatus('submitting')
      try {
        await onSubmit(values)
        setStatus('success')
      } catch {
        setStatus('error')
      }
    },
    [onSubmit, schema, status, values],
  )

  const reset = useCallback(() => {
    setValues(initialValues)
    setErrors({})
    setTouched({})
    setStatus('idle')
    setSubmitCount(0)
  }, [initialValues])

  /**
   * Spread onto an input: <input {...register('email')} />
   * Wires value, change/blur handlers, ref (for focusing) and ARIA error attributes.
   */
  const register = useCallback(
    (name, { type } = {}) => ({
      name,
      id: `field-${name}`,
      ref: (el) => {
        fieldRefs.current[name] = el
      },
      ...(type === 'checkbox'
        ? { checked: Boolean(values[name]), onChange: (e) => setFieldValue(name, e.target.checked) }
        : { value: values[name] ?? '', onChange: (e) => setFieldValue(name, e.target.value) }),
      onBlur: () => handleBlur(name),
      'aria-invalid': errors[name] ? true : undefined,
      'aria-describedby': errors[name] ? `field-${name}-error` : undefined,
    }),
    [errors, handleBlur, setFieldValue, values],
  )

  const errorList = useMemo(
    () =>
      Object.keys(schema)
        .filter((k) => errors[k])
        .map((k) => ({ name: k, message: errors[k] })),
    [errors, schema],
  )

  return {
    values,
    errors,
    errorList,
    touched,
    status,
    submitCount,
    register,
    handleSubmit,
    setFieldValue,
    reset,
    fieldRefs,
  }
}
