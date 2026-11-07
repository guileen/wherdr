import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { authorizeGraphWireSource, createGraphObservation } from '../server/utils/bots/graphObservation'

const dirs: string[] = []
const source = { id: 'local', label: 'Local', command: ['/trusted/observer'], runs: ['run1'] }
const projection = { version: 1, run: { id: 'run1', graph_id: 'graph1', revision: '2', definition_revision: '1', state: 'running', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', secret: 'private' }, cursor: { journal_id: 'journal1', seq: '2' }, nodes: [{ id: 'review', kind: 'human', member: null }], edges: [], communications: [], invocations: [{ id: 'inv1', kind: 'node', node: 'review', member: null, state: 'waiting', iteration: 0, scope_id: 'scope1', attempt_id: null, superseded: false, secret: 'private' }] }
async function setup(run = vi.fn().mockResolvedValue(projection)) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'graph-observation-')); dirs.push(dir)
  const file = path.join(dir, 'graph-observation-sources.json')
  await fs.writeFile(file, JSON.stringify({ sources: [source] }), { mode: 0o600 })
  const workspace = createGraphObservation({ dataDir: dir, run })
  const configured = (await workspace.sources()).sources[0]!
  return { workspace, dir, file, run, scope: { source_id: configured.id, source_token: configured.token, run_id: 'run1' } }
}
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))) })

