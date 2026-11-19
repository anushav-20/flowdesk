import { useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import Button from '@/components/ui/Button'
import FormField from '@/components/ui/FormField'
import Icon from '@/components/ui/Icon'
import { contactTopics, teamSizes } from '@/data/content'
import useForm from '@/hooks/useForm'
import { appActions } from '@/store/appStore'
import { contactInitialValues, contactSchema, MESSAGE_MAX, toContactPayload } from './contactSchema'
import { sendContactMessage } from './contactService'
import './ContactForm.css'

const FIELD_LABELS = {
  name: 'Full name',
  email: 'Work email',
  teamSize: 'Team size',
  topic: 'Topic',
  message: 'Message',
  consent: 'Consent',
  company: 'Company',
}

/**
 * Accessible contact form:
 *  - Error summary at the top after a failed submit (GOV.UK design-system pattern), linking to each field
 *  - Inline errors tied to inputs with aria-describedby
 *  - Honeypot + minimum fill time against spam bots
 */
export default function ContactForm() {
  const [searchParams] = useSearchParams()
  const topicFromUrl = contactTopics.some((t) => t.value === searchParams.get('topic'))
    ? searchParams.get('topic')
    : 'sales'
  const [startedAt] = useState(() => Date.now())
  const [initialValues] = useState(() => ({ ...contactInitialValues, topic: topicFromUrl }))
  const summaryRef = useRef(null)

  const form = useForm({
    initialValues,
    schema: contactSchema,
    onSubmit: async (values) => {
      await sendContactMessage(toContactPayload(values), { honeypot: values.website, startedAt })
      appActions.toast('Message sent — we will reply within one business day.')
    },
  })
  const { values, errors, errorList, status, submitCount, register, handleSubmit, reset, fieldRefs } = form

  if (status === 'success') {
    return (
      <div className="contact-success" role="status">
        <span className="contact-success__icon" aria-hidden="true">
          <Icon name="check" size={30} strokeWidth={2.6} />
        </span>
        <h2>Thanks, {values.name.split(' ')[0]}!</h2>
        <p>Your message is on its way. We usually reply within one business day at {values.email}.</p>
        <Button variant="secondary" onClick={reset}>
          Send another message
        </Button>
      </div>
    )
  }

  const messageLength = values.message.length

  return (
    <form className="contact-form" onSubmit={handleSubmit} noValidate aria-describedby="contact-required-note">
      {submitCount > 0 && errorList.length > 0 && (
        <div
          className="error-summary"
          role="alert"
          tabIndex={-1}
          ref={summaryRef}
          aria-labelledby="error-summary-title"
        >
          <h2 id="error-summary-title">
            There {errorList.length === 1 ? 'is 1 problem' : `are ${errorList.length} problems`} with the form
          </h2>
          <ul>
            {errorList.map((e) => (
              <li key={e.name}>
                <a
                  href={`#field-${e.name}`}
                  onClick={(ev) => {
                    ev.preventDefault()
                    fieldRefs.current[e.name]?.focus()
                  }}
                >
                  {FIELD_LABELS[e.name]}: {e.message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p id="contact-required-note" className="contact-form__note">
        All fields are required unless marked optional.
      </p>

      <div className="contact-form__row">
        <FormField name="name" label="Full name" error={errors.name}>
          <input type="text" autoComplete="name" maxLength={80} {...register('name')} />
        </FormField>
        <FormField name="email" label="Work email" error={errors.email}>
          <input type="email" autoComplete="email" inputMode="email" maxLength={254} {...register('email')} />
        </FormField>
      </div>

      <div className="contact-form__row">
        <FormField name="company" label="Company" optional error={errors.company}>
          <input type="text" autoComplete="organization" maxLength={100} {...register('company')} />
        </FormField>
        <FormField name="teamSize" label="Team size" error={errors.teamSize}>
          <select {...register('teamSize')}>
            <option value="">Select…</option>
            {teamSizes.map((s) => (
              <option key={s} value={s}>
                {s} people
              </option>
            ))}
          </select>
        </FormField>
      </div>

      <fieldset className="choice-group">
        <legend>What can we help with?</legend>
        {contactTopics.map((t) => (
          <label key={t.value} className="choice">
            <input
              type="radio"
              name="topic"
              value={t.value}
              checked={values.topic === t.value}
              onChange={() => form.setFieldValue('topic', t.value)}
            />
            {t.label}
          </label>
        ))}
      </fieldset>

      <FormField name="message" label="Message" error={errors.message}>
        <textarea rows={6} maxLength={MESSAGE_MAX} {...register('message')} />
        <p
          className={`contact-form__counter ${messageLength > MESSAGE_MAX * 0.9 ? 'is-warning' : ''}`}
          aria-live="polite"
        >
          {messageLength} / {MESSAGE_MAX}
        </p>
      </FormField>

      {/* Honeypot: invisible to people and screen readers, tempting for bots */}
      <div className="contact-form__hp" aria-hidden="true">
        <label htmlFor="field-website">Website</label>
        <input type="text" tabIndex={-1} autoComplete="off" {...register('website')} />
      </div>

      <div className={`field ${errors.consent ? 'has-error' : ''}`}>
        <label className="checkbox">
          <input type="checkbox" {...register('consent', { type: 'checkbox' })} />
          <span>I agree that FlowDesk may contact me about this enquiry. We never share your details.</span>
        </label>
        {errors.consent && (
          <p id="field-consent-error" className="field__error">
            <span aria-hidden="true">⚠ </span>
            {errors.consent}
          </p>
        )}
      </div>

      {status === 'error' && (
        <p className="contact-form__failure" role="alert">
          We couldn't send your message. Please check your connection and try again.
        </p>
      )}

      <Button
        type="submit"
        size="lg"
        loading={status === 'submitting'}
        icon={status === 'submitting' ? undefined : 'arrowRight'}
      >
        {status === 'submitting' ? 'Sending…' : 'Send message'}
      </Button>
    </form>
  )
}
