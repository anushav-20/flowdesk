import { threeWayMerge } from '@shared/merge.js'
import { createJob } from '@shared/jobs.js'
import { ApiError, cleanText, notify, uid } from '../core'
import { award } from './tasks'

export const ATTACHMENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
]
export const MAX_ATTACHMENT_BYTES = 1_000_000

/** Comments (mentions + attachments), collaborative docs with version history, notifications. */
export function collaborationModule(ctx) {
  const { db } = ctx

  /** Finds @FirstName or @First Last mentions of members (case-insensitive). */
  function findMentions(body, members) {
    const text = body.toLowerCase()
    return members
      .filter((m) => {
        const first = m.name.split(' ')[0].toLowerCase()
        return text.includes(`@${m.name.toLowerCase()}`) || new RegExp(`@${first}\\b`).test(text)
      })
      .map((m) => m.id)
  }

  return {
    _findMentions: findMentions,

    // ------------------------------------------------------------ comments
    async addComment(taskId, { body, attachments = [] }) {
      const cleanBody = cleanText(body, { max: 2000, field: 'Comment' })
      if (!cleanBody && attachments.length === 0)
        throw new ApiError('validation', 'Write a comment or attach a file.', 422)
      if (attachments.length > 3) throw new ApiError('validation', 'Attach up to 3 files per comment.', 422)
      for (const f of attachments) {
        if (!ATTACHMENT_TYPES.includes(f.type))
          throw new ApiError('validation', `${f.name}: file type not allowed.`, 422)
        if (f.size > MAX_ATTACHMENT_BYTES) throw new ApiError('validation', `${f.name}: files must be under 1 MB.`, 422)
      }
      return ctx.mutate('comment.create', (tx, a) => {
        const task = ctx.inOrg('tasks', taskId, a.orgId)
        const members = Object.values(tx.state.memberships)
          .filter((m) => m.orgId === a.orgId)
          .map((m) => tx.state.users[m.userId])
        const mentions = findMentions(cleanBody, members).filter((id) => id !== a.user.id)
        const comment = tx.put('comments', {
          id: uid('c'),
          orgId: a.orgId,
          taskId,
          authorId: a.user.id,
          body: cleanBody,
          mentions,
          attachments: attachments.map((f) => ({
            id: uid('f'),
            name: cleanText(f.name, { max: 120 }),
            type: f.type,
            size: f.size,
            dataUrl: f.dataUrl,
            status: 'processing',
          })),
          createdAt: ctx.now(),
        })
        for (const userId of mentions)
          notify(tx, {
            orgId: a.orgId,
            userId,
            type: 'mention',
            message: `${a.user.name} mentioned you on ${task.key}`,
            link: { taskId },
            now: ctx.now(),
          })
        if (task.assigneeId && task.assigneeId !== a.user.id && !mentions.includes(task.assigneeId))
          notify(tx, {
            orgId: a.orgId,
            userId: task.assigneeId,
            type: 'comment',
            message: `${a.user.name} commented on ${task.key}`,
            link: { taskId },
            now: ctx.now(),
          })
        // Attachments are processed in the background (type check, size, "virus scan" step)
        for (const f of comment.attachments)
          tx.put(
            'jobs',
            createJob({
              id: uid('j'),
              orgId: a.orgId,
              type: 'files.process',
              payload: { commentId: comment.id, fileId: f.id },
              priority: 'normal',
              runAt: ctx.now(),
            }),
          )
        award(tx, { orgId: a.orgId, userId: a.user.id, now: ctx.now() }, { type: 'comment' })
        a.audit(tx, {
          action: 'comment.created',
          entityType: 'comment',
          entityId: comment.id,
          after: { ...comment, attachments: comment.attachments.map((f) => f.name) },
          summary: `Commented on ${task.key}`,
        })
        a.emit('comment.created', { ...comment, task })
        return comment
      })
    },

    async deleteComment(id) {
      return ctx.mutate('comment.create', (tx, a) => {
        const c = ctx.inOrg('comments', id, a.orgId)
        if (c.authorId !== a.user.id && !['owner', 'admin'].includes(a.role))
          throw new ApiError('forbidden', 'You can only delete your own comments.', 403)
        tx.remove('comments', id)
        a.audit(tx, {
          action: 'comment.deleted',
          entityType: 'comment',
          entityId: id,
          before: { ...c, attachments: c.attachments.map((f) => f.name) },
          summary: 'Deleted a comment',
        })
      })
    },

    // ------------------------------------------------------------ docs (real-time collaborative)
    async createDoc({ title, projectId = null }) {
      return ctx.mutate('doc.edit', (tx, a) => {
        const d = tx.put('docs', {
          id: uid('d'),
          orgId: a.orgId,
          projectId,
          title: cleanText(title, { max: 100, required: true, field: 'Title' }),
          content: '',
          version: 1,
          updatedBy: a.user.id,
          updatedAt: ctx.now(),
        })
        a.audit(tx, {
          action: 'doc.created',
          entityType: 'doc',
          entityId: d.id,
          after: { title: d.title },
          summary: `Created doc “${d.title}”`,
        })
        return d
      })
    },

    /**
     * Save with optimistic concurrency. If someone saved since `baseVersion`,
     * the two edits are merged line-by-line; overlapping edits are marked as conflicts.
     */
    async saveDoc(id, { content, baseVersion, baseContent }) {
      const text = String(content ?? '').slice(0, 50_000)
      return ctx.mutate('doc.edit', (tx, a) => {
        const doc = ctx.inOrg('docs', id, a.orgId)
        let merged = text
        let conflicts = 0
        if (baseVersion !== doc.version) {
          const r = threeWayMerge(baseContent ?? '', text, doc.content)
          merged = r.merged
          conflicts = r.conflicts
        }
        if (merged === doc.content) return { doc, conflicts, merged: false }
        tx.log('docVersions', {
          id: uid('dv'),
          orgId: a.orgId,
          docId: id,
          version: doc.version,
          content: doc.content,
          by: doc.updatedBy,
          at: doc.updatedAt,
        })
        const next = tx.put('docs', {
          ...doc,
          content: merged,
          version: doc.version + 1,
          updatedBy: a.user.id,
          updatedAt: ctx.now(),
        })
        a.audit(tx, {
          action: 'doc.updated',
          entityType: 'doc',
          entityId: id,
          before: { version: doc.version },
          after: { version: next.version },
          summary: `Edited “${doc.title}”${conflicts ? ` (${conflicts} conflict${conflicts > 1 ? 's' : ''} to resolve)` : baseVersion !== doc.version ? ' (auto-merged with a concurrent edit)' : ''}`,
        })
        return { doc: next, conflicts, merged: baseVersion !== doc.version }
      })
    },

    async restoreDocVersion(id, versionId) {
      return ctx.mutate('doc.edit', (tx, a) => {
        const doc = ctx.inOrg('docs', id, a.orgId)
        const v = tx.state.docVersions.find((x) => x.id === versionId && x.docId === id)
        if (!v) throw new ApiError('not_found', 'Version not found.', 404)
        tx.log('docVersions', {
          id: uid('dv'),
          orgId: a.orgId,
          docId: id,
          version: doc.version,
          content: doc.content,
          by: doc.updatedBy,
          at: doc.updatedAt,
        })
        const next = tx.put('docs', {
          ...doc,
          content: v.content,
          version: doc.version + 1,
          updatedBy: a.user.id,
          updatedAt: ctx.now(),
        })
        a.audit(tx, {
          action: 'doc.restored',
          entityType: 'doc',
          entityId: id,
          after: { version: next.version },
          summary: `Restored “${doc.title}” to version ${v.version}`,
        })
        return next
      })
    },

    // ------------------------------------------------------------ notifications
    async markNotificationRead(id) {
      const { user, orgId } = ctx.actor()
      db.transact((tx) => {
        const n = tx.state.notifications[id]
        if (n && n.userId === user.id && n.orgId === orgId) tx.patch('notifications', id, { read: true })
      })
    },

    async markAllNotificationsRead() {
      const { user, orgId } = ctx.actor()
      db.transact((tx) => {
        for (const n of tx.all('notifications'))
          if (n.userId === user.id && n.orgId === orgId && !n.read) tx.patch('notifications', n.id, { read: true })
      })
    },

    /** Announcement to everyone → processed by the background "bulk notifications" job. */
    async announce(message) {
      const text = cleanText(message, { max: 200, required: true, field: 'Message' })
      return ctx.mutate('settings.manage', (tx, a) => {
        tx.put(
          'jobs',
          createJob({
            id: uid('j'),
            orgId: a.orgId,
            type: 'notifications.bulk',
            payload: { message: `📣 ${a.user.name}: ${text}` },
            priority: 'high',
            runAt: ctx.now(),
          }),
        )
        a.audit(tx, {
          action: 'announcement.sent',
          entityType: 'org',
          entityId: a.orgId,
          summary: `Sent announcement: “${text}”`,
        })
      })
    },
  }
}
