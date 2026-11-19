import jwt from 'jsonwebtoken'
import { WebSocketServer } from 'ws'
import { logger } from '../lib/util.js'

/**
 * Real-time updates over WebSockets.
 *  - Clients connect to /ws?token=<access JWT>, then {type:'subscribe', orgId}
 *  - Membership is verified before joining an org "room" (tenant isolation applies here too)
 *  - Every committed domain event is broadcast to that org's room → clients refresh without reloading
 *  - Presence/cursor messages are relayed to everyone else in the room
 */
export function attachRealtime(server, ctx) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 })
  const rooms = new Map() // orgId → Set<ws>

  wss.on('connection', (ws, req) => {
    const token = new URL(req.url, 'http://x').searchParams.get('token')
    let user
    try {
      user = jwt.verify(token, ctx.config.jwtSecret, { algorithms: ['HS256'], issuer: 'flowdesk' })
    } catch {
      ws.close(4401, 'Unauthorized')
      return
    }
    ws.userId = user.sub
    ws.isAlive = true
    ws.on('pong', () => (ws.isAlive = true))

    ws.on('message', async (raw) => {
      let msg
      try {
        msg = JSON.parse(raw)
      } catch {
        return
      }
      if (msg.type === 'subscribe' && typeof msg.orgId === 'string') {
        const m = await ctx.db.one('SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2', [
          msg.orgId,
          ws.userId,
        ])
        if (!m) return ws.send(JSON.stringify({ type: 'error', message: 'Not a member' }))
        rooms.get(ws.orgId)?.delete(ws)
        ws.orgId = msg.orgId
        if (!rooms.has(msg.orgId)) rooms.set(msg.orgId, new Set())
        rooms.get(msg.orgId).add(ws)
        ws.send(JSON.stringify({ type: 'subscribed', orgId: msg.orgId }))
      } else if (msg.type === 'presence' && ws.orgId) {
        const payload = JSON.stringify({
          type: 'presence',
          userId: ws.userId,
          location: String(msg.location ?? '').slice(0, 100),
          docId: msg.docId ?? null,
          cursor: Number(msg.cursor) || null,
          at: Date.now(),
        })
        for (const peer of rooms.get(ws.orgId) ?? []) if (peer !== ws && peer.readyState === 1) peer.send(payload)
      }
    })
    ws.on('close', () => rooms.get(ws.orgId)?.delete(ws))
  })

  // Broadcast committed changes (entity + id only; clients fetch what they're allowed to see)
  ctx.bus.on(async (event) => {
    const peers = rooms.get(event.orgId)
    if (!peers?.size) return
    const msg = JSON.stringify({ type: 'event', event: event.type, id: event.subject?.id ?? null, at: Date.now() })
    for (const ws of peers) if (ws.readyState === 1) ws.send(msg)
  })

  // Drop dead connections
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate()
        continue
      }
      ws.isAlive = false
      ws.ping()
    }
  }, 30_000)
  wss.on('close', () => clearInterval(heartbeat))
  logger.info('realtime_ready', { path: '/ws' })
  return wss
}
