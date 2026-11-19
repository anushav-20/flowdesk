/**
 * Real-time presence: who is online, which page they're on, and where their cursor is in a doc.
 * Tabs exchange heartbeats over BroadcastChannel (or the server's WebSocket in API mode).
 * Entries expire after 12s without a heartbeat.
 */
const CHANNEL = 'flowdesk-presence'
const TTL = 12_000
const HEARTBEAT = 4_000

export function createPresence({ getIdentity }) {
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null
  const tabId = Math.random().toString(36).slice(2)
  let peers = {}
  let local = { location: '', docId: null, cursor: null, typing: false }
  const listeners = new Set()
  let snapshot = []

  const recompute = () => {
    const now = Date.now()
    peers = Object.fromEntries(Object.entries(peers).filter(([, p]) => now - p.at < TTL))
    snapshot = Object.values(peers)
    listeners.forEach((l) => l())
  }

  const send = (type = 'beat') => {
    const id = getIdentity()
    if (!id?.userId || !channel) return
    channel.postMessage({ type, tabId, ...id, ...local, at: Date.now() })
  }

  channel?.addEventListener('message', (e) => {
    const msg = e.data
    if (!msg?.tabId || msg.tabId === tabId) return
    if (msg.type === 'leave') delete peers[msg.tabId]
    else {
      peers[msg.tabId] = msg
      if (msg.type === 'hello') send() // reply so the newcomer sees us immediately
    }
    recompute()
  })

  const timer = setInterval(() => {
    send()
    recompute()
  }, HEARTBEAT)
  if (typeof window !== 'undefined') window.addEventListener('pagehide', () => send('leave'))
  send('hello')

  return {
    tabId,
    /** Update what this tab is doing (page, doc cursor…) and broadcast immediately. */
    update(patch) {
      local = { ...local, ...patch }
      send()
    },
    announce: () => send('hello'),
    /** Other tabs/people currently online. Stable array reference between changes. */
    getPeers: () => snapshot,
    subscribe(l) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    stop() {
      clearInterval(timer)
      send('leave')
      channel?.close()
    },
  }
}
