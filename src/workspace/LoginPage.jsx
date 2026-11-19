import { env } from '@/config/env'
import { useState } from 'react'
import { Link } from 'react-router'
import Button from '@/components/ui/Button'
import FormField from '@/components/ui/FormField'
import Logo from '@/components/ui/Logo'
import { DEMO_USERS } from './engine/seed'
import { ROLE_LABELS } from '@shared/permissions.js'
import { Avatar } from './ui/primitives'
import { useApi } from './WorkspaceContext'

const demoRoles = {
  u_priya: 'owner',
  u_daniel: 'admin',
  u_meera: 'admin',
  u_ravi: 'member',
  u_sara: 'viewer',
  u_omar: 'owner',
}

/** Sign in (one-click demo accounts or email + password) and registration. */
export default function LoginPage() {
  const api = useApi()
  const [mode, setMode] = useState('demo')
  const [form, setForm] = useState({ name: '', email: '', password: '', orgName: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (mode === 'register') await api.register(form)
      else await api.login(form)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login" id="main">
      <div className="login__card">
        <Link to="/" className="login__brand" aria-label="FlowDesk home">
          <Logo />
        </Link>
        <h1>{mode === 'register' ? 'Create your workspace' : 'Sign in to FlowDesk'}</h1>
        <p className="login__sub">
          {env.workspaceApiUrl
            ? 'Connected to the FlowDesk API server. Your data is stored in PostgreSQL.'
            : 'This is a fully working demo. Everything is saved in your browser.'}
        </p>

        <div className="login__tabs" role="tablist" aria-label="Sign-in method">
          {[
            ['demo', 'Demo accounts'],
            ['login', 'Email'],
            ['register', 'Sign up'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={mode === id}
              className={mode === id ? 'is-active' : ''}
              onClick={() => setMode(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === 'demo' ? (
          <>
            <p className="login__hint">
              Pick a person to see what each role can do. Open a second tab as someone else to watch real-time
              collaboration.
            </p>
            <ul className="login__users">
              {DEMO_USERS.map((u) => (
                <li key={u.id}>
                  <button type="button" onClick={() => api.demoLogin(u.id)}>
                    <Avatar user={u} size={38} title={false} />
                    <span>
                      <strong>{u.name}</strong>
                      <small>
                        {u.title} · {ROLE_LABELS[demoRoles[u.id]]}
                        {u.id === 'u_omar' ? ' (Nimbus Studio)' : ''}
                      </small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <form className="login__form" onSubmit={submit} noValidate>
            {mode === 'register' && (
              <FormField name="name" label="Full name">
                <input id="field-name" value={form.name} onChange={set('name')} autoComplete="name" required />
              </FormField>
            )}
            <FormField name="email" label="Email">
              <input
                id="field-email"
                type="email"
                value={form.email}
                onChange={set('email')}
                autoComplete="email"
                required
              />
            </FormField>
            <FormField
              name="password"
              label="Password"
              hint={mode === 'register' ? 'At least 8 characters.' : 'Demo accounts use “demo1234”.'}
            >
              <input
                id="field-password"
                type="password"
                value={form.password}
                onChange={set('password')}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                required
                minLength={mode === 'register' ? 8 : undefined}
                aria-describedby="field-password-hint"
              />
            </FormField>
            {mode === 'register' && (
              <FormField name="orgName" label="Workspace name" optional>
                <input id="field-orgName" value={form.orgName} onChange={set('orgName')} placeholder="e.g. Acme Labs" />
              </FormField>
            )}
            {error && (
              <p className="login__error" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" fullWidth loading={busy}>
              {mode === 'register' ? 'Create account' : 'Sign in'}
            </Button>
          </form>
        )}
      </div>
    </main>
  )
}
