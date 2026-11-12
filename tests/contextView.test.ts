import { expect, it } from 'vitest'
import type { ContextChainItem, ContextChainKind } from '../shared/types'
import { contextFragments, contextTone, mergeToneRuns, type ContextFragment } from '../app/utils/contextView'
import { contextSegments } from '../app/utils/meters'

const item = (kind: ContextChainKind, role: string, tokens: number): ContextChainItem =>
  ({ kind, role, text: 'x'.repeat(tokens * 4), chars: tokens * 4, tokens })

const chain: ContextChainItem[] = [
  item('message', 'user', 5_000),
  item('inject', 'system-reminder', 1_000),
  item('memory', 'memory', 2_000),
  item('daynote', 'day note', 1_000),
  item('compaction', 'compaction', 3_000),
  item('message', 'assistant', 4_000),
  item('message', 'toolResult', 0),
]

it('builds one fragment per entry in send order, fixed load first', () => {
  const fragments = contextFragments(chain, { system: 20_000, tools: 10_000 })
  expect(fragments.map(f => f.key)).toEqual(['system', 'tools', 'i0', 'i1', 'i2', 'i3', 'i4', 'i5'])
  expect(fragments.map(f => f.tone)).toEqual(['system', 'tools', 'work', 'inject', 'memory', 'daynotes', 'compaction', 'work'])
  expect(fragments.map(f => f.tokens)).toEqual([20_000, 10_000, 5_000, 1_000, 2_000, 1_000, 3_000, 4_000])
  // A zero-token entry is not a fragment: it would render as a 0-width block.
  expect(fragments.some(f => f.key === 'i6')).toBe(false)
  expect(contextFragments(chain, null).map(f => f.key)).toEqual(['i0', 'i1', 'i2', 'i3', 'i4', 'i5'])
})

it('maps every kind onto exactly one tone', () => {
  const kinds: ContextChainKind[] = ['message', 'inject', 'compaction', 'memory', 'daynote']
  expect(kinds.map(contextTone)).toEqual(['work', 'inject', 'compaction', 'memory', 'daynotes'])
})

it('does not draw the free remainder', () => {
  // Free is the empty rest of the window, not a fragment of the request.
  expect(contextFragments(chain, { system: 20_000, tools: 10_000 }).some(f => f.tone === 'free')).toBe(false)
  expect(contextFragments(chain, null).map(f => f.key)).toEqual(['i0', 'i1', 'i2', 'i3', 'i4', 'i5'])
})

it('coarse segments are the per-layer sums of the fragments, in the same order', () => {
  const fragments = contextFragments(chain, { system: 20_000, tools: 10_000 })
  const sum = (tones: string[]) => fragments.filter(f => tones.includes(f.tone)).reduce((n, f) => n + f.tokens, 0)
  const coarse = contextSegments({ system: 20_000, tools: 10_000, memory: 2_000, daynotes: 1_000, work: 13_000, free: 900_000 })
  expect(coarse.map(seg => seg.key)).toEqual(['system', 'tools', 'memory', 'daynotes', 'work'])
  expect(coarse.map(seg => seg.tokens)).toEqual([
    sum(['system']),
    sum(['tools']),
    sum(['memory']),
    sum(['daynotes']),
    sum(['work', 'inject', 'compaction']),
  ])
  // Order is never the size order: the empty layer is dropped, the rest stays put.
  expect(coarse.map(seg => seg.key)).not.toEqual(['free', 'work', 'system', 'tools', 'memory', 'daynotes'])
})

it('draws adjacent fragments of the same kind as one run, order unchanged', () => {
  const frags: ContextFragment[] = [
    { key: 'a', tone: 'work', tokens: 10, index: 0 },
    { key: 'b', tone: 'work', tokens: 5, index: 1 },
    { key: 'c', tone: 'inject', tokens: 2, index: 2 },
    { key: 'd', tone: 'work', tokens: 3, index: 3 },
  ]
  expect(mergeToneRuns(frags)).toEqual([
    { key: 'a', tone: 'work', tokens: 15, index: 0 },
    { key: 'c', tone: 'inject', tokens: 2, index: 2 },
    { key: 'd', tone: 'work', tokens: 3, index: 3 },
  ])
})
