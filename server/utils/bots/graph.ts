import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { canonical, durable, json, serializeIntent, type BotInvocation } from './ledger'
import { readSources, type BotSource } from './source'
import { BotWorkspaceError, decimal, exact, fail, identity, record, text } from './validation'

export interface GraphCliResult { code: number, output: string }
export type GraphRunner = (source: BotSource, args: string[], input?: string) => Promise<GraphCliResult>
type Mutation = { source_id: string, action: 'create' | 'import' | 'edit', request_key: string, name?: string, content?: string, graph_id?: string, revision?: string }
type Operation = { request_key: string, state: 'accepted' | 'completed' | 'unknown' | 'rejected', target_id: string | null, revision: string | null, result_ref: { id: string, digest: string } | null, error: Record<string, unknown> | null }
type Intent = { version: 1, payload: Mutation, source: string, invocation: BotInvocation }
const OUTPUT_MAX = 8 * 1024 * 1024
const unsupported = () => fail('unsupported', 'Graph source returned an unsupported response. Reconcile using the original request key.', 502)
const fields = (value: unknown, keys: string[]): value is Record<string, unknown> => record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const bounded = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
const revisionValue = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9][0-9]{0,39})$/.test(value)
const digest = (value: unknown): value is string => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value)
const sourceIdentity = (source: BotSource) => canonical([source.id, source.command, source.profile ?? null])
const sourceToken = (source: BotSource) => createHash('sha256').update(sourceIdentity(source)).digest('hex')

// Only server-owned source configuration selects the executable and profile.
export const runGraphCli: GraphRunner = (source, args, input = '') => {
  const { promise, resolve, reject } = Promise.withResolvers<GraphCliResult>()
  const child = spawn(source.command[0]!, [...source.command.slice(1), ...(source.profile ? ['--profile', source.profile] : []), 'graph', ...args], { shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  const chunks: Buffer[] = []
  let bytes = 0, stderrBytes = 0, stopped = false
  const stop = () => { stopped = true; child.kill('SIGKILL') }
  const timer = setTimeout(stop, 15000)
  child.stdout.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > OUTPUT_MAX) stop(); else chunks.push(chunk) })
  child.stderr.on('data', (chunk: Buffer) => { stderrBytes += chunk.length; if (stderrBytes > 1024 * 1024) stop() })
  child.stdin.on('error', (error: NodeJS.ErrnoException) => { if (error.code !== 'EPIPE') stop() })
  child.on('error', () => { clearTimeout(timer); reject(new BotWorkspaceError('source_unavailable', 'Cannot launch the configured Graph source.', 503)) })
  child.on('close', code => {
    clearTimeout(timer)
    if (stopped || code === null) reject(new BotWorkspaceError('result_unknown', 'Graph source timed out or exceeded its limit. Reconcile using the original request key before retrying.', 503))
    else resolve({ code, output: Buffer.concat(chunks).toString('utf8') })
  })
  child.stdin.end(input)
  return promise
}

// Wire exit classes from the Graph CLI contract, not generic process failure.
function errorExit(code: unknown): number {
  if (['permission_denied', 'model_unavailable', 'base_unavailable', 'capability_unavailable', 'resource_limit', 'budget_exhausted', 'gate_unsatisfied', 'wait_cycle'].includes(String(code))) return 3
  if (['result_unknown', 'source_unavailable', 'cursor_expired', 'consultation_timeout'].includes(String(code))) return 4
  return code === 'internal_error' ? 1 : 2
}

function location(value: unknown, nullable: boolean): boolean {
  return fields(value, ['file', 'path', 'line', 'column']) && bounded(value.file, 4096) && bounded(value.path, 4096) && [value.line, value.column].every(n => (nullable && n === null) || (Number.isSafeInteger(n) && (n as number) > 0))
}

