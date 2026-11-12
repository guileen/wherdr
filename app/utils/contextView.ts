import type { ContextChainItem, ContextChainKind } from '../../shared/types'

// The loaded-context screen mirrors the request fragment by fragment: the bar
// is one block per fragment (fixed load included), and the vertical list keeps
// the same send order entry by entry.
export type ContextTone = 'system' | 'tools' | 'memory' | 'daynotes' | 'inject' | 'compaction' | 'work' | 'free'

export interface ContextFragment {
  key: string
  tone: ContextTone
  tokens: number
  // Index in the chain, or -1 for the fixed-load blocks.
  index: number
}

// Colour follows what the entry is, not which layer it aggregates into: an
// injected notice keeps its own tone inside the conversation.
export const contextTone = (kind: ContextChainKind): ContextTone =>
  kind === 'memory' ? 'memory'
  : kind === 'daynote' ? 'daynotes'
  : kind === 'inject' ? 'inject'
  : kind === 'compaction' ? 'compaction'
  : 'work'

export function contextFragments(items: ContextChainItem[], fixed: { system: number, tools: number } | null): ContextFragment[] {
  const out: ContextFragment[] = []
  if (fixed && fixed.system > 0) out.push({ key: 'system', tone: 'system', tokens: fixed.system, index: -1 })
  if (fixed && fixed.tools > 0) out.push({ key: 'tools', tone: 'tools', tokens: fixed.tools, index: -1 })
  for (const [index, item] of items.entries()) {
    if (!(item.tokens > 0)) continue
    out.push({ key: `i${index}`, tone: contextTone(item.kind), tokens: item.tokens, index })
  }
  return out
}

// Adjacent fragments of the same kind draw as one run: the order is still the
// send order, but a 159-fragment bar stops reading as a barcode. The run keeps
// the first fragment's key, so a tap still lands where the run starts.
export function mergeToneRuns(segments: ContextFragment[]): ContextFragment[] {
  const out: ContextFragment[] = []
  for (const seg of segments) {
    const last = out[out.length - 1]
    if (last && last.tone === seg.tone && last.index < 0 === seg.index < 0) {
      last.tokens += seg.tokens
      continue
    }
    out.push({ ...seg })
  }
  return out
}
