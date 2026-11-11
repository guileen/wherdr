import { describe, expect, it } from 'vitest'
import type { ChatItem } from '../shared/types'
import { processSummary } from '../app/utils/processSummary'

const tool = (name: string, text = ''): ChatItem => ({ role: 'tool', name, text, ts: null })
const thinking: ChatItem = { role: 'thinking', text: 'private reasoning', ts: null }
const job: ChatItem = { role: 'job', text: '', ts: null, job: { id: 'bg_2', tool: 'bash', out: 'output' } }

describe('processSummary', () => {
  it('shows recorded thinking only while the segment is live', () => {
    expect(processSummary([], true)).toBe('Thinking')
    expect(processSummary([thinking], true)).toBe('private reasoning')
    expect(processSummary([thinking], false)).toBe('Thinking')
  })

  it('uses the most recent action for live updates, preferring omp intent to command', () => {
    const read: ChatItem = { ...tool('Read', 'old summary'), omp: { title: 'Read', target: 'src/a.ts:1-10', intent: 'Reading source' } }
    expect(processSummary([thinking, tool('Bash', 'pwd'), read], true)).toBe('Reading source')
    expect(processSummary([read, { ...thinking, text: 'Check the result.\nThen continue.' }], true)).toBe('Check the result. Then continue.')
    expect(processSummary([{ ...read, omp: { title: 'Read', target: 'src/a.ts:1-10' } }], true)).toBe('read src/a.ts:1-10')
    expect(processSummary([{ ...read, omp: { title: 'Bash', target: 'git status' } }], true)).toBe('git status')
  })

  it('shows other tool name and text on one line without inventing a target', () => {
    expect(processSummary([tool('Grep', 'foo\nbar')], true)).toBe('Grep · foo bar')
    expect(processSummary([tool('Read')], true)).toBe('Read')
    expect(processSummary([tool('', '')], true)).toBe('Tool')
  })

  it('aggregates consecutive read and edit actions in order, not file counts', () => {
    const items = [tool('Read', 'a'), thinking, tool('Read', 'a'), tool('Edit', 'a'), tool('Write', 'b'), tool('Read', 'c')]
    expect(processSummary(items, false)).toBe('2 reads: a, a · 2 edits: a, b · 1 read: c')
    expect(processSummary([tool('Read', 'a')], false)).toBe('Read · a')
  })

  it('leaves the folded count to the process row and names the last action', () => {
    expect(processSummary([tool('Read', 'a'), thinking, tool('Bash', 'git status')], false)).toBe('Bash · git status')
  })

  it('recognizes background jobs without counting thinking', () => {
    expect(processSummary([thinking, job], true)).toBe('Background job completed · bash bg_2')
    expect(processSummary([tool('Bash', 'start'), job], false)).toBe('Background job completed · bash bg_2')
  })

  it('keeps a failed action visible after a later success and in aggregated runs', () => {
    const bad = { ...tool('Read', 'missing'), error: true }
    expect(processSummary([bad, tool('Read', 'found')], false)).toBe('2 reads: missing, found · Failed · Read · missing')
    expect(processSummary([bad, tool('Bash', 'pwd')], true)).toBe('Bash · pwd · Failed · Read · missing')
    expect(processSummary([bad], true)).toBe('Failed · Read · missing')
    expect(processSummary([{ ...job, error: true }], false)).toBe('Failed · Background job completed · bash bg_2')
  })

  it('recognizes a nonzero omp exit as a failure', () => {
    expect(processSummary([{ ...tool('Bash'), omp: { title: 'Bash', target: 'false', exit: 1 } }], true)).toBe('Failed · false')
  })
})