function graphError(value: unknown): value is Record<string, unknown> {
  if (!fields(value, ['code', 'message', 'location', 'retryable', 'details']) || typeof value.code !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(value.code) || !bounded(value.message, 16384) || typeof value.retryable !== 'boolean') return false
  if (value.location !== null && !location(value.location, true)) return false
  if (value.details !== null && !record(value.details)) return false
  // Details are never forwarded to the browser, but still must be a bounded JSON tree.
  const pending: { value: unknown, depth: number }[] = [{ value: value.details, depth: 0 }]
  let count = 0
  while (pending.length) {
    const item = pending.pop()!
    if (++count > 10000 || item.depth > 16) return false
    if (typeof item.value === 'string' && !bounded(item.value, 65536)) return false
    if (typeof item.value === 'number' && !Number.isFinite(item.value)) return false
    if (Array.isArray(item.value) || record(item.value)) {
      const children = Object.values(item.value)
      if (children.length > 10000) return false
      for (const child of children) pending.push({ value: child, depth: item.depth + 1 })
    }
  }
  return true
}

function response(result: GraphCliResult, kind: string): Record<string, unknown> {
  if (!Number.isInteger(result.code) || typeof result.output !== 'string' || Buffer.byteLength(result.output, 'utf8') > OUTPUT_MAX || !/^\{[^\r\n]*\}\n?$/.test(result.output)) return unsupported()
  let value: unknown
  try { value = JSON.parse(result.output) } catch { return unsupported() }
  if (!record(value) || value.schema_version !== 1) return unsupported()
  if (value.kind === 'graph.error') {
    if (!fields(value, ['schema_version', 'kind', 'error']) || !graphError(value.error) || value.error.location !== null || value.error.retryable !== false || value.error.details !== null || result.code !== errorExit(value.error.code)) return unsupported()
    const code = value.error.code as string
    // Do not leak source messages, filesystem paths, or error details.
    fail(code, `Graph source rejected the operation (${code.replaceAll('_', ' ')}). Reconcile the original request before retrying.`, ['revision_conflict', 'idempotency_conflict', 'invalid_state'].includes(code) ? 409 : 503)
  }
  if (value.kind !== kind) return unsupported()
  return value
}

function operation(value: unknown, key: string, target: string | null): Operation {
  if (!fields(value, ['request_key', 'state', 'target_id', 'revision', 'result_ref', 'error']) || value.request_key !== key || !['accepted', 'completed', 'unknown', 'rejected'].includes(String(value.state)) || !(value.target_id === null || identity(value.target_id)) || !(value.revision === null || revisionValue(value.revision)) || !(value.error === null || graphError(value.error))) return unsupported()
  if (target !== null && value.target_id !== target) return unsupported()
  if (value.result_ref !== null && (!fields(value.result_ref, ['id', 'digest']) || !bounded(value.result_ref.id, 512) || !digest(value.result_ref.digest) || value.result_ref.id !== `${value.target_id}@${value.revision}`)) return unsupported()
  if (value.state === 'completed' && (value.target_id === null || value.revision === null || value.result_ref === null || value.error !== null)) return unsupported()
  if (value.state === 'rejected' ? value.error === null || value.result_ref !== null || value.revision !== null : value.error !== null) return unsupported()
  return value as unknown as Operation
}

function receipt(result: GraphCliResult, key: string, target: string | null, readOnly: boolean) {
  if (!result.output) fail('result_unknown', 'Graph command outcome is unknown. Reconcile using the original request key.', 503)
  const envelope = response(result, 'graph.operation')
  if (!fields(envelope, ['schema_version', 'kind', 'operation'])) return unsupported()
  const parsed = operation(envelope.operation, key, target)
  if (result.code !== (parsed.state === 'rejected' && !readOnly ? errorExit(parsed.error!.code) : 0)) return unsupported()
  return parsed
}

function invocation(payload: Mutation): BotInvocation {
  const key = payload.request_key
  const argv = payload.action === 'create' ? ['create', payload.name!, `--request-key=${key}`]
    : payload.action === 'import' ? ['import', '--file=-', `--request-key=${key}`]
      : ['edit', payload.graph_id!, '--file=-', `--if-revision=${payload.revision}`, `--request-key=${key}`]
  return { argv: [...argv, '--format=json'], stdin: payload.content ?? '' }
}

