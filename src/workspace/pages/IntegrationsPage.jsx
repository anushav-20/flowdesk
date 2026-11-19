import { useMemo, useState } from 'react'
import { env } from '@/config/env'
import { Link } from 'react-router'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import { appActions } from '@/store/appStore'
import { WEBHOOK_EVENTS } from '@shared/integrations.js'
import { STATUS_LABELS } from '../engine/core'
import { attempt, Empty, fmtDateTime, Modal, PageTitle, Panel, PrStateBadge, timeAgo, Toggle } from '../ui/primitives'
import { ui } from '../uiStore'
import { useApi, useCurrent, useOrgCollection } from '../WorkspaceContext'

const toast = appActions.toast
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

function WebhookDialog({ hook, onClose }) {
  const api = useApi()
  const [url, setUrl] = useState(hook?.url ?? 'https://')
  const [events, setEvents] = useState(hook?.events ?? ['task.completed'])
  const [error, setError] = useState('')
  return (
    <Modal
      title={hook ? 'Edit webhook' : 'Add webhook'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={async () => {
              try {
                await api.saveWebhook({ id: hook?.id, url: url.trim(), events, active: hook?.active ?? true })
                toast('Webhook saved')
                onClose()
              } catch (err) {
                setError(err.message)
              }
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="drawer-section">
        <div>
          <label className="label" htmlFor="wh-url">
            Endpoint URL (https only)
          </label>
          <input
            id="wh-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-describedby="wh-url-hint"
          />
          <p id="wh-url-hint" className="muted small">
            Private and local addresses are blocked (SSRF protection). Tip: a URL containing “fail” simulates a broken
            endpoint.
          </p>
        </div>
        <fieldset className="fieldset">
          <legend>Events</legend>
          <div className="check-grid">
            {Object.entries(WEBHOOK_EVENTS).map(([k, v]) => (
              <label key={k} className="checkbox">
                <input
                  type="checkbox"
                  checked={events.includes(k)}
                  onChange={(e) => setEvents((ev) => (e.target.checked ? [...ev, k] : ev.filter((x) => x !== k)))}
                />
                <span>
                  {v} <code className="muted small">{k}</code>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}

/** GitHub: connect a real repository, sync PRs/commits onto tasks, configure what moves tasks. */
function GitHubCard() {
  const api = useApi()
  const { org, can } = useCurrent()
  const tasks = useOrgCollection('tasks')
  const gh = org.integrations.github ?? {}
  const manage = can('settings.manage')
  const connected = gh.connected && gh.verified
  const [repo, setRepo] = useState(gh.repo ?? '')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [ghKey, setGhKey] = useState('')
  const [simLog, setSimLog] = useState([])
  const apiMode = Boolean(env.workspaceApiUrl)

  const linked = useMemo(
    () =>
      tasks
        .flatMap((t) => (t.links ?? []).filter((l) => l.type === 'pull_request').map((l) => ({ ...l, task: t })))
        .sort((a, b) => (b.number ?? 0) - (a.number ?? 0)),
    [tasks],
  )
  const openKeys = useMemo(() => tasks.filter((t) => t.status !== 'done').map((t) => t.key), [tasks])

  const run = async (label, fn, success) => {
    setBusy(label)
    setError('')
    try {
      const r = await fn()
      if (success) toast(typeof success === 'function' ? success(r) : success)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }

  const connect = () =>
    run(
      'connect',
      () =>
        api.updateIntegration('github', { connected: true, repo: repo.trim(), ...(token && { token: token.trim() }) }),
      'GitHub connected — pull requests and commits synced',
    ).then(() => setToken(''))

  const simulate = async (kind) => {
    const key = ghKey || openKeys[0]
    const n = Math.floor(Math.random() * 900) + 100
    const pr = {
      number: n,
      title: `${key} Implement feature`,
      html_url: `https://github.com/${gh.repo ?? 'example/repo'}/pull/${n}`,
      head: { ref: `feature/${key.toLowerCase()}` },
      merged: kind === 'merged',
      state: kind === 'merged' ? 'closed' : 'open',
    }
    const body = { action: kind === 'merged' ? 'closed' : 'opened', pull_request: pr }
    const results = await attempt(api.handleGitHubEvent('pull_request', body), { toast })
    if (results) setSimLog((l) => [{ at: Date.now(), event: `pull_request.${body.action}`, results }, ...l].slice(0, 4))
  }

  return (
    <Panel
      title="GitHub"
      className="integ-card"
      actions={
        connected ? (
          <span className="badge badge--success">Connected</span>
        ) : (
          <span className="badge">Not connected</span>
        )
      }
    >
      <p className="small muted">
        Mention a task key such as <code>{tasks[0]?.key ?? 'FD-1'}</code> in a pull request title, branch name or commit
        message. FlowDesk reads your repository through the GitHub API, links the PR to the task, shows its status and
        moves the task when the PR is opened or merged.
      </p>

      {!connected ? (
        <form
          className="integ-form"
          onSubmit={(e) => {
            e.preventDefault()
            connect()
          }}
        >
          <label>
            <span className="label">Repository</span>
            <input
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="owner/name or https://github.com/owner/name"
              disabled={!manage}
              required
            />
          </label>
          {apiMode ? (
            <label>
              <span className="label">Access token (optional, needed for private repositories)</span>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="github_pat_…  (read-only: Contents + Pull requests)"
                autoComplete="off"
                disabled={!manage}
              />
            </label>
          ) : (
            <p className="muted small">
              In the browser demo, public repositories are supported (no token is stored in the browser). Try{' '}
              <button type="button" className="link-btn" onClick={() => setRepo('facebook/react')}>
                facebook/react
              </button>
              , or your own public repo.
            </p>
          )}
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <div>
            <Button type="submit" size="sm" loading={busy === 'connect'} disabled={!manage || !repo.trim()}>
              Connect repository
            </Button>
          </div>
        </form>
      ) : (
        <div className="integ-form">
          <p className="integ-repo">
            <Icon name="link" size={16} />
            <a href={gh.repoInfo?.url ?? `https://github.com/${gh.repo}`} target="_blank" rel="noopener noreferrer">
              {gh.repo}
            </a>
            <span className="badge">{gh.repoInfo?.private ? 'Private' : 'Public'}</span>
            {gh.hasToken && <span className="badge">Token saved (encrypted)</span>}
          </p>
          <p className="small muted" aria-live="polite">
            {gh.lastSync
              ? gh.lastSync.ok
                ? `Last sync ${timeAgo(gh.lastSync.at)}: ${plural(gh.lastSync.pulls, 'pull request')} and ${plural(gh.lastSync.commits, 'commit')} checked, ${plural(gh.lastSync.updated, 'task')} updated. Syncs automatically every 10 minutes.`
                : `Last sync failed ${timeAgo(gh.lastSync.at)}: ${gh.lastSync.error}`
              : 'Not synced yet.'}
          </p>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <div className="integ-actions">
            <Button
              size="sm"
              iconLeft="refresh"
              loading={busy === 'sync'}
              disabled={!can('task.update')}
              onClick={() =>
                run(
                  'sync',
                  () => api.syncGitHub(),
                  (r) => `Synced: ${r.updated} task${r.updated === 1 ? '' : 's'} updated`,
                )
              }
            >
              Sync now
            </Button>
            {manage && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  run('disconnect', () => api.updateIntegration('github', { connected: false }), 'GitHub disconnected')
                }
              >
                Disconnect
              </Button>
            )}
          </div>

          <fieldset className="fieldset integ-rules" disabled={!manage}>
            <legend>Automation</legend>
            <label>
              <span>When a pull request is opened</span>
              <select
                value={gh.rules?.onOpen ?? ''}
                onChange={(e) =>
                  attempt(api.updateIntegration('github', { rules: { ...gh.rules, onOpen: e.target.value || null } }), {
                    toast,
                    success: 'Rule saved',
                  })
                }
              >
                <option value="review">Move the task to Review</option>
                <option value="progress">Move the task to In progress</option>
                <option value="">Do nothing</option>
              </select>
            </label>
            <label>
              <span>When a pull request is merged</span>
              <select
                value={gh.rules?.onMerge ?? ''}
                onChange={(e) =>
                  attempt(
                    api.updateIntegration('github', { rules: { ...gh.rules, onMerge: e.target.value || null } }),
                    {
                      toast,
                      success: 'Rule saved',
                    },
                  )
                }
              >
                <option value="done">Move the task to Completed</option>
                <option value="review">Move the task to Review</option>
                <option value="">Do nothing</option>
              </select>
            </label>
          </fieldset>

          {apiMode && manage && org.githubSecret && (
            <details className="integ-details">
              <summary>Instant updates with a GitHub webhook (optional)</summary>
              <p className="small muted">
                In GitHub: Settings → Webhooks → Add webhook. Content type <code>application/json</code>, events “Pull
                requests” and “Pushes”.
              </p>
              <p className="small">
                Payload URL: <code>{`${env.workspaceApiUrl}/integrations/github/${org.id}`}</code>
              </p>
              <p className="small">
                Secret: <code>{org.githubSecret}</code>
              </p>
            </details>
          )}
        </div>
      )}

      <h3 className="label integ-subhead">Linked pull requests ({linked.length})</h3>
      {linked.length === 0 ? (
        <p className="muted small">
          {connected
            ? `No pull requests in ${gh.repo} mention a task key yet. Put a key like ${tasks[0]?.key ?? 'FD-1'} in a PR title or a branch name (feature/${(tasks[0]?.key ?? 'FD-1').toLowerCase()}-…), then click Sync now.`
            : 'Connect a repository to see pull requests linked to your tasks.'}
        </p>
      ) : (
        <ul className="list">
          {linked.slice(0, 8).map((l) => (
            <li key={`${l.task.id}${l.url}`} className="list-item">
              <PrStateBadge state={l.state} />
              <span className="list-item__main">
                <a href={l.url} target="_blank" rel="noopener noreferrer" className="list-item__title">
                  {l.title}
                </a>
                <button type="button" className="link-btn small" onClick={() => ui.openTask(l.task.id)}>
                  {l.task.key} {l.task.title} · {STATUS_LABELS[l.task.status]}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {manage && !apiMode && openKeys.length > 0 && (
        <details className="integ-details">
          <summary>Test the webhook handler with a sample event</summary>
          <p className="small muted">
            Sends a sample GitHub <code>pull_request</code> event through the same code path that GitHub&apos;s webhook
            uses.
          </p>
          <div className="field-inline">
            <label>
              <span className="sr-only">Task key</span>
              <select value={ghKey || openKeys[0]} onChange={(e) => setGhKey(e.target.value)}>
                {openKeys.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <Button size="sm" variant="secondary" onClick={() => simulate('opened')}>
              PR opened
            </Button>
            <Button size="sm" variant="secondary" onClick={() => simulate('merged')}>
              PR merged
            </Button>
          </div>
          {simLog.map((l) => (
            <p key={l.at} className="small">
              <code>{l.event}</code> →{' '}
              {(l.results ?? []).map((r) => (typeof r === 'string' ? r : `${r.key}: ${r.result}`)).join('; ') ||
                'no task keys found'}
            </p>
          ))}
        </details>
      )}
    </Panel>
  )
}

/** Slack: connecting posts a real test message to the channel. */
function SlackCard() {
  const api = useApi()
  const { org, can } = useCurrent()
  const slack = org.integrations.slack ?? {}
  const manage = can('settings.manage')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const save = async (settings, success) => {
    setBusy(true)
    setError('')
    try {
      await api.updateIntegration('slack', settings)
      toast(success)
      setUrl('')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel
      title="Slack"
      className="integ-card"
      actions={
        slack.connected ? (
          <span className="badge badge--success">Connected</span>
        ) : (
          <span className="badge">Not connected</span>
        )
      }
    >
      <p className="small muted">
        Posts to a Slack channel when tasks are completed, approvals are decided and projects finish. Create an incoming
        webhook in Slack (Apps → Incoming Webhooks → Add to Slack), choose a channel and paste the URL here.
      </p>
      {slack.connected ? (
        <div className="integ-form">
          <p className="small">
            Posting to <code>{slack.webhookUrl ? `${slack.webhookUrl.slice(0, 40)}…` : 'your Slack channel'}</code>
            {slack.connectedAt && <span className="muted"> · connected {timeAgo(slack.connectedAt)}</span>}
          </p>
          {manage && (
            <div className="integ-actions">
              <Button
                size="sm"
                variant="ghost"
                loading={busy}
                onClick={() => save({ connected: false }, 'Slack disconnected')}
              >
                Disconnect
              </Button>
            </div>
          )}
        </div>
      ) : (
        <form
          className="integ-form"
          onSubmit={(e) => {
            e.preventDefault()
            save({ connected: true, webhookUrl: url.trim() }, 'Slack connected — check the channel for a test message')
          }}
        >
          <label>
            <span className="label">Incoming webhook URL</span>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://hooks.slack.com/services/…"
              disabled={!manage}
              required
              autoComplete="off"
            />
          </label>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <div>
            <Button type="submit" size="sm" loading={busy} disabled={!manage || !url.trim()}>
              Connect and send test message
            </Button>
          </div>
        </form>
      )}
    </Panel>
  )
}

export default function IntegrationsPage() {
  const api = useApi()
  const { org, can } = useCurrent()
  const webhooks = useOrgCollection('webhooks')
  const deliveries = useOrgCollection('deliveries')
  const outbox = useOrgCollection('outbox')
  const [editing, setEditing] = useState(null)
  const [secretShown, setSecretShown] = useState({})
  const [payload, setPayload] = useState(null)
  const manage = can('webhook.manage')

  return (
    <div className="ws-page">
      <PageTitle title="Integrations" subtitle="Connect FlowDesk to your developer tools, chat, calendar and email." />
      {!manage && <p className="callout">Only owners and admins can change integrations.</p>}

      <div className="grid-2">
        <GitHubCard />
        <SlackCard />

        <Panel title="Google Calendar & Outlook">
          <p className="small muted">
            Export task deadlines, meetings and milestones as an iCalendar (.ics) file and import it into Google
            Calendar, Outlook or Apple Calendar.
          </p>
          <Link to="/app/calendar" className="btn btn--secondary btn--sm">
            <Icon name="calendar" size={16} /> Open calendar to export
          </Link>
        </Panel>

        <Panel
          title="Email reports"
          actions={
            <Toggle
              checked={Boolean(org.integrations.email?.weeklyReport)}
              disabled={!manage}
              label="Weekly report"
              onChange={(v) => attempt(api.updateIntegration('email', { weeklyReport: v }), { toast })}
            />
          }
        >
          <p className="small muted">
            A background job emails admins a weekly summary. In this demo, emails go to the outbox below.
          </p>
          {manage && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                attempt(api.enqueueJob('reports.weekly', { priority: 'high' }), {
                  toast,
                  success: 'Report job queued — check the outbox in a moment',
                })
              }
            >
              Send report now
            </Button>
          )}
          {outbox.length > 0 && (
            <ul className="list outbox">
              {outbox.slice(0, 3).map((m) => (
                <li key={m.id} className="list-item">
                  <Icon name="mail" size={18} />
                  <div className="list-item__main">
                    <p className="list-item__title">{m.subject}</p>
                    <p className="small">{m.summary}</p>
                    <p className="list-item__meta">
                      To {m.to.join(', ')} · {fmtDateTime(m.at)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        title="Webhooks"
        actions={
          manage && (
            <Button size="sm" iconLeft="plus" onClick={() => setEditing('new')}>
              Add webhook
            </Button>
          )
        }
      >
        <p className="small muted" style={{ marginBottom: '0.75rem' }}>
          FlowDesk sends a signed JSON payload for each subscribed event. Verify the <code>X-FlowDesk-Signature</code>{' '}
          header (HMAC-SHA256 of the body with your secret). Failed deliveries retry with exponential backoff, then move
          to the dead-letter queue.
        </p>
        {webhooks.length === 0 ? (
          <Empty
            icon="link"
            title="No webhooks yet"
            actions={
              manage && (
                <Button size="sm" variant="secondary" iconLeft="plus" onClick={() => setEditing('new')}>
                  Add your first webhook
                </Button>
              )
            }
          >
            Send task, comment and approval events to your own services, Zapier or Make.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Endpoint</th>
                  <th>Events</th>
                  <th>Secret</th>
                  <th>Active</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {webhooks.map((w) => (
                  <tr key={w.id}>
                    <td>
                      <code>{w.url}</code>
                    </td>
                    <td className="small">{w.events.join(', ')}</td>
                    <td>
                      {manage ? (
                        <button
                          type="button"
                          className="link-btn small"
                          onClick={() => setSecretShown((s) => ({ ...s, [w.id]: !s[w.id] }))}
                        >
                          {secretShown[w.id] ? <code>{w.secret}</code> : 'Reveal'}
                        </button>
                      ) : (
                        '••••'
                      )}
                    </td>
                    <td>
                      <Toggle
                        checked={w.active}
                        disabled={!manage}
                        label={<span className="sr-only">Active</span>}
                        onChange={(v) => attempt(api.saveWebhook({ ...w, active: v }), { toast })}
                      />
                    </td>
                    <td className="num">
                      {manage && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => attempt(api.testWebhook(w.id), { toast, success: 'Test event queued' })}
                          >
                            Send test
                          </Button>
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label="Edit webhook"
                            onClick={() => setEditing(w)}
                          >
                            <Icon name="pencil" size={15} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn icon-btn--danger"
                            aria-label="Delete webhook"
                            onClick={() => attempt(api.deleteWebhook(w.id), { toast, success: 'Webhook removed' })}
                          >
                            <Icon name="trash" size={15} />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h3 className="label" style={{ margin: '1.25rem 0 0.5rem' }}>
          Recent deliveries
        </h3>
        {deliveries.length === 0 ? (
          <p className="muted small">Complete a task to trigger a delivery.</p>
        ) : (
          <ul className="list">
            {deliveries.slice(0, 8).map((d) => (
              <li key={d.id} className="list-item">
                <span className={`badge ${d.ok ? 'badge--success' : 'badge--danger'}`}>{d.status}</span>
                <div className="list-item__main">
                  <p className="list-item__title">
                    {d.event} → {new URL(d.url).host}
                  </p>
                  <p className="list-item__meta">{fmtDateTime(d.at)}</p>
                </div>
                <button type="button" className="link-btn small" onClick={() => setPayload(d)}>
                  Payload
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {editing && <WebhookDialog hook={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {payload && (
        <Modal title={`Delivery: ${payload.event}`} onClose={() => setPayload(null)} wide>
          <p className="label">Headers</p>
          <pre className="code">{`POST ${payload.url}\nContent-Type: application/json\nX-FlowDesk-Event: ${payload.event}${payload.signature ? `\nX-FlowDesk-Signature: ${payload.signature}` : ''}`}</pre>
          <p className="label" style={{ marginTop: '1rem' }}>
            Body
          </p>
          <pre className="code">{JSON.stringify(JSON.parse(payload.body), null, 2)}</pre>
          <p className="muted small" style={{ marginTop: '0.75rem' }}>
            Response: {payload.status}. Slack messages are really sent; other webhook deliveries are simulated in the
            browser demo and sent as real HTTP requests by the Node backend.
          </p>
        </Modal>
      )}
    </div>
  )
}
