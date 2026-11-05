import { describe, expect, it } from 'vitest'
import type { BotWorkspaceCommand } from '../shared/botWorkspace'
import { createSampleWorkspace } from '../app/utils/bots/sample'
import { answersReady, controlReason, decodeBotDetail } from '../app/utils/bots/workspace'

function command(action: BotWorkspaceCommand['action'], key = 'intent-one'): BotWorkspaceCommand {
  return { source_id: 'sample', bot_name: 'reviewer', bot_id: 'sample-reviewer', job_id: 'sample-review', revision: '1', request_key: key, action }
}
describe('Bot workspace sample and wire presentation', () => {
  it('keeps independent sample sessions isolated when one applies a control', () => {
    const first = createSampleWorkspace(), second = createSampleWorkspace()
    const before = structuredClone(second.snapshot)
    first.observe(first.submit(command('stop')).request_id)
    expect(second.snapshot).toEqual(before)
    expect(first.snapshot.bots[1]!.jobs[0]!.state).not.toBe(second.snapshot.bots[1]!.jobs[0]!.state)
  })
  it('requires typed single, multiple and text answers before submitting', () => {
    const sample = createSampleWorkspace()
    const job = sample.snapshot.bots[1]!.jobs[0]!
    const question = decodeBotDetail(sample.detail(job, 'inspect', 'sample-question')).question!
    expect(answersReady(question, {})).toBe(false)
    expect(answersReady(question, { audience: 'newcomers', note: 'Explain first steps' })).toBe(false)
    expect(answersReady(question, { audience: 'newcomers', checks: [], note: 'Explain first steps' })).toBe(true)
    expect(answersReady(question, { audience: 'invented', checks: ['accuracy'], note: 'Explain first steps' })).toBe(false)
    expect(answersReady(question, { audience: 'newcomers', checks: ['accuracy', 'clarity'], note: 'Explain first steps' })).toBe(true)
  })
  it('accepts omitted optional fields and free text even when custom options are disabled', () => {
    const sample = createSampleWorkspace()
    const question = structuredClone(decodeBotDetail(sample.detail(sample.snapshot.bots[1]!.jobs[0]!, 'inspect', 'sample-question')).question!)
    question.fields = [
      { id: 'note', label: 'Note', mode: 'text', required: true, allow_custom: false, options: [] },
      { id: 'extra', label: 'Extra', mode: 'single', required: false, allow_custom: false, options: [{ value: 'one', label: 'One', description: null }] },
    ]
    expect(answersReady(question, { note: 'Arbitrary free text' })).toBe(true)
    expect(answersReady(question, { note: 'Arbitrary free text', extra: '' })).toBe(false)
    expect(answersReady(question, { note: 'Arbitrary free text', extra: 'not-offered' })).toBe(false)
  })
  it('separates admission from observed application and does not complete downstream work', () => {
    const sample = createSampleWorkspace()
    const job = sample.snapshot.bots[1]!.jobs[0]!
    const intent = { ...command('reply'), input_request_id: 'sample-direction', answers: { audience: 'newcomers', checks: ['clarity'], note: 'Keep it practical' } }
    const receipt = sample.submit(intent)
    expect(receipt.status).toBe('accepted')
    expect(job.state).toBe('waiting_input')
    expect(job.input_requests[0]!.status).toBe('open')
    const outcome = sample.observe(receipt.request_id)
    expect(outcome.data).toMatchObject({ kind: 'request', outcome: 'applied' })
    expect(job.state).toBe('running')
    expect(job.settled).toBe(false)
    expect(job.input_requests[0]!.status).toBe('reply_queued')
    expect(sample.snapshot.bots[2]!.jobs[0]!.state).toBe('queued')
    expect(sample.snapshot.bots[2]!.jobs[0]!.pending_delivery_count).toBe(0)
    expect(sample.observe(receipt.request_id)).toEqual(outcome)
    expect(job.revision).toBe('2')
  })
  it('reuses an original key, appends a follow-up and scopes stop to one Job', () => {
    const sample = createSampleWorkspace()
    const intent = { ...command('send'), text: 'Keep the guide concise' }
    const receipt = sample.submit(intent)
    expect(sample.submit(intent)).toEqual(receipt)
    sample.observe(receipt.request_id)
    const reviewer = sample.snapshot.bots[1]!.jobs[0]!
    expect(decodeBotDetail(sample.detail(reviewer, 'messages')).items.at(-1)?.text).toBe('Keep the guide concise')
    const stop = sample.submit({ ...command('stop', 'intent-stop'), revision: reviewer.revision })
    expect(reviewer.state).toBe('running')
    sample.observe(stop.request_id)
    expect(reviewer.state).toBe('stopped')
    expect(sample.snapshot.bots[0]!.jobs[0]!.state).toBe('idle')
    expect(sample.snapshot.bots[2]!.jobs[0]!.state).toBe('queued')
  })
  it('shows a pending model separately from the current model', () => {
    const sample = createSampleWorkspace()
    const current = sample.snapshot.bots[1]!.jobs[0]!.model.current
    const receipt = sample.submit({ ...command('set-model'), model: 'sample/model-fast' })
    sample.observe(receipt.request_id)
    expect(sample.snapshot.bots[1]!.jobs[0]!.model).toEqual({ current, pending: 'sample/model-fast' })
  })
  it('never renders unknown media or a malformed question as an interactive form', () => {
    const detail = { data: { ref: 'reference', availability: 'available' as const, media_type: 'text/html', content: '<script>unsafe()</script>', next_page_token: null } }
    expect(decodeBotDetail(detail).question).toBeNull()
    expect(decodeBotDetail(detail).text).not.toContain('<script>')
    expect(decodeBotDetail({ data: { ...detail.data, media_type: 'application/vnd.omp.bot-question+json', content: { schema_version: 1, fields: [] } } }).question).toBeNull()
    expect(decodeBotDetail({ data: { ...detail.data, availability: 'expired' } })).toMatchObject({ question: null, text: null, availability: 'expired' })
  })
  it('uses actual control readiness and question status instead of inventing controls', () => {
    const job = createSampleWorkspace().snapshot.bots[1]!.jobs[0]!
    job.controls = [{ action: 'stop', enabled: false, reason: 'Cleanup in progress' }]
    expect(controlReason(job, 'stop')).toBe('Cleanup in progress')
    expect(controlReason(job, 'send')).not.toBeNull()
    expect(controlReason(job, 'reply')).toBeNull()
    job.input_requests[0]!.status = 'reply_queued'
    expect(controlReason(job, 'reply')).not.toBeNull()
  })
})
