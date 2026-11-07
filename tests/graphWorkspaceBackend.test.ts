import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { createGraphWorkspace, type GraphCliResult, type GraphRunner } from '../server/utils/bots/graph'

const directories: string[] = []
const source = { id: 'local', label: 'Local', command: ['/trusted/omp'], profile: 'work' }
const hash = (content: string) => `sha256:${createHash('sha256').update(content).digest('hex')}`
const output = (kind: string, value: Record<string, unknown>, code = 0) => ({ code, output: JSON.stringify({ schema_version: 1, kind, ...value }) + '\n' })
const completed = (key = 'k1', graph = 'g1', revision = '2') => ({ request_key: key, state: 'completed', target_id: graph, revision, result_ref: { id: `${graph}@${revision}`, digest: hash('definition') }, error: null })

async function setup() {
  const dataDir = await fs.mkdtemp(path.join(tmpdir(), 'wherdr-graphs-'))
  directories.push(dataDir)
  const sourceFile = path.join(dataDir, 'graph-sources.json')
  await fs.writeFile(sourceFile, JSON.stringify({ sources: [source] }))
  const runtimeFile = path.join(dataDir, 'runtime.json')
  await fs.writeFile(runtimeFile, JSON.stringify({ mutations: 0, receipts: {}, revision: '1', content: 'original definition' }))
  const calls: { args: string[], input: string }[] = []
  let loseReceipt = false
  let replace: ((value: GraphCliResult, args: string[]) => GraphCliResult) | undefined
  const run: GraphRunner = async (_source, args, input = '') => {
    calls.push({ args: [...args], input })
    // The fixture runtime keeps admissions on disk independently of the workspace ledger.
    const runtime = JSON.parse(await fs.readFile(runtimeFile, 'utf8'))
    if (!args.includes('--format=json')) throw new Error('Machine format is required')
    let result: GraphCliResult
    if (args[0] === 'request') {
      const operation = runtime.receipts[args[2]!]
      result = operation ? output('graph.operation', { operation }) : output('graph.error', { error: { code: 'unknown_reference', message: 'No request', location: null, retryable: false, details: null } }, 2)
    } else if (args[0] === 'validate') {
      result = output('graph.validation', { graph_id: args[1], revision: runtime.revision, issues: [] })
    } else if (args[0] === 'export') {
      if (!args.includes('--output=-')) throw new Error('Export may not write files')
      result = output('graph.definition', { graph_id: args[1], revision: runtime.revision, digest: hash(runtime.content), content: runtime.content })
    } else {
      const requestKey = args.find(arg => arg.startsWith('--request-key='))!.slice('--request-key='.length)
      if (!runtime.receipts[requestKey]) {
        // Observe that the complete intent is already durable before source admission.
        const names = (await fs.readdir(path.join(dataDir, 'graph-intents'))).filter(name => !name.includes('.state.'))
        const intents = await Promise.all(names.map(async name => JSON.parse(await fs.readFile(path.join(dataDir, 'graph-intents', name), 'utf8'))))
        const retained = intents.find(intent => intent.payload.request_key === requestKey)
        expect(retained).toMatchObject({ version: 1, invocation: { argv: args, stdin: input } })
        expect(retained.source).toContain('/trusted/omp')
        runtime.mutations++
        runtime.revision = String(Number(runtime.revision) + 1)
        runtime.content = args[0] === 'create' ? `Graph ${args[1]}` : input
        runtime.receipts[requestKey] = completed(requestKey, args[0] === 'edit' ? args[1] : 'g1', runtime.revision)
        await fs.writeFile(runtimeFile, JSON.stringify(runtime))
      }
      if (loseReceipt) { loseReceipt = false; throw new Error('Connection lost after admission') }
      result = output('graph.operation', { operation: runtime.receipts[requestKey] })
    }
    return replace ? replace(result, args) : result
  }
  const open = () => createGraphWorkspace({ dataDir, run })
  const workspace = open()
  const scope = { source_id: source.id, source_token: (await workspace.sources()).sources[0]!.token }
  return { workspace, open, dataDir, scope, calls, sourceFile, runtimeFile, loseNextReceipt: () => { loseReceipt = true }, replaceResponse: (fn: typeof replace) => { replace = fn } }
}
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))) })

