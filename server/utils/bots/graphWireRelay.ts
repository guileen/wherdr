import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

const PROTOCOL = 'omp.graph.v1'
const MAX_INPUT = 64 * 1024
const MAX_PENDING_BYTES = 128 * 1024
const MAX_PENDING = 16
const MAX_OUTPUT = 2 * 1024 * 1024
const DEADLINE = 1000
const unavailable = () => new Error('Graph wire relay unavailable')
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

export interface GraphWireRelayOptions {
  /** Complete argv from trusted source configuration, including its fixed source and Run. */
  command: readonly string[]
  signal: AbortSignal
  assertAuthorized: () => Promise<void>
  /** Resolves after the actual transport write, not after enqueueing it. */
  deliver: (frame: unknown) => Promise<void>
}

export interface GraphWireRelay {
  send(value: unknown): Promise<void>
  close(): void
  /** Resolves on revocation/explicit close/clean EOF; rejects generically on failure. */
  closed: Promise<void>
}

// Races callbacks as well as IO: neither an embedding callback nor a child may hold
// revocation open. Late callback rejection is consumed, never exposed to the browser.
function bounded<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>()
  if (signal.aborted) { reject(unavailable()); return promise }
  const finish = (error: boolean, value?: T) => {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
    if (error) reject(unavailable())
    else resolve(value as T)
  }
  const abort = () => finish(true)
  const timer = setTimeout(abort, DEADLINE)
  signal.addEventListener('abort', abort, { once: true })
  try { Promise.resolve(operation()).then(value => finish(false, value), () => finish(true)) }
  catch { finish(true) }
  return promise
}

/** Private read-only JSONL pipe, not a listener, authenticator or descendant sandbox.
 * The parent owns session policy, the browser command allowlist and aggregate resource
 * limits. Only the direct child is owned/killed; trusted launchers must not detach it.
 */
