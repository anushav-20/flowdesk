import { useReducer, useRef } from 'react'
import { subscribeToNewsletter } from '@/features/contact/contactService'
import { EMAIL_RE } from '@/lib/validators'
import { appActions } from '@/store/appStore'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import Reveal from '@/components/ui/Reveal'
import './Newsletter.css'

const initialForm = { email: '', error: '', status: 'idle' } // idle | submitting | success

function formReducer(state, action) {
  switch (action.type) {
    case 'CHANGE':
      return { ...state, email: action.value, error: '' }
    case 'INVALID':
      return { ...state, error: action.error }
    case 'SUBMIT':
      return { ...state, status: 'submitting', error: '' }
    case 'SUCCESS':
      return { ...initialForm, status: 'success' }
    case 'FAIL':
      return { ...state, status: 'idle', error: action.error }
    default:
      return state
  }
}

/** Newsletter CTA. Form state is a small local state machine (useReducer) — no global state needed. */
export default function Newsletter() {
  const [form, dispatch] = useReducer(formReducer, initialForm)
  const inputRef = useRef(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    const email = form.email.trim()

    if (!email) {
      dispatch({ type: 'INVALID', error: 'Please enter your email address.' })
      inputRef.current?.focus()
      return
    }
    if (!EMAIL_RE.test(email)) {
      dispatch({ type: 'INVALID', error: 'Please enter a valid email, like name@company.com.' })
      inputRef.current?.focus()
      return
    }

    dispatch({ type: 'SUBMIT' })
    try {
      await subscribeToNewsletter(email.toLowerCase())
      dispatch({ type: 'SUCCESS' })
      appActions.toast(`Thanks! ${email} is on the list.`)
    } catch {
      dispatch({ type: 'FAIL', error: 'Something went wrong. Please try again.' })
    }
  }

  const submitting = form.status === 'submitting'

  return (
    <section className="section newsletter-section" aria-labelledby="newsletter-title">
      <div className="container">
        <Reveal direction="zoom" className="newsletter">
          <div className="newsletter__glow" aria-hidden="true" />
          <span className="newsletter__icon" aria-hidden="true">
            <Icon name="mail" size={26} />
          </span>
          <h2 id="newsletter-title" className="newsletter__title">
            Ready to bring calm to your team's work?
          </h2>
          <p className="newsletter__text">
            Join 12,000+ teams. Get product tips and early access to new features — one email a month.
          </p>

          <form className="newsletter__form" onSubmit={handleSubmit} noValidate>
            <label htmlFor="newsletter-email" className="sr-only">
              Email address
            </label>
            <input
              ref={inputRef}
              id="newsletter-email"
              type="email"
              name="email"
              autoComplete="email"
              maxLength={254}
              placeholder="you@company.com"
              value={form.email}
              onChange={(e) => dispatch({ type: 'CHANGE', value: e.target.value })}
              aria-invalid={Boolean(form.error)}
              aria-describedby={form.error ? 'newsletter-error' : 'newsletter-hint'}
              disabled={submitting}
            />
            <Button type="submit" size="lg" disabled={submitting} icon={submitting ? undefined : 'arrowRight'}>
              {submitting ? 'Subscribing…' : 'Get started'}
            </Button>
          </form>

          <p
            id={form.error ? 'newsletter-error' : 'newsletter-hint'}
            className={`newsletter__hint ${form.error ? 'is-error' : ''} ${form.status === 'success' ? 'is-success' : ''}`}
            role={form.error ? 'alert' : undefined}
          >
            {form.error ||
              (form.status === 'success' ? "You're subscribed — check your inbox!" : 'No spam. Unsubscribe anytime.')}
          </p>
        </Reveal>
      </div>
    </section>
  )
}