function mutation(value: unknown): Mutation {
  if (!record(value) || !identity(value.source_id) || !identity(value.request_key)) return unsupported()
  const keys = value.action === 'create' ? ['name'] : value.action === 'import' ? ['content'] : value.action === 'edit' ? ['graph_id', 'revision', 'content'] : null
  if (!keys || !fields(value, ['source_id', 'action', 'request_key', ...keys])) return unsupported()
  if (value.action === 'create' && (!text(value.name, 256) || !/^[a-z][a-z0-9-]*$/.test(value.name))) return unsupported()
  if (value.action !== 'create' && (!text(value.content, 200 * 1024) || !value.content.trim())) return unsupported()
  if (value.action === 'edit' && (!identity(value.graph_id) || !decimal(value.revision))) return unsupported()
  return value as Mutation
}

function retained(value: unknown, source: BotSource, key: string): Intent {
  if (!fields(value, ['version', 'payload', 'source', 'invocation']) || value.version !== 1 || typeof value.source !== 'string') fail('intent_storage', 'Retained Graph intent is invalid; do not use a new request key.', 503)
  let payload: Mutation
  try { payload = mutation(value.payload) } catch { fail('intent_storage', 'Retained Graph intent is invalid; do not use a new request key.', 503) }
  if (payload.request_key !== key || canonical(value.invocation) !== canonical(invocation(payload))) fail('intent_storage', 'Retained Graph invocation is invalid; do not use a new request key.', 503)
  if (payload.source_id !== source.id || value.source !== sourceIdentity(source)) fail('source_changed', 'Graph source configuration changed since the original mutation; restore it to reconcile or retry the original key.', 409)
  return value as unknown as Intent
}

function outward(value: Operation) {
  return { request_key: value.request_key, graph_id: value.target_id, state: value.state, revision: value.revision, error_code: value.error === null ? null : value.error.code as string }
}

