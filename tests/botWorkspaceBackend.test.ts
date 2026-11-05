import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BotCliReceipt, BotCliSnapshot, BotQuestionDetail, BotWorkspaceCommand, JobProjection } from '../shared/botWorkspace'
import { createAuth } from '../server/utils/auth'
import { dispatchIntent } from '../server/utils/bots/ledger'
import { parseSnapshot } from '../server/utils/bots/projections'
import { readSources, type BotCliRunner, type BotSource } from '../server/utils/bots/source'
import { BotWorkspaceError, commandBody, detailBody, encodeReply } from '../server/utils/bots/validation'
import { commandInvocation, createBotWorkspace, requireBotSession } from '../server/utils/bots/workspace'

const directories: string[] = []
async function directory(): Promise<string> {
  const value = await fs.mkdtemp(path.join(tmpdir(), 'wherdr-bots-'))
  directories.push(value)
  return value
}
afterEach(async () => { await Promise.all(directories.splice(0).map(value => fs.rm(value, { recursive: true, force: true }))) })
const at = '2026-01-01T00:00:00.000Z'
const source: BotSource = { id: 'local', label: 'Local OMP', command: ['omp'] }
const target = { source_id: 'local', bot_name: 'reviewer', bot_id: 'bot_a', job_id: 'job_a' }
const question: BotQuestionDetail = {
  schema_version: 1, input_request_id: 'input_a', title: 'Review', body: 'Choose a direction', kind: 'text', reply_encoding: 'question_map',
  fields: [
    { id: 'direction', label: 'Direction', mode: 'single', required: true, allow_custom: true, options: [{ value: 'Ship', label: 'Ship', description: null }] },
    { id: 'checks', label: 'Checks', mode: 'multi', required: true, allow_custom: true, options: [{ value: 'Tests', label: 'Tests', description: null }] },
  ],
}
function job(): JobProjection {
  return {
    job_id: 'job_a', bot_id: 'bot_a', config_revision: 'v_a', revision: '9007199254740993', goal_preview: 'Review cancellation', goal_ref: 'ref_goal', cwd: '/home/user/project', graph_context: null,
    state: 'waiting_input', phase: 'input', settled: false,
    input_requests: [{ input_request_id: 'input_a', kind: 'text', prompt_ref: 'ref_question', status: 'open', reply_request_id: null, completion_reason: null }],
    ownership: { state: 'active', activation_ref: 'ref_activation' }, execution_id: 'exec_a', pending_input_count: 0, pending_background_count: 0, pending_delivery_count: 0,
    activity: null, wait: { kind: 'input', message: 'Waiting for review', request_id: 'input_a', retry_at: null }, progress: null,
    model: { current: 'provider/model-a', pending: null }, context: { used_tokens: null, limit_tokens: null },
    usage: { input_tokens: 17, output_tokens: 3, cache_read_tokens: null, cache_write_tokens: null, cost_usd: '0.000000000123456789', completeness: 'partial', measured_at: at },
    created_at: at, updated_at: at, last_activity_at: at, elapsed_ms: 10, active_ms: 5, output_ref: null, artifact_ids: [], error: null,
    controls: ['send', 'steer', 'interrupt', 'resume', 'compact', 'set-model', 'stop'].map(action => ({ action: action as JobProjection['controls'][number]['action'], enabled: true, reason: null })),
  }
}
function snapshot(): BotCliSnapshot {
  return {
    schema_version: 1, kind: 'snapshot', profile_id: 'profile_a', capabilities: ['bot.questions.v1', 'bot.ownership.v1', 'bot.identity-guard.v1', 'bot.scoped-refs.v1'],
    bot: { bot_id: 'bot_a', bot_name: 'reviewer', config_revision: 'v_a', worker: { state: 'online', last_seen_at: at }, counts: { queued: 0, running: 0, waiting_input: 1, idle: 0, paused: 0, stopped: 0, interrupted: 0, failed: 0 }, jobs_total: 1 },
    jobs: [job()], cursor: { journal_id: 'bj_a', seq: '9007199254740994' }, next_page_token: null,
  }
}
const receipt: BotCliReceipt = { schema_version: 1, kind: 'receipt', bot_id: 'bot_a', job_id: 'job_a', request_id: 'req_a', accepted: true, cursor: { journal_id: 'bj_a', seq: '9007199254740995' } }
function command(patch: Partial<BotWorkspaceCommand> = {}): BotWorkspaceCommand {
  return commandBody({ ...target, revision: '9007199254740993', request_key: 'review-1', action: 'send', text: 'Keep exact text\n--stop $(not-a-shell)', ...patch })
}
async function configured(): Promise<string> {
  const dataDir = await directory()
  await fs.writeFile(path.join(dataDir, 'bot-sources.json'), JSON.stringify({ sources: [source] }), { mode: 0o600 })
  return dataDir
}

