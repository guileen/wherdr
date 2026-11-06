import { describe, expect, it } from 'vitest'
import { readingPosition, saveReadingPosition, type ReadingPosition } from '../app/utils/readingPosition'

const position = (file: string, key: string): ReadingPosition => ({
  file, anchor: { key, textOffset: 42, text: 'The passage being read', viewportOffset: -8, sourceOffset: 8192 },
  hasNewBelow: true, latest: { key: 'last-reply', text: 'Last observed output' },
})

describe('conversation reading context', () => {
  it('isolates panes and rejects a different source instead of restoring unrelated content', () => {
    saveReadingPosition('position-a', position('a.jsonl', 'source-a'))
    saveReadingPosition('position-b', position('b.jsonl', 'source-b'))
    expect(readingPosition('position-a', 'b.jsonl')).toBeNull()
    expect(readingPosition('position-b', 'b.jsonl')?.anchor.key).toBe('source-b')
    expect(readingPosition('missing-pane', 'a.jsonl')).toBeNull()
    expect(readingPosition('position-a', 'a.jsonl')?.anchor).toMatchObject({ key: 'source-a', textOffset: 42, viewportOffset: -8 })
  })
  it('returning in follow mode forgets the previous reading anchor and new-output indication', () => {
    saveReadingPosition('position-follow', position('a.jsonl', 'source-a'))
    saveReadingPosition('position-follow', null)
    expect(readingPosition('position-follow', 'a.jsonl')).toBeNull()
  })
  it('bounds retained conversations and refreshes the most recently saved position', () => {
    for (let i = 0; i < 50; i++) saveReadingPosition(`position-limit-${i}`, position('a.jsonl', `source-${i}`))
    saveReadingPosition('position-limit-0', position('a.jsonl', 'updated-source'))
    saveReadingPosition('position-limit-50', position('a.jsonl', 'source-50'))
    expect(readingPosition('position-limit-1', 'a.jsonl')).toBeNull()
    expect(readingPosition('position-limit-0', 'a.jsonl')?.anchor.key).toBe('updated-source')
  })
})
