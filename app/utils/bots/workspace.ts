import type { BotQuestionDetail, BotQuestionField, BotWorkspaceBot, BotWorkspaceCommand, BotWorkspaceDetail, JobProjection } from '#shared/botWorkspace'

export type BotView = 'list' | 'graph' | 'timeline'
export type BotDetailTab = 'attention' | 'messages' | 'artifacts' | 'usage'
export type BotAnswers = Record<string, string | string[]>
export interface BotDetailItem { id: string, label: string, text: string, at: string | null }
export interface BotDetailContent { question: BotQuestionDetail | null, text: string | null, items: BotDetailItem[], next: string | null, availability: string | null }
export function botKey(entry: BotWorkspaceBot): string { return `${entry.source_id}:${entry.bot.bot_id}` }
export function jobKey(entry: BotWorkspaceBot, job: JobProjection): string { return `${botKey(entry)}:${job.job_id}` }
export function hasAttention(job: JobProjection): boolean { return job.input_requests.some(q => q.status === 'open') || job.state === 'failed' || job.ownership.state === 'uncertain' }
export function controlReason(job: JobProjection, action: BotWorkspaceCommand['action']): string | null {
  if (action === 'reply') return job.input_requests.some(q => q.status === 'open') ? null : 'This question is no longer open.'
  const control = job.controls.find(c => c.action === action)
  return control?.enabled ? null : control?.reason || 'This control is not available for the selected Job.'
}
export function answersReady(question: BotQuestionDetail, answers: BotAnswers): boolean {
  return question.fields.every(field => {
    const answer = answers[field.id]
    if (!field.required && (answer === undefined || (field.mode === 'text' && answer === ''))) return true
    if (field.mode === 'multi') return Array.isArray(answer) && answer.every(v => !!v.trim() && (field.allow_custom || field.options.some(o => o.value === v)))
    return typeof answer === 'string' && !!answer.trim() && (field.mode === 'text' || field.allow_custom || field.options.some(o => o.value === answer))
  })
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function questionField(value: unknown): value is BotQuestionField {
  return record(value) && typeof value.id === 'string' && typeof value.label === 'string' && ['text', 'single', 'multi'].includes(String(value.mode)) && typeof value.required === 'boolean' && typeof value.allow_custom === 'boolean' && Array.isArray(value.options) && value.options.every(option => record(option) && typeof option.value === 'string' && typeof option.label === 'string' && (option.description === null || typeof option.description === 'string'))
}
function question(value: unknown): value is BotQuestionDetail {
  return record(value) && value.schema_version === 1 && typeof value.input_request_id === 'string' && typeof value.title === 'string' && typeof value.body === 'string' && ['text', 'approval'].includes(String(value.kind)) && ['text', 'question_map'].includes(String(value.reply_encoding)) && Array.isArray(value.fields) && value.fields.length > 0 && value.fields.every(questionField)
}
function contentText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(part => record(part) && typeof part.text === 'string' ? part.text : '').filter(Boolean).join('\n')
  return ''
}
export function decodeBotDetail(detail: BotWorkspaceDetail): BotDetailContent {
  const data = detail.data
  const result: BotDetailContent = { question: null, text: null, items: [], next: null, availability: null }
  if ('ref' in data) {
    result.availability = data.availability
    result.next = data.next_page_token
    if (data.availability !== 'available') return result
    if (data.media_type === 'application/vnd.omp.bot-question+json' && question(data.content)) result.question = data.content
    else if ((data.media_type === 'text/plain' || data.media_type === 'text/markdown') && typeof data.content === 'string') result.text = data.content
    else result.text = 'This reference has an unsupported content type. No content was rendered.'
  } else if ('items' in data) {
    result.next = data.next_page_token
    result.items = data.items.flatMap((item, index) => {
      if (!record(item)) return []
      if (item.kind === 'event' && typeof item.type === 'string') return [{ id: typeof item.event_id === 'string' ? item.event_id : String(index), label: item.type, text: record(item.data) && typeof item.data.message === 'string' ? item.data.message : '', at: typeof item.occurred_at === 'string' ? item.occurred_at : null }]
      const text = contentText(item.content) || contentText(item.text)
      return text ? [{ id: typeof item.id === 'string' ? item.id : String(index), label: typeof item.role === 'string' ? item.role : 'Message', text, at: typeof item.timestamp === 'string' ? item.timestamp : null }] : []
    })
  }
  return result
}