describe('Bot workspace trust boundary', () => {
  it('requires an actual signed passkey session even when normal app access is open', async () => {
    const auth = createAuth({ dataDir: await directory() })
    const req = { headers: {} }
    expect(auth.isUnlocked(req)).toBe(true)
    expect(() => requireBotSession(auth.status(req))).toThrowError(expect.objectContaining({ code: 'auth_required' }))
    auth._db().credentials.push({ id: 'key-a', publicKey: 'neutral-test-key', counter: 0, transports: [], name: 'Test device', createdAt: at })
    expect(() => requireBotSession(auth.status(req))).toThrowError(expect.objectContaining({ code: 'auth_required' }))
    const cookie = auth._sessionCookie(req).split(';')[0]!
    requireBotSession(auth.status({ headers: { cookie } }))
    expect(() => requireBotSession(auth.status({ headers: { cookie: `${cookie}broken` } }))).toThrowError(expect.objectContaining({ code: 'auth_required' }))
  })
  it('reports missing config honestly without executing any CLI', async () => {
    const run = vi.fn<BotCliRunner>()
    const workspace = createBotWorkspace({ dataDir: await directory(), run })
    expect(await workspace.snapshot()).toMatchObject({ configured: false, sources: [], bots: [], complete: true })
    await expect(workspace.command(command())).rejects.toMatchObject({ code: 'not_configured' })
    expect(run).not.toHaveBeenCalled()
  })
  it('rejects malformed trusted configuration and browser configuration overrides', async () => {
    const dataDir = await directory()
    await fs.writeFile(path.join(dataDir, 'bot-sources.json'), JSON.stringify({ sources: [{ ...source, command: 'omp; touch /tmp/no' }] }))
    await expect(readSources(dataDir)).rejects.toMatchObject({ code: 'source_config' })
    for (const extra of [{ command: ['evil'] }, { profile: 'other' }, { cwd: '/tmp' }, { argv: ['stop', '--all'] }, { all: true }]) expect(() => commandBody({ ...command(), ...extra })).toThrow()
  })
  it('rejects hostile identities, action payload confusion and cross-kind detail fields', () => {
    for (const field of ['bot_name', 'bot_id', 'job_id', 'source_id', 'request_key']) for (const hostile of ['--all', '../private', 'x\n--stop', 'x\u0000y']) expect(() => commandBody({ ...command(), [field]: hostile })).toThrow()
    for (const hostile of [null, [], { ...command(), action: 'submit' }, { ...command(), action: 'stop' }, { ...command(), revision: 42 }, { ...command(), action: 'set-model', text: undefined, model: '--all' }]) expect(() => commandBody(hostile)).toThrow()
    expect(() => detailBody({ ...target, kind: 'inspect', ref: '--all' })).toThrow()
    expect(() => detailBody({ ...target, kind: 'inspect', ref: 'ref_a', request_id: 'req_a' })).toThrow()
    expect(() => detailBody({ ...target, kind: 'messages', cursor: { journal_id: 'bj_a', seq: '1' } })).toThrow()
    expect(() => detailBody({ ...target, kind: 'events', cursor: { journal_id: 'bj_a', seq: '1', injected: true } })).toThrow()
  })
  it('rejects foreign Job identities and numeric revision or cost fields', () => {
    expect(() => parseSnapshot({ ...snapshot(), jobs: [{ ...job(), bot_id: 'bot_other' }] })).toThrow()
    expect(() => parseSnapshot({ ...snapshot(), jobs: [{ ...job(), revision: 9007199254740993 }] })).toThrow()
    expect(() => parseSnapshot({ ...snapshot(), jobs: [{ ...job(), usage: { ...job().usage, cost_usd: 0.0001 } }] })).toThrow()
  })
  it('never mutates unsupported sources or changed Bot/Job identities', async () => {
    const dataDir = await configured()
    const unsupported = vi.fn<BotCliRunner>().mockResolvedValue({ ...snapshot(), capabilities: [] })
    await expect(createBotWorkspace({ dataDir, run: unsupported }).command(command())).rejects.toMatchObject({ code: 'unsupported' })
    expect(unsupported).toHaveBeenCalledTimes(1)
    const wrongBot = vi.fn<BotCliRunner>().mockResolvedValue({ ...snapshot(), bot: { ...snapshot().bot, bot_id: 'bot_other' }, jobs: [{ ...job(), bot_id: 'bot_other' }] })
    await expect(createBotWorkspace({ dataDir, run: wrongBot }).command(command())).rejects.toMatchObject({ code: 'identity_conflict' })
    expect(wrongBot).toHaveBeenCalledTimes(1)
  })
})

