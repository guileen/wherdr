import type { BotQuestionDetail, BotWorkspaceCommand, BotWorkspaceDetailRequest } from '../../../shared/botWorkspace'

export class BotWorkspaceError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) { super(message) }
}
export function fail(code: string, message: string, status = 400): never { throw new BotWorkspaceError(code, message, status) }
export function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
export function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!record(value) || Object.keys(value).some(key => !keys.includes(key))) fail('invalid_input', 'Expected an object with only documented fields')
}
export function text(value: unknown, max = 512): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) }
export function identity(value: unknown): value is string { return text(value, 256) && /^[A-Za-z0-9][A-Za-z0-9_.:@-]*$/.test(value) }
export function botName(value: unknown): value is string { return text(value, 256) && /^[\p{L}\p{N}_][\p{L}\p{N}_.-]*$/u.test(value) && value !== 'create' && value !== 'list' }
export function decimal(value: unknown): value is string { return typeof value === 'string' && /^\d{1,40}$/.test(value) }
const base = ['source_id', 'bot_name', 'bot_id', 'job_id']
function target(value: Record<string, unknown>) {
  for (const key of base) if (key === 'bot_name' ? !botName(value[key]) : !identity(value[key])) fail('invalid_input', `Invalid ${key}`)
}
export function commandBody(value: unknown): BotWorkspaceCommand {
  exact(value, [...base, 'revision', 'request_key', 'action', 'text', 'model', 'input_request_id', 'answers'])
  target(value)
  if (!decimal(value.revision) || !identity(value.request_key)) fail('invalid_input', 'A decimal revision and bounded request key are required')
  const action = value.action
  if (typeof action !== 'string' || !['send', 'steer', 'reply', 'interrupt', 'resume', 'compact', 'set-model', 'stop'].includes(action)) fail('invalid_input', 'Unsupported command action')
  const present = (key: string) => Object.hasOwn(value, key)
  const allowed = action === 'reply' ? ['input_request_id', 'answers'] : action === 'send' || action === 'steer' ? ['text'] : action === 'set-model' ? ['model'] : []
  for (const key of ['text', 'model', 'input_request_id', 'answers']) if (present(key) && !allowed.includes(key)) fail('invalid_input', `Unexpected ${key} for ${action}`)
  if ((action === 'send' || action === 'steer') && (!text(value.text, 64 * 1024) || !value.text.trim())) fail('invalid_input', 'Nonempty message text is required')
  if (action === 'set-model' && (typeof value.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,255}$/.test(value.model) || !value.model.includes('/'))) fail('invalid_input', 'Model must be provider/model')
  if (action === 'reply') {
    if (!identity(value.input_request_id) || !record(value.answers) || Object.keys(value.answers).length > 32) fail('invalid_input', 'An input request and typed answers are required')
    for (const [key, answer] of Object.entries(value.answers)) {
      if (!text(key, 256) || !(answer === '' || text(answer, 64 * 1024) || (Array.isArray(answer) && answer.length <= 64 && answer.every(item => text(item, 4096))))) fail('invalid_input', 'Invalid typed answer')
    }
  }
  return value as unknown as BotWorkspaceCommand
}
export function detailBody(value: unknown): BotWorkspaceDetailRequest {
  exact(value, [...base, 'kind', 'ref', 'request_id', 'page_token', 'cursor'])
  target(value)
  if (!['inspect', 'messages', 'events', 'request'].includes(String(value.kind))) fail('invalid_input', 'Unsupported detail kind')
  if (value.kind === 'inspect' ? !identity(value.ref) : Object.hasOwn(value, 'ref')) fail('invalid_input', 'Reference required only for inspect')
  if (value.kind === 'request' ? !identity(value.request_id) : Object.hasOwn(value, 'request_id')) fail('invalid_input', 'Request ID required only for request')
  if (Object.hasOwn(value, 'page_token') && (value.kind === 'request' || !text(value.page_token, 16384) || !/^[A-Za-z0-9_-]+={0,2}$/.test(value.page_token))) fail('invalid_input', 'Invalid page token')
  if (Object.hasOwn(value, 'cursor')) {
    exact(value.cursor, ['journal_id', 'seq'])
    if (value.kind !== 'events' || !identity(value.cursor.journal_id) || !decimal(value.cursor.seq)) fail('invalid_input', 'Invalid event cursor')
  }
  return value as unknown as BotWorkspaceDetailRequest
}
export function encodeReply(question: BotQuestionDetail, answers: Record<string, string | string[]>): string {
  const ids = question.fields.map(field => field.id)
  if (!ids.length || new Set(ids).size !== ids.length || Object.keys(answers).some(key => !ids.includes(key)) || question.fields.some(field => field.required && !Object.hasOwn(answers, field.id))) fail('invalid_input', 'Supply every required question field, with no extra fields')
  for (const field of question.fields) {
    if (!Object.hasOwn(answers, field.id)) continue
    const answer = answers[field.id]!
    const values = Array.isArray(answer) ? answer : [answer]
    if (field.mode === 'multi' ? !Array.isArray(answer) : typeof answer !== 'string') fail('invalid_input', 'Answer type does not match question')
    if (field.required && field.mode !== 'multi' && values.some(value => !value.trim())) fail('invalid_input', 'Required answer is empty')
    if (new Set(values).size !== values.length || (field.mode !== 'text' && !field.allow_custom && values.some(value => !field.options.some(option => option.value === value)))) fail('invalid_input', 'Select an offered answer')
  }
  if (question.reply_encoding === 'question_map') return JSON.stringify(answers)
  if (question.fields.length !== 1 || typeof answers[question.fields[0]!.id] !== 'string') fail('unsupported', 'Unsupported question encoding', 409)
  return answers[question.fields[0]!.id] as string
}