export function createGraphWorkspace(options: { dataDir: string, run?: GraphRunner }) {
  const run = options.run ?? runGraphCli
  async function sources() { return readSources(options.dataDir, 'graph-sources.json') }
  async function sourceFor(id: unknown, token: unknown) {
    if (!identity(id)) fail('invalid_input', 'Invalid source ID')
    const source = (await sources()).find(item => item.id === id)
    if (!source) fail('unknown_source', 'Unknown configured Graph source', 404)
    if (token !== sourceToken(source)) fail('source_changed', 'Graph source configuration changed; restore the original source before reconciling or retrying.', 409)
    return source
  }
  async function revision(source: BotSource, graphId: string) {
    const result = await run(source, ['validate', graphId, '--format=json'])
    const value = response(result, 'graph.validation')
    if (!fields(value, ['schema_version', 'kind', 'graph_id', 'revision', 'issues']) || value.graph_id !== graphId || !revisionValue(value.revision) || !Array.isArray(value.issues) || value.issues.length > 10000 || !value.issues.every(issue => fields(issue, ['path', 'message', 'location']) && bounded(issue.path, 4096) && bounded(issue.message, 16384) && location(issue.location, false) && (issue.location as Record<string, unknown>).path === issue.path)) return unsupported()
    if (result.code !== (value.issues.length ? 2 : 0)) return unsupported()
    if (value.issues.length) fail('source_unavailable', 'Graph definition could not be validated.', 503)
    return value.revision
  }
  return {
    async sources() { return { sources: (await sources()).map(source => ({ id: source.id, label: source.label, token: sourceToken(source) })) } },
    async request(body: unknown) {
      exact(body, ['source_id', 'source_token', 'action', 'graph_id', 'revision', 'request_key', 'name', 'content'])
      const source = await sourceFor(body.source_id, body.source_token)
      const action = body.action
      if (typeof action !== 'string' || !['read', 'create', 'import', 'edit', 'receipt'].includes(action)) fail('invalid_input', 'Unsupported Graph operation')
      const allowed: Record<string, string[]> = { read: ['graph_id'], create: ['request_key', 'name'], import: ['request_key', 'content'], edit: ['graph_id', 'revision', 'request_key', 'content'], receipt: ['request_key'] }
      if (!fields(body, ['source_id', 'source_token', 'action', ...allowed[action]!])) fail('invalid_input', 'Unexpected or missing field for Graph operation')
      if (['read', 'edit'].includes(action) && !identity(body.graph_id)) fail('invalid_input', 'Graph ID required')
      if (action !== 'read' && !identity(body.request_key)) fail('invalid_input', 'Request key required')
      if (action === 'edit' && !decimal(body.revision)) fail('invalid_input', 'Revision required')
      if (action === 'create' && (!text(body.name, 256) || !/^[a-z][a-z0-9-]*$/.test(body.name))) fail('invalid_input', 'Graph name must start with a lowercase letter and contain only lowercase letters, digits or hyphens.')
      if (['import', 'edit'].includes(action) && (!text(body.content, 200 * 1024) || !body.content.trim())) fail('invalid_input', 'Graph Markdown is required (maximum 200 KiB)')
      if (action === 'read') {
        const graphId = body.graph_id as string
        const before = await revision(source, graphId)
        const result = await run(source, ['export', graphId, '--output=-', '--format=json'])
        const value = response(result, 'graph.definition')
        if (!fields(value, ['schema_version', 'kind', 'graph_id', 'revision', 'digest', 'content']) || value.graph_id !== graphId || !revisionValue(value.revision) || !digest(value.digest) || !bounded(value.content, OUTPUT_MAX) || value.digest !== `sha256:${createHash('sha256').update(value.content).digest('hex')}`) return unsupported()
        if (result.code !== 0) fail('source_unavailable', 'Graph export failed.', 503)
        const after = await revision(source, graphId)
        if (before !== after || before !== value.revision) fail('revision_conflict', 'Graph changed while reading; try again.', 409)
        return { graph_id: graphId, revision: before, content: value.content }
      }
      const key = body.request_key as string
      const directory = path.join(options.dataDir, 'graph-intents')
      const file = path.join(directory, `${createHash('sha256').update(key).digest('hex')}.json`)
      return serializeIntent(file, async () => {
        let stored = await json(file, 'Graph', OUTPUT_MAX)
        let intent = stored === null ? null : retained(stored, source, key)
        if (action === 'receipt' && !intent) fail('unknown_request', 'No retained local Graph intent binds this key to its original source. The external outcome remains unknown. Use the original source and profile CLI: graph request get <original-key> --format=json. Do not issue a replacement mutation.', 404)
        if (action !== 'receipt') {
          const { source_token: _token, ...payload } = body
          if (intent && canonical(intent.payload) !== canonical(payload)) fail('idempotency_conflict', 'This request key already belongs to a different Graph mutation.', 409)
          if (!intent) {
            const command = mutation(payload)
            const candidate: Intent = { version: 1, payload: command, source: sourceIdentity(source), invocation: invocation(command) }
            try {
              await fs.mkdir(directory, { recursive: true, mode: 0o700 })
              await durable(file, candidate, true)
              stored = candidate
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'EEXIST') fail('intent_storage', 'Cannot durably retain Graph intent; command was not dispatched.', 503)
              stored = await json(file, 'Graph', OUTPUT_MAX)
            }
            intent = retained(stored, source, key)
            if (canonical(intent.payload) !== canonical(payload)) fail('idempotency_conflict', 'This request key already belongs to a different Graph mutation.', 409)
          }
        }
        const stateFile = `${file}.state.json`
        const state = await json(stateFile, 'Graph', OUTPUT_MAX)
        const expectedTarget = intent?.payload.graph_id ?? null
        let previous: Operation | null = null
        if (state !== null) {
          try { previous = operation(state, key, expectedTarget) } catch { fail('intent_storage', 'Retained Graph receipt is invalid; do not use a new request key.', 503) }
        }
        if (action !== 'receipt' && previous && ['completed', 'rejected'].includes(previous.state)) return outward(previous)
        // Reconciliation is always read-only, even when the original dispatch lost its receipt.
        const prepared = action === 'receipt' ? { argv: ['request', 'get', key, '--format=json'], stdin: '' } : intent!.invocation
        const result = await run(source, prepared.argv, prepared.stdin)
        const parsed = receipt(result, key, previous?.target_id ?? expectedTarget, action === 'receipt')
        if (previous && ['completed', 'rejected'].includes(previous.state) && canonical(previous) !== canonical(parsed)) return unsupported()
        if (intent) {
          try { await durable(stateFile, parsed) } catch { fail('intent_storage', 'Graph result could not be retained. Reconcile using the original request key.', 503) }
        }
        return outward(parsed)
      })
    },
  }
}
