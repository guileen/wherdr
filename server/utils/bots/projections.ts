import type { BotCliReceipt, BotCliSnapshot, BotPage, BotQuestionDetail, BotRefProjection, BotRequestProjection } from '../../../shared/botWorkspace'
import { botName, decimal, fail, identity, record } from './validation'

type Schema = 'string' | 'boolean' | 'number' | 'unknown' | 'id' | 'name' | 'decimal' | { nullable: Schema } | { array: Schema } | { enum: readonly string[] } | { [key: string]: Schema }
const nullable = (schema: Schema): Schema => ({ nullable: schema })
const array = (schema: Schema): Schema => ({ array: schema })
const choice = (...values: string[]): Schema => ({ enum: values })
const cursor: Schema = { journal_id: 'id', seq: 'decimal' }
const failure: Schema = { code: 'string', message: 'string', retryable: 'boolean' }
const receipt: Schema = { schema_version: 'number', kind: choice('receipt'), bot_id: 'id', job_id: nullable('id'), request_id: 'id', accepted: 'boolean', cursor }
const input: Schema = { input_request_id: 'id', kind: choice('text', 'approval'), prompt_ref: 'id', status: choice('open', 'reply_queued', 'completion_queued'), reply_request_id: nullable('id'), completion_reason: nullable(choice('reply', 'timeout', 'dialog_cancel')) }
const states = ['queued', 'running', 'waiting_input', 'idle', 'paused', 'stopped', 'interrupted', 'failed']
const job: Schema = {
  job_id: 'id', bot_id: 'id', config_revision: 'id', revision: 'decimal', goal_preview: 'string', goal_ref: nullable('id'), cwd: 'string',
  graph_context: nullable({ graph_id: 'string', graph_run_id: 'string', node_id: 'string', invocation_id: 'string', attempt: 'number', upstream: array({ edge_id: 'string' }) }),
  state: choice(...states), phase: choice('queued', 'model', 'tool', 'background', 'input', 'compacting', 'retry_wait', 'cancelling', 'none'), settled: 'boolean', input_requests: array(input),
  ownership: { state: choice('none', 'active', 'uncertain'), activation_ref: nullable('id') }, execution_id: nullable('id'), pending_input_count: 'number', pending_background_count: 'number', pending_delivery_count: 'number',
  activity: nullable({ kind: choice('model', 'tool', 'background', 'control'), label: 'string', span_id: nullable('string') }),
  wait: nullable({ kind: choice('input', 'approval', 'capacity', 'provider', 'retry'), message: 'string', request_id: nullable('string'), retry_at: nullable('string') }),
  progress: nullable({ source: choice('todo', 'tool'), completed: 'number', total: 'number', unit: 'string' }),
  model: { current: nullable('string'), pending: nullable('string') }, context: { used_tokens: nullable('number'), limit_tokens: nullable('number') },
  usage: { input_tokens: nullable('number'), output_tokens: nullable('number'), cache_read_tokens: nullable('number'), cache_write_tokens: nullable('number'), cost_usd: nullable('string'), completeness: choice('complete', 'partial', 'unknown'), measured_at: nullable('string') },
  created_at: 'string', updated_at: 'string', last_activity_at: 'string', elapsed_ms: 'number', active_ms: 'number', output_ref: nullable('id'), artifact_ids: array('id'), error: nullable(failure),
  controls: array({ action: choice('send', 'steer', 'interrupt', 'resume', 'compact', 'set-model', 'stop'), enabled: 'boolean', reason: nullable('string') }),
}
function valid(value: unknown, schema: Schema): boolean {
  if (typeof schema === 'string') {
    if (schema === 'unknown') return true
    if (schema === 'id') return identity(value)
    if (schema === 'name') return botName(value)
    if (schema === 'decimal') return decimal(value)
    if (schema === 'number') return typeof value === 'number' && Number.isFinite(value) && value >= 0
    return typeof value === schema
  }
  if ('nullable' in schema) return value === null || valid(value, schema.nullable as Schema)
  if ('array' in schema) return Array.isArray(value) && value.length <= 10000 && value.every(item => valid(item, schema.array as Schema))
  if ('enum' in schema) return typeof value === 'string' && (schema.enum as readonly string[]).includes(value)
  return record(value) && Object.entries(schema).every(([key, shape]) => Object.hasOwn(value, key) && valid(value[key], shape))
}
function check(value: unknown, schema: Schema) {
  if (!valid(value, schema)) fail('unsupported', 'Source returned an unsupported OMP JSON projection', 502)
}
export function parseSnapshot(value: unknown): BotCliSnapshot {
  check(value, { schema_version: 'number', kind: choice('snapshot'), profile_id: 'id', capabilities: array('string'), bot: { bot_id: 'id', bot_name: 'name', config_revision: 'id', worker: { state: choice('online', 'offline', 'unknown'), last_seen_at: nullable('string') }, counts: Object.fromEntries(states.map(state => [state, 'number'])) as Schema, jobs_total: 'number' }, jobs: array(job), cursor, next_page_token: nullable('string') })
  const result = value as BotCliSnapshot
  if (result.schema_version !== 1 || result.jobs.some(item => item.bot_id !== result.bot.bot_id) || new Set(result.jobs.map(item => item.job_id)).size !== result.jobs.length) fail('unsupported', 'Inconsistent source snapshot', 502)
  return result
}
export function parseReceipt(value: unknown): BotCliReceipt {
  check(value, receipt)
  const result = value as BotCliReceipt
  if (result.schema_version !== 1 || result.accepted !== true) fail('unsupported', 'Invalid admission receipt', 502)
  return result
}
export function parseRequest(value: unknown): BotRequestProjection {
  check(value, { schema_version: 'number', kind: choice('request'), receipt, outcome: choice('pending', 'applied', 'rejected', 'cancelled'), effective_at: nullable('string'), error: nullable(failure) })
  const result = value as BotRequestProjection
  if (result.schema_version !== 1) fail('unsupported', 'Unsupported request version', 502)
  parseReceipt(result.receipt)
  if (Object.hasOwn(result, 'children')) {
    if (!Array.isArray(result.children)) fail('unsupported', 'Invalid request children', 502)
    for (const child of result.children) parseRequest(child)
  }
  return result
}
export function parseRef(value: unknown): BotRefProjection {
  check(value, { ref: 'id', availability: choice('available', 'redacted', 'expired', 'missing'), media_type: nullable('string'), content: 'unknown', next_page_token: nullable('string') })
  return value as BotRefProjection
}
export function parseQuestion(value: unknown): BotQuestionDetail {
  check(value, { schema_version: 'number', input_request_id: 'id', title: 'string', body: 'string', kind: choice('text', 'approval'), reply_encoding: choice('text', 'question_map'), fields: array({ id: 'id', label: 'string', mode: choice('text', 'single', 'multi'), required: 'boolean', allow_custom: 'boolean', options: array({ value: 'string', label: 'string', description: nullable('string') }) }) })
  const result = value as BotQuestionDetail
  if (result.schema_version !== 1 || result.fields.length > 32) fail('unsupported', 'Unsupported question version or size', 502)
  return result
}
export function parsePage(value: unknown, kind: 'messages' | 'events', botId: string, jobId: string): BotPage<unknown> {
  check(value, { items: array('unknown'), next_page_token: nullable('string') })
  const page = value as BotPage<unknown>
  if (kind === 'events') for (const item of page.items) {
    check(item, { schema_version: 'number', kind: choice('event'), profile_id: 'id', bot_id: 'id', job_id: nullable('id'), execution_id: nullable('id'), request_id: nullable('id'), event_id: 'id', cursor, occurred_at: 'string', type: 'string', cause_event_id: nullable('id'), data: 'unknown' })
    if (!record(item) || item.schema_version !== 1 || item.bot_id !== botId || item.job_id !== jobId) fail('unsupported', 'Source returned events outside the selected Job', 502)
  }
  return page
}
export function parseBotList(value: unknown): Array<{ bot_id: string, bot_name: string }> {
  check(value, { schema_version: 'number', kind: choice('bots'), bots: array({ bot_id: 'id', bot_name: 'name', config_revision: 'id', created_at: 'string' }) })
  const list = value as { schema_version: number, bots: Array<{ bot_id: string, bot_name: string }> }
  if (list.schema_version !== 1 || list.bots.some(bot => bot.bot_name === 'list' || bot.bot_name === 'create')) fail('unsupported', 'Unsupported Bot list', 502)
  return list.bots
}
