import fs from 'node:fs/promises'
import * as nodeFs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { BotWorkspaceError, exact, fail, identity, record, text } from './validation'
import type { JobProjection } from '../../../shared/botWorkspace'

type Source = { id: string, label: string, command: string[], runs: string[], wire_command?: string[] }
type Cursor = { journal_id: string, seq: string }
type HistoryOptions = { after?: Cursor, watermark?: Cursor, limit?: number }
type Runner = (source: Source, run: string, history?: HistoryOptions, extensions?: string[]) => Promise<unknown>
const filename = 'graph-observation-sources.json'
const token = (source: Source) => createHash('sha256').update(JSON.stringify(source)).digest('hex')

async function readSources(dataDir: string): Promise<Source[]> {
  let data: string
  try {
    const file = await fs.open(path.join(dataDir, filename), nodeFs.constants.O_RDONLY | nodeFs.constants.O_NOFOLLOW | nodeFs.constants.O_NONBLOCK)
    try {
      const stat = await file.stat()
      if (!stat.isFile() || (stat.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) fail('source_config', 'Observation configuration must be an owner-only file.', 503)
      if (stat.size > 65536) fail('source_config', 'Observation configuration is too large.', 503)
      const buffer = Buffer.alloc(65537)
      let size = 0
      while (size < buffer.length) {
        const { bytesRead } = await file.read(buffer, size, buffer.length - size, size)
        if (bytesRead === 0) break
        size += bytesRead
      }
      if (size > 65536) fail('source_config', 'Observation configuration is too large.', 503)
      data = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size))
    } finally { await file.close() }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    if (error instanceof BotWorkspaceError) throw error
    fail('source_config', 'Cannot read observation configuration.', 503)
  }
  try {
    const config: unknown = JSON.parse(data)
    exact(config, ['sources'])
    if (!Array.isArray(config.sources) || config.sources.length > 8) throw new Error()
    const ids = new Set<string>()
    for (const source of config.sources) {
      exact(source, ['id', 'label', 'command', 'runs', 'wire_command'])
      const command = (value: unknown) => Array.isArray(value) && value.length > 0 && value.length <= 16 && value.every(arg => text(arg, 4096) && !/[\r\n]/.test(arg))
      if (!identity(source.id) || ids.has(source.id) || !text(source.label, 100) || !command(source.command) || (source.wire_command !== undefined && !command(source.wire_command)) || !Array.isArray(source.runs) || source.runs.length > 1000 || !source.runs.every(identity) || new Set(source.runs).size !== source.runs.length) throw new Error()
      ids.add(source.id)
    }
    return config.sources as Source[]
  } catch { fail('source_config', 'Invalid Graph observation configuration.', 503) }
}
const runObserver: Runner = (source, run, history, extensions) => {
  const { promise, resolve, reject } = Promise.withResolvers<unknown>()
  const child = spawn(source.command[0]!, source.command.slice(1), { shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  const chunks: Buffer[] = []; let size = 0; let stopped = false
  const stop = () => { stopped = true; child.kill('SIGKILL') }
  const timer = setTimeout(stop, 15000)
  child.stdout.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 2 * 1024 * 1024) stop(); else chunks.push(chunk) })
  child.stderr.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 2 * 1024 * 1024) stop() })
  child.stdin.on('error', stop)
  child.on('error', () => { clearTimeout(timer); reject(new BotWorkspaceError('source_unavailable', 'Cannot launch Graph observation source.', 503)) })
  child.on('close', code => {
    clearTimeout(timer)
    if (stopped || code !== 0) { reject(new BotWorkspaceError('source_unavailable', 'Graph observation source is unavailable.', 503)); return }
    try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { reject(new BotWorkspaceError('unsupported', 'Unsupported Graph observation.', 502)) }
  })
  child.stdin.end(JSON.stringify(extensions !== undefined ? { run_id: run, extensions } : history === undefined ? { run_id: run } : { run_id: run, history }))
  return promise
}

function projectUsage(value: unknown): JobProjection['usage'] & { observed_sources: number } {
  const bad = () => fail('unsupported', 'Unsupported Graph usage observation.', 502)
  if (!record(value)) return bad()
  const { input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, completeness, measured_at, observed_sources } = value
  if ([input_tokens, output_tokens, cache_read_tokens, cache_write_tokens].some(v => v !== null && (!Number.isSafeInteger(v) || (v as number) < 0)) ||
      !(cost_usd === null || (typeof cost_usd === 'string' && cost_usd.length <= 4096 && /^\d+(?:\.\d+)?$/.test(cost_usd))) ||
      !['complete', 'partial', 'unknown'].includes(completeness as string) ||
      !(measured_at === null || (typeof measured_at === 'string' && Number.isFinite(Date.parse(measured_at)))) ||
      !Number.isSafeInteger(observed_sources) || (observed_sources as number) < 0) return bad()
  return { input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, completeness, measured_at, observed_sources } as JobProjection['usage'] & { observed_sources: number }
}

