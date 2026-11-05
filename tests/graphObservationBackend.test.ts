import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGraphObservation } from '../server/utils/bots/graphObservation'

const dirs: string[] = []
const source = { id: 'local', label: 'Local', command: ['/trusted/observer'], runs: ['run1'] }
const projection = { version: 1, run: { id: 'run1', graph_id: 'graph1', revision: '2', definition_revision: '1', state: 'running', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', secret: 'private' }, cursor: { journal_id: 'journal1', seq: '2' }, nodes: [{ id: 'review', kind: 'human', member: null }], edges: [], communications: [], invocations: [{ id: 'inv1', kind: 'node', node: 'review', member: null, state: 'waiting', iteration: 0, scope_id: 'scope1', attempt_id: null, superseded: false, secret: 'private' }] }
async function setup(run = vi.fn().mockResolvedValue(projection)) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'graph-observation-')); dirs.push(dir)
  const file = path.join(dir, 'graph-observation-sources.json')
  await fs.writeFile(file, JSON.stringify({ sources: [source] }), { mode: 0o600 })
  const workspace = createGraphObservation({ dataDir: dir, run })
  const configured = (await workspace.sources()).sources[0]!
  return { workspace, file, run, scope: { source_id: configured.id, source_token: configured.token, run_id: 'run1' } }
}
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))) })

describe('Graph observation scope', () => {
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
  it('rejects malformed topology and unsafe configuration', async () => {
    const { workspace, file, run, scope } = await setup()
    run.mockResolvedValueOnce({ ...projection, edges: [{ id: 'e1', from: 'missing', to: 'review', loop: null }] })
    await expect(workspace.snapshot(scope)).rejects.toMatchObject({ code: 'unsupported' })
    await fs.chmod(file, 0o644)
    await expect(workspace.sources()).rejects.toMatchObject({ code: 'source_config' })
  })
})
