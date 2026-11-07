import { defineWebSocketHandler } from 'h3'
import type { Peer } from 'crossws'
import { DATA_DIR } from '../../utils/env'
import { auth } from '../../utils/http'
import { onNetworkReading } from '../../utils/network'
import { checkUpgrade, headersOf, rawWs, upgradeVerdict, watchPeer, unwatchPeer } from '../../utils/ws'
import { requireBotSession } from '../../utils/bots/workspace'
import { createGraphWireGateway } from '../../utils/bots/graphWireGateway'

interface Connection { receive: (text: string) => Promise<void>, close: () => void }
const connections = new Map<Peer, Connection>()

export default defineWebSocketHandler({
  async upgrade(request) {
    const refusal = await checkUpgrade(request)
    if (refusal) return refusal
    try { requireBotSession(auth.status({ headers: headersOf(request.headers) })) }
    catch { return new Response(null, { status: 401, statusText: 'Unauthorized' }) }
    if (connections.size >= 16) return new Response(null, { status: 503, statusText: 'Observation capacity reached' })
  },
  open(peer) {
    const socket = rawWs(peer)
    if (!socket || connections.size >= 16) { peer.close(1008, 'Graph observation unavailable'); return }
    const lifetime = new AbortController()
    const request = { headers: headersOf(peer.request.headers) }
    let removeAuth = () => {}, removeNetwork = () => {}
    const close = () => {
      if (lifetime.signal.aborted) return
      lifetime.abort()
      connections.delete(peer)
      removeAuth(); removeNetwork(); unwatchPeer(peer)
      try { peer.close(1008, 'Graph observation closed') } catch { /* disconnected */ }
    }
    const assertSession = () => {
      lifetime.signal.throwIfAborted()
      if (upgradeVerdict(request.headers, peer.remoteAddress) !== 'ok') throw new Error('Graph observation unavailable')
      requireBotSession(auth.status(request))
      lifetime.signal.throwIfAborted()
    }
    const gateway = createGraphWireGateway({
      dataDir: DATA_DIR,
      signal: lifetime.signal,
      assertSession,
      deliver: async frame => {
        assertSession()
        const data = JSON.stringify(frame)
        if (socket.readyState !== 1 || socket.bufferedAmount + Buffer.byteLength(data) > 2 * 1024 * 1024) throw new Error('Graph observation unavailable')
        const delivery = Promise.withResolvers<void>()
        // crossws Peer.send is fire-and-forget; use the Node adapter's real write callback.
        socket.send(data, { binary: false, compress: false }, error => {
          if (error || lifetime.signal.aborted) delivery.reject(new Error('Graph observation unavailable'))
          else delivery.resolve()
        })
        await delivery.promise
        assertSession()
      },
    })
    removeAuth = auth.onConnectionInvalidated(matches => { if (matches(request)) close() })
    removeNetwork = onNetworkReading(() => { try { assertSession() } catch { close() } })
    connections.set(peer, { receive: gateway.receive, close })
    void gateway.closed.then(close)
    watchPeer(peer)
    try { assertSession() } catch { close() }
  },
  message(peer, message) {
    const connection = connections.get(peer)
    if (!connection) { peer.close(1008, 'Graph observation unavailable'); return }
    try {
      const bytes = message.uint8Array()
      if (bytes.byteLength > 64 * 1024) { connection.close(); return }
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      void connection.receive(text).catch(connection.close)
    } catch { connection.close() }
  },
  close(peer) { connections.get(peer)?.close(); unwatchPeer(peer) },
  error(peer) { connections.get(peer)?.close(); unwatchPeer(peer) },
})
