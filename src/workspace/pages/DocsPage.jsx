import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import { appActions } from '@/store/appStore'
import { attempt, Avatar, Empty, fmtDateTime, Modal, PageTitle, Panel, timeAgo } from '../ui/primitives'
import { useApi, useCurrent, useOrgCollection, usePeers, useWorkspace, useWs } from '../WorkspaceContext'
import './DocsPage.css'

const toast = appActions.toast
const lineOf = (text, pos) => text.slice(0, pos).split('\n').length

/**
 * Real-time collaborative document:
 *  - live updates from other tabs/people (no refresh)
 *  - presence + "cursor" (which line each person is on)
 *  - autosave with optimistic concurrency; concurrent edits are merged line-by-line,
 *    overlapping edits are flagged as conflicts
 *  - version history with restore
 */
function Editor({ doc }) {
  const api = useApi()
  const { presence } = useWorkspace()
  const { orgId, can } = useCurrent()
  const users = useWs((s) => s.users)
  const versions = useOrgCollection('docVersions')
  const peers = usePeers()
  const [text, setText] = useState(doc.content)
  const [base, setBase] = useState({ version: doc.version, content: doc.content })
  const [status, setStatus] = useState('saved')
  const [history, setHistory] = useState(false)
  const textRef = useRef(null)
  const baseRef = useRef(base)
  const saveTimer = useRef(null)

  useEffect(() => {
    baseRef.current = base
  }, [base])

  // Someone else saved and we have no unsaved edits → show their version immediately (live update).
  // ("Adjust state while rendering" pattern — no effect, no extra render pass.)
  if (doc.version !== base.version && text === base.content && status !== 'saving') {
    setBase({ version: doc.version, content: doc.content })
    setText(doc.content)
  }

  const save = useCallback(async () => {
    clearTimeout(saveTimer.current)
    const current = textRef.current?.value ?? ''
    const from = baseRef.current
    if (current === from.content) return
    setStatus('saving')
    const r = await attempt(
      api.saveDoc(doc.id, { content: current, baseVersion: from.version, baseContent: from.content }),
      { toast },
    )
    if (!r) return setStatus('error')
    const next = { version: r.doc.version, content: r.doc.content }
    baseRef.current = next
    setBase(next)
    if (r.doc.content !== current) setText(r.doc.content)
    setStatus(r.conflicts ? 'conflict' : r.merged ? 'merged' : 'saved')
    if (r.conflicts)
      toast(
        `${r.conflicts} conflicting edit${r.conflicts > 1 ? 's' : ''} — both versions were kept and marked for you to resolve.`,
        'error',
      )
  }, [api, doc.id])

  const onChange = (e) => {
    setText(e.target.value)
    setStatus('editing')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(save, 800) // autosave after typing pauses
  }

  useEffect(() => () => clearTimeout(saveTimer.current), [])

  const reportCursor = () => {
    const el = textRef.current
    if (el) presence?.update({ docId: doc.id, cursor: lineOf(el.value, el.selectionStart) })
  }
  useEffect(() => {
    presence?.update({ docId: doc.id, cursor: 1 })
    return () => presence?.update({ docId: null, cursor: null })
  }, [doc.id, presence])

  const here = peers.filter((p) => p.orgId === orgId && p.docId === doc.id)
  const docVersions = useMemo(() => versions.filter((v) => v.docId === doc.id), [versions, doc.id])
  const lines = text.split('\n').length

  return (
    <Panel
      title={doc.title}
      className="doc-editor"
      actions={
        <div className="doc-editor__meta">
          {here.map((p) => (
            <span
              key={p.tabId}
              className="doc-peer"
              style={{ '--c': p.color }}
              title={`${p.name} is on line ${p.cursor}`}
            >
              <Avatar user={{ name: p.name, color: p.color }} size={24} title={false} />
              <span>
                {p.name.split(' ')[0]} · line {p.cursor}
              </span>
            </span>
          ))}
          <span className={`doc-status doc-status--${status}`} role="status" aria-live="polite">
            {
              {
                saved: 'All changes saved',
                editing: 'Editing…',
                saving: 'Saving…',
                merged: 'Merged with a teammate’s edit',
                conflict: 'Conflict — resolve the marked lines',
                error: 'Save failed',
              }[status]
            }
          </span>
          <Button size="sm" variant="ghost" onClick={() => setHistory(true)}>
            History ({docVersions.length})
          </Button>
        </div>
      }
    >
      <div className="doc-body">
        <div className="doc-gutter" aria-hidden="true">
          {Array.from({ length: lines }, (_, i) => {
            const who = here.filter((p) => p.cursor === i + 1)
            return (
              <span
                key={i}
                className={who.length ? 'has-peer' : ''}
                style={who.length ? { '--c': who[0].color } : undefined}
              >
                {i + 1}
              </span>
            )
          })}
        </div>
        <label htmlFor="doc-text" className="sr-only">
          Document content
        </label>
        <textarea
          id="doc-text"
          ref={textRef}
          value={text}
          readOnly={!can('doc.edit')}
          onChange={onChange}
          onKeyUp={reportCursor}
          onClick={reportCursor}
          onBlur={save}
          spellCheck
          rows={Math.max(14, lines + 2)}
        />
      </div>
      <p className="muted small">
        Last edited by {users[doc.updatedBy]?.name ?? 'someone'} {timeAgo(doc.updatedAt)} · version {doc.version}. Open
        this doc in another tab as a different user to see live updates and cursors.
      </p>

      {history && (
        <Modal title="Version history" onClose={() => setHistory(false)} wide>
          {docVersions.length === 0 ? (
            <p className="muted">No earlier versions yet.</p>
          ) : (
            <ul className="list">
              {docVersions.map((v) => (
                <li key={v.id} className="list-item doc-version">
                  <div className="list-item__main">
                    <p className="list-item__title">
                      Version {v.version} · {users[v.by]?.name ?? 'someone'} · {fmtDateTime(v.at)}
                    </p>
                    <pre className="code">{v.content.slice(0, 400) || '(empty)'}</pre>
                  </div>
                  {can('doc.edit') && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={async () => {
                        const r = await attempt(api.restoreDocVersion(doc.id, v.id), {
                          toast,
                          success: `Restored version ${v.version}`,
                        })
                        if (r) {
                          setBase({ version: r.version, content: r.content })
                          setText(r.content)
                          setHistory(false)
                        }
                      }}
                    >
                      Restore
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
    </Panel>
  )
}

export default function DocsPage() {
  const api = useApi()
  const navigate = useNavigate()
  const { docId } = useParams()
  const { can } = useCurrent()
  const docs = useOrgCollection('docs')
  const projects = useOrgCollection('projects')
  const doc = docs.find((d) => d.id === docId) ?? (docId ? null : docs[0])
  const [title, setTitle] = useState('')

  return (
    <div className="ws-page">
      <PageTitle title="Docs" subtitle="Write project briefs and notes together in real time." />
      <div className="docs-layout">
        <Panel title="Documents">
          <ul className="list">
            {docs.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  className={`list-item ${doc?.id === d.id ? 'is-selected' : ''}`}
                  onClick={() => navigate(`/app/docs/${d.id}`)}
                  aria-current={doc?.id === d.id ? 'page' : undefined}
                >
                  <Icon name="doc" size={18} />
                  <span className="list-item__main">
                    <span className="list-item__title">{d.title}</span>
                    <span className="list-item__meta">
                      {projects.find((p) => p.id === d.projectId)?.name ?? 'General'} · {timeAgo(d.updatedAt)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {can('doc.edit') && (
            <form
              className="field-inline"
              style={{ marginTop: '0.75rem' }}
              onSubmit={async (e) => {
                e.preventDefault()
                const d = await attempt(api.createDoc({ title }), { toast })
                if (d) {
                  setTitle('')
                  navigate(`/app/docs/${d.id}`)
                }
              }}
            >
              <label>
                <span className="sr-only">New document title</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="New document title"
                  maxLength={100}
                  required
                />
              </label>
              <Button type="submit" size="sm" variant="secondary">
                Create
              </Button>
            </form>
          )}
        </Panel>
        {doc ? (
          <Editor doc={doc} key={doc.id} />
        ) : docs.length === 0 ? (
          <Panel>
            <Empty icon="doc" title="No documents yet">
              {can('doc.edit')
                ? 'Create a project brief, meeting notes or a spec using the box on the left. Teammates can edit it with you in real time.'
                : 'Documents your team writes will appear here.'}
            </Empty>
          </Panel>
        ) : (
          <Panel>
            <Empty
              icon="doc"
              title="This document doesn't exist"
              actions={
                <Button variant="secondary" onClick={() => navigate('/app/docs')}>
                  Open the latest document
                </Button>
              }
            >
              It may have been deleted, or the link is from another workspace.
            </Empty>
          </Panel>
        )}
      </div>
    </div>
  )
}
