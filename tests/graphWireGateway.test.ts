import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GRAPH_WIRE_EXECUTION_EXTENSION, GraphWireSourceState, type GraphWireSourceFrame } from '@oh-my-pi/pi-wire/graph'
import { createGraphObservation } from '../server/utils/bots/graphObservation'
import { createGraphWireGateway } from '../server/utils/bots/graphWireGateway'
import { graphWireFixture, type GraphWireFixture } from './fixtures/graphWire'

const cleanups: (() => Promise<void>)[] = []
const protocol = 'omp.graph.v1'
const hello = { protocol, type: 'hello', message_id: 'hello', supported_protocols: [protocol], extensions: ['graph.execution.v1'] }
const artifactRequest = { protocol, type: 'graph.artifact.get', message_id: 'artifact', source_id: 'local', graph_run_id: 'run1', ref: 'consultation-message:question', page_token: null, limit: 1 }
interface ArtifactFixture {
  responses?: Record<string, unknown>[]
  omit?: string[]
  unsolicited?: boolean
  deferred?: boolean
}
async function setup(options: { fixture?: GraphWireFixture, extensions?: string[], history?: unknown[], artifact?: ArtifactFixture } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'graph-wire-gateway-'))
  const script = path.join(dir, 'source.mjs'), requests = path.join(dir, 'requests'), release = path.join(dir, 'release')
  const fixture = options.fixture ?? graphWireFixture(false)
  const extensions = options.extensions ?? (fixture.source.capabilities.includes(GRAPH_WIRE_EXECUTION_EXTENSION) ? [GRAPH_WIRE_EXECUTION_EXTENSION] : [])
  await fs.writeFile(release, '')
  await fs.writeFile(script, `
    import fs from 'node:fs';
    import { createInterface } from 'node:readline';
    const fixture = ${JSON.stringify(fixture)}, extensions = ${JSON.stringify(extensions)}, history = ${JSON.stringify(options.history ?? [])}, artifact = ${JSON.stringify(options.artifact ?? {})};
    const send = frame => process.stdout.write(JSON.stringify(frame) + '\\n');
    const respond = value => {
      for (const patch of artifact.responses ?? [{}]) {
        const frame = {protocol:'omp.graph.v1', type:'graph.artifact', in_reply_to:value.message_id, source_id:value.source_id, graph_run_id:value.graph_run_id, ref:value.ref, availability:'available', media_type:'text/markdown', content:'Consultation answer', next_page_token:null, ...patch};
        for (const key of artifact.omit ?? []) delete frame[key];
        send(frame);
      }
    };
    const waiting = [];
    const flush = () => {
      if (fs.readFileSync(process.argv[3], 'utf8') === 'ready') for (const value of waiting.splice(0)) respond(value);
    };
    if (artifact.deferred) fs.watch(process.argv[3], flush);
    createInterface({input:process.stdin}).on('line', line => {
      const value = JSON.parse(line); fs.appendFileSync(process.argv[2], line + '\\n');
      if (value.type === 'hello') {
        send({protocol:'omp.graph.v1', type:'hello', in_reply_to:value.message_id, sources:[fixture.source], capabilities:fixture.source.capabilities, extensions});
        if (artifact.unsolicited) respond(${JSON.stringify(artifactRequest)});
      }
      if (value.type === 'subscribe') for (const frame of fixture.frames) send({...frame, subscription_id:value.subscription_id});
      if (value.type === 'graph.history.get') send({protocol:'omp.graph.v1', type:'graph.history', in_reply_to:value.message_id, subscription_id:value.subscription_id, source_id:'local', graph_run_id:'run1', view:value.view, items:history});
      if (value.type === 'graph.artifact.get') {
        if (artifact.deferred) {
          waiting.push(value);
          flush();
        } else respond(value);
      }
    });
  `)
  const source = { id: 'local', label: 'Local', command: ['/trusted/legacy'], wire_command: [process.execPath, script, requests, release], runs: ['run1', 'run2'] }
  const file = path.join(dir, 'graph-observation-sources.json')
  await fs.writeFile(file, JSON.stringify({ sources: [source] }), { mode: 0o600 })
  const info = (await createGraphObservation({ dataDir: dir }).sources()).sources[0]!
  const controller = new AbortController(), frames: unknown[] = []
  let session = true
  const gateway = createGraphWireGateway({ dataDir: dir, signal: controller.signal, assertSession: () => { if (!session) throw new Error('protected auth detail') }, deliver: async frame => { frames.push(frame) } })
  const send = (value: unknown) => gateway.receive(JSON.stringify(value))
  const open = { type: 'open', source_id: 'local', source_token: info.token, run_id: 'run1' }
  cleanups.push(async () => { gateway.close(); await gateway.closed; await fs.rm(dir, { recursive: true, force: true }) })
  return { gateway, send, open, frames, file, source, requests, fixture, controller, release, revoke: () => { session = false } }
}
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup() })