describe('Graph observation scope', () => {
  it('rejects symlink configuration before launching an observer', async () => {
    const { workspace, file, run, scope } = await setup()
    const target = `${file}.target`
    await fs.rename(file, target)
    await fs.symlink(target, file)
    await expect(workspace.sources()).rejects.toMatchObject({ code: 'source_config', status: 503 })
    await expect(workspace.snapshot(scope)).rejects.toMatchObject({ code: 'source_config' })
    expect(run).not.toHaveBeenCalled()
  })
  it('rejects non-regular configuration before launching an observer', async () => {
    const { workspace, file, run, scope } = await setup()
    await fs.rm(file)
    await fs.mkdir(file, { mode: 0o700 })
    await expect(workspace.sources()).rejects.toMatchObject({ code: 'source_config', status: 503 })
    await expect(workspace.snapshot(scope)).rejects.toMatchObject({ code: 'source_config' })
    expect(run).not.toHaveBeenCalled()
  })
  it('accepts a complete 64 KiB configuration but rejects even one extra byte', async () => {
    const { workspace, file, run, scope } = await setup()
    const config = JSON.stringify({ sources: [source] }).padEnd(65536, ' ')
    await fs.writeFile(file, config)
    await expect(workspace.snapshot(scope)).resolves.toMatchObject({ run: { id: 'run1' } })
    run.mockClear()
    await fs.appendFile(file, ' ')
    await expect(workspace.sources()).rejects.toMatchObject({ code: 'source_config', status: 503 })
    await expect(workspace.snapshot(scope)).rejects.toMatchObject({ code: 'source_config' })
    expect(run).not.toHaveBeenCalled()
  })
  it('rejects malformed UTF-8 even when replacement decoding would produce valid configuration', async () => {
    const { workspace, file, run, scope } = await setup()
    const invalid = Buffer.from(JSON.stringify({ sources: [{ ...source, label: 'Invalid \u0080' }] }), 'latin1')
    await fs.writeFile(file, invalid)
    await expect(workspace.sources()).rejects.toMatchObject({ code: 'source_config', status: 503 })
    await expect(workspace.snapshot(scope)).rejects.toMatchObject({ code: 'source_config' })
    expect(run).not.toHaveBeenCalled()
  })
  it('invalidates prior snapshot and streaming scope when only the wire command changes', async () => {
    const { workspace, dir, file, run } = await setup()
    const streaming = { ...source, wire_command: ['/trusted/wire-observer', '--first'] }
    await fs.writeFile(file, JSON.stringify({ sources: [streaming] }))
    const first = (await workspace.sources()).sources[0]!
    const prior = { source_id: first.id, source_token: first.token, run_id: 'run1' }
    await expect(authorizeGraphWireSource(dir, prior)).resolves.toMatchObject({ command: streaming.wire_command })
    const changed = { ...streaming, wire_command: ['/trusted/wire-observer', '--second'] }
    await fs.writeFile(file, JSON.stringify({ sources: [changed] }))
    const current = (await workspace.sources()).sources[0]!
    expect(current.token).not.toBe(first.token)
    await expect(authorizeGraphWireSource(dir, prior)).rejects.toMatchObject({ code: 'scope_denied' })
    await expect(workspace.snapshot(prior)).rejects.toMatchObject({ code: 'scope_denied' })
    await expect(workspace.negotiate({ ...prior, extensions: [] })).rejects.toMatchObject({ code: 'scope_denied' })
    await expect(workspace.history({ ...prior, history: {} })).rejects.toMatchObject({ code: 'scope_denied' })
    expect(run).not.toHaveBeenCalled()
    const scope = { ...prior, source_token: current.token }
    await expect(authorizeGraphWireSource(dir, scope)).resolves.toMatchObject({ command: changed.wire_command })
    await expect(workspace.snapshot(scope)).resolves.toMatchObject({ run: { id: 'run1' } })
  })
  it('refuses wire authorization for a legacy source without launching and preserves snapshot access', async () => {
    const { workspace, dir, run, scope } = await setup()
    await expect(authorizeGraphWireSource(dir, scope)).rejects.toMatchObject({ code: 'unsupported', status: 503 })
    expect(run).not.toHaveBeenCalled()
    await expect(workspace.snapshot(scope)).resolves.toMatchObject({ run: { id: 'run1' } })
    expect(run).toHaveBeenCalledOnce()
  })
  it('negotiates only after Run authorization and refuses unsupported source claims', async () => {
    const { workspace, run, scope } = await setup()
    await expect(workspace.negotiate({ ...scope, run_id: 'run2', extensions: ['graph.execution.v1'] })).rejects.toMatchObject({ code: 'scope_denied' })
    await expect(workspace.negotiate({ ...scope, extensions: ['graph.execution.v1', 'graph.execution.v1'] })).rejects.toMatchObject({ code: 'invalid_input' })
    expect(run).not.toHaveBeenCalled()
    run.mockResolvedValueOnce({ extensions: [] })
    await expect(workspace.negotiate({ ...scope, extensions: ['graph.execution.v1'] })).resolves.toEqual({ extensions: [] })
    expect(run).toHaveBeenCalledWith(source, 'run1', undefined, ['graph.execution.v1'])
    run.mockResolvedValueOnce({ extensions: ['graph.execution.v1'] })
    await expect(workspace.negotiate({ ...scope, extensions: ['graph.execution.v1'] })).rejects.toMatchObject({ code: 'unsupported' })
  })
  it('rechecks authorization before releasing negotiated capabilities', async () => {
    const { promise, resolve } = Promise.withResolvers<unknown>()
    const run = vi.fn(() => promise)
    const { workspace, file, scope } = await setup(run)
    const pending = workspace.negotiate({ ...scope, extensions: ['graph.execution.v1'] })
    await vi.waitFor(() => expect(run).toHaveBeenCalled())
    await fs.writeFile(file, JSON.stringify({ sources: [{ ...source, runs: [] }] }))
    resolve({ extensions: [] })
    await expect(pending).rejects.toMatchObject({ code: 'scope_denied' })
  })
  it('requires explicit per-Run scope before launching and returns only projected fields', async () => {
    const { workspace, run, scope } = await setup()
    await expect(workspace.snapshot({ ...scope, run_id: 'run2' })).rejects.toMatchObject({ code: 'scope_denied' })
    await expect(workspace.snapshot({ ...scope, command: '/bin/sh' })).rejects.toMatchObject({ code: 'invalid_input' })
    expect(run).not.toHaveBeenCalled()
    const result = await workspace.snapshot(scope)
    expect(result.invocations[0]).toMatchObject({ id: 'inv1', state: 'waiting' })
    expect(JSON.stringify(result)).not.toContain('private')
  })
  it('checks authorization again before releasing a delayed result', async () => {
    let release!: (value: unknown) => void
    const run = vi.fn(() => new Promise<unknown>(resolve => { release = resolve }))
    const { workspace, file, scope } = await setup(run)
    const pending = workspace.snapshot(scope)
    await vi.waitFor(() => expect(run).toHaveBeenCalled())
    await fs.writeFile(file, JSON.stringify({ sources: [{ ...source, runs: [] }] }))
    release(projection)
    await expect(pending).rejects.toMatchObject({ code: 'scope_denied' })
  })
  it('keeps consultation executions separate from frozen topology and rejects forged ordinary nodes', async () => {
    const { workspace, run, scope } = await setup()
    const auxiliary = { id: 'consult1', kind: 'consultation', node: null, member: 'reviewer', state: 'running', iteration: 0, scope_id: 'run', attempt_id: 'attempt1', superseded: false }
    run.mockResolvedValueOnce({ ...projection, invocations: [...projection.invocations, auxiliary] })
    const result = await workspace.snapshot(scope)
    expect(result.nodes).toEqual(projection.nodes)
    expect(result.invocations[1]).toEqual(auxiliary)
    run.mockResolvedValueOnce({ ...projection, invocations: [{ ...auxiliary, kind: 'node', node: 'consultation:reviewer', member: null }] })
    await expect(workspace.snapshot(scope)).rejects.toMatchObject({ code: 'unsupported' })
    run.mockResolvedValueOnce({ ...projection, invocations: [{ ...auxiliary, node: 'review' }] })
    await expect(workspace.snapshot(scope)).rejects.toMatchObject({ code: 'unsupported' })
  })
  it('passes a pinned read-only history request and validates every replacement', async () => {
    const { workspace, run, scope } = await setup()
    const first = { ...projection, cursor: { journal_id: 'journal1', seq: '1' } }
    run.mockResolvedValueOnce({ views: [first], cursor: first.cursor, watermark: projection.cursor, next_cursor: first.cursor })
    const page = await workspace.history({ ...scope, history: { limit: 1 } })
    expect(page.next_cursor).toEqual(first.cursor)
    expect(JSON.stringify(page)).not.toContain('private')
    expect(run).toHaveBeenCalledWith(source, 'run1', { limit: 1 })
    run.mockResolvedValueOnce({ views: [projection], cursor: projection.cursor, watermark: projection.cursor, next_cursor: null })
    const last = await workspace.history({ ...scope, history: { after: page.next_cursor, watermark: page.watermark, limit: 1 } })
    expect(last.views[0]?.cursor).toEqual(projection.cursor)
    run.mockResolvedValueOnce({ views: [projection], cursor: projection.cursor, watermark: projection.cursor, next_cursor: null })
    await expect(workspace.history({ ...scope, history: { limit: 1 } })).rejects.toMatchObject({ code: 'unsupported' })
    await expect(workspace.history({ ...scope, run_id: 'run2', history: {} })).rejects.toMatchObject({ code: 'scope_denied' })
    await expect(workspace.history({ ...scope, history: { command: '/bin/sh' } })).rejects.toMatchObject({ code: 'invalid_input' })
    run.mockResolvedValueOnce({ views: [], cursor: first.cursor, watermark: projection.cursor, next_cursor: first.cursor })
    await expect(workspace.history({ ...scope, history: { after: first.cursor, watermark: projection.cursor } })).rejects.toMatchObject({ code: 'unsupported' })
  })
  it('rechecks history authorization before returning a delayed page', async () => {
    const { promise, resolve } = Promise.withResolvers<unknown>()
    const run = vi.fn(() => promise)
    const { workspace, file, scope } = await setup(run)
    const pending = workspace.history({ ...scope, history: {} })
    await vi.waitFor(() => expect(run).toHaveBeenCalled())
    await fs.writeFile(file, JSON.stringify({ sources: [{ ...source, runs: [] }] }))
    resolve({ views: [projection], cursor: projection.cursor, watermark: projection.cursor, next_cursor: null })
    await expect(pending).rejects.toMatchObject({ code: 'scope_denied' })
  })
  it('rejects a source page beyond the originally requested watermark even if the runner mutates its options', async () => {
    const { workspace, run, scope } = await setup()
    const requested = { journal_id: 'journal1', seq: '1' }
    run.mockImplementationOnce(async (_source, _run, history) => {
      history.watermark.seq = '2'
      return { views: [{ ...projection, cursor: { journal_id: 'journal1', seq: '1' } }, projection], cursor: projection.cursor, watermark: projection.cursor, next_cursor: null }
    })
    await expect(workspace.history({ ...scope, history: { watermark: requested } })).rejects.toMatchObject({ code: 'unsupported' })
    expect(requested.seq).toBe('1')
  })
  it('preserves unknown versus zero usage, strips protected metadata, and rejects malformed outcomes and costs', async () => {
    const { workspace, run, scope } = await setup()
    const usage = { input_tokens: 0, output_tokens: null, cache_read_tokens: 0, cache_write_tokens: null, cost_usd: '0', completeness: 'partial', measured_at: null, observed_sources: 1, authorization: 'private' }
    run.mockResolvedValueOnce({ ...projection, run: { ...projection.run, observed_bot_usage: usage }, invocations: [{ ...projection.invocations[0], state: 'succeeded', selected_outcome: 'revise' }] })
    const result = await workspace.snapshot(scope)
    expect(result.run.observed_bot_usage).toMatchObject({ input_tokens: 0, output_tokens: null, cost_usd: '0', completeness: 'partial' })
    expect(JSON.stringify(result)).not.toContain('private')
    expect(result.invocations[0]).toMatchObject({ state: 'succeeded', selected_outcome: 'revise' })
    run.mockResolvedValueOnce({ ...projection, run: { ...projection.run, observed_bot_usage: { ...usage, cost_usd: 'NaN' } } })
    await expect(workspace.snapshot(scope)).rejects.toMatchObject({ code: 'unsupported' })
    run.mockResolvedValueOnce({ ...projection, invocations: [{ ...projection.invocations[0], selected_outcome: { approve: true } }] })
    await expect(workspace.snapshot(scope)).rejects.toMatchObject({ code: 'unsupported' })
  })
  it('does not backfill old history with later usage or outcome', async () => {
    const { workspace, run, scope } = await setup()
    const usage = { input_tokens: 100, output_tokens: 50, cache_read_tokens: null, cache_write_tokens: null, cost_usd: '0.2', completeness: 'partial', measured_at: null, observed_sources: 1 }
    const initial = { ...projection, cursor: { journal_id: 'journal1', seq: '1' } }
    const current = { ...projection, run: { ...projection.run, observed_bot_usage: usage }, invocations: [{ ...projection.invocations[0], selected_outcome: 'revise' }] }
    run.mockResolvedValueOnce({ views: [initial, current], cursor: current.cursor, watermark: current.cursor, next_cursor: null })
    const page = await workspace.history({ ...scope, history: {} })
    expect(page.views[0]?.run.observed_bot_usage).toBeUndefined()
    expect(page.views[0]?.invocations[0]?.selected_outcome).toBeUndefined()
    expect(page.views[1]?.run.observed_bot_usage?.cost_usd).toBe('0.2')
    expect(page.views[1]?.invocations[0]?.selected_outcome).toBe('revise')
  })
  it('rejects malformed topology and unsafe configuration', async () => {
    const { workspace, file, run, scope } = await setup()
    run.mockResolvedValueOnce({ ...projection, edges: [{ id: 'e1', from: 'missing', to: 'review', loop: null }] })
    await expect(workspace.snapshot(scope)).rejects.toMatchObject({ code: 'unsupported' })
    await fs.chmod(file, 0o644)
    await expect(workspace.sources()).rejects.toMatchObject({ code: 'source_config' })
  })
})