const edit = { action: 'edit', graph_id: 'g1', revision: '1', request_key: 'k1', content: '---\nname: test\n---\n--request-key=bad $(command)' }

describe('Graph authoring durable machine boundary', () => {
  it('requires explicit Graph source configuration, independent of Bot sources', async () => {
    const { workspace, dataDir, calls } = await setup()
    await fs.rename(path.join(dataDir, 'graph-sources.json'), path.join(dataDir, 'bot-sources.json'))
    expect(await workspace.sources()).toEqual({ sources: [] })
    expect(calls).toHaveLength(0)
  })

  it('does not consume a request key when a new Graph name is not a source-supported slug', async () => {
    const h = await setup()
    await expect(h.workspace.request({ ...h.scope, action: 'create', name: 'Project plan', request_key: 'create-1' })).rejects.toMatchObject({ code: 'invalid_input' })
    expect(h.calls).toHaveLength(0)
    await expect(h.workspace.request({ ...h.scope, action: 'create', name: 'project-plan', request_key: 'create-1' })).resolves.toMatchObject({ state: 'completed' })
    expect(JSON.parse(await fs.readFile(h.runtimeFile, 'utf8')).mutations).toBe(1)
  })

  it('retains the full original payload and revision through lost receipt and workspace reopen', async () => {
    const h = await setup()
    h.loseNextReceipt()
    await expect(h.workspace.request({ ...h.scope, ...edit })).rejects.toThrow('Connection lost')
    const files = await fs.readdir(path.join(h.dataDir, 'graph-intents'))
    const intentFile = path.join(h.dataDir, 'graph-intents', files.find(name => name.endsWith('.json') && !name.includes('.state.'))!)
    const retained = JSON.parse(await fs.readFile(intentFile, 'utf8'))
    expect(retained.payload).toEqual({ source_id: 'local', ...edit })
    expect((await fs.stat(intentFile)).mode & 0o777).toBe(0o600)
    const reopened = h.open()
    expect(await reopened.request({ ...h.scope, ...edit })).toEqual({ request_key: 'k1', graph_id: 'g1', revision: '2', state: 'completed', error_code: null })
    expect(h.calls[1]).toEqual(h.calls[0])
    expect(JSON.parse(await fs.readFile(h.runtimeFile, 'utf8')).mutations).toBe(1)
    const calls = h.calls.length
    expect(await h.open().request({ ...h.scope, ...edit })).toMatchObject({ state: 'completed' })
    expect(h.calls).toHaveLength(calls)
  })

  it('reconciles a lost receipt after reopen without redispatching the retained mutation', async () => {
    const h = await setup()
    h.loseNextReceipt()
    await expect(h.workspace.request({ ...h.scope, ...edit })).rejects.toThrow('Connection lost')
    expect(await h.open().request({ ...h.scope, action: 'receipt', request_key: 'k1' })).toMatchObject({ state: 'completed', graph_id: 'g1', revision: '2' })
    expect(h.calls.map(call => call.args[0])).toEqual(['edit', 'request'])
    expect(JSON.parse(await fs.readFile(h.runtimeFile, 'utf8')).mutations).toBe(1)
  })

  it.each([
    { content: 'different definition' }, { revision: '2' }, { graph_id: 'g2' }, { action: 'import', graph_id: undefined, revision: undefined },
  ])('rejects content-key conflict after reopen: %j', async change => {
    const h = await setup()
    h.loseNextReceipt()
    await expect(h.workspace.request({ ...h.scope, ...edit })).rejects.toThrow()
    const body = Object.fromEntries(Object.entries({ ...h.scope, ...edit, ...change }).filter(([, value]) => value !== undefined))
    await expect(h.open().request(body)).rejects.toMatchObject({ code: 'idempotency_conflict' })
    expect(h.calls).toHaveLength(1)
    expect(JSON.parse(await fs.readFile(h.runtimeFile, 'utf8')).mutations).toBe(1)
  })

  it.each([{ command: ['/trusted/other-omp'] }, { profile: 'other' }])('binds the original source even with a valid replacement token: %j', async change => {
    const h = await setup()
    h.loseNextReceipt()
    await expect(h.workspace.request({ ...h.scope, ...edit })).rejects.toThrow()
    await fs.writeFile(h.sourceFile, JSON.stringify({ sources: [{ ...source, ...change }] }))
    const reopened = h.open()
    const changedScope = { source_id: source.id, source_token: (await reopened.sources()).sources[0]!.token }
    await expect(reopened.request({ ...changedScope, ...edit })).rejects.toMatchObject({ code: 'source_changed' })
    await expect(reopened.request({ ...changedScope, action: 'receipt', request_key: 'k1' })).rejects.toMatchObject({ code: 'source_changed' })
    await expect(reopened.request({ ...h.scope, action: 'receipt', request_key: 'k1' })).rejects.toMatchObject({ code: 'source_changed' })
    expect(h.calls).toHaveLength(1)
    await fs.writeFile(h.sourceFile, JSON.stringify({ sources: [source] }))
    expect(await h.open().request({ ...h.scope, action: 'receipt', request_key: 'k1' })).toMatchObject({ state: 'completed' })
    expect(h.calls.map(call => call.args[0])).toEqual(['edit', 'request'])
  })

  it('keeps pre-upgrade receipts ambiguous without querying an unbound source', async () => {
    const h = await setup()
    const runtime = JSON.parse(await fs.readFile(h.runtimeFile, 'utf8'))
    runtime.receipts.k1 = completed()
    await fs.writeFile(h.runtimeFile, JSON.stringify(runtime))
    await expect(h.open().request({ ...h.scope, action: 'receipt', request_key: 'k1' })).rejects.toMatchObject({ code: 'unknown_request', message: expect.stringContaining('external outcome remains unknown') })
    expect(h.calls).toHaveLength(0)
    await expect(fs.stat(path.join(h.dataDir, 'graph-intents'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('cannot move an existing key to another configured source ID', async () => {
    const h = await setup()
    h.loseNextReceipt()
    await expect(h.workspace.request({ ...h.scope, ...edit })).rejects.toThrow()
    await fs.writeFile(h.sourceFile, JSON.stringify({ sources: [source, { ...source, id: 'other' }] }))
    const reopened = h.open()
    const otherScope = { source_id: 'other', source_token: (await reopened.sources()).sources.find(item => item.id === 'other')!.token }
    await expect(reopened.request({ ...otherScope, ...edit })).rejects.toMatchObject({ code: 'source_changed' })
    await expect(reopened.request({ ...otherScope, action: 'receipt', request_key: 'k1' })).rejects.toMatchObject({ code: 'source_changed' })
    expect(h.calls).toHaveLength(1)
  })

  it('checks the original source before returning a cached terminal receipt but ignores label changes', async () => {
    const h = await setup()
    await h.workspace.request({ ...h.scope, ...edit })
    await fs.writeFile(h.sourceFile, JSON.stringify({ sources: [{ ...source, profile: 'other' }] }))
    const changedScope = { source_id: source.id, source_token: (await h.open().sources()).sources[0]!.token }
    await expect(h.open().request({ ...changedScope, ...edit })).rejects.toMatchObject({ code: 'source_changed' })
    expect(h.calls).toHaveLength(1)
    await fs.writeFile(h.sourceFile, JSON.stringify({ sources: [{ ...source, label: 'Renamed' }] }))
    expect(await h.open().request({ ...h.scope, ...edit })).toMatchObject({ state: 'completed' })
    expect(h.calls).toHaveLength(1)
  })

  it('deduplicates concurrent mutations and preserves Markdown as durable stdin', async () => {
    const h = await setup()
    const results = await Promise.all([h.workspace.request({ ...h.scope, ...edit }), h.open().request({ ...h.scope, ...edit })])
    expect(results[0]).toEqual(results[1])
    expect(h.calls).toHaveLength(1)
    expect(JSON.parse(await fs.readFile(h.runtimeFile, 'utf8')).content).toBe(edit.content)
    await expect(h.workspace.request({ ...h.scope, ...edit, command: ['evil'] })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(h.workspace.request({ ...h.scope, action: 'read', graph_id: '--help' })).rejects.toMatchObject({ code: 'invalid_input' })
    expect(h.calls).toHaveLength(1)
  })

  it.each(['create', 'import'] as const)('supports %s and keeps the browser receipt shape', async action => {
    const h = await setup()
    const payload = action === 'create' ? { name: 'new-graph' } : { content: '# Graph\n' }
    expect(await h.workspace.request({ ...h.scope, action, request_key: 'k1', ...payload })).toEqual({ request_key: 'k1', graph_id: 'g1', revision: '2', state: 'completed', error_code: null })
    expect(await h.open().request({ ...h.scope, action: 'receipt', request_key: 'k1' })).toMatchObject({ graph_id: 'g1' })
  })

  it('reads versioned definitions without exposing the machine envelope to the browser', async () => {
    const h = await setup()
    expect(await h.workspace.request({ ...h.scope, action: 'read', graph_id: 'g1' })).toEqual({ graph_id: 'g1', revision: '1', content: 'original definition' })
    expect(h.calls.map(call => call.args[0])).toEqual(['validate', 'export', 'validate'])
  })

  it('refuses exported content associated with a changing revision', async () => {
    const h = await setup()
    let validations = 0
    h.replaceResponse((result, args) => args[0] === 'validate' && ++validations === 2 ? output('graph.validation', { graph_id: 'g1', revision: '2', issues: [] }) : result)
    await expect(h.workspace.request({ ...h.scope, action: 'read', graph_id: 'g1' })).rejects.toMatchObject({ code: 'revision_conflict' })
  })

  it('recognizes located validation failures without forwarding private source locations', async () => {
    const h = await setup()
    h.replaceResponse(() => output('graph.validation', { graph_id: 'g1', revision: '1', issues: [{ path: '/nodes', message: 'Invalid nodes in /private/profile', location: { file: '/private/profile/GRAPH.md', path: '/nodes', line: 4, column: 1 } }] }, 2))
    await expect(h.workspace.request({ ...h.scope, action: 'read', graph_id: 'g1' })).rejects.toMatchObject({ code: 'source_unavailable', message: expect.not.stringContaining('/private') })
    expect(h.calls.map(call => call.args[0])).toEqual(['validate'])
  })

  const malformed = [
    ['human prose', () => ({ code: 0, output: 'Request: k1\nGraph: g1\nState: completed\nRevision: 2\n' })],
    ['mixed stdout', (r: GraphCliResult) => ({ ...r, output: 'Notice\n' + r.output })],
    ['multiple lines', (r: GraphCliResult) => ({ ...r, output: r.output + r.output })],
    ['wrong version', (r: GraphCliResult) => ({ ...r, output: r.output.replace('"schema_version":1', '"schema_version":2') })],
    ['wrong kind', () => output('graph.definition', { graph_id: 'g1', revision: '2', digest: hash('definition'), content: 'definition' })],
    ['extra envelope field', () => output('graph.operation', { operation: completed(), extra: true })],
    ['wrong key', () => output('graph.operation', { operation: completed('other') })],
    ['wrong target', () => output('graph.operation', { operation: completed('k1', 'other') })],
    ['missing revision', () => output('graph.operation', { operation: { ...completed(), revision: null } })],
    ['missing result', () => output('graph.operation', { operation: { ...completed(), result_ref: null } })],
    ['bad result identity', () => output('graph.operation', { operation: { ...completed(), result_ref: { id: 'other@2', digest: hash('definition') } } })],
    ['extra operation field', () => output('graph.operation', { operation: { ...completed(), extra: true } })],
    ['oversize response', () => ({ code: 0, output: 'x'.repeat(8 * 1024 * 1024 + 1) })],
    ['inconsistent exit code', () => output('graph.operation', { operation: completed() }, 1)],
  ] as const
  it.each(malformed)('rejects malformed mutation source response: %s', async (_name, replace) => {
    const h = await setup()
    h.replaceResponse(replace)
    await expect(h.workspace.request({ ...h.scope, ...edit })).rejects.toMatchObject({ code: 'unsupported' })
    expect(JSON.parse(await fs.readFile(h.runtimeFile, 'utf8')).mutations).toBe(1)
    h.replaceResponse(undefined)
    expect(await h.open().request({ ...h.scope, action: 'receipt', request_key: 'k1' })).toMatchObject({ state: 'completed' })
    expect(h.calls.map(call => call.args[0])).toEqual(['edit', 'request'])
  })

  it('rejects a mismatched reconciliation target from the durable original edit', async () => {
    const h = await setup()
    h.loseNextReceipt()
    await expect(h.workspace.request({ ...h.scope, ...edit })).rejects.toThrow()
    h.replaceResponse(() => output('graph.operation', { operation: completed('k1', 'g2') }))
    await expect(h.open().request({ ...h.scope, action: 'receipt', request_key: 'k1' })).rejects.toMatchObject({ code: 'unsupported' })
    expect(h.calls.map(call => call.args[0])).toEqual(['edit', 'request'])
  })

  it.each([
    ['wrong definition target', (r: GraphCliResult, args: string[]) => args[0] === 'export' ? output('graph.definition', { graph_id: 'g2', revision: '1', digest: hash('definition'), content: 'definition' }) : r],
    ['content digest mismatch', (r: GraphCliResult, args: string[]) => args[0] === 'export' ? output('graph.definition', { graph_id: 'g1', revision: '1', digest: hash('wrong'), content: 'definition' }) : r],
    ['wrong validation target', (r: GraphCliResult, args: string[]) => args[0] === 'validate' ? output('graph.validation', { graph_id: 'g2', revision: '1', issues: [] }) : r],
    ['malformed issue', (r: GraphCliResult, args: string[]) => args[0] === 'validate' ? output('graph.validation', { graph_id: 'g1', revision: '1', issues: [{}] }) : r],
  ] as const)('rejects malformed read response: %s', async (_name, replace) => {
    const h = await setup()
    h.replaceResponse(replace)
    await expect(h.workspace.request({ ...h.scope, action: 'read', graph_id: 'g1' })).rejects.toMatchObject({ code: 'unsupported' })
  })

  it('keeps rejected operation receipts distinct from out-of-operation errors', async () => {
    const h = await setup()
    const rejected = { request_key: 'k1', state: 'rejected', target_id: 'g1', revision: null, result_ref: null, error: { code: 'revision_conflict', message: '/private/profile', location: null, retryable: false, details: { expected_revision: '2' } } }
    h.replaceResponse(() => output('graph.operation', { operation: rejected }, 2))
    expect(await h.workspace.request({ ...h.scope, ...edit })).toEqual({ request_key: 'k1', graph_id: 'g1', state: 'rejected', revision: null, error_code: 'revision_conflict' })
    expect(await h.open().request({ ...h.scope, ...edit })).toMatchObject({ state: 'rejected' })
    expect(h.calls).toHaveLength(1)
    h.replaceResponse(() => output('graph.operation', { operation: rejected }))
    expect(await h.open().request({ ...h.scope, action: 'receipt', request_key: 'k1' })).toMatchObject({ state: 'rejected', error_code: 'revision_conflict' })
    expect(h.calls.map(call => call.args[0])).toEqual(['edit', 'request'])
    h.replaceResponse(() => output('graph.error', { error: { code: 'permission_denied', message: '/private/profile', location: null, retryable: false, details: null } }, 3))
    await expect(h.workspace.request({ ...h.scope, action: 'read', graph_id: 'g1' })).rejects.toMatchObject({ code: 'permission_denied', message: expect.not.stringContaining('/private/profile') })
  })

  it('rejects an error receipt whose process exit disagrees with its error class', async () => {
    const h = await setup()
    h.replaceResponse(() => output('graph.operation', { operation: { request_key: 'k1', state: 'rejected', target_id: 'g1', revision: null, result_ref: null, error: { code: 'permission_denied', message: 'Denied', location: null, retryable: false, details: null } } }, 2))
    await expect(h.workspace.request({ ...h.scope, ...edit })).rejects.toMatchObject({ code: 'unsupported' })
  })

  it('does not dispatch when retained intent storage is corrupt', async () => {
    const h = await setup()
    h.loseNextReceipt()
    await expect(h.workspace.request({ ...h.scope, ...edit })).rejects.toThrow()
    const files = await fs.readdir(path.join(h.dataDir, 'graph-intents'))
    await fs.writeFile(path.join(h.dataDir, 'graph-intents', files[0]!), '{broken')
    await expect(h.open().request({ ...h.scope, ...edit })).rejects.toMatchObject({ code: 'intent_storage' })
    await expect(h.open().request({ ...h.scope, action: 'receipt', request_key: 'k1' })).rejects.toMatchObject({ code: 'intent_storage' })
    expect(h.calls).toHaveLength(1)
  })
})
