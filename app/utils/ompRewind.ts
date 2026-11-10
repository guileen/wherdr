import type { ChatItem } from '#shared/types'

export interface RewindHistory {
  start: number | null
  end: number
  count: number
  partial: boolean
}
export interface RewindSourceRange { start: number, end: number }

// Only journal-backed identities can own expansion state. Never key a cut by its report.
export function rewindKey(item: ChatItem): string | null {
  return item.id ? `rewind:${item.id}` : null
}

export function projectRewinds(
  items: readonly ChatItem[],
  open: ReadonlySet<string>,
  sourceRanges: readonly RewindSourceRange[] = [],
  gapBefore: readonly number[] = [],
) {
  const ranges = [...sourceRanges].sort((a, b) => a.start - b.start)
  const covered: RewindSourceRange[] = []
  for (const range of ranges) {
    const last = covered.at(-1)
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end)
    else covered.push({ ...range })
  }
  const hidden = new Set<number>()
  const cards = new Map<ChatItem, ChatItem>()
  // A summary and its report can be parsed in separate, adjoining API pages.
  // Keep the summary's source identity/anchor and the report's enriched handoff.
  let previous: { item: ChatItem, index: number } | undefined
  items.forEach((item, index) => {
    const rewind = item.rewind
    const prior = previous && (cards.get(previous.item) || previous.item)
    if (rewind?.kind === 'work-package' && rewind.checkpointId && prior?.rewind?.kind === rewind.kind
      && prior.rewind.checkpointId === rewind.checkpointId && prior.rewind.contextChanged === rewind.contextChanged
      && !gapBefore.some(gap => gap > previous!.index && gap <= index)
      && (!ranges.length || (prior.offset !== undefined && item.offset !== undefined && covered.some(range => range.start <= prior.offset! && range.end > item.offset!)))) {
      cards.set(previous!.item, {
        ...prior, text: item.text || prior.text, todos: item.todos ?? prior.todos,
        rewind: { ...prior.rewind, ...rewind, anchorId: prior.rewind.anchorId ?? rewind.anchorId, anchorOffset: prior.rewind.anchorOffset ?? rewind.anchorOffset },
      })
      hidden.add(index)
    } else previous = rewind ? { item, index } : undefined
  })
  const duplicates = new Set(hidden)
  const histories = new Map<ChatItem, RewindHistory>()
  items.forEach((item, end) => {
    if (duplicates.has(end)) return
    const rewind = (cards.get(item) || item).rewind
    if (!rewind) return
    let start: number | null = null
    let boundary = -1
    if (rewind.contextChanged && rewindKey(item)) {
      if (rewind.anchorOffset !== undefined) {
        const anchor = rewind.anchorOffset
        const exact = items.findIndex((row, index) => index < end && row.offset === anchor)
        const continuous = item.offset !== undefined && covered.some(range => range.start <= anchor && range.end > item.offset!)
        if ((exact >= 0 && !ranges.length) || continuous) {
          const first = items.findIndex((row, index) => index < end && row.offset !== undefined && row.offset > anchor)
          start = first >= 0 ? first : end
          boundary = exact >= 0 ? exact : start
          // Missing source positions cannot safely be assigned to either side of an offset.
          if (items.slice(start, end).some(row => row.offset === undefined)) start = null
        }
      } else if (rewind.kind === 'work-package' && rewind.checkpointId) {
        boundary = items.findLastIndex((row, index) => index < end && !row.error && row.ompContext?.checkpointId === rewind.checkpointId)
        if (boundary >= 0) start = boundary + 1
      } else if (rewind.kind === 'search' && rewind.searchId) {
        boundary = items.findIndex((row, index) => index < end && !row.error && row.ompContext?.searchId === rewind.searchId)
        if (boundary >= 0) {
          start = boundary
          const entryId = items[boundary]!.ompContext?.entryId
          if (entryId) {
            while (start > 0 && items[start - 1]!.ompContext?.entryId === entryId) start--
            boundary = start
          } else start = null
        }
      }
      if (start !== null && gapBefore.some(gap => gap > boundary && gap <= end)) start = null
      if (start !== null && ranges.length) {
        const from = rewind.anchorOffset ?? items[boundary]?.offset
        const to = item.offset
        if (from === undefined || to === undefined || !covered.some(range => range.start <= from && range.end > to)) start = null
      }
    }
    const count = start === null ? 0 : items.slice(start, end).filter((_, index) => !duplicates.has(start! + index)).length
    const history = { start, end, count, partial: rewind.contextChanged && start === null }
    histories.set(item, history)
    const key = rewindKey(item)
    if (start !== null && key && !open.has(key)) for (let index = start; index < end; index++) hidden.add(index)
  })
  return { hidden, histories, cards, duplicates }
}
