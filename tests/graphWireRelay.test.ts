import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openGraphWireRelay, type GraphWireRelay, type GraphWireRelayOptions } from '../server/utils/bots/graphWireRelay'

const temporary: string[] = []
const opened: GraphWireRelay[] = []
const pids: number[] = []
const request = (extra: Record<string, unknown> = {}) => ({ protocol: 'omp.graph.v1', type: 'hello', message_id: 'request1', supported_protocols: ['omp.graph.v1'], ...extra })
const reply = `const emit = (value) => process.stdout.write(JSON.stringify({ protocol: 'omp.graph.v1', type: 'hello', in_reply_to: null, ...value }) + '\\n');`
const readLines = `const lines = createInterface({ input: process.stdin });`

async function fixture(body: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'graph-wire-relay-'))
  temporary.push(dir)
  const script = path.join(dir, 'source.mjs')
  const pidFile = path.join(dir, 'pid')
  // Real pipe/deadline integration requires a live OS process, not fake timers.
  // The interval only holds the fixture open; no test waits for one of its ticks.
  await fs.writeFile(script, `import fs from 'node:fs'; import { createInterface } from 'node:readline'; fs.writeFileSync(process.argv[2], String(process.pid)); setInterval(() => {}, 1000); ${reply}\n${body}`)
  return { command: [process.execPath, script, pidFile], pidFile }
}

async function launch(body: string, overrides: Partial<GraphWireRelayOptions> = {}) {
  const source = await fixture(body)
  const controller = new AbortController()
  const frames: unknown[] = []
  const relay = await openGraphWireRelay({ command: source.command, signal: controller.signal, assertAuthorized: async () => {}, deliver: async frame => { frames.push(frame) }, ...overrides })
  opened.push(relay)
  let pid = 0
  await vi.waitFor(async () => { pid = Number(await fs.readFile(source.pidFile, 'utf8')); expect(pid).toBeGreaterThan(0) })
  pids.push(pid)
  return { relay, controller, frames, pid }
}

async function expectDead(pid: number) {
  await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow())
}

afterEach(async () => {
  for (const relay of opened.splice(0)) relay.close()
  // A rejected closed promise is part of the public failure contract, not a leak.
  await Promise.all(pids.splice(0).map(expectDead))
  await Promise.all(temporary.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })))
})

