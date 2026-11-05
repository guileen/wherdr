import type { BotAction, BotQuestionDetail, BotWorkspaceCommand, BotWorkspaceDetail, BotWorkspaceReceipt, BotWorkspaceSnapshot, JobProjection } from '#shared/botWorkspace'

const AT = '2026-01-15T10:00:00.000Z'
export const SAMPLE_GRAPH = [
  { name: 'writer', job: 'sample-draft', label: 'Draft', note: 'Produces the working draft' },
  { name: 'reviewer', job: 'sample-review', label: 'Review', note: 'Checks scope and asks for direction' },
  { name: 'publisher', job: 'sample-publish', label: 'Publish', note: 'Waiting for a reviewed artifact' },
] as const
const QUESTION: BotQuestionDetail = {
  schema_version: 1, input_request_id: 'sample-direction', kind: 'text', reply_encoding: 'question_map', title: 'Choose the review direction', body: 'The fictional field guide is ready for review. Your answer applies only to this sample Job.', fields: [
    { id: 'audience', label: 'Who is this guide for?', mode: 'single', required: true, allow_custom: false, options: [{ value: 'newcomers', label: 'Newcomers', description: 'Explain the first steps' }, { value: 'maintainers', label: 'Maintainers', description: 'Focus on operating details' }] },
    { id: 'checks', label: 'What should the review cover?', mode: 'multi', required: true, allow_custom: false, options: [{ value: 'clarity', label: 'Clarity', description: null }, { value: 'accuracy', label: 'Accuracy', description: null }, { value: 'accessibility', label: 'Accessibility', description: null }] },
    { id: 'note', label: 'What matters most?', mode: 'text', required: true, allow_custom: true, options: [] },
  ],
}
const ACTIONS: BotAction[] = ['send', 'steer', 'interrupt', 'resume', 'compact', 'set-model', 'stop']
function sampleControls(job: JobProjection): JobProjection['controls'] {
  return ACTIONS.map(action => {
    let reason: string | null = null
    if (action === 'steer' && !job.execution_id) reason = 'No foreground execution'
    if (action === 'resume' && !['paused', 'interrupted', 'failed', 'stopped'].includes(job.state)) reason = 'Job is not suspended'
    if (action === 'interrupt' && ['paused', 'stopped'].includes(job.state)) reason = 'Job is already suspended'
    if (action === 'stop' && job.state === 'stopped' && job.settled) reason = 'Job is already stopped'
    if (['send', 'steer', 'compact', 'set-model'].includes(action) && ['stopped', 'failed', 'interrupted'].includes(job.state)) reason = 'Resume the suspended Job first'
    return { action, enabled: reason === null, reason }
  })
}
function sampleJob(name: string, index: number): JobProjection {
  const node = SAMPLE_GRAPH[index]!
  const job: JobProjection = {
    job_id: node.job, bot_id: `sample-${name}`, config_revision: '1', revision: '1', goal_preview: ['Write a practical field guide for a community garden', 'Review the field guide for clarity and completeness', 'Prepare a publication after review; do not deliver yet'][index]!, goal_ref: `sample-goal-${name}`, cwd: '/sample/garden-guide', graph_context: { graph_id: 'sample-guide', graph_run_id: 'sample-run', node_id: name, invocation_id: `sample-invocation-${name}`, attempt: 1, upstream: [] }, state: index === 0 ? 'idle' : index === 1 ? 'waiting_input' : 'queued', phase: index === 1 ? 'input' : index === 2 ? 'queued' : 'none', settled: false,
    input_requests: index === 1 ? [{ input_request_id: QUESTION.input_request_id, kind: 'text', prompt_ref: 'sample-question', status: 'open', reply_request_id: null, completion_reason: null }] : [], ownership: { state: index === 2 ? 'none' : 'active', activation_ref: null }, execution_id: null, pending_input_count: index === 1 ? 1 : 0, pending_background_count: 0, pending_delivery_count: 0, activity: null, wait: index === 1 ? { kind: 'input', message: 'Choose a review direction', request_id: QUESTION.input_request_id, retry_at: null } : null,
    progress: index === 0 ? { source: 'todo', completed: 3, total: 3, unit: 'draft sections' } : null, model: { current: 'sample/model-balanced', pending: null }, context: { used_tokens: index === 2 ? null : 2400, limit_tokens: 32000 }, usage: { input_tokens: index === 2 ? null : 1800, output_tokens: index === 2 ? null : 600, cache_read_tokens: null, cache_write_tokens: null, cost_usd: index === 2 ? null : '0.012400', completeness: index === 2 ? 'unknown' : 'partial', measured_at: index === 2 ? null : AT }, created_at: AT, updated_at: AT, last_activity_at: AT, elapsed_ms: 48000, active_ms: 24000, output_ref: index === 0 ? 'sample-draft-artifact' : null, artifact_ids: index === 0 ? ['sample-draft-artifact'] : [], error: null,
    controls: [],
  }
  job.controls = sampleControls(job)
  return job
}
export function createSampleWorkspace() {
  const snapshot: BotWorkspaceSnapshot = {
    configured: true, observed_at: AT, complete: true,
    sources: [{ id: 'sample', label: 'Fictional garden guide', state: 'live', message: null, observed_at: AT }],
    bots: SAMPLE_GRAPH.map((node, index) => {
      const job = sampleJob(node.name, index)
      return { source_id: 'sample', profile_id: 'sample', bot: { bot_id: job.bot_id, bot_name: node.name, config_revision: '1', worker: { state: 'online', last_seen_at: AT }, counts: { queued: 0, running: 0, waiting_input: 0, idle: 0, paused: 0, stopped: 0, interrupted: 0, failed: 0, [job.state]: 1 }, jobs_total: 1 }, jobs: [job], cursor: { journal_id: 'sample', seq: '1' }, capabilities: ['sample'], observed_at: AT, complete: true, next_page_token: null }
    }),
  }
  const commands = new Map<string, BotWorkspaceCommand>()
  const receipts = new Map<string, BotWorkspaceReceipt>()
  const applied = new Set<string>()
  const messages = new Map<string, Array<{ role: string, content: string }>>()
  const events = new Map<string, Array<{ kind: string, event_id: string, type: string, occurred_at: string, data: { message: string } }>>()
  function submit(command: BotWorkspaceCommand): BotWorkspaceReceipt {
    const existing = receipts.get(command.request_key)
    if (existing) return existing
    const request = `sample-request-${commands.size + 1}`
    const receipt: BotWorkspaceReceipt = { source_id: 'sample', bot_id: command.bot_id, job_id: command.job_id, request_id: request, request_key: command.request_key, accepted: true, status: 'accepted', receipt: { schema_version: 1, kind: 'receipt', bot_id: command.bot_id, job_id: command.job_id, request_id: request, accepted: true, cursor: { journal_id: 'sample', seq: String(commands.size + 2) } } }
    commands.set(request, command)
    receipts.set(command.request_key, receipt)
    return receipt
  }
  function observe(request: string): BotWorkspaceDetail {
    const command = commands.get(request)
    if (!command) throw new Error('Sample request not found')
    const receipt = receipts.get(command.request_key)!
    const entry = snapshot.bots.find(bot => bot.bot.bot_id === command.bot_id)!
    const job = entry.jobs.find(item => item.job_id === command.job_id)!
    if (!applied.has(request)) {
      applied.add(request)
      job.revision = String(BigInt(job.revision) + 1n)
      job.updated_at = new Date().toISOString()
      if (command.action === 'reply') {
        const question = job.input_requests.find(item => item.input_request_id === command.input_request_id)
        if (question) { question.status = 'reply_queued'; question.reply_request_id = request }
        job.pending_input_count = 0
        job.state = 'running'; job.phase = 'model'; job.wait = null; job.execution_id = `sample-execution-${job.job_id}`
      } else if (command.action === 'stop') {
        job.state = 'stopped'; job.phase = 'none'; job.settled = true; job.ownership.state = 'none'; job.execution_id = null; job.wait = null; job.pending_input_count = 0
        for (const question of job.input_requests) if (question.status === 'open') { question.status = 'completion_queued'; question.completion_reason = 'dialog_cancel' }
      } else if (command.action === 'interrupt') { job.state = 'interrupted'; job.phase = 'none'; job.execution_id = null }
      else if (command.action === 'resume' || command.action === 'send' || command.action === 'steer') { job.state = 'running'; job.phase = 'model'; job.settled = false; job.execution_id = `sample-execution-${job.job_id}` }
      else if (command.action === 'set-model') job.model.pending = command.model || null
      else if (command.action === 'compact') { job.phase = 'compacting'; job.activity = { kind: 'control', label: 'Sample compaction requested', span_id: null } }
      job.controls = sampleControls(job)
      if (command.text || command.answers) messages.set(job.job_id, [...(messages.get(job.job_id) || []), { role: 'user', content: command.text || JSON.stringify(command.answers, null, 2) }])
      events.set(job.job_id, [...(events.get(job.job_id) || []), { kind: 'event', event_id: request, type: `sample.${command.action}.applied`, occurred_at: job.updated_at, data: { message: 'Sample operation applied. This does not claim downstream delivery or task completion.' } }])
      entry.bot.counts = { queued: 0, running: 0, waiting_input: 0, idle: 0, paused: 0, stopped: 0, interrupted: 0, failed: 0, [job.state]: 1 }
    }
    return { data: { schema_version: 1, kind: 'request', receipt: receipt.receipt, outcome: 'applied', effective_at: job.updated_at, error: null } }
  }
  function detail(job: JobProjection, kind: 'inspect' | 'messages' | 'events', ref?: string): BotWorkspaceDetail {
    if (kind === 'messages') return { data: { items: [{ role: 'assistant', content: job.bot_id === 'sample-writer' ? 'The draft has three sections: planning, planting, and shared care. It is not published.' : job.bot_id === 'sample-reviewer' ? 'Before I review, please choose the audience and the checks that matter.' : 'Waiting for the reviewed artifact. Nothing has been delivered.' }, ...(messages.get(job.job_id) || [])], next_page_token: null } }
    if (kind === 'events') return { data: { items: [{ kind: 'event', event_id: `${job.job_id}-created`, type: 'sample.job.created', occurred_at: AT, data: { message: job.goal_preview } }, ...(events.get(job.job_id) || [])], next_page_token: null } }
    return { data: { ref: ref || '', availability: 'available', media_type: ref === 'sample-question' ? 'application/vnd.omp.bot-question+json' : 'text/plain', content: ref === 'sample-question' ? QUESTION : ref === 'sample-draft-artifact' ? '# A shared garden\n\n1. Plan a small, accessible growing space.\n2. Plant according to the local season.\n3. Share watering and record what works.\n\nWorking draft — not reviewed or delivered.' : job.goal_preview, next_page_token: null } }
  }
  return { snapshot, submit, observe, detail }
}
export type SampleWorkspace = { snapshot: BotWorkspaceSnapshot, submit: (command: BotWorkspaceCommand) => BotWorkspaceReceipt, observe: (request: string) => BotWorkspaceDetail, detail: (job: JobProjection, kind: 'inspect' | 'messages' | 'events', ref?: string) => BotWorkspaceDetail }