describe('OMP CLI transformations and detail guards', () => {
  it('enforces text/single/multi types, complete required keys and offered approval grants', () => {
    expect(() => encodeReply(question, { direction: 'Ship', checks: 'Tests' })).toThrow()
    expect(() => encodeReply(question, { direction: 'Ship' })).toThrow()
    expect(() => encodeReply(question, { direction: 'Ship', checks: ['Tests'], extra: 'bad' })).toThrow()
    expect(encodeReply(question, { direction: 'Ship', checks: [] })).toBe('{"direction":"Ship","checks":[]}')
    const approval: BotQuestionDetail = { ...question, kind: 'approval', reply_encoding: 'text', fields: [{ id: 'answer', label: 'Approval', mode: 'single', required: true, allow_custom: false, options: [{ value: 'once', label: 'Approve once', description: null }, { value: 'deny', label: 'Deny', description: null }] }] }
    expect(encodeReply(approval, { answer: 'once' })).toBe('once')
    expect(() => encodeReply(approval, { answer: 'session' })).toThrow()
  })
  it('preserves optional omission and plain text instead of inventing required choices', () => {
    const optional: BotQuestionDetail = { ...question, fields: [{ ...question.fields[0]!, required: false }, question.fields[1]!] }
    expect(encodeReply(optional, { checks: [] })).toBe('{"checks":[]}')
    const plain: BotQuestionDetail = { ...question, reply_encoding: 'text', fields: [{ id: 'answer', label: 'Notes', mode: 'text', required: true, allow_custom: false, options: [] }] }
    expect(encodeReply(plain, { answer: 'Exact free text' })).toBe('Exact free text')
    expect(() => encodeReply(plain, { answer: '' })).toThrow()
    const optionalOnly = { ...question, fields: question.fields.map(field => ({ ...field, required: false })) }
    const parsed = commandBody({ ...target, revision: '9', request_key: 'optional-1', action: 'reply', input_request_id: 'input_a', answers: {} })
    expect(encodeReply(optionalOnly, parsed.answers!)).toBe('{}')
  })
  it('pins lazy refs, messages/events and real request outcomes to the selected Job', async () => {
    const run = vi.fn<BotCliRunner>().mockImplementation(async (_source, argv) => {
      if (argv[1] === 'status') return snapshot()
      if (argv[1] === 'inspect') return { ref: 'ref_goal', availability: 'available', media_type: 'text/plain', content: 'Actual goal', next_page_token: null }
      if (argv[1] === 'request') return { schema_version: 1, kind: 'request', receipt, outcome: 'rejected', effective_at: at, error: { code: 'worker_unavailable', message: 'Worker unavailable', retryable: true } }
      return { items: [], next_page_token: null }
    })
    const workspace = createBotWorkspace({ dataDir: await configured(), run })
    expect(await workspace.detail(detailBody({ ...target, kind: 'inspect', ref: 'ref_goal' }))).toMatchObject({ data: { content: 'Actual goal' } })
    expect(run).toHaveBeenLastCalledWith(source, ['reviewer', 'inspect', 'ref_goal', '--expect-bot-id=bot_a', '--job=job_a'])
    expect(await workspace.detail(detailBody({ ...target, kind: 'request', request_id: 'req_a' }))).toMatchObject({ data: { outcome: 'rejected', error: { code: 'worker_unavailable' } } })
    await workspace.detail(detailBody({ ...target, kind: 'events', cursor: { journal_id: 'bj_a', seq: '8' } }))
    expect(run).toHaveBeenLastCalledWith(source, ['reviewer', 'events', 'job_a', '--expect-bot-id=bot_a', '--limit=100', '--after={"journal_id":"bj_a","seq":"8"}'])
    run.mockImplementation(async (_source, argv) => argv[1] === 'status' ? snapshot() : { schema_version: 1, kind: 'request', receipt: { ...receipt, job_id: 'job_other' }, outcome: 'applied', effective_at: at, error: null })
    await expect(workspace.detail(detailBody({ ...target, kind: 'request', request_id: 'req_a' }))).rejects.toMatchObject({ code: 'permission_denied' })
  })
  it('fully pages snapshots and exposes truncation rather than claiming completeness', async () => {
    let pages = 0
    const run = vi.fn<BotCliRunner>().mockImplementation(async (_source, argv) => {
      if (argv[0] === 'list') return { schema_version: 1, kind: 'bots', bots: [{ bot_id: 'bot_a', bot_name: 'reviewer', config_revision: 'v_a', created_at: at }] }
      pages++
      return { ...snapshot(), jobs: [{ ...job(), job_id: `job_${pages}` }], next_page_token: `page_${pages}` }
    })
    const observed = await createBotWorkspace({ dataDir: await configured(), run }).snapshot()
    expect(observed.sources[0]!.state).toBe('live')
    expect(observed.complete).toBe(false)
    expect(observed.bots[0]).toMatchObject({ complete: false, next_page_token: 'page_5' })
    expect(observed.bots[0]!.jobs).toHaveLength(5)
  })
})