// Validate and reconstruct the response, rather than exposing arbitrary upstream fields.
function project(value: unknown, runId: string) {
  const bad = () => fail('unsupported', 'Unsupported Graph observation.', 502)
  if (!record(value) || value.version !== 1 || !record(value.run) || !record(value.cursor) || !Array.isArray(value.nodes) || !Array.isArray(value.edges) || !Array.isArray(value.communications) || !Array.isArray(value.invocations)) return bad()
  const r = value.run, c = value.cursor
  const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256
  const decimal = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9][0-9]*)$/.test(v)
  if (r.id !== runId || !identity(r.graph_id) || !decimal(r.revision) || !decimal(r.definition_revision) || !str(r.state) || !str(r.created_at) || !str(r.updated_at) || !identity(c.journal_id) || !decimal(c.seq) || [value.nodes, value.edges, value.communications, value.invocations].some(a => a.length > 10000)) return bad()
  const nodes = value.nodes.map(n => { if (!record(n) || !identity(n.id) || !str(n.kind) || !(n.member === null || identity(n.member))) return bad(); return { id: n.id, kind: n.kind, member: n.member } })
  const ids = new Set(nodes.map(n => n.id)); if (ids.size !== nodes.length) return bad()
  const edges = value.edges.map(e => { if (!record(e) || !identity(e.id) || !identity(e.from) || !identity(e.to) || !ids.has(e.from) || !ids.has(e.to) || !(e.loop === null || identity(e.loop))) return bad(); return { id: e.id, from: e.from, to: e.to, loop: e.loop } })
  const communications = value.communications.map(e => { if (!record(e) || !identity(e.from) || !identity(e.to)) return bad(); return { from: e.from, to: e.to } })
  const invocations = value.invocations.map(i => {
    if (!record(i) || !identity(i.id) || !str(i.state) || !Number.isSafeInteger(i.iteration) || (i.iteration as number) < 0 || !identity(i.scope_id) || !(i.attempt_id === null || identity(i.attempt_id)) || typeof i.superseded !== 'boolean') return bad()
    if (i.kind === 'node' ? !identity(i.node) || !ids.has(i.node) || i.member !== null : i.kind === 'consultation' ? i.node !== null || !identity(i.member) : true) return bad()
    if (Object.hasOwn(i, 'selected_outcome') && !(i.selected_outcome === null || str(i.selected_outcome))) return bad()
    return { id: i.id, kind: i.kind, node: i.node, member: i.member, state: i.state, iteration: i.iteration as number, scope_id: i.scope_id, attempt_id: i.attempt_id, superseded: i.superseded, ...(Object.hasOwn(i, 'selected_outcome') ? { selected_outcome: i.selected_outcome as string | null } : {}) }
  })
  return { version: 1 as const, run: { id: runId, graph_id: r.graph_id, revision: r.revision, definition_revision: r.definition_revision, state: r.state, created_at: r.created_at, updated_at: r.updated_at, ...(Object.hasOwn(r, 'observed_bot_usage') ? { observed_bot_usage: projectUsage(r.observed_bot_usage) } : {}) }, cursor: { journal_id: c.journal_id, seq: c.seq }, nodes, edges, communications, invocations }
}

function cursor(value: unknown): value is Cursor {
  return record(value) && Object.keys(value).length === 2 && identity(value.journal_id) && typeof value.seq === 'string' && /^(0|[1-9][0-9]*)$/.test(value.seq)
}

function projectHistory(value: unknown, runId: string, options: HistoryOptions) {
  const bad = () => fail('unsupported', 'Unsupported Graph observation history.', 502)
  if (!record(value) || !Array.isArray(value.views) || value.views.length > (options.limit ?? 50) || !cursor(value.cursor) || !cursor(value.watermark) || !(value.next_cursor === null || cursor(value.next_cursor))) return bad()
  const end = value.cursor, watermark = value.watermark, next = value.next_cursor
  if (end.journal_id !== watermark.journal_id || BigInt(end.seq) > BigInt(watermark.seq) ||
      (options.watermark && (options.watermark.journal_id !== watermark.journal_id || options.watermark.seq !== watermark.seq)) ||
      (options.after && (options.after.journal_id !== end.journal_id || BigInt(options.after.seq) > BigInt(end.seq))) ||
      (next && (next.journal_id !== end.journal_id || next.seq !== end.seq))) return bad()
  const views = value.views.map(item => project(item, runId))
  let previous = options.after ? BigInt(options.after.seq) : 0n
  for (const view of views) {
    const seq = BigInt(view.cursor.seq)
    if (view.cursor.journal_id !== end.journal_id || seq !== previous + 1n || seq > BigInt(end.seq)) return bad()
    previous = seq
  }
  if ((views.length > 0 && previous !== BigInt(end.seq)) ||
      (views.length === 0 && BigInt(end.seq) !== (options.after ? BigInt(options.after.seq) : 0n)) ||
      (next === null && end.seq !== watermark.seq) ||
      (next !== null && (views.length === 0 || BigInt(end.seq) >= BigInt(watermark.seq)))) return bad()
  return { views, cursor: end, watermark, next_cursor: next }
}