describe('Graph streaming scope gateway', () => {
  it('does not launch or reveal source arguments for an ungranted Run', async () => {
    const s = await setup()
    await expect(s.send({ ...s.open, run_id: 'other' })).rejects.toThrow()
    await s.gateway.closed
    await expect(fs.stat(s.requests)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(s.frames).toEqual([])
  })
  it('negotiates base-only observation and rejects mutations before the source receives them', async () => {
    const s = await setup()
    await s.send(s.open); await s.send(hello)
    await vi.waitFor(() => expect(s.frames).toContainEqual(expect.objectContaining({ type: 'hello', extensions: [] })))
    await expect(s.send({ protocol, type: 'graph.command', message_id: 'bad', action: 'start' })).rejects.toThrow()
    const lines = (await fs.readFile(s.requests, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(lines.map(value => value.type)).toEqual(['hello'])
  })
  it.each([false, true])('relays committed snapshots to the shared consumer with negotiated execution support %s', async execution => {
    const s = await setup({ fixture: graphWireFixture(execution) })
    await s.send(s.open); await s.send(hello)
    await vi.waitFor(() => expect(s.frames).toHaveLength(1))
    const reply = s.frames[0]
    if (!reply || typeof reply !== 'object' || !('extensions' in reply) || !Array.isArray(reply.extensions) || !reply.extensions.every(extension => typeof extension === 'string')) throw new Error('Missing negotiated extension reply')
    expect(reply.extensions).toEqual(execution ? [GRAPH_WIRE_EXECUTION_EXTENSION] : [])
    const consumer = new GraphWireSourceState({ subscriptionId: 'sub', mode: 'live', scope: { graph_run_id: 'run1', source_ids: ['local'] }, extensions: reply.extensions, limits: { maxRecords: 100, maxPages: 10, maxEvents: 100 } })
    await s.send({ protocol, type: 'subscribe', message_id: 'subscribe', subscription_id: 'sub', mode: 'live', scope: { source_ids: ['local'], graph_run_id: 'run1' }, resume: null })
    await vi.waitFor(() => expect(s.frames).toHaveLength(6))
    for (const frame of s.frames.slice(1)) consumer.apply(frame as GraphWireSourceFrame)
    expect(consumer.read().sources[0]).toMatchObject({ ready: true, hasProjection: true, records: s.fixture.records })
    if (execution) expect(consumer.read().sources[0]!.records).toContainEqual(expect.objectContaining({ kind: 'execution_attempt', value: expect.objectContaining({ executor_kind: 'program', job: null }) }))
  })
  it('relays actual live execution replacements through the shared consumer commit barrier', async () => {
    const fixture = graphWireFixture(true)
    const replacement = structuredClone(fixture.records.find(record => record.kind === 'execution_run')!)
    if (replacement.kind !== 'execution_run') throw new Error('Missing execution fixture')
    replacement.value.revision = '2'; replacement.value.state = 'held'; replacement.value.reason = 'Budget review'
    const envelope = { protocol: 'omp.graph.v1' as const, in_reply_to: null, subscription_id: 'sub', source_id: 'local' }
    const cursor = { journal_id: 'journal', seq: '2' }
    fixture.frames.push({ ...envelope, type: 'graph.event', event_id: 'event', cursor, occurred_at: new Date().toISOString(), replay: false, records: [replacement] }, { ...envelope, type: 'source.ready', cursor })
    const s = await setup({ fixture })
    await s.send(s.open); await s.send(hello)
    await vi.waitFor(() => expect(s.frames).toHaveLength(1))
    await s.send({ protocol, type: 'subscribe', message_id: 'subscribe', subscription_id: 'sub', mode: 'live', scope: { source_ids: ['local'], graph_run_id: 'run1' }, resume: null })
    await vi.waitFor(() => expect(s.frames).toHaveLength(8))
    const consumer = new GraphWireSourceState({ subscriptionId: 'sub', mode: 'live', scope: { graph_run_id: 'run1', source_ids: ['local'] }, extensions: [GRAPH_WIRE_EXECUTION_EXTENSION], limits: { maxRecords: 100, maxPages: 10, maxEvents: 100 } })
    for (const frame of s.frames.slice(1)) consumer.apply(frame as GraphWireSourceFrame)
    expect(consumer.read().sources[0]!.records).toContainEqual(replacement)
    expect(consumer.read().sources[0]!.cursor).toEqual(cursor)
  })
  it.each(['unoffered', 'unsupported-source', 'unknown-extension', 'unknown-source-capability'])('rejects an upstream claiming %s execution negotiation', async mode => {
    const fixture = graphWireFixture(mode !== 'unsupported-source')
    if (mode === 'unknown-source-capability') fixture.source.capabilities.push('graph.author.v1')
    const s = await setup({ fixture, extensions: [mode === 'unknown-extension' ? 'graph.author.v1' : GRAPH_WIRE_EXECUTION_EXTENSION] })
    await s.send(s.open); await s.send(mode === 'unoffered' ? { ...hello, extensions: [] } : hello)
    await s.gateway.closed
    expect(s.frames).toEqual([])
  })
  it.each(['unnegotiated', 'malformed', 'foreign-run', 'unsupported-source'])('denies %s execution records before relaying their page', async mode => {
    const fixture = graphWireFixture(true)
    if (mode === 'malformed') {
      const attempt = fixture.records.find(record => record.kind === 'execution_attempt')!
      if (attempt.kind === 'execution_attempt') attempt.value.job = { source_id: 'bot-source', profile_id: 'profile', bot_id: 'bot', job_id: 'invented-job' }
    }
    if (mode === 'foreign-run') fixture.records[1]!.value.graph_run_id = 'run2'
    if (mode === 'unsupported-source') fixture.source.capabilities = ['graph.runs.v1', 'graph.history.v1']
    const s = await setup({ fixture, extensions: mode === 'unnegotiated' || mode === 'unsupported-source' ? [] : [GRAPH_WIRE_EXECUTION_EXTENSION] })
    await s.send(s.open); await s.send(hello)
    await vi.waitFor(() => expect(s.frames).toHaveLength(1))
    await s.send({ protocol, type: 'subscribe', message_id: 'subscribe', subscription_id: 'sub', mode: 'live', scope: { source_ids: ['local'], graph_run_id: 'run1' }, resume: null })
    await s.gateway.closed
    expect(s.frames.map(frame => frame && typeof frame === 'object' && 'type' in frame ? frame.type : null)).toEqual(['hello', 'subscription', 'snapshot.begin'])
  })
  it.each(['state', 'events'])('validates execution records in actual %s history output', async view => {
    const fixture = graphWireFixture(true)
    const foreign = structuredClone(fixture.records[1]!)
    foreign.value.graph_run_id = 'run2'
    const items = view === 'state' ? [foreign] : [{ event_id: 'event', cursor: { journal_id: 'journal', seq: '2' }, occurred_at: new Date().toISOString(), records: [foreign] }]
    const s = await setup({ fixture, history: items })
    await s.send(s.open); await s.send(hello)
    await vi.waitFor(() => expect(s.frames).toHaveLength(1))
    await s.send({ protocol, type: 'graph.history.get', message_id: 'history', subscription_id: 'sub', scope_id: 'scope', source_id: 'local', graph_run_id: 'run1', view, at: null, after: null, filter: null, page_token: null, limit: 10 })
    await s.gateway.closed
    expect(s.frames).toHaveLength(1)
  })
  it.each(['available', 'expired', 'missing', 'unknown'])('delivers requested %s consultation content from the relay child', async availability => {
    const response = availability === 'available' ? { availability } : { availability, media_type: null, content: null }
    const s = await setup({ fixture: graphWireFixture(true), artifact: { responses: [response] } })
    await s.send(s.open); await s.send(hello)
    await vi.waitFor(() => expect(s.frames).toHaveLength(1))
    await s.send(artifactRequest)
    await vi.waitFor(() => expect(s.frames).toHaveLength(2))
    expect(s.frames[1]).toEqual({ protocol, type: 'graph.artifact', in_reply_to: artifactRequest.message_id, source_id: 'local', graph_run_id: 'run1', ref: artifactRequest.ref, availability, media_type: availability === 'available' ? 'text/markdown' : null, content: availability === 'available' ? 'Consultation answer' : null, next_page_token: null })
    const lines = (await fs.readFile(s.requests, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(lines).toEqual([hello, artifactRequest])
  })
  it.each([
    { source_id: 'remote' },
    { graph_run_id: 'run2' },
    { ref: 'artifact:file' },
    { ref: 'consultation-message:../secret' },
    { ref: 'consultation-message:' },
    { page_token: 'next' },
    { limit: 2 },
    { path: '/private/content' },
    { artifact_id: 'protected-message' },
  ])('rejects an out-of-scope or malformed consultation request %j before forwarding', async patch => {
    const s = await setup({ fixture: graphWireFixture(true) })
    await s.send(s.open); await s.send(hello)
    await vi.waitFor(() => expect(s.frames).toHaveLength(1))
    await expect(s.send({ ...artifactRequest, ...patch })).rejects.toThrow()
    expect((await fs.readFile(s.requests, 'utf8')).trim().split('\n').map(line => JSON.parse(line).type)).toEqual(['hello'])
    expect(s.frames).toHaveLength(1)
  })
  it.each(['base-only-source', 'unnegotiated-extension', 'before-hello'])('rejects consultation reads with %s', async mode => {
    const s = await setup({ fixture: graphWireFixture(mode !== 'base-only-source'), extensions: [] })
    await s.send(s.open)
    if (mode !== 'before-hello') {
      await s.send(hello)
      await vi.waitFor(() => expect(s.frames).toHaveLength(1))
    }
    await expect(s.send(artifactRequest)).rejects.toThrow()
    const lines = await fs.readFile(s.requests, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error })
    expect(lines.trim() ? lines.trim().split('\n').map(line => JSON.parse(line).type) : []).toEqual(mode === 'before-hello' ? [] : ['hello'])
    expect(s.frames).toHaveLength(mode === 'before-hello' ? 0 : 1)
  })
  it.each([
    ['foreign source', { source_id: 'remote' }],
    ['foreign Run', { graph_run_id: 'run2' }],
    ['different ref', { ref: 'consultation-message:other' }],
    ['unrequested reply', { in_reply_to: 'other' }],
    ['unbound reply', { in_reply_to: null }],
    ['invalid content', { content: 42 }],
    ['non-text media', { media_type: 'application/octet-stream' }],
    ['unavailable content', { availability: 'missing' }],
    ['unexpected field', { path: '/private/content' }],
    ['pagination', { next_page_token: 'next' }],
    ['oversized UTF-8 content', { content: '界'.repeat(349526) }],
  ])('rejects %s artifact responses from the actual child', async (_name, response) => {
    const s = await setup({ fixture: graphWireFixture(true), artifact: { responses: [response as Record<string, unknown>] } })
    await s.send(s.open); await s.send(hello)
    await vi.waitFor(() => expect(s.frames).toHaveLength(1))
    await s.send(artifactRequest)
    await s.gateway.closed
    expect(s.frames).toHaveLength(1)
  })
  it('rejects artifact frames missing required fields', async () => {
    const s = await setup({ fixture: graphWireFixture(true), artifact: { omit: ['media_type'] } })
    await s.send(s.open); await s.send(hello)
    await vi.waitFor(() => expect(s.frames).toHaveLength(1))
    await s.send(artifactRequest)
    await s.gateway.closed
    expect(s.frames).toHaveLength(1)
  })
  it.each([false, true])('rejects unsolicited artifact content with execution negotiation %s', async execution => {
    const s = await setup({ fixture: graphWireFixture(execution), artifact: { unsolicited: true } })
    await s.send(s.open); await s.send(hello)
    await s.gateway.closed
    expect(s.frames).toHaveLength(1)
  })
  it('consumes a response correlation before a duplicate child response', async () => {
    const s = await setup({ fixture: graphWireFixture(true), artifact: { responses: [{}, {}] } })
    await s.send(s.open); await s.send(hello)
    await vi.waitFor(() => expect(s.frames).toHaveLength(1))
    await s.send(artifactRequest)
    await s.gateway.closed
    expect(s.frames).toHaveLength(2)
    expect(s.frames[1]).toMatchObject({ type: 'graph.artifact', in_reply_to: artifactRequest.message_id })
  })
  it.each(['pending', 'completed', 'hello'])('rejects duplicate message IDs previously used by %s requests', async mode => {
    const s = await setup({ fixture: graphWireFixture(true), artifact: { responses: mode === 'pending' ? [] : [{}] } })
    await s.send(s.open); await s.send(hello)
    await vi.waitFor(() => expect(s.frames).toHaveLength(1))
    if (mode !== 'hello') {
      await s.send(artifactRequest)
      await vi.waitFor(async () => expect((await fs.readFile(s.requests, 'utf8')).trim().split('\n')).toHaveLength(2))
      if (mode === 'completed') await vi.waitFor(() => expect(s.frames).toHaveLength(2))
    }
    await expect(s.send({ ...artifactRequest, message_id: mode === 'hello' ? hello.message_id : artifactRequest.message_id, ref: 'consultation-message:different' })).rejects.toThrow()
    expect((await fs.readFile(s.requests, 'utf8')).trim().split('\n').map(line => JSON.parse(line).type)).toEqual(mode === 'hello' ? ['hello'] : ['hello', 'graph.artifact.get'])
  })
  it('bounds outstanding artifact reads even after writes to the child complete', async () => {
    const s = await setup({ fixture: graphWireFixture(true), artifact: { responses: [] } })
    await s.send(s.open); await s.send(hello)
    await vi.waitFor(() => expect(s.frames).toHaveLength(1))
    for (let i = 0; i < 16; i++) await s.send({ ...artifactRequest, message_id: `artifact-${i}` })
    await vi.waitFor(async () => expect((await fs.readFile(s.requests, 'utf8')).trim().split('\n')).toHaveLength(17))
    await expect(s.send({ ...artifactRequest, message_id: 'overflow' })).rejects.toThrow()
    expect((await fs.readFile(s.requests, 'utf8')).trim().split('\n')).toHaveLength(17)
    expect(s.frames).toHaveLength(1)
  })
  it.each(['session-lock', 'source-revocation', 'parent-close'])('blocks pending artifact output after %s', async mode => {
    const s = await setup({ fixture: graphWireFixture(true), artifact: { deferred: true } })
    await s.send(s.open); await s.send(hello)
    await vi.waitFor(() => expect(s.frames).toHaveLength(1))
    await s.send(artifactRequest)
    await vi.waitFor(async () => expect((await fs.readFile(s.requests, 'utf8')).trim().split('\n')).toHaveLength(2))
    if (mode === 'session-lock') s.revoke()
    else if (mode === 'parent-close') s.controller.abort()
    else await fs.writeFile(s.file, JSON.stringify({ sources: [{ ...s.source, runs: [] }] }), { mode: 0o600 })
    await fs.writeFile(s.release, 'ready')
    await s.gateway.closed
    expect(s.frames).toHaveLength(1)
    await expect(s.send({ ...artifactRequest, message_id: 'after-close' })).rejects.toThrow()
  })
  it.each([
    ['another allowed Run', { graph_run_id: 'run2', source_ids: ['local'] }],
    ['roster inventory', { graph_run_id: null, source_ids: ['local'] }],
    ['another source', { graph_run_id: 'run1', source_ids: ['remote'] }],
  ])('cannot expand a fixed connection to %s', async (_name, scope) => {
    const s = await setup()
    await s.send(s.open); await s.send(hello)
    await vi.waitFor(() => expect(s.frames).toHaveLength(1))
    await expect(s.send({ protocol, type: 'subscribe', message_id: 'sub', subscription_id: 'sub', mode: 'live', scope, resume: null })).rejects.toThrow()
    expect((await fs.readFile(s.requests, 'utf8')).trim().split('\n').map(line => JSON.parse(line).type)).toEqual(['hello'])
  })
  it('revokes idle source access on atomic configuration replacement', async () => {
    const s = await setup()
    await s.send(s.open); await s.send(hello)
    await vi.waitFor(() => expect(s.frames).toHaveLength(1))
    await fs.writeFile(`${s.file}.new`, JSON.stringify({ sources: [{ ...s.source, runs: [] }] }), { mode: 0o600 })
    await fs.rename(`${s.file}.new`, s.file)
    await s.gateway.closed
    await expect(s.send(hello)).rejects.toThrow()
    expect(s.frames).toHaveLength(1)
  })
  it('checks a locked session before another request or output', async () => {
    const s = await setup()
    await s.send(s.open); await s.send(hello)
    await vi.waitFor(() => expect(s.frames).toHaveLength(1))
    s.revoke()
    await expect(s.send(hello)).rejects.toThrow()
    await s.gateway.closed
    expect(s.frames).toHaveLength(1)
  })
  it('closes on parent revocation and rejects an oversized UTF-8 frame before JSON parsing', async () => {
    const s = await setup()
    await expect(s.gateway.receive('界'.repeat(24000))).rejects.toThrow()
    await s.gateway.closed
    expect(s.frames).toEqual([])
    const other = await setup()
    await other.send(other.open)
    other.controller.abort()
    await other.gateway.closed
    await expect(other.send(hello)).rejects.toThrow()
  })
})
