import { describe, expect, it } from 'vitest'
import { parseLines } from '../server/utils/transcripts'

const journal = (records: object[], base = 0) => parseLines(records.map(record => JSON.stringify(record)).join('\n'), 'omp', base)
const entry = (id: string, message: object) => ({ type: 'message', id, message })
const call = (id: string, name: string, args: object = {}) => ({ type: 'toolCall', id, name, arguments: args })
const result = (toolCallId: string, toolName: string, details: object = {}, extra: object = {}) => ({ role: 'toolResult', toolCallId, toolName, details, ...extra })
const hidden = (id: string, customType: string, details: object, content = '') => ({ type: 'custom_message', id, customType, details, content, display: false })
const macro = { kind: 'work-package-rewind', checkpointId: 'package-1', report: 'Implemented the parser.', nextAction: 'Review the caller.', outcome: 'completed', contextChanged: true }
const todos = { phases: [{ name: 'Build', tasks: [{ content: 'Implement parser', status: 'completed' }] }] }

describe('committed omp rewind journal', () => {
  it('retains selected code and continuation on the actual search cut without exposing hidden prompts', () => {
    const material = { ref: 'source-1', path: 'src/a.ts', tag: 'ABCD', first: 5, last: 6, body: '5:const answer = 42\n6:return answer' }
    const items = journal([
      entry('anchor', { role: 'user', content: 'Locate the parser.' }),
      entry('search-batch', { role: 'assistant', content: [call('grep-1', 'grep')] }),
      entry('search-result', result('grep-1', 'grep', {}, { content: [{ type: 'text', text: 'src/a.ts\nsearchId=search-1' }] })),
      { type: 'branch_summary', id: 'cut-1', parentId: 'anchor', fromId: 'anchor', summary: '', details: { kind: 'search-rewind', searchId: 'search-1' } },
      hidden('refs', 'search-rewind-state', { activeRefs: ['source-1'] }),
      hidden('material', 'search-material', material, 'PRIVATE MATERIAL PROMPT'),
      hidden('decision', 'search-decision', {}, 'Located the parser; inspect its caller.'),
      { type: 'custom', id: 'todo', customType: 'user_todo_edit', data: todos },
      hidden('state', 'work-package-state', { checkpoint: null }),
      hidden('prompt', 'checkpoint-active-reminder', {}, 'PRIVATE CHECKPOINT PROMPT'),
      entry('next', { role: 'assistant', content: [{ type: 'text', text: 'Now reviewing.' }] }),
    ])
    const card = items.find(item => item.rewind)!
    expect(card).toMatchObject({ role: 'notice', name: 'context-rewind', text: 'Located the parser; inspect its caller.', offset: expect.any(Number), id: expect.any(String), todos: [{ text: 'Implement parser', status: 'completed' }] })
    expect(card.rewind).toEqual({ kind: 'search', contextChanged: true, anchorId: 'anchor', anchorOffset: 0, searchId: 'search-1', nextAction: 'Located the parser; inspect its caller.', materials: [material] })
    expect(items.find(item => item.role === 'tool')!.ompContext).toEqual({ entryId: 'search-batch', toolCallId: 'grep-1', searchId: 'search-1' })
    expect(JSON.stringify(items)).not.toContain('PRIVATE')
    expect(items.at(-1)!.text).toBe('Now reviewing.')
  })

  it('deduplicates the macro summary and report while retaining the authored report, parent, and canonical todo snapshot', () => {
    const items = journal([
      hidden('anchor', 'checkpoint-active-reminder', {}, 'PRIVATE ANCHOR'),
      { type: 'branch_summary', id: 'macro-cut', parentId: 'anchor', fromId: 'anchor', summary: macro.report, details: macro },
      hidden('report', 'rewind-report', { ...macro, parent: { checkpointId: 'outer-package' } }, 'PRIVATE MODEL REPORT WRAPPER'),
      { type: 'custom', customType: 'user_todo_edit', data: todos },
    ], 400)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ text: macro.report, rewind: { kind: 'work-package', contextChanged: true, anchorId: 'anchor', anchorOffset: 400, checkpointId: 'package-1', parentId: 'outer-package', outcome: 'completed', nextAction: macro.nextAction }, todos: [{ text: 'Implement parser', status: 'completed' }] })
    expect(JSON.stringify(items)).not.toContain('PRIVATE')
    expect(journal([
      hidden('anchor', 'checkpoint-active-reminder', {}, 'PRIVATE ANCHOR'),
      { type: 'branch_summary', id: 'macro-cut', parentId: 'anchor', fromId: 'anchor', summary: macro.report, details: macro },
    ], 400)[0]!.id).toBe(items[0]!.id)
  })

  it('shows explicit no-cut completion without inventing a history boundary', () => {
    const items = journal([
      entry('user', { role: 'user', content: 'Keep this visible.' }),
      hidden('no-cut', 'rewind-report', { ...macro, contextChanged: false }, macro.nextAction),
      { type: 'custom', customType: 'user_todo_edit', data: { phases: [] } },
    ])
    expect(items).toHaveLength(2)
    expect(items[1]).toMatchObject({ text: macro.report, rewind: { kind: 'work-package', contextChanged: false, checkpointId: 'package-1' }, todos: [] })
    expect(items[1]!.rewind!.anchorOffset).toBeUndefined()
    expect(items[1]!.rewind!.anchorId).toBeUndefined()
  })

  it('never treats a successful request, accepted result, or failed rewind as a committed cut', () => {
    const items = journal([
      entry('calls', { role: 'assistant', content: [call('requested', 'rewind'), call('accepted', 'write', { path: 'xd://rewind', content: '{}' }), call('failed', 'rewind')] }),
      entry('request-result', result('requested', 'rewind', { rewound: true, checkpointId: 'package-1', report: 'Requested only.' })),
      entry('accepted-result', result('accepted', 'write', { xdev: { tool: 'rewind', mode: 'execute', inner: { rewound: true, report: 'Accepted only.' } } })),
      entry('failed-result', result('failed', 'rewind', { rewound: true }, { isError: true })),
      hidden('uncommitted-report', 'rewind-report', { report: 'No contextChanged authority.' }, 'PRIVATE REPORT'),
    ])
    expect(items.filter(item => item.rewind)).toEqual([])
    expect(items.find(item => item.ompContext?.toolCallId === 'failed')!.error).toBe(true)
  })

  it('supports report-only compacted pages without guessing an anchor or showing model framing', () => {
    const items = journal([
      hidden('report', 'rewind-report', macro, 'PRIVATE MODEL WRAPPER'),
      hidden('orphan-material', 'search-material', { ref: 'not-this-cut', path: 'secret.ts', body: 'PRIVATE SOURCE' }),
    ], 9000)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ offset: 9000, text: macro.report, rewind: { kind: 'work-package', contextChanged: true, checkpointId: 'package-1' } })
    expect(items[0]!.rewind!.anchorOffset).toBeUndefined()
    expect(items[0]!.rewind!.materials).toBeUndefined()
    expect(JSON.stringify(items)).not.toContain('PRIVATE')
  })

  it('leaves an unavailable search anchor undefined and does not attach orphaned materials to another cut', () => {
    const items = journal([
      hidden('orphan', 'search-material', { ref: 'old', path: 'old.ts', body: 'orphan' }),
      { type: 'branch_summary', id: 'cut', parentId: 'outside-window', details: { kind: 'search-rewind', searchId: 'search-2' } },
      hidden('decision', 'search-decision', {}, 'Continue.'),
      entry('user', { role: 'user', content: 'New instruction.' }),
      hidden('unrelated', 'search-material', { ref: 'new', path: 'other.ts', body: 'not retained by this cut' }),
      { type: 'custom', customType: 'user_todo_edit', data: todos },
    ], 1000)
    const card = items.find(item => item.rewind)!
    expect(card.rewind).toEqual({ kind: 'search', contextChanged: true, anchorId: 'outside-window', searchId: 'search-2', nextAction: 'Continue.' })
    expect(card.todos).toBeUndefined()
    expect(items.at(-1)!.text).toBe('New instruction.')
  })

  it.each(['native', 'xd', 'xd-prefixed'] as const)('exposes only successful actual %s checkpoint result boundaries, even without the call in the page', transport => {
    const toolName = transport === 'xd' ? 'write' : transport === 'xd-prefixed' ? 'xd://checkpoint' : 'checkpoint'
    const details = transport === 'xd' ? { xdev: { tool: 'checkpoint', mode: 'execute', inner: { checkpointId: 'package-1', goal: 'Inspect parser' } } } : { checkpointId: 'package-1', goal: 'Inspect parser' }
    const items = journal([
      entry('checkpoint-result', result('checkpoint-call', toolName, details)),
      entry('failed-result', result('failed-call', toolName, details, { isError: true })),
    ], 1234)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ role: 'system', text: 'Work package checkpoint recorded', offset: 1234, ompContext: { entryId: 'checkpoint-result', toolCallId: 'checkpoint-call', checkpointId: 'package-1' } })
  })

  it.each(['grep', 'find'])('uses annotated xd %s results and the original assistant batch identity, never failed results', name => {
    const args = { path: 'src', i: 'Locating entry point' }
    const items = journal([
      entry('batch', { role: 'assistant', content: [{ type: 'text', text: 'Looking.' }, call('locating-call', 'write', { path: `xd://${name}`, content: JSON.stringify(args) }), call('failed-call', name)] }),
      entry('xd-result', result('locating-call', 'write', { xdev: { tool: name, mode: 'execute', inner: {} } }, { content: [{ type: 'text', text: 'src/a.ts' }, { type: 'text', text: 'searchId=sopaque' }] })),
      entry('failed', result('failed-call', name, {}, { isError: true, content: [{ type: 'text', text: 'searchId=sfake' }] })),
    ])
    expect(items.find(item => item.ompContext?.toolCallId === 'locating-call')!.ompContext).toEqual({ entryId: 'batch', toolCallId: 'locating-call', searchId: 'sopaque' })
    expect(items.find(item => item.ompContext?.toolCallId === 'failed-call')!.ompContext?.searchId).toBeUndefined()
    expect(items[0]!.ompContext).toEqual({ entryId: 'batch' })
  })

  it('keeps the checkpoint boundary at the result, after sibling locating actions, not at the call', () => {
    const records = [
      entry('batch', { role: 'assistant', content: [call('checkpoint-call', 'checkpoint'), call('locate', 'find')] }),
      entry('located', result('locate', 'find', {}, { content: [{ type: 'text', text: 'searchId=search-1' }] })),
      entry('checkpoint-result', result('checkpoint-call', 'checkpoint', { checkpointId: 'package-1' })),
    ]
    const items = journal(records, 200)
    const marker = items.find(item => item.ompContext?.checkpointId)!
    expect(marker.offset).toBe(200 + records.slice(0, 2).reduce((total, record) => total + Buffer.byteLength(JSON.stringify(record)) + 1, 0))
    expect(marker.ompContext?.entryId).toBe('checkpoint-result')
    expect(items.find(item => item.ompContext?.toolCallId === 'checkpoint-call' && item.role === 'tool')!.ompContext?.checkpointId).toBeUndefined()
    expect(items.find(item => item.ompContext?.searchId)!.ompContext?.entryId).toBe('batch')
  })

  it('ignores device previews and unannotated or orphan locating results as boundary evidence', () => {
    const items = journal([
      entry('batch', { role: 'assistant', content: [call('preview', 'write', { path: 'xd://find' }), call('unannotated', 'grep'), call('ordinary-write', 'write')] }),
      entry('preview-result', result('preview', 'write', { xdev: { tool: 'find', mode: 'preview' } }, { content: [{ type: 'text', text: 'searchId=preview' }] })),
      entry('unannotated-result', result('unannotated', 'grep', { searchId: 'not-delivered' }, { content: [{ type: 'text', text: 'src/a.ts' }] })),
      entry('write-result', result('ordinary-write', 'write', {}, { content: [{ type: 'text', text: 'searchId=not-a-search' }] })),
      entry('orphan-result', result('outside-page', 'find', {}, { content: [{ type: 'text', text: 'searchId=orphan' }] })),
      entry('checkpoint-preview', result('checkpoint-preview', 'write', { xdev: { tool: 'checkpoint', mode: 'preview', inner: { checkpointId: 'preview' } } })),
    ])
    expect(items).toHaveLength(3)
    expect(items.every(item => !item.ompContext?.searchId && !item.ompContext?.checkpointId)).toBe(true)
  })

  it('attaches each search selection only to its own committed transition and leaves earlier card identities stable', () => {
    const records = [
      { type: 'branch_summary', id: 'first-cut', parentId: 'outside', details: { kind: 'search-rewind', searchId: 'search-1' } },
      hidden('first-material', 'search-material', { ref: 'first', path: 'first.ts', body: 'const first = 1' }),
      hidden('first-decision', 'search-decision', {}, 'Follow the first caller.'),
      hidden('first-state', 'work-package-state', { checkpoint: null }),
      entry('second-batch', { role: 'assistant', content: [call('second-search', 'find')] }),
      { type: 'branch_summary', id: 'second-cut', parentId: 'first-cut', details: { kind: 'search-rewind', searchId: 'search-2' } },
      hidden('second-material', 'search-material', { ref: 'second', path: 'second.ts', note: 'Caller confirmed.' }),
      hidden('second-decision', 'search-decision', {}, 'Inspect the second caller.'),
    ]
    const cards = journal(records).filter(item => item.rewind)
    expect(cards).toHaveLength(2)
    expect(cards.map(item => item.rewind!.materials)).toEqual([[{ ref: 'first', path: 'first.ts', body: 'const first = 1' }], [{ ref: 'second', path: 'second.ts', note: 'Caller confirmed.' }]])
    expect(cards[0]!.id).toBe(journal(records.slice(0, 4))[0]!.id)
    expect(cards[1]!.rewind!.anchorOffset).toBe(cards[0]!.offset)
  })

  it('resolves hidden anchors using absolute UTF-8 source positions rather than visible item indices', () => {
    const records = [entry('user', { role: 'user', content: 'Find café.' }), hidden('hidden-anchor', 'checkpoint-active-reminder', {}, 'Hidden.'), { type: 'branch_summary', id: 'cut', parentId: 'hidden-anchor', details: { kind: 'search-rewind', searchId: 'search-1' } }]
    const items = journal(records, 600)
    expect(items.find(item => item.rewind)!.rewind!.anchorOffset).toBe(600 + Buffer.byteLength(JSON.stringify(records[0])) + 1)
    expect(items[0]!.offset).toBe(600)
  })
})
