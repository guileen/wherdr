import { describe, expect, it } from 'vitest'
import { createQaCompactionEstimator, estimateQaCompaction } from '../server/utils/compactEstimate'

const meter = '◫ 50%/100K'
const file = (entries: object[]) => entries.map(e => JSON.stringify(e)).join('\n')
const message = (id: string, parentId: string | null, role: string, content: unknown, extra = {}) => ({ type: 'message', id, parentId, message: { role, content, ...extra } })
const text = (s: string) => [{ type: 'text', text: s }]

describe('QA compact estimates', () => {
  it('uses the displayed context including inferred overhead, and removes tool history', () => {
    const input = file([
      message('u', null, 'user', text('question')),
      message('a', 'u', 'assistant', [{ type: 'toolCall', name: 'read', arguments: { path: 'src/a' } }], { stopReason: 'toolUse' }),
      message('t', 'a', 'toolResult', text('x'.repeat(4000))),
      message('b', 't', 'assistant', text('answer'), { stopReason: 'stop' }),
    ])
    const estimate = estimateQaCompaction(input, meter)!
    expect(estimate.beforeTokens).toBe(50_000)
    expect(estimate.afterTokens).toBeGreaterThan(48_000)
    expect(estimate.afterTokens).toBeLessThan(49_100)
  })

  it('uses the selected branch and honors reset boundaries', () => {
    const base = [
      message('u', null, 'user', text('old'.repeat(1000))),
      { type: 'reset_boundary', id: 'r', parentId: 'u' },
      message('v', 'r', 'user', text('new question')),
      message('abandoned', 'v', 'assistant', text('discarded'.repeat(1000)), { stopReason: 'stop' }),
      message('live', 'v', 'assistant', text('live answer'), { stopReason: 'stop' }),
    ]
    expect(estimateQaCompaction(file(base), meter)).toEqual(estimateQaCompaction(file(base.filter(e => e.id !== 'abandoned')), meter))
  })

  it('recovers all retained Q&A across repeated QA compactions, not just the latest tail', () => {
    const entries = [
      message('u', null, 'user', text('first question')),
      message('a', 'u', 'assistant', text('first answer'), { stopReason: 'stop' }),
      { type: 'compaction', id: 'c', parentId: 'a', details: { kind: 'qaonly', retainedEntryIds: ['u', 'a'], toolTip: 'old activity' } },
      message('v', 'c', 'user', text('second question')),
      message('b', 'v', 'assistant', text('second answer'), { stopReason: 'stop' }),
    ]
    const withFirst = estimateQaCompaction(file(entries), meter)!
    const currentChars = 'first question'.length + 'first answer'.length + 'old activity'.length + 'second question'.length + 'second answer'.length
    const retainedChars = 'first question'.length + 'first answer'.length + 'second question'.length + 'second answer'.length
    expect(withFirst.afterTokens).toBe(50_000 - Math.ceil(currentChars / 4) + Math.ceil(retainedChars / 4))
  })

  it('refuses unavailable meters, invalid histories and non-QA compactions', () => {
    expect(estimateQaCompaction('', meter)).toBeNull()
    expect(estimateQaCompaction('{', meter)).toBeNull()
    expect(estimateQaCompaction(file([message('u', null, 'user', text('hi')), { type: 'compaction', id: 'c', parentId: 'u' }]), meter)).toBeNull()
    expect(estimateQaCompaction(file([message('u', 'missing', 'user', text('hi'))]), meter)).toBeNull()
    expect(estimateQaCompaction(file([message('u', null, 'user', text('hi'))]), '')).toBeNull()
  })

  it('ignores opaque tool results discarded by a previous QA compaction', () => {
    const entries = [
      message('u', null, 'user', text('question')),
      message('call', 'u', 'assistant', [{ type: 'toolCall', name: 'read', arguments: { path: 'image.png' } }], { stopReason: 'toolUse' }),
      message('result', 'call', 'toolResult', [{ type: 'text', text: 'screenshot' }, { type: 'image', data: 'not-real-image-data' }]),
      message('a', 'result', 'assistant', [{ type: 'thinking', thinking: 'private reasoning' }, ...text('answer')], { stopReason: 'stop' }),
      { type: 'compaction', id: 'c', parentId: 'a', details: { kind: 'qaonly', retainedEntryIds: ['u', 'a'], toolTip: 'old activity' } },
      message('v', 'c', 'user', text('next question')),
    ]
    const currentChars = 'question'.length + 'answer'.length + 'old activity'.length + 'next question'.length
    const projectedChars = 'question'.length + 'answer'.length + 'next question'.length
    expect(estimateQaCompaction(file(entries), meter)).toEqual({
      beforeTokens: 50_000,
      afterTokens: 50_000 - Math.ceil(currentChars / 4) + Math.ceil(projectedChars / 4),
    })
  })

  it('carries retained user media through the meter without pricing it as zero', () => {
    const entries = [
      message('u', null, 'user', [{ type: 'text', text: 'describe this' }, { type: 'image', data: 'not-real-image-data' }]),
      message('a', 'u', 'assistant', text('description'), { stopReason: 'stop' }),
      { type: 'compaction', id: 'c', parentId: 'a', details: { kind: 'qaonly', retainedEntryIds: ['u', 'a'], toolTip: 'old activity' } },
      message('v', 'c', 'user', text('another question')),
    ]
    const known = 'describe this'.length + 'description'.length + 'another question'.length
    expect(estimateQaCompaction(file(entries), meter)).toEqual({
      beforeTokens: 50_000,
      afterTokens: 50_000 - Math.ceil((known + 'old activity'.length) / 4) + Math.ceil(known / 4),
    })
    const currentImage = file([message('u', null, 'user', [{ type: 'image', data: 'not-real-image-data' }])])
    expect(estimateQaCompaction(currentImage, meter)).toEqual({ beforeTokens: 50_000, afterTokens: 50_000 })
  })

  it('rejects opaque content retained on only one side and ignores inactive opaque branches', () => {
    const image = [{ type: 'image', data: 'not-real-image-data' }]
    expect(estimateQaCompaction(file([
      message('u', null, 'user', image),
      { type: 'compaction', id: 'c', parentId: 'u', details: { kind: 'qaonly', retainedEntryIds: [] } },
    ]), meter)).toBeNull()
    expect(estimateQaCompaction(file([
      message('u', null, 'user', text('question')),
      message('t', 'u', 'toolResult', image),
    ]), meter)).toMatchObject({ beforeTokens: 50_000, afterTokens: 50_000, imageSavingsExcluded: true })
    const u = message('u', null, 'user', text('question'))
    const live = message('live', 'u', 'assistant', text('answer'), { stopReason: 'stop' })
    expect(estimateQaCompaction(file([u, message('inactive', 'u', 'toolResult', image), live]), meter))
      .toEqual(estimateQaCompaction(file([u, live]), meter))
  })

  it('streams complete lines and bounds previously omitted opaque turns', () => {
    const entries: object[] = [message('u', null, 'user', text('question'))]
    let parent = 'u'
    for (let i = 0; i < 58; i++) {
      const id = `result${i}`
      entries.push(message(id, parent, 'toolResult', [{ type: 'image', data: `synthetic-${i}` }]))
      parent = id
    }
    entries.push(
      message('a', parent, 'assistant', text('answer'), { stopReason: 'stop' }),
      { type: 'compaction', id: 'c', parentId: 'a', details: { kind: 'qaonly', retainedEntryIds: ['u', 'a'] } },
    )
    const estimator = createQaCompactionEstimator(meter)
    for (const entry of entries) estimator.push(JSON.stringify(entry))
    estimator.push('')
    expect(estimator.finish()).toEqual({ beforeTokens: 50_000, afterTokens: 50_000 })
    expect(estimator.finish()).toEqual(estimateQaCompaction(file(entries), meter))
  })

  it('retains custom user requests in either OMP entry representation', () => {
    const entries = [
      { type: 'custom_message', id: 'u', parentId: null, customType: 'skill-prompt', attribution: 'user', content: text('skill request') },
      { type: 'message', id: 'v', parentId: 'u', message: { role: 'custom', customType: 'collab-prompt', attribution: 'user', content: text('collab request') } },
      message('t', 'v', 'toolResult', text('x'.repeat(400))),
    ]
    const before = 'skill request'.length + 'collab request'.length + 400
    const after = 'skill request'.length + 'collab request'.length
    expect(estimateQaCompaction(file(entries), meter)).toEqual({
      beforeTokens: 50_000,
      afterTokens: 50_000 - Math.ceil(before / 4) + Math.ceil(after / 4),
    })
  })

  it('estimates plain-text handoff summaries and the entire preserved tail', () => {
    const entries = [
      message('u', null, 'user', text('old question')),
      message('a', 'u', 'assistant', text('old answer'), { stopReason: 'stop' }),
      message('v', 'a', 'user', text('recent question')),
      message('call', 'v', 'assistant', [{ type: 'toolCall', name: 'read', arguments: { path: 'file' } }], { stopReason: 'toolUse' }),
      message('t', 'call', 'toolResult', text('x'.repeat(400))),
      message('b', 't', 'assistant', text('recent answer'), { stopReason: 'stop' }),
      { type: 'compaction', id: 'c', parentId: 'b', method: 'handoff', summary: 'earlier summary', firstKeptEntryId: 'v' },
      message('w', 'c', 'user', text('new question')),
    ]
    const current = 'earlier summary'.length + 'recent question'.length + '{"path":"file"}'.length + 1 + 'read'.length + 400 + 'recent answer'.length + 'new question'.length
    const projected = 'old question'.length + 'old answer'.length + 'recent question'.length + 'recent answer'.length + 'new question'.length
    expect(estimateQaCompaction(file(entries), meter)).toEqual({
      beforeTokens: 50_000,
      afterTokens: 50_000 - Math.ceil(current / 4) + Math.ceil(projected / 4),
    })
  })

  it('accounts for an empty kept tail and rejects opaque standard compactions', () => {
    const u = message('u', null, 'user', text('original question'))
    const compact = { type: 'compaction', id: 'c', parentId: 'u', summary: 'summary', firstKeptEntryId: '' }
    expect(estimateQaCompaction(file([u, compact]), meter)).toEqual({
      beforeTokens: 50_000,
      afterTokens: 50_000 - Math.ceil('summary'.length / 4) + Math.ceil('original question'.length / 4),
    })
    expect(estimateQaCompaction(file([u, { ...compact, firstKeptEntryId: 'missing' }]), meter)).toBeNull()
    expect(estimateQaCompaction(file([u, { ...compact, preserveData: { openaiRemoteCompaction: { replacementHistory: [] } } }]), meter)).toBeNull()
    expect(estimateQaCompaction(file([u, { ...compact, method: 'snapcompact' }]), meter)).toBeNull()
    expect(estimateQaCompaction(file([u, { ...compact, details: { kind: 'experimental-context-rollover' } }]), meter)).toBeNull()
  })

  it('reports excluded image savings for kept history removed by QA compaction', () => {
    const entries = [
      message('u', null, 'user', text('question')),
      message('t', 'u', 'toolResult', [{ type: 'image', data: 'synthetic' }]),
      { type: 'compaction', id: 'c', parentId: 't', method: 'handoff', summary: 'summary', firstKeptEntryId: 't' },
    ]
    expect(estimateQaCompaction(file(entries), meter)).toMatchObject({ imageSavingsExcluded: true })
    expect(estimateQaCompaction(file([entries[0], entries[1], { ...entries[2], firstKeptEntryId: '' }]), meter)).not.toBeNull()
  })

  it('counts a preserved pre-reset tail in the current context but not the projected QA history', () => {
    const entries = [
      message('u', null, 'user', text('old question')),
      { type: 'reset_boundary', id: 'r', parentId: 'u' },
      message('v', 'r', 'user', text('new question')),
      { type: 'compaction', id: 'c', parentId: 'v', method: 'handoff', summary: 'summary', firstKeptEntryId: 'u' },
    ]
    const current = 'old question'.length + 'new question'.length + 'summary'.length
    expect(estimateQaCompaction(file(entries), meter)).toEqual({
      beforeTokens: 50_000,
      afterTokens: 50_000 - Math.ceil(current / 4) + Math.ceil('new question'.length / 4),
    })
  })

  it('includes preserved branch summaries in the current context', () => {
    const entries = [
      message('u', null, 'user', text('question')),
      { type: 'branch_summary', id: 's', parentId: 'u', summary: 'branch summary' },
      { type: 'compaction', id: 'c', parentId: 's', summary: 'handoff summary', firstKeptEntryId: 's', method: 'handoff' },
    ]
    expect(estimateQaCompaction(file(entries), meter)).toEqual({
      beforeTokens: 50_000,
      afterTokens: 50_000 - Math.ceil(('branch summary'.length + 'handoff summary'.length) / 4) + Math.ceil('question'.length / 4),
    })
  })
})
