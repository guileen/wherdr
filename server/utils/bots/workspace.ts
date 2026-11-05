import type { BotCliSnapshot, BotWorkspaceBot, BotWorkspaceCommand, BotWorkspaceDetail, BotWorkspaceDetailRequest, BotWorkspaceReceipt, BotWorkspaceSnapshot, BotWorkspaceTarget, JobProjection } from '../../../shared/botWorkspace'
import { dispatchIntent, type BotInvocation } from './ledger'
import { parseBotList, parsePage, parseQuestion, parseReceipt, parseRef, parseRequest, parseSnapshot } from './projections'
import { readSources, runBotCli, type BotCliRunner, type BotSource } from './source'
import { BotWorkspaceError, encodeReply, fail } from './validation'

const REQUIRED_CAPABILITIES = ['bot.questions.v1', 'bot.ownership.v1', 'bot.identity-guard.v1', 'bot.scoped-refs.v1']
const PAGE_SIZE = 100
const MAX_PAGES = 5
const MAX_BOTS = 32
export interface WorkspaceSession { enabled: boolean, unlocked: boolean }
export function requireBotSession(session: WorkspaceSession) {
  // Ordinary app access deliberately permits an unconfigured lock. Bot access
  // never does: status.unlocked alone is not evidence of a passkey session.
  if (!session.enabled || !session.unlocked) fail('auth_required', 'Bot access requires a registered passkey and a valid unlocked session. Register a passkey in Settings, then unlock this device.', 401)
}
function supported(snapshot: BotCliSnapshot) {
  if (!REQUIRED_CAPABILITIES.every(capability => snapshot.capabilities.includes(capability))) fail('unsupported', 'OMP source must support typed questions, ownership, immutable identity guards and Job-scoped refs. Upgrade OMP before using this workspace.', 409)
}
function assertTarget(snapshot: BotCliSnapshot, target: BotWorkspaceTarget): JobProjection {
  if (snapshot.bot.bot_id !== target.bot_id || snapshot.bot.bot_name !== target.bot_name) fail('identity_conflict', 'The named Bot no longer has the selected immutable identity', 409)
  const job = snapshot.jobs.find(item => item.job_id === target.job_id && item.bot_id === target.bot_id)
  if (!job || snapshot.jobs.length !== 1) fail('unknown_job', 'Source did not return the exact selected Job', 404)
  return job
}
export function commandInvocation(command: BotWorkspaceCommand, reply?: string): BotInvocation {
  const action = command.action === 'reply' || command.action === 'steer' ? 'send' : command.action
  const argv = [command.bot_name, action, command.job_id, `--expect-bot-id=${command.bot_id}`, `--if-revision=${command.revision}`, `--request-key=${command.request_key}`]
  if (command.action === 'steer') argv.push('--steer')
  if (command.action === 'reply') argv.push(`--reply-to=${command.input_request_id}`)
  if (command.action === 'compact') argv.push('--mode=qaonly')
  if (command.action === 'set-model') argv.push(command.model!)
  return { argv, stdin: command.action === 'reply' ? reply! : command.text ?? '' }
}