/** Trusted launch configuration; never returns command arguments to the browser. */
export async function authorizeGraphWireSource(dataDir: string, body: unknown) {
  exact(body, ['source_id', 'source_token', 'run_id'])
  if (!identity(body.source_id) || !identity(body.run_id) || typeof body.source_token !== 'string') fail('invalid_input', 'Invalid observation request.')
  const { source_id, source_token, run_id } = body
  const source = (await readSources(dataDir)).find(item => item.id === source_id)
  if (!source || token(source) !== source_token || !source.runs.includes(run_id)) fail('scope_denied', 'Graph Run observation is not authorized.', 403)
  if (!source.wire_command) fail('unsupported', 'Streaming observation is not configured for this source.', 503)
  return { command: [...source.wire_command], sourceId: source.id, runId: run_id }
}

export function createGraphObservation(options: { dataDir: string, run?: Runner }) {
  const run = options.run ?? runObserver
  return {
    async sources() { return { sources: (await readSources(options.dataDir)).map(s => ({ id: s.id, label: s.label, token: token(s), runs: s.runs, streaming: s.wire_command !== undefined })) } },
    async negotiate(body: unknown) {
      exact(body, ['source_id', 'source_token', 'run_id', 'extensions'])
      if (!identity(body.source_id) || !identity(body.run_id) || typeof body.source_token !== 'string' ||
          !Array.isArray(body.extensions) || body.extensions.length > 32 ||
          !body.extensions.every(extension => typeof extension === 'string' && /^[a-z][a-z0-9.-]{0,127}$/.test(extension)) ||
          new Set(body.extensions).size !== body.extensions.length) fail('invalid_input', 'Invalid observation capability request.')
      const { source_id, source_token, run_id } = body
      const extensions = [...body.extensions] as string[]
      const source = (await readSources(options.dataDir)).find(s => s.id === source_id)
      if (!source || token(source) !== source_token || !source.runs.includes(run_id)) fail('scope_denied', 'Graph Run observation is not authorized.', 403)
      const result = await run(structuredClone(source), run_id, undefined, extensions)
      const current = (await readSources(options.dataDir)).find(s => s.id === source_id)
      if (!current || token(current) !== source_token || !current.runs.includes(run_id)) fail('scope_denied', 'Graph Run observation is not authorized.', 403)
      // This adapter cannot consume the execution wire; never forward a source's unsupported claim.
      if (!record(result) || Object.keys(result).length !== 1 || !Array.isArray(result.extensions) || result.extensions.length !== 0)
        fail('unsupported', 'Unsupported Graph observation capability response.', 502)
      return { extensions: [] as string[] }
    },
    async snapshot(body: unknown) {
      exact(body, ['source_id', 'source_token', 'run_id'])
      if (!identity(body.source_id) || !identity(body.run_id) || typeof body.source_token !== 'string') fail('invalid_input', 'Invalid observation request.')
      const { source_id, source_token, run_id } = body
      const source = (await readSources(options.dataDir)).find(s => s.id === source_id)
      if (!source || token(source) !== source_token || !source.runs.includes(run_id)) fail('scope_denied', 'Graph Run observation is not authorized.', 403)
      const result = await run(structuredClone(source), run_id)
      const current = (await readSources(options.dataDir)).find(s => s.id === source_id)
      if (!current || token(current) !== source_token || !current.runs.includes(run_id)) fail('scope_denied', 'Graph Run observation is not authorized.', 403)
      return project(result, run_id)
    },
    async history(body: unknown) {
      exact(body, ['source_id', 'source_token', 'run_id', 'history'])
      if (!identity(body.source_id) || !identity(body.run_id) || typeof body.source_token !== 'string' || !record(body.history)) fail('invalid_input', 'Invalid observation request.')
      const history = body.history
      if (Object.keys(history).some(key => !['after', 'watermark', 'limit'].includes(key)) ||
          (history.after !== undefined && !cursor(history.after)) ||
          (history.watermark !== undefined && !cursor(history.watermark)) ||
          (history.limit !== undefined && (!Number.isSafeInteger(history.limit) || (history.limit as number) < 1 || (history.limit as number) > 100))) fail('invalid_input', 'Invalid observation history request.')
      const { source_id, source_token, run_id } = body
      const historyOptions = structuredClone(history) as HistoryOptions
      const source = (await readSources(options.dataDir)).find(s => s.id === source_id)
      if (!source || token(source) !== source_token || !source.runs.includes(run_id)) fail('scope_denied', 'Graph Run observation is not authorized.', 403)
      const result = await run(structuredClone(source), run_id, structuredClone(historyOptions))
      const current = (await readSources(options.dataDir)).find(s => s.id === source_id)
      if (!current || token(current) !== source_token || !current.runs.includes(run_id)) fail('scope_denied', 'Graph Run observation is not authorized.', 403)
      return projectHistory(result, run_id, historyOptions)
    },
  }
}
