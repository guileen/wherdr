import * as fs from 'node:fs'
import { GRAPH_WIRE_EXECUTION_EXTENSION, isGraphWireExecutionKind, validateGraphWireArtifactFrame, validateGraphWireRecord } from '@oh-my-pi/pi-wire/graph'
import { authorizeGraphWireSource } from './graphObservation'
import { openGraphWireRelay, type GraphWireRelay } from './graphWireRelay'
import { exact, identity, record } from './validation'

interface GatewayOptions {
  dataDir: string
  signal: AbortSignal
  assertSession: () => void
  deliver: (frame: unknown) => Promise<void>
}

/** One authenticated connection, one fixed source/Run. No mutation or roster admission. */
export function createGraphWireGateway(options: GatewayOptions) {
  const lifetime = new AbortController()
  let relay: GraphWireRelay | undefined
  let selected: { source_id: string, source_token: string, run_id: string } | undefined
  let watcher: fs.FSWatcher | undefined
  let checkingConfig = false
  let pending = 0, pendingBytes = 0
  let chain = Promise.resolve()
  let helloOffer: { message_id: string, extensions: string[] } | undefined
  let negotiated: string[] | undefined
  let executionSource = false
  const messageIds = new Set<string>()
  const artifactRequests = new Map<string, { source_id: string, graph_run_id: string, ref: string }>()
  const done = Promise.withResolvers<void>()
  const close = () => {
    if (lifetime.signal.aborted) return
    lifetime.abort()
    artifactRequests.clear()
    messageIds.clear()
    clearTimeout(openDeadline)
    watcher?.close()
    relay?.close()
    options.signal.removeEventListener('abort', close)
    done.resolve()
  }
  const fail = () => { close(); throw new Error('Graph observation unavailable') }
  const openDeadline = setTimeout(close, 10000)
  options.signal.addEventListener('abort', close, { once: true })
  if (options.signal.aborted) close()
  const assertSession = () => { lifetime.signal.throwIfAborted(); options.assertSession(); lifetime.signal.throwIfAborted() }
  const authorize = async () => {
    assertSession()
    if (!selected) throw new Error('Graph observation unavailable')
    const config = await authorizeGraphWireSource(options.dataDir, selected)
    assertSession()
    return config
  }
  const outgoing = async (frame: unknown) => {
    await authorize()
    if (!record(frame) || frame.protocol !== 'omp.graph.v1' || typeof frame.type !== 'string') return fail()
    const sourceId = selected!.source_id, runId = selected!.run_id
    if (Object.hasOwn(frame, 'source_id') && frame.source_id !== sourceId) return fail()
    if (Object.hasOwn(frame, 'graph_run_id') && frame.graph_run_id !== runId) return fail()
    if (frame.type === 'hello' || frame.type === 'subscription') {
      if (!Array.isArray(frame.sources) || frame.sources.length !== 1 || !record(frame.sources[0]) || frame.sources[0].source_id !== sourceId || frame.sources[0].kind !== 'graph' || frame.sources[0].profile_id !== null || frame.sources[0].bot_id !== null) return fail()
      const capabilities = frame.sources[0].capabilities
      if (!Array.isArray(capabilities) || capabilities.some(value => typeof value !== 'string' || !['graph.runs.v1', 'graph.history.v1', GRAPH_WIRE_EXECUTION_EXTENSION].includes(value))) return fail()
      const supportsExecution = capabilities.includes(GRAPH_WIRE_EXECUTION_EXTENSION)
      if (frame.type === 'hello') {
        if (!helloOffer || negotiated || frame.in_reply_to !== helloOffer.message_id || !Array.isArray(frame.extensions) || frame.extensions.length > 1 || frame.extensions.some(value => value !== GRAPH_WIRE_EXECUTION_EXTENSION || !helloOffer!.extensions.includes(value) || !supportsExecution)) return fail()
        negotiated = [...frame.extensions] as string[]
        executionSource = supportsExecution
      } else if (!negotiated || supportsExecution !== executionSource) return fail()
    }
    if (frame.type !== 'hello' && frame.type !== 'error' && !negotiated) return fail()
    // The transport intersection and this fixed source's capability are both required.
    // Record validation is shared with the browser, not a parallel execution schema.
    const records = (items: unknown): boolean => Array.isArray(items) && items.every(item => {
      validateGraphWireRecord(item)
      return item.value.graph_run_id === runId && (!isGraphWireExecutionKind(item.kind) || (executionSource && negotiated?.includes(GRAPH_WIRE_EXECUTION_EXTENSION)))
    })
    if ((frame.type === 'snapshot.page' || frame.type === 'graph.event') && !records(frame.records)) return fail()
    if (frame.type === 'graph.history' && (!Array.isArray(frame.items) || (frame.view === 'state' ? !records(frame.items) : frame.view !== 'events' || !frame.items.every(item => record(item) && records(item.records))))) return fail()
    if (frame.type === 'graph.artifact') {
      validateGraphWireArtifactFrame(frame)
      const request = artifactRequests.get(frame.in_reply_to)
      if (!executionSource || !negotiated?.includes(GRAPH_WIRE_EXECUTION_EXTENSION) || !request || frame.source_id !== request.source_id || frame.graph_run_id !== request.graph_run_id || frame.ref !== request.ref) return fail()
      // Consume before awaiting authority again so no replay can reuse this request.
      artifactRequests.delete(frame.in_reply_to)
      await authorize()
    }
    if (!['hello', 'error', 'subscription', 'scope.authorized', 'scope.invalidated', 'source.state', 'snapshot.begin', 'snapshot.page', 'snapshot.end', 'graph.event', 'source.ready', 'heartbeat', 'graph.history', 'graph.artifact'].includes(frame.type)) return fail()
    assertSession()
    await options.deliver(frame)
    assertSession()
  }
  const handle = async (value: unknown) => {
    assertSession()
    if (!selected) {
      exact(value, ['type', 'source_id', 'source_token', 'run_id'])
      if (value.type !== 'open' || !identity(value.source_id) || !identity(value.run_id) || typeof value.source_token !== 'string') return fail()
      selected = { source_id: value.source_id, source_token: value.source_token, run_id: value.run_id }
      // Directory watches see replacements, but Darwin may also report writes predating
      // watcher creation. Judge current authority, not event arrival time.
      watcher = fs.watch(options.dataDir, (_event, name) => {
        if (name !== null && String(name) !== 'graph-observation-sources.json') return
        if (checkingConfig || lifetime.signal.aborted) return
        checkingConfig = true
        void authorize().catch(close).finally(() => { checkingConfig = false })
      })
      watcher.on('error', close)
      const config = await authorize()
      const opened = await openGraphWireRelay({ command: config.command, signal: lifetime.signal, assertAuthorized: async () => { await authorize() }, deliver: outgoing })
      if (lifetime.signal.aborted) { opened.close(); return }
      relay = opened
      void relay.closed.then(close, close)
      clearTimeout(openDeadline)
      return
    }
    if (!record(value) || value.protocol !== 'omp.graph.v1' || !identity(value.message_id)) return fail()
    // Lifetime uniqueness prevents a completed request ID from authorizing a replay.
    if (messageIds.has(value.message_id) || messageIds.size >= 4096) return fail()
    messageIds.add(value.message_id)
    if (value.type !== 'hello' && !negotiated) return fail()
    if (value.type === 'hello') {
      exact(value, ['protocol', 'type', 'message_id', 'supported_protocols', 'extensions'])
      if (helloOffer || !Array.isArray(value.supported_protocols) || !value.supported_protocols.includes('omp.graph.v1') || !Array.isArray(value.extensions) || value.extensions.some(extension => !identity(extension))) return fail()
      helloOffer = { message_id: value.message_id, extensions: [...value.extensions] as string[] }
    } else if (value.type === 'subscribe') {
      exact(value, ['protocol', 'type', 'message_id', 'subscription_id', 'mode', 'scope', 'resume'])
      exact(value.scope, ['source_ids', 'graph_run_id'])
      if (value.scope.graph_run_id !== selected.run_id || !Array.isArray(value.scope.source_ids) || value.scope.source_ids.length !== 1 || value.scope.source_ids[0] !== selected.source_id) return fail()
    } else if (value.type === 'unsubscribe') {
      exact(value, ['protocol', 'type', 'message_id', 'subscription_id'])
    } else if (value.type === 'graph.history.get') {
      exact(value, ['protocol', 'type', 'message_id', 'subscription_id', 'scope_id', 'source_id', 'graph_run_id', 'view', 'at', 'after', 'filter', 'page_token', 'limit'])
      if (value.source_id !== selected.source_id || value.graph_run_id !== selected.run_id) return fail()
    } else if (value.type === 'graph.artifact.get') {
      exact(value, ['protocol', 'type', 'message_id', 'source_id', 'graph_run_id', 'ref', 'page_token', 'limit'])
      if (!executionSource || !negotiated?.includes(GRAPH_WIRE_EXECUTION_EXTENSION) || value.source_id !== selected.source_id || value.graph_run_id !== selected.run_id || !identity(value.ref) || !value.ref.startsWith('consultation-message:') || value.ref.length === 'consultation-message:'.length || value.page_token !== null || value.limit !== 1 || artifactRequests.size >= 16) return fail()
      artifactRequests.set(value.message_id, { source_id: value.source_id, graph_run_id: value.graph_run_id, ref: value.ref })
    } else return fail()
    await authorize()
    await relay!.send(value)
    assertSession()
  }
  return {
    close,
    closed: done.promise,
    receive(text: string): Promise<void> {
      const bytes = Buffer.byteLength(text, 'utf8')
      if (lifetime.signal.aborted || bytes > 64 * 1024 || pending >= 16 || pendingBytes + bytes > 128 * 1024) {
        close()
        return Promise.reject(new Error('Graph observation unavailable'))
      }
      pending++; pendingBytes += bytes
      const operation = chain.then(async () => { assertSession(); await handle(JSON.parse(text)) }).catch(() => { close(); throw new Error('Graph observation unavailable') }).finally(() => { pending--; pendingBytes -= bytes })
      chain = operation.catch(() => {})
      return operation
    },
  }
}
