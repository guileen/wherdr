import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { readSources, type BotSource } from './source'
import { BotWorkspaceError, decimal, exact, fail, identity, text } from './validation'

export type GraphRunner = (source: BotSource, args: string[], input?: string) => Promise<{ code: number, output: string }>

// Only server-owned source configuration selects the executable and profile.
export const runGraphCli: GraphRunner = (source, args, input = '') => {
  const { promise, resolve, reject } = Promise.withResolvers<{ code: number, output: string }>()
  const child = spawn(source.command[0]!, [...source.command.slice(1), ...(source.profile ? ['--profile', source.profile] : []), 'graph', ...args], { shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  const chunks: Buffer[] = []
  let bytes = 0, stderrBytes = 0, stopped = false
  const stop = () => { stopped = true; child.kill('SIGKILL') }
  const timer = setTimeout(stop, 15000)
  child.stdout.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 2 * 1024 * 1024) stop(); else chunks.push(chunk) })
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

function receipt(output: string, requestKey: string) {
  const match = /^Request: ([A-Za-z0-9][A-Za-z0-9_.:@-]*)\n(?:Graph: ([A-Za-z0-9][A-Za-z0-9_.:@-]*)\n)?State: (accepted|completed|unknown|rejected)\n(?:Revision: (\d+)\n)?(?:Reason: ([a-z_]+): [^\n]*\n)?$/.exec(output)
  if (!match || match[1] !== requestKey || (match[3] === 'completed' && (!match[2] || !match[4]))) fail('unsupported', 'Graph source returned an unsupported receipt. Reconcile using the original request key.', 502)
  return { request_key: match[1], graph_id: match[2] || null, state: match[3], revision: match[4] || null, error_code: match[5] || null }
}

function sourceToken(source: BotSource) {
  return createHash('sha256').update(JSON.stringify([source.id, source.command, source.profile ?? null])).digest('hex')
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
    const result = await run(source, ['validate', graphId])
    const match = /^Graph: ([A-Za-z0-9][A-Za-z0-9_.:@-]*)\nState: valid\nRevision: (\d+)\n$/.exec(result.output)
    if (result.code !== 0 || !match || match[1] !== graphId) fail('source_unavailable', 'Graph could not be validated or the source returned an unsupported response.', 503)
    return match[2]!
  }
  return {
    async sources() { return { sources: (await sources()).map(source => ({ id: source.id, label: source.label, token: sourceToken(source) })) } },
    async request(body: unknown) {
      exact(body, ['source_id', 'source_token', 'action', 'graph_id', 'revision', 'request_key', 'name', 'content'])
      const source = await sourceFor(body.source_id, body.source_token)
      const action = body.action
      if (typeof action !== 'string' || !['read', 'create', 'import', 'edit', 'receipt'].includes(action)) fail('invalid_input', 'Unsupported Graph operation')
      const allowed: Record<string, string[]> = { read: ['graph_id'], create: ['request_key', 'name'], import: ['request_key', 'content'], edit: ['graph_id', 'revision', 'request_key', 'content'], receipt: ['request_key'] }
      if (Object.keys(body).some(key => !['source_id', 'source_token', 'action', ...allowed[action]!].includes(key))) fail('invalid_input', 'Unexpected field for Graph operation')
      if (['read', 'edit'].includes(action) && !identity(body.graph_id)) fail('invalid_input', 'Graph ID required')
      if (action !== 'read' && !identity(body.request_key)) fail('invalid_input', 'Request key required')
      if (action === 'edit' && !decimal(body.revision)) fail('invalid_input', 'Revision required')
      if (action === 'create' && (!text(body.name, 256) || /[\r\n]/.test(body.name) || body.name.startsWith('-'))) fail('invalid_input', 'Valid Graph name required')
      if (['import', 'edit'].includes(action) && (!text(body.content, 200 * 1024) || !body.content.trim())) fail('invalid_input', 'Graph Markdown is required (maximum 200 KiB)')
      if (action === 'read') {
        const graphId = body.graph_id as string
        const before = await revision(source, graphId)
        const result = await run(source, ['export', graphId, '--output=-'])
        if (result.code !== 0) fail('source_unavailable', 'Graph export failed.', 503)
        const after = await revision(source, graphId)
        if (before !== after) fail('revision_conflict', 'Graph changed while reading; try again.', 409)
        return { graph_id: graphId, revision: before, content: result.output }
      }
      const key = body.request_key as string
      const args = action === 'receipt' ? ['request', 'get', key]
        : action === 'create' ? ['create', body.name as string, `--request-key=${key}`]
        : action === 'import' ? ['import', '--file=-', `--request-key=${key}`]
        : ['edit', body.graph_id as string, '--file=-', `--if-revision=${body.revision}`, `--request-key=${key}`]
      const result = await run(source, args, typeof body.content === 'string' ? body.content : '')
      if (!result.output) fail(action === 'receipt' ? 'source_unavailable' : 'result_unknown', action === 'receipt' ? 'Receipt could not be read.' : 'Graph command outcome is unknown. Reconcile using the original request key.', 503)
      const parsed = receipt(result.output, key)
      if (result.code !== 0 && parsed.state !== 'rejected') fail('result_unknown', 'Graph command outcome is unknown. Reconcile using the original request key.', 503)
      return parsed
    },
  }
}
