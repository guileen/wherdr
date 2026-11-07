import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { BotCliReceipt, BotWorkspaceCommand } from '../../../shared/botWorkspace'
import { parseReceipt } from './projections'
import type { BotSource } from './source'
import { BotWorkspaceError, fail, record } from './validation'

export interface BotInvocation { argv: string[], stdin: string }
interface Intent { version: 1, canonical: string, source: string, invocation: BotInvocation, created_at: string }
interface IntentState { status: 'dispatching' | 'accepted' | 'failed' | 'ambiguous', receipt?: BotCliReceipt, error?: { code: string, message: string, status: number } }
const queues = new Map<string, Promise<unknown>>()
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (record(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
export async function durable(file: string, value: unknown, exclusive = false) {
  const temp = `${file}.${randomUUID()}.tmp`
  const handle = await fs.open(temp, 'wx', 0o600)
  let conflict: unknown
  try {
    try { await handle.writeFile(JSON.stringify(value) + '\n'); await handle.sync() } finally { await handle.close() }
    if (exclusive) {
      try { await fs.link(temp, file) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        conflict = error
      }
    } else await fs.rename(temp, file)
  } finally { await fs.unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error }) }
  const directory = await fs.open(path.dirname(file), 'r')
  try { await directory.sync() } finally { await directory.close() }
  // Retaining a new intent directory must survive a crash too. Also finish syncing
  // an already-published exclusive winner before a competing caller reads it.
  const parent = await fs.open(path.dirname(path.dirname(file)), 'r')
  try { await parent.sync() } finally { await parent.close() }
  if (conflict) throw conflict
}
export async function json(file: string, owner = 'Bot', maxBytes = 2 * 1024 * 1024): Promise<unknown | null> {
  try {
    const handle = await fs.open(file, 'r')
    try {
      if ((await handle.stat()).size > maxBytes) fail('intent_storage', `Retained ${owner} intent is invalid; do not use a new request key`, 503)
      return JSON.parse(await handle.readFile('utf8'))
    } finally { await handle.close() }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    if (error instanceof BotWorkspaceError) throw error
    fail('intent_storage', `Cannot read retained ${owner} intent; do not use a new request key`, 503)
  }
}

export async function serializeIntent<T>(file: string, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(file) ?? Promise.resolve()
  const run = previous.catch(() => undefined).then(work)
  queues.set(file, run)
  try { return await run } finally { if (queues.get(file) === run) queues.delete(file) }
}

// Immutable payload + prepared argv are durable before dispatch. On a lost receipt,
// a user retry replays this exact command/key: OMP's admission ledger returns the
// original receipt even after the revision or typed question has since changed.
export async function dispatchIntent(options: {
  dataDir: string
  source: BotSource
  command: BotWorkspaceCommand
  prepare: () => Promise<BotInvocation>
  invoke: (invocation: BotInvocation) => Promise<BotCliReceipt>
}): Promise<BotCliReceipt> {
  const { command, source } = options
  const key = createHash('sha256').update(canonical([source.id, command.bot_id, command.request_key])).digest('hex')
  const directory = path.join(options.dataDir, 'bot-intents')
  const file = path.join(directory, `${key}.json`)
  const stateFile = path.join(directory, `${key}.state.json`)
  return serializeIntent(file, async () => {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 })
    const payload = canonical(command)
    const sourceIdentity = canonical(source)
    let stored = await json(file)
    if (stored === null) {
      const invocation = await options.prepare()
      const intent: Intent = { version: 1, canonical: payload, source: sourceIdentity, invocation, created_at: new Date().toISOString() }
      try { await durable(file, intent, true); stored = intent } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') fail('intent_storage', 'Cannot durably retain Bot intent; command was not dispatched', 503)
        stored = await json(file)
      }
    }
    if (!record(stored) || stored.version !== 1 || typeof stored.canonical !== 'string' || typeof stored.source !== 'string' || !record(stored.invocation) || !Array.isArray(stored.invocation.argv) || !stored.invocation.argv.every(arg => typeof arg === 'string') || typeof stored.invocation.stdin !== 'string') fail('intent_storage', 'Retained Bot intent is invalid; do not use a new request key', 503)
    if (stored.canonical !== payload) fail('idempotency_conflict', 'This request key already belongs to a different command', 409)
    if (stored.source !== sourceIdentity) fail('source_changed', 'Source configuration changed since this intent was retained; restore it to reconcile the original key', 409)
    const state = await json(stateFile)
    if (state !== null && (!record(state) || !['dispatching', 'accepted', 'failed', 'ambiguous'].includes(String(state.status)))) fail('intent_storage', 'Retained Bot intent state is invalid', 503)
    if (record(state) && state.status === 'accepted') return parseReceipt(state.receipt)
    if (record(state) && state.status === 'failed') {
      if (!record(state.error) || typeof state.error.code !== 'string' || typeof state.error.message !== 'string' || typeof state.error.status !== 'number') fail('intent_storage', 'Retained Bot failure is invalid', 503)
      throw new BotWorkspaceError(state.error.code, state.error.message, state.error.status)
    }
    const invocation = stored.invocation as unknown as BotInvocation
    try { await durable(stateFile, { status: 'dispatching' } satisfies IntentState) } catch { fail('intent_storage', 'Cannot persist dispatch state; command was not dispatched', 503) }
    try {
      const receipt = await options.invoke(invocation)
      if (receipt.bot_id !== command.bot_id || receipt.job_id !== command.job_id) fail('unsupported', 'Source returned a receipt for a different Bot or Job', 502)
      await durable(stateFile, { status: 'accepted', receipt } satisfies IntentState)
      return receipt
    } catch (error) {
      const known = error instanceof BotWorkspaceError ? error : new BotWorkspaceError('intent_ambiguous', 'Command result could not be retained. Retry only the original request key.', 503)
      const status: IntentState['status'] = known.status >= 500 ? 'ambiguous' : 'failed'
      try { await durable(stateFile, { status, error: { code: known.code, message: known.message, status: known.status } } satisfies IntentState) } catch { fail('intent_storage', 'Command result could not be retained. Retry only the original request key.', 503) }
      throw known
    }
  })
}