describe('durable Bot operation intent', () => {
  it('persists canonical payload before dispatch, dedupes concurrent requests, and rejects key reuse with a different action', async () => {
    const dataDir = await directory()
    const body = command()
    const prepare = vi.fn(async () => commandInvocation(body))
    const invoke = vi.fn(async () => {
      const files = await fs.readdir(path.join(dataDir, 'bot-intents'))
      const intentName = files.find(file => !file.includes('.state.') && file.endsWith('.json'))!
      const retained = JSON.parse(await fs.readFile(path.join(dataDir, 'bot-intents', intentName), 'utf8'))
      expect(retained.canonical).toContain('review-1')
      expect(retained.invocation.stdin).toBe(body.text)
      expect((await fs.stat(path.join(dataDir, 'bot-intents', intentName))).mode & 0o777).toBe(0o600)
      expect(files.some(file => file.endsWith('.state.json'))).toBe(true)
      return receipt
    })
    const options = { dataDir, source, command: body, prepare, invoke }
    expect(await Promise.all([dispatchIntent(options), dispatchIntent(options)])).toEqual([receipt, receipt])
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(prepare).toHaveBeenCalledTimes(1)
    await expect(dispatchIntent({ ...options, command: { ...body, text: 'different' } })).rejects.toMatchObject({ code: 'idempotency_conflict' })
    expect(invoke).toHaveBeenCalledTimes(1)
  })
  it('retains ambiguous results and replays the original key/argv without re-preparing a changed question or revision', async () => {
    const dataDir = await directory()
    const body = command()
    const prepare = vi.fn(async () => commandInvocation(body))
    const invoke = vi.fn().mockRejectedValueOnce(new BotWorkspaceError('source_timeout', 'Receipt lost', 503)).mockResolvedValue(receipt)
    const options = { dataDir, source, command: body, prepare, invoke }
    await expect(dispatchIntent(options)).rejects.toMatchObject({ code: 'source_timeout' })
    expect(await dispatchIntent(options)).toEqual(receipt)
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(invoke.mock.calls[1]![0]).toEqual(invoke.mock.calls[0]![0])
    const states = (await fs.readdir(path.join(dataDir, 'bot-intents'))).filter(file => file.endsWith('.state.json'))
    expect(JSON.parse(await fs.readFile(path.join(dataDir, 'bot-intents', states[0]!), 'utf8'))).toMatchObject({ status: 'accepted', receipt })
  })
  it('retains explicit admission failures and never automatically redispatches them', async () => {
    const body = command()
    const invoke = vi.fn().mockRejectedValue(new BotWorkspaceError('revision_conflict', 'Revision changed', 409))
    const options = { dataDir: await directory(), source, command: body, prepare: async () => commandInvocation(body), invoke }
    await expect(dispatchIntent(options)).rejects.toMatchObject({ code: 'revision_conflict' })
    await expect(dispatchIntent(options)).rejects.toMatchObject({ code: 'revision_conflict' })
    expect(invoke).toHaveBeenCalledTimes(1)
  })
})
