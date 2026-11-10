import { describe, expect, it } from 'vitest'
import type { ChatItem } from '../shared/types'
import { projectRewinds, rewindKey } from '../app/utils/ompRewind'
import { rewindItems } from './fixtures/ompRewind'

const range = [{ start: 0, end: 1000 }]
const ids = (items: ChatItem[], hidden: Set<number>) => items.filter((_, index) => !hidden.has(index)).map(item => item.id)

describe('journal-backed rewind history', () => {
  it('collapses nested retired ranges once, leaving handoff, no-cut and subsequent work outside', () => {
    const items = rewindItems()
    const closed = projectRewinds(items, new Set(), range)
    expect(ids(items, closed.hidden)).toEqual(['request', 'checkpoint', 'parent-cut', 'no-cut', 'current-request', 'current-call', 'current-reply'])
    const parentOpen = new Set([rewindKey(items[6]!)!])
    expect(ids(items, projectRewinds(items, parentOpen, range).hidden)).toContain('search-cut')
    expect(ids(items, projectRewinds(items, parentOpen, range).hidden)).not.toContain('search-call')
    parentOpen.add(rewindKey(items[4]!)!)
    expect(projectRewinds(items, parentOpen, range).hidden.size).toBe(0)
  })

  it('finds a hidden raw anchor only inside explicitly loaded continuous source ranges', () => {
    const items = rewindItems().filter(item => item.id !== 'checkpoint')
    const projection = projectRewinds(items, new Set(), range)
    expect(projection.histories.get(items.find(item => item.id === 'parent-cut')!)?.partial).toBe(false)
    expect(projection.hidden.has(items.findIndex(item => item.id === 'search-call'))).toBe(true)
    const partial = projectRewinds(items, new Set(), [{ start: 200, end: 1000 }])
    expect(partial.hidden.size).toBe(0)
    expect([...partial.histories.values()].filter(history => history.partial)).toHaveLength(2)
  })

  it('resolves checkpoint results and the exact assistant search batch across loaded pages', () => {
    const items = rewindItems()
    items[4]!.rewind!.anchorOffset = undefined
    items[6]!.rewind!.anchorOffset = undefined
    const projection = projectRewinds(items, new Set(), range)
    expect(projection.histories.get(items[4]!)?.start).toBe(2)
    expect(projection.histories.get(items[6]!)?.start).toBe(2)
    const prepended: ChatItem = { id: 'older', offset: -10, role: 'user', text: 'Unrelated earlier request', ts: null }
    const open = new Set([rewindKey(items[6]!)!, rewindKey(items[4]!)!])
    const next = projectRewinds([prepended, ...structuredClone(items)], open)
    expect(next.hidden.size).toBe(0)
    expect(rewindKey(items[6]!)).toBe(rewindKey(structuredClone(items[6]!)))
  })

  it('does not bridge pagination gaps or hide unrelated content for an unresolved or failed boundary', () => {
    const items = rewindItems()
    const partial = projectRewinds(items, new Set(), [{ start: 0, end: 250 }, { start: 350, end: 1000 }], [4])
    expect(partial.hidden.size).toBe(0)
    items[4]!.rewind!.anchorOffset = undefined
    items[6]!.rewind!.anchorOffset = undefined
    items[1]!.error = true
    items[3]!.error = true
    expect(projectRewinds(items, new Set()).hidden.size).toBe(0)
    expect(projectRewinds(items, new Set()).histories.get(items[6]!)?.partial).toBe(true)
  })

  it('never treats merely accepted calls or a no-cut closure as a cut', () => {
    const items = rewindItems().filter(item => !item.rewind || !item.rewind.contextChanged)
    items.splice(2, 0, { id: 'accepted', role: 'tool', name: 'write', text: 'xd://work-package', out: '{"accepted":true}', ts: null })
    expect(projectRewinds(items, new Set(), range).hidden.size).toBe(0)
    const noCut = items.find(item => item.id === 'no-cut')!
    expect(projectRewinds(items, new Set(), range).histories.get(noCut)).toMatchObject({ partial: false, count: 0, start: null })
  })

  it('coalesces only adjacent same-checkpoint macro summary/report copies without mutating input', () => {
    const items = rewindItems()
    const summary = items[6]!
    const report: ChatItem = { ...structuredClone(summary), id: 'separate-report', offset: 550, text: 'Enriched handoff.', rewind: { ...summary.rewind!, anchorOffset: undefined, parentId: 'reported-parent' }, todos: [{ text: 'Outer work', status: 'in_progress' }] }
    items.splice(7, 0, report)
    const before = structuredClone(items)
    const projection = projectRewinds(items, new Set([rewindKey(summary)!]), range)
    expect(projection.duplicates).toEqual(new Set([7]))
    expect(projection.cards.get(summary)).toMatchObject({ id: 'parent-cut', text: 'Enriched handoff.', rewind: { anchorOffset: 100, parentId: 'reported-parent' }, todos: report.todos })
    expect(projection.histories.has(report)).toBe(false)
    expect(items).toEqual(before)
    const work: ChatItem = { id: 'intervening-work', role: 'assistant', text: 'Real work between closures.', ts: null }
    expect(projectRewinds([summary, work, report], new Set()).duplicates.size).toBe(0)
    expect(projectRewinds([summary, report], new Set(), [], [1]).duplicates.size).toBe(0)
    expect(projectRewinds([summary, { ...report, rewind: { ...report.rewind!, checkpointId: 'different-child' } }], new Set()).duplicates.size).toBe(0)
  })
})