export async function openGraphWireRelay(options: GraphWireRelayOptions): Promise<GraphWireRelay> {
  if (!options.command.length || options.command.some(value => typeof value !== 'string' || !value || value.includes('\0'))) throw unavailable()
  await bounded(options.assertAuthorized, options.signal)
  if (options.signal.aborted) throw unavailable()

  const lifetime = new AbortController()
  const signal = lifetime.signal
  let child: ChildProcessWithoutNullStreams
  try {
    child = spawn(options.command[0]!, [...options.command.slice(1)], {
      shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    })
  } catch { throw unavailable() }
  // Explicit pipe stdio above guarantees these streams (without using shell or EOF).
  const input = child.stdin!
  const output = child.stdout!
  const stderr = child.stderr!
  const settled = Promise.withResolvers<void>()
  const exited = Promise.withResolvers<void>()
  void settled.promise.catch(() => {})
  let stopped = false
  let failed = false
  let processClosed = false
  let closeTimer: NodeJS.Timeout | undefined
  let pollTimer: NodeJS.Timeout | undefined
  let lifetimeTimer: NodeJS.Timeout | undefined
  let pollActive = false
  let pendingBytes = 0
  let pendingCount = 0
  let writing = false
  type Request = { bytes: Buffer, resolve: () => void, reject: (reason: Error) => void }
  const queue: Request[] = []
  let active: Request | undefined

  const settle = () => {
    clearTimeout(closeTimer)
    if (failed) settled.reject(unavailable())
    else settled.resolve()
  }
  const stop = (failure = false) => {
    if (stopped) return
    stopped = true
    failed = failure
    // Revoke synchronously before releasing any pending operation.
    lifetime.abort()
    clearInterval(pollTimer)
    clearTimeout(lifetimeTimer)
    options.signal.removeEventListener('abort', revoke)
    active?.reject(unavailable())
    for (const item of queue.splice(0)) {
      pendingBytes -= item.bytes.length
      pendingCount--
      item.reject(unavailable())
    }
    input.destroy()
    output.destroy()
    stderr.destroy()
    // No process-group signals: this is ownership of the direct child only.
    if (!processClosed) {
      try { child.kill('SIGKILL') } catch { /* Settlement remains bounded if already gone. */ }
      closeTimer = setTimeout(settle, DEADLINE)
    } else settle()
  }
  const revoke = () => stop()
  options.signal.addEventListener('abort', revoke, { once: true })
  child.once('error', () => stop(true))
  input.on('error', () => stop(true))
  output.on('error', () => stop(true))
  stderr.on('error', () => stop(true))
  child.once('exit', (code, exitSignal) => {
    exited.resolve()
    if (!stopped && (code !== 0 || exitSignal !== null)) stop(true)
  })
  child.once('close', () => {
    processClosed = true
    if (stopped) settle()
  })
  let stderrBytes = 0
  stderr.on('data', (chunk: Buffer) => {
    stderrBytes += chunk.length
    if (stderrBytes > 1024 * 1024) stop(true)
  })

  const check = async () => {
    signal.throwIfAborted()
    await bounded(options.assertAuthorized, signal)
    signal.throwIfAborted()
  }
  const pumpInput = async () => {
    if (writing) return
    writing = true
    try {
      while (!stopped && queue.length) {
        const item = queue.shift()!
        active = item
        try {
          await check()
          await bounded(() => {
            const write = Promise.withResolvers<void>()
            input.write(item.bytes, error => { if (error) write.reject(unavailable()); else write.resolve() })
            return write.promise
          }, signal)
          await check()
          item.resolve()
        } catch {
          item.reject(unavailable())
          throw unavailable()
        } finally {
          active = undefined
          pendingBytes -= item.bytes.length
          pendingCount--
        }
      }
    } catch {
      stop(true)
    } finally { writing = false }
  }

  const pumpOutput = async () => {
    // Fixed storage and a paused Node readable: no frame list or unbounded chunk queue.
    const line = Buffer.allocUnsafe(MAX_OUTPUT)
    const decoder = new TextDecoder('utf-8', { fatal: true })
    let used = 0
    try {
      for await (const raw of output) {
        if (stopped) return
        const chunk = raw as Buffer
        if (chunk.length > MAX_OUTPUT) throw unavailable()
        let offset = 0
        while (offset < chunk.length) {
          const end = chunk.indexOf(10, offset)
          const boundary = end === -1 ? chunk.length : end
          const count = boundary - offset
          if (used + count + 1 > MAX_OUTPUT) throw unavailable()
          chunk.copy(line, used, offset, boundary)
          used += count
          if (end === -1) break
          // Fatal UTF-8 and byte ceilings precede parsing or delivery.
          const frame: unknown = JSON.parse(decoder.decode(line.subarray(0, used)))
          if (!record(frame) || frame.protocol !== PROTOCOL || typeof frame.type !== 'string' || !frame.type ||
            !(frame.in_reply_to === null || typeof frame.in_reply_to === 'string')) throw unavailable()
          used = 0
          await check()
          await bounded(() => options.deliver(frame), signal)
          await check()
          offset = end + 1
        }
      }
      if (!stopped) {
        if (used !== 0 || pendingCount !== 0) throw unavailable()
        // EOF is only graceful when the direct child exits successfully; do not
        // misclassify a nonzero exit whose stdout EOF wins the event-loop race.
        await check()
        await bounded(() => exited.promise, signal)
        await check()
        stop()
      }
    } catch { if (!stopped) stop(true) }
  }

  pollTimer = setInterval(() => {
    if (stopped || pollActive) return
    pollActive = true
    void check().catch(() => stop(true)).finally(() => { pollActive = false })
  }, 500)
  lifetimeTimer = setTimeout(revoke, 5 * 60 * 1000)
  void pumpOutput()
  if (options.signal.aborted) revoke()

  try {
    await bounded(() => {
      const started = Promise.withResolvers<void>()
      child.once('spawn', started.resolve)
      child.once('error', started.reject)
      if (stopped) started.reject(unavailable())
      return started.promise
    }, signal)
    await check()
  } catch {
    stop(true)
    await settled.promise.catch(() => {})
    throw unavailable()
  }

  return {
    send(value: unknown): Promise<void> {
      try {
        if (stopped || options.signal.aborted) throw unavailable()
        const json = JSON.stringify(value)
        if (typeof json !== 'string' || json.length + 1 > MAX_INPUT) throw unavailable()
        const bytes = Buffer.byteLength(json, 'utf8') + 1
        if (bytes > MAX_INPUT || pendingCount >= MAX_PENDING || pendingBytes + bytes > MAX_PENDING_BYTES) throw unavailable()
        const envelope: unknown = JSON.parse(json)
        if (!record(envelope) || envelope.protocol !== PROTOCOL || typeof envelope.type !== 'string' || !envelope.type ||
          typeof envelope.message_id !== 'string' || !envelope.message_id || envelope.message_id.length > 256) throw unavailable()
        const result = Promise.withResolvers<void>()
        void result.promise.catch(() => {})
        // Admission counts include the active write, before any authorization/IO await.
        pendingBytes += bytes
        pendingCount++
        queue.push({ bytes: Buffer.from(`${json}\n`, 'utf8'), resolve: result.resolve, reject: result.reject })
        void pumpInput()
        return result.promise
      } catch {
        stop(true)
        const rejected = Promise.reject<void>(unavailable())
        void rejected.catch(() => {})
        return rejected
      }
    },
    close: revoke,
    closed: settled.promise,
  }
}
