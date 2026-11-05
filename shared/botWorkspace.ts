// OMP CLI schema v1 wire boundary. Revisions, cursors and exact costs stay strings.
export type BotJobState = 'queued' | 'running' | 'waiting_input' | 'idle' | 'paused' | 'stopped' | 'interrupted' | 'failed'
export type BotJobPhase = 'queued' | 'model' | 'tool' | 'background' | 'input' | 'compacting' | 'retry_wait' | 'cancelling' | 'none'
export type BotAction = 'send' | 'steer' | 'interrupt' | 'resume' | 'compact' | 'set-model' | 'stop'
export interface Cursor { journal_id: string, seq: string }
export interface BotFailure { code: string, message: string, retryable: boolean, details?: Record<string, unknown> }
export interface BotProjection {
  bot_id: string
  bot_name: string
  config_revision: string
  worker: { state: 'online' | 'offline' | 'unknown', last_seen_at: string | null }
  counts: Record<BotJobState, number>
  jobs_total: number
}
export interface BotGraphContext {
  graph_id: string
  graph_run_id: string
  node_id: string
  invocation_id: string
  attempt: number
  trace_id?: string | null
  upstream: Array<{ edge_id: string, job_id?: string | null, artifact_id?: string | null }>
}
export interface BotInputRequest {
  input_request_id: string
  kind: 'text' | 'approval'
  prompt_ref: string
  status: 'open' | 'reply_queued' | 'completion_queued'
  reply_request_id: string | null
  completion_reason: 'reply' | 'timeout' | 'dialog_cancel' | null
}
export interface BotQuestionField {
  id: string
  label: string
  mode: 'text' | 'single' | 'multi'
  required: boolean
  allow_custom: boolean
  options: Array<{ value: string, label: string, description: string | null }>
}
export interface BotQuestionDetail {
  schema_version: 1
  input_request_id: string
  title: string
  body: string
  kind: 'text' | 'approval'
  reply_encoding: 'text' | 'question_map'
  fields: BotQuestionField[]
}
export interface BotJobUsage {
  input_tokens: number | null
  output_tokens: number | null
  cache_read_tokens: number | null
  cache_write_tokens: number | null
  cost_usd: string | null
  completeness: 'complete' | 'partial' | 'unknown'
  measured_at: string | null
}
export interface JobProjection {
  job_id: string
  bot_id: string
  config_revision: string
  revision: string
  goal_preview: string
  goal_ref: string | null
  cwd: string
  graph_context: BotGraphContext | null
  state: BotJobState
  phase: BotJobPhase
  settled: boolean
  input_requests: BotInputRequest[]
  ownership: { state: 'none' | 'active' | 'uncertain', activation_ref: string | null }
  execution_id: string | null
  pending_input_count: number
  pending_background_count: number
  pending_delivery_count: number
  activity: { kind: 'model' | 'tool' | 'background' | 'control', label: string, span_id: string | null } | null
  wait: { kind: 'input' | 'approval' | 'capacity' | 'provider' | 'retry', message: string, request_id: string | null, retry_at: string | null } | null
  progress: { source: 'todo' | 'tool', completed: number, total: number, unit: string } | null
  model: { current: string | null, pending: string | null }
  context: { used_tokens: number | null, limit_tokens: number | null }
  usage: BotJobUsage
  created_at: string
  updated_at: string
  last_activity_at: string
  elapsed_ms: number
  active_ms: number
  output_ref: string | null
  artifact_ids: string[]
  error: BotFailure | null
  controls: Array<{ action: BotAction, enabled: boolean, reason: string | null }>
}
export interface BotCliSnapshot {
  schema_version: 1
  kind: 'snapshot'
  profile_id: string
  capabilities: string[]
  bot: BotProjection
  jobs: JobProjection[]
  cursor: Cursor
  next_page_token: string | null
}
export interface BotWorkspaceSource {
  id: string
  label: string
  state: 'live' | 'unavailable' | 'unsupported'
  message: string | null
  observed_at: string | null
}
export interface BotWorkspaceBot {
  source_id: string
  profile_id: string
  bot: BotProjection
  jobs: JobProjection[]
  cursor: Cursor
  capabilities: string[]
  observed_at: string
  complete: boolean
  next_page_token: string | null
}
export interface BotWorkspaceSnapshot {
  configured: boolean
  sources: BotWorkspaceSource[]
  bots: BotWorkspaceBot[]
  observed_at: string
  complete: boolean
}
export interface BotWorkspaceTarget { source_id: string, bot_name: string, bot_id: string, job_id: string }
export interface BotWorkspaceDetailRequest extends BotWorkspaceTarget {
  kind: 'inspect' | 'messages' | 'events' | 'request'
  ref?: string
  request_id?: string
  page_token?: string
  cursor?: Cursor
}
export interface BotRefProjection {
  ref: string
  availability: 'available' | 'redacted' | 'expired' | 'missing'
  media_type: string | null
  content: unknown | null
  next_page_token: string | null
}
export interface BotCliReceipt {
  schema_version: 1
  kind: 'receipt'
  bot_id: string
  job_id: string | null
  request_id: string
  accepted: true
  cursor: Cursor
}
export interface BotRequestProjection {
  schema_version: 1
  kind: 'request'
  receipt: BotCliReceipt
  outcome: 'pending' | 'applied' | 'rejected' | 'cancelled'
  effective_at: string | null
  error: BotFailure | null
  children?: BotRequestProjection[]
}
export interface BotEventProjection {
  schema_version: 1
  kind: 'event'
  profile_id: string
  bot_id: string
  job_id: string | null
  execution_id: string | null
  request_id: string | null
  event_id: string
  cursor: Cursor
  occurred_at: string
  type: string
  cause_event_id: string | null
  data: unknown
}
export interface BotPage<T> { items: T[], next_page_token: string | null }
export interface BotWorkspaceDetail { data: BotRefProjection | BotRequestProjection | BotPage<unknown> }
export interface BotWorkspaceCommand extends BotWorkspaceTarget {
  revision: string
  request_key: string
  action: BotAction | 'reply'
  text?: string
  model?: string
  input_request_id?: string
  answers?: Record<string, string | string[]>
}
export interface BotWorkspaceReceipt {
  source_id: string
  bot_id: string
  job_id: string
  request_id: string
  request_key: string
  accepted: true
  status: 'accepted'
  receipt: BotCliReceipt
}