describe('private Graph wire relay', () => {
  it('streams multiple frames and commands without closing source stdin', async () => {
    const { relay, frames, pid } = await launch(`${readLines} let index = 0; lines.on('line', line => { const input = JSON.parse(line); emit({ in_reply_to: input.message_id, index: ++index }); emit({ type: 'source.ready', index }); }); lines.on('close', () => process.exit(0));`)
    await relay.send(request())
    await vi.waitFor(() => expect(frames).toHaveLength(2))
    await relay.send(request({ message_id: 'request2' }))
    await vi.waitFor(() => expect(frames).toHaveLength(4))
    expect(frames).toEqual([
      expect.objectContaining({ in_reply_to: 'request1', index: 1 }), expect.objectContaining({ type: 'source.ready', index: 1 }),
      expect.objectContaining({ in_reply_to: 'request2', index: 2 }), expect.objectContaining({ type: 'source.ready', index: 2 }),
    ])
    expect(() => process.kill(pid, 0)).not.toThrow()
    relay.close()
    await expect(relay.closed).resolves.toBeUndefined()
    await expectDead(pid)
    await expect(relay.send(request())).rejects.toThrow('Graph wire relay unavailable')
  })

  it.each([
    ['oversized ASCII line', () => request({ padding: 'a'.repeat(64 * 1024) })],
    ['oversized UTF-8 line', () => request({ padding: '界'.repeat(24000) })],
    ['unsupported protocol', () => request({ protocol: 'omp.graph.v2' })],
    ['non-envelope binary input', () => Buffer.from([0xc3, 0x28])],
    ['missing message identity', () => request({ message_id: undefined })],
    ['unserializable input', () => ({ ...request(), self: 1n })],
  ])('rejects %s before writing', async (_name, value) => {
    const { relay, frames } = await launch(`${readLines} lines.on('line', () => emit({ leaked: true }));`)
    await expect(relay.send(value())).rejects.toThrow('Graph wire relay unavailable')
    await expect(relay.closed).rejects.toThrow('Graph wire relay unavailable')
    expect(frames).toEqual([])
  })

  it.each([
    ['pending request count', 17, 1],
    ['pending UTF-8 bytes', 3, 50000],
  ])('bounds %s including the active request before queueing', async (_name, count, size) => {
    let block = false
    const gate = Promise.withResolvers<void>()
    const { relay, frames } = await launch(`${readLines} lines.on('line', () => emit({ leaked: true }));`, {
      assertAuthorized: async () => { if (block) await gate.promise },
    })
    block = true
    const writes = Array.from({ length: count }, (_, index) => relay.send(request({ message_id: String(index), padding: 'x'.repeat(size) })))
    const results = await Promise.allSettled(writes)
    expect(results.every(result => result.status === 'rejected')).toBe(true)
    await expect(relay.closed).rejects.toThrow('Graph wire relay unavailable')
    expect(frames).toEqual([])
    gate.reject(new Error('protected authorization detail'))
  })

  it.each([
    ['oversized unterminated output', `process.stdout.write(Buffer.alloc(2 * 1024 * 1024 + 1, 97))`],
    ['oversized multibyte output', `process.stdout.write(JSON.stringify({ protocol: 'omp.graph.v1', type: 'hello', in_reply_to: null, padding: '界'.repeat(750000) }) + '\\n')`],
    ['malformed UTF-8 output', `process.stdout.write(Buffer.from([0xc3, 0x28, 10]))`],
    ['malformed JSON output', `process.stdout.write('{bad}\\n')`],
    ['unsupported first envelope', `emit({ protocol: 'omp.graph.v2' })`],
    ['non-envelope first output', `process.stdout.write('{}\\n')`],
    ['truncated EOF', `process.stdout.end('{"protocol":', () => process.exit(0))`],
    ['stderr budget', `process.stderr.write(Buffer.alloc(1024 * 1024 + 1, 97))`],
  ])('rejects %s without delivering protected details', async (_name, output) => {
    const { relay, frames } = await launch(`${readLines} lines.once('line', () => { ${output}; });`)
    await relay.send(request()).catch(() => {})
    await expect(relay.closed).rejects.toThrow('Graph wire relay unavailable')
    expect(frames).toEqual([])
  })

  it('validates protocol envelopes after the first frame too', async () => {
    const { relay, frames } = await launch(`${readLines} lines.once('line', () => { emit({}); emit({ protocol: 'other' }); });`)
    await relay.send(request())
    await expect(relay.closed).rejects.toThrow('Graph wire relay unavailable')
    expect(frames).toHaveLength(1)
  })

  it('checks idle authorization without depending on stdout', async () => {
    let authorized = true
    const { relay, pid } = await launch(`process.stdin.resume();`, { assertAuthorized: async () => { if (!authorized) throw new Error('/protected/session') } })
    authorized = false
    await expect(relay.closed).rejects.toThrow(/^Graph wire relay unavailable$/)
    await expectDead(pid)
  })

  it('revokes immediately while an authorization callback ignores abort', async () => {
    let block = false
    const gate = Promise.withResolvers<void>()
    const entered = Promise.withResolvers<void>()
    const { relay, controller, frames, pid } = await launch(`${readLines} lines.on('line', () => emit({ leaked: true }));`, {
      assertAuthorized: async () => { if (block) { entered.resolve(); await gate.promise } },
    })
    block = true
    const sending = relay.send(request())
    await entered.promise
    controller.abort()
    await expect(sending).rejects.toThrow('Graph wire relay unavailable')
    await expect(relay.closed).resolves.toBeUndefined()
    await expectDead(pid)
    expect(frames).toEqual([])
    gate.reject(new Error('late protected failure'))
  })

  it('does not wait for a stuck delivery callback on revocation or deliver another frame', async () => {
    const entered = Promise.withResolvers<void>()
    const gate = Promise.withResolvers<void>()
    let deliveries = 0
    const { relay, controller, pid } = await launch(`${readLines} lines.once('line', () => { emit({ index: 1 }); emit({ index: 2 }); });`, {
      deliver: async () => { deliveries++; entered.resolve(); await gate.promise },
    })
    await relay.send(request())
    await entered.promise
    controller.abort()
    await expect(relay.closed).resolves.toBeUndefined()
    await expectDead(pid)
    expect(deliveries).toBe(1)
    gate.reject(new Error('late protected delivery detail'))
  })

  it('rechecks authorization after a delayed delivery before releasing the next frame', async () => {
    let authorized = true
    const entered = Promise.withResolvers<void>()
    const gate = Promise.withResolvers<void>()
    let deliveries = 0
    const { relay } = await launch(`${readLines} lines.once('line', () => { emit({ index: 1 }); emit({ index: 2 }); });`, {
      assertAuthorized: async () => { if (!authorized) throw new Error('protected authorization detail') },
      deliver: async () => { deliveries++; entered.resolve(); await gate.promise },
    })
    await relay.send(request())
    await entered.promise
    authorized = false
    gate.resolve()
    await expect(relay.closed).rejects.toThrow(/^Graph wire relay unavailable$/)
    expect(deliveries).toBe(1)
  })

  it('bounds a delivery callback that never settles', async () => {
    const entered = Promise.withResolvers<void>()
    const gate = Promise.withResolvers<void>()
    const { relay, pid } = await launch(`${readLines} lines.once('line', () => emit({}));`, {
      deliver: async () => { entered.resolve(); await gate.promise },
    })
    await relay.send(request())
    await entered.promise
    await expect(relay.closed).rejects.toThrow('Graph wire relay unavailable')
    await expectDead(pid)
    gate.resolve()
  })

  it('bounds source stdin backpressure rather than accumulating write callbacks', async () => {
    const { relay, pid } = await launch(`process.stdin.pause();`)
    // Sequential writes can fill even a large platform pipe without relying on its capacity.
    let rejected = false
    for (let index = 0; index < 1024; index++) {
      try { await relay.send(request({ message_id: String(index), padding: 'x'.repeat(60000) })) }
      catch { rejected = true; break }
    }
    expect(rejected).toBe(true)
    await expect(relay.closed).rejects.toThrow('Graph wire relay unavailable')
    await expectDead(pid)
  })

  it.each([0, 7])('settles source exit %s and leaves no owned child', async code => {
    const { relay, pid } = await launch(`${readLines} lines.once('line', () => process.exit(${code}));`)
    await relay.send(request()).catch(() => {})
    if (code === 0) await expect(relay.closed).resolves.toBeUndefined()
    else await expect(relay.closed).rejects.toThrow(/^Graph wire relay unavailable$/)
    await expectDead(pid)
  })

  it('rejects spawn failure and never exposes executable or exception text', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'graph-wire-relay-'))
    temporary.push(dir)
    await expect(openGraphWireRelay({ command: [path.join(dir, 'protected-missing-program')], signal: new AbortController().signal, assertAuthorized: async () => {}, deliver: async () => {} })).rejects.toThrow(/^Graph wire relay unavailable$/)
  })

  it('does not launch a source when initial authorization is revoked or never settles', async () => {
    const source = await fixture(`process.stdin.resume();`)
    const controller = new AbortController()
    const gate = Promise.withResolvers<void>()
    const entered = Promise.withResolvers<void>()
    const opening = openGraphWireRelay({ command: source.command, signal: controller.signal, assertAuthorized: async () => { entered.resolve(); await gate.promise }, deliver: async () => {} })
    await entered.promise
    controller.abort()
    await expect(opening).rejects.toThrow(/^Graph wire relay unavailable$/)
    await expect(fs.stat(source.pidFile)).rejects.toMatchObject({ code: 'ENOENT' })
    gate.reject(new Error('late initial authorization detail'))
  })
})

describe('Graph wire relay callback boundaries', () => {
  it('waits for actual delivery completion before delivering the next frame', async () => {
    const first = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let deliveries = 0
    const { relay } = await launch(`${readLines} lines.once('line', () => { emit({ index: 1 }); emit({ index: 2 }); });`, {
      deliver: async () => {
        deliveries++
        if (deliveries === 1) { first.resolve(); await release.promise }
      },
    })
    await relay.send(request())
    await first.promise
    expect(deliveries).toBe(1)
    release.resolve()
    await vi.waitFor(() => expect(deliveries).toBe(2))
    relay.close()
    await expect(relay.closed).resolves.toBeUndefined()
  })

  it('bounds initial authorization even without an abort notification', async () => {
    const source = await fixture(`process.stdin.resume();`)
    const gate = Promise.withResolvers<void>()
    await expect(openGraphWireRelay({
      command: source.command,
      signal: new AbortController().signal,
      assertAuthorized: () => gate.promise,
      deliver: async () => {},
    })).rejects.toThrow(/^Graph wire relay unavailable$/)
    await expect(fs.stat(source.pidFile)).rejects.toMatchObject({ code: 'ENOENT' })
    gate.resolve()
  })
})