export function createBotWorkspace(options: { dataDir: string, run?: BotCliRunner }) {
  const run = options.run ?? runBotCli
  let cached: { until: number, value: BotWorkspaceSnapshot } | null = null
  let observing: Promise<BotWorkspaceSnapshot> | null = null
  async function sourceFor(id: string): Promise<BotSource> {
    const sources = await readSources(options.dataDir)
    if (!sources.length) fail('not_configured', 'Configure local OMP sources in DATA_DIR/bot-sources.json before using live Bots', 503)
    const source = sources.find(item => item.id === id)
    if (!source) fail('unknown_source', 'Unknown configured Bot source', 404)
    return source
  }
  async function current(source: BotSource, target: BotWorkspaceTarget): Promise<BotCliSnapshot> {
    const snapshot = parseSnapshot(await run(source, [target.bot_name, 'status', target.job_id, `--expect-bot-id=${target.bot_id}`, '--limit=100']))
    supported(snapshot)
    assertTarget(snapshot, target)
    return snapshot
  }
  async function observe(): Promise<BotWorkspaceSnapshot> {
    const sources = await readSources(options.dataDir)
    const observed_at = new Date().toISOString()
    const result: BotWorkspaceSnapshot = { configured: sources.length > 0, sources: [], bots: [], observed_at, complete: true }
    const deadline = Date.now() + 25000
    let calls = 0
    const boundedRun: BotCliRunner = async (source, argv) => {
      if (++calls > 64 || Date.now() >= deadline) fail('source_limit', 'Workspace observation reached its bounded CLI/time limit; some Bots or Jobs are not shown', 503)
      return run(source, argv)
    }
    // Source-owned process prefixes never come from the browser. Work is serial
    // and explicitly bounded to avoid a polling-driven subprocess stampede.
    for (const source of sources) {
      const sourceBots: BotWorkspaceBot[] = []
      let sourceComplete = true
      try {
        const listed = parseBotList(await boundedRun(source, ['list']))
        if (listed.length > MAX_BOTS) sourceComplete = false
        for (const definition of listed.slice(0, MAX_BOTS)) {
          let snapshot = parseSnapshot(await boundedRun(source, [definition.bot_name, 'status', `--expect-bot-id=${definition.bot_id}`, `--limit=${PAGE_SIZE}`]))
          if (snapshot.bot.bot_id !== definition.bot_id || snapshot.bot.bot_name !== definition.bot_name) fail('unsupported', 'Source returned a mismatched immutable Bot identity', 502)
          supported(snapshot)
          const entry: BotWorkspaceBot = { source_id: source.id, profile_id: snapshot.profile_id, bot: snapshot.bot, jobs: [...snapshot.jobs], cursor: snapshot.cursor, capabilities: snapshot.capabilities, observed_at: new Date().toISOString(), complete: true, next_page_token: snapshot.next_page_token }
          for (let page = 1; snapshot.next_page_token && page < MAX_PAGES; page++) {
            const next = parseSnapshot(await boundedRun(source, [definition.bot_name, 'status', `--expect-bot-id=${definition.bot_id}`, `--limit=${PAGE_SIZE}`, `--page-token=${snapshot.next_page_token}`]))
            if (next.bot.bot_id !== definition.bot_id || next.bot.bot_name !== definition.bot_name || next.profile_id !== entry.profile_id || next.cursor.journal_id !== entry.cursor.journal_id || next.cursor.seq !== entry.cursor.seq || next.jobs.some(job => entry.jobs.some(previous => previous.job_id === job.job_id))) fail('unsupported', 'Source returned inconsistent snapshot pages; refresh the workspace', 502)
            supported(next)
            entry.jobs.push(...next.jobs)
            snapshot = next
          }
          entry.next_page_token = snapshot.next_page_token
          entry.complete = snapshot.next_page_token === null
          if (!entry.complete) sourceComplete = false
          sourceBots.push(entry)
        }
        result.bots.push(...sourceBots)
        result.sources.push({ id: source.id, label: source.label, state: 'live', message: sourceComplete ? null : 'Observation limit reached; this source is incomplete (32 Bots, 500 Jobs per Bot maximum).', observed_at: new Date().toISOString() })
      } catch (error) {
        result.complete = false
        const known = error instanceof BotWorkspaceError ? error : null
        result.sources.push({ id: source.id, label: source.label, state: known?.code === 'unsupported' ? 'unsupported' : 'unavailable', message: known?.message ?? 'Configured local Bot source could not be observed', observed_at: null })
      }
      if (!sourceComplete) result.complete = false
    }
    return result
  }
  return {
    async snapshot(): Promise<BotWorkspaceSnapshot> {
      if (cached && cached.until > Date.now()) return cached.value
      if (observing) return observing
      observing = observe()
      try { const value = await observing; cached = { value, until: Date.now() + 3000 }; return value } finally { observing = null }
    },
    async detail(body: BotWorkspaceDetailRequest): Promise<BotWorkspaceDetail> {
      const source = await sourceFor(body.source_id)
      await current(source, body)
      const guard = `--expect-bot-id=${body.bot_id}`
      const page = body.page_token ? [`--page-token=${body.page_token}`] : []
      if (body.kind === 'inspect') {
        const data = parseRef(await run(source, [body.bot_name, 'inspect', body.ref!, guard, `--job=${body.job_id}`, ...page]))
        if (data.ref !== body.ref) fail('unsupported', 'Source returned a different reference', 502)
        // Large structured refs are JSON-text chunks in the actual CLI. Keep
        // those lazy pages intact; only a complete object is a typed question.
        if (data.availability === 'available' && data.media_type === 'application/vnd.omp.bot-question+json' && typeof data.content !== 'string') parseQuestion(data.content)
        return { data }
      }
      if (body.kind === 'request') {
        const data = parseRequest(await run(source, [body.bot_name, 'request', body.request_id!, guard]))
        if (data.receipt.bot_id !== body.bot_id || data.receipt.job_id !== body.job_id || data.receipt.request_id !== body.request_id || data.children?.some(child => child.receipt.bot_id !== body.bot_id || child.receipt.job_id !== body.job_id)) fail('permission_denied', 'Request does not belong to the exact selected Bot and Job', 403)
        return { data }
      }
      const after = body.cursor ? [`--after=${JSON.stringify(body.cursor)}`] : []
      return { data: parsePage(await run(source, [body.bot_name, body.kind, body.job_id, guard, `--limit=${PAGE_SIZE}`, ...page, ...after]), body.kind, body.bot_id, body.job_id) }
    },
    async command(body: BotWorkspaceCommand): Promise<BotWorkspaceReceipt> {
      const source = await sourceFor(body.source_id)
      const receipt = await dispatchIntent({
        dataDir: options.dataDir, source, command: body,
        prepare: async () => {
          const snapshot = await current(source, body)
          const job = assertTarget(snapshot, body)
          if (job.revision !== body.revision) fail('revision_conflict', 'Job revision changed; refresh before submitting this command', 409)
          if (body.action !== 'reply' && !job.controls.some(control => control.action === body.action && control.enabled)) fail('invalid_state', 'This action is not enabled for the selected Job', 409)
          if (body.action !== 'reply') return commandInvocation(body)
          const question = job.input_requests.find(item => item.input_request_id === body.input_request_id && item.status === 'open')
          if (!question) fail('input_request_closed', 'The exact input request is no longer open', 409)
          const ref = parseRef(await run(source, [body.bot_name, 'inspect', question.prompt_ref, `--expect-bot-id=${body.bot_id}`, `--job=${body.job_id}`]))
          if (ref.ref !== question.prompt_ref || ref.availability !== 'available' || ref.media_type !== 'application/vnd.omp.bot-question+json' || ref.next_page_token !== null) fail('unsupported', 'Current typed question is not fully available', 409)
          const detail = parseQuestion(ref.content)
          if (detail.input_request_id !== body.input_request_id || detail.kind !== question.kind) fail('unsupported', 'Source returned a different input request', 502)
          return commandInvocation(body, encodeReply(detail, body.answers!))
        },
        invoke: async invocation => {
          // Even replay must establish identity/capabilities before mutation;
          // do not re-check the original revision/question (admission dedupes first).
          await current(source, body)
          return parseReceipt(await run(source, invocation.argv, invocation.stdin))
        },
      })
      cached = null
      return { source_id: body.source_id, bot_id: body.bot_id, job_id: body.job_id, request_id: receipt.request_id, request_key: body.request_key, accepted: true, status: 'accepted', receipt }
    },
  }
}
