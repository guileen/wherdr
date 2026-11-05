import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { BotWorkspaceError, exact, fail, identity, record, text } from './validation'

export interface BotSource { id: string, label: string, command: string[], profile?: string }
export type BotCliRunner = (source: BotSource, argv: string[], stdin?: string) => Promise<unknown>
export const SOURCE_FILE = 'bot-sources.json'
const OUTPUT_MAX = 4 * 1024 * 1024
export async function readSources(dataDir: string, filename: 'bot-sources.json' | 'graph-sources.json' = SOURCE_FILE): Promise<BotSource[]> {
  let raw: string
  try {
    const file = await fs.open(path.join(dataDir, filename), 'r')
    try {
      if ((await file.stat()).size > 64 * 1024) fail('source_config', 'Source configuration exceeds its size limit', 503)
      raw = await file.readFile('utf8')
    } finally { await file.close() }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    if (error instanceof BotWorkspaceError) throw error
    fail('source_config', `Cannot read ${filename} in DATA_DIR`, 503)
  }
  let value: unknown
  try { value = JSON.parse(raw) } catch { fail('source_config', `${filename} must contain valid JSON`, 503) }
  try {
    exact(value, ['sources'])
    if (!Array.isArray(value.sources) || value.sources.length > 8) fail('invalid_input', 'Expected at most eight sources')
    const ids = new Set<string>()
    for (const source of value.sources) {
      exact(source, ['id', 'label', 'command', 'profile'])
      if (!identity(source.id) || !text(source.label, 100) || !Array.isArray(source.command) || source.command.length < 1 || source.command.length > 16 || !source.command.every(arg => text(arg, 4096) && !/[\r\n]/.test(arg)) || (Object.hasOwn(source, 'profile') && !identity(source.profile))) fail('invalid_input', 'Invalid local source')
      if (ids.has(source.id)) fail('invalid_input', 'Source IDs must be unique')
      ids.add(source.id)
    }
  } catch { fail('source_config', `Invalid ${filename}: expected sources with unique id, label, command argv and optional profile`, 503) }
  const config = value as { sources: BotSource[] }
  return config.sources
}

// The executable and prefix come exclusively from the server-owned config file.
// Text is piped through stdin. No shell, browser argv, cwd or environment override.
export const runBotCli: BotCliRunner = async (source, argv, stdin = '') => {
  const args = [...source.command.slice(1), ...(source.profile ? ['--profile', source.profile] : []), 'bot', ...argv, '--json']
  const { promise, resolve, reject } = Promise.withResolvers<unknown>()
    const child = spawn(source.command[0]!, args, { shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    const output: Buffer[] = []
    let bytes = 0
    let stderrBytes = 0
    let stopped: BotWorkspaceError | null = null
    const stop = (code: string, message: string) => {
      stopped ??= new BotWorkspaceError(code, message, 503)
      child.kill('SIGKILL')
    }
    const timer = setTimeout(() => stop('source_timeout', 'Bot source timed out; an admitted command may still exist. Retry only the original request key.'), 15000)
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > OUTPUT_MAX) stop('source_limit', 'Bot source response exceeds the bounded output limit')
      else output.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length
      if (stderrBytes > OUTPUT_MAX) stop('source_limit', 'Bot source error output exceeds its limit')
    })
    child.stdin.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE') stop('source_unavailable', 'Cannot send input to the Bot source')
    })
    child.on('error', () => {
      clearTimeout(timer)
      reject(new BotWorkspaceError('source_unavailable', 'Cannot launch the configured local Bot source', 503))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (stopped) { reject(stopped); return }
      let value: unknown
      try { value = JSON.parse(Buffer.concat(output).toString('utf8')) } catch { reject(new BotWorkspaceError('unsupported', 'Source did not return one supported JSON projection', 502)); return }
      if (record(value) && value.kind === 'error' && value.schema_version === 1 && record(value.error) && typeof value.error.code === 'string') {
        // CLI messages may include private paths. Return a fixed explanation, not raw stderr/details.
        const errorCode = /^[a-z_]{1,64}$/.test(value.error.code) ? value.error.code : 'source_error'
        reject(new BotWorkspaceError(errorCode, `OMP rejected the operation (${errorCode.replaceAll('_', ' ')}). Refresh the exact Job before acting again.`, ['revision_conflict', 'idempotency_conflict', 'invalid_state', 'input_request_closed'].includes(errorCode) ? 409 : 400))
        return
      }
      if (code !== 0) { reject(new BotWorkspaceError('source_unavailable', 'Configured Bot source exited unsuccessfully', 503)); return }
      resolve(value)
    })
    child.stdin.end(stdin)
  return promise
}
