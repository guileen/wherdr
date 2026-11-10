// An edit's diff split into rows (OmpDiff.vue): omp's hashline form keeps each
// line's own number, a patch's unified form has none, and headers stay apart.
import { describe, expect, it } from 'vitest'
import { diffMore, diffNumberWidth, parseOmpDiff } from '../app/utils/ompDiff'

describe('edit diff rows', () => {
  it('reads omp hashline rows with their own side number', () => {
    const rows = parseOmpDiff(' 13|\n 14|## Queue\n+15|- [ ] new task\n-16|- [ ] old task\n+16|- [ ] other')
    expect(rows).toEqual([
      { kind: 'ctx', sign: ' ', num: '13', text: '' },
      { kind: 'ctx', sign: ' ', num: '14', text: '## Queue' },
      { kind: 'add', sign: '+', num: '15', text: '- [ ] new task' },
      { kind: 'del', sign: '-', num: '16', text: '- [ ] old task' },
      { kind: 'add', sign: '+', num: '16', text: '- [ ] other' },
    ])
  })

  it('accepts a space between the sign and the number', () => {
    expect(parseOmpDiff('+ 9|added')).toEqual([{ kind: 'add', sign: '+', num: '9', text: 'added' }])
  })

  it('reads a plain unified diff and its headers', () => {
    const rows = parseOmpDiff('*** Begin Patch\n*** Update File: src/a.ts\n@@ section\n-const a = 1\n+const a = 2\n context\n*** End Patch')
    expect(rows.map(r => r.kind)).toEqual(['hunk', 'hunk', 'hunk', 'del', 'add', 'ctx', 'hunk'])
    expect(rows[3]).toEqual({ kind: 'del', sign: '-', num: '', text: 'const a = 1' })
    expect(rows[4]).toEqual({ kind: 'add', sign: '+', num: '', text: 'const a = 2' })
    expect(rows[2]!.text).toBe('@@ section')
  })

  it('keeps unknown lines apart instead of reading them as changes', () => {
    expect(parseOmpDiff('diff --git a/x b/x\n\\ No newline at end of file')[1]).toEqual({ kind: 'raw', sign: '', num: '', text: '\\ No newline at end of file' })
  })

  it('aligns every number on the widest one', () => {
    const rows = parseOmpDiff(' 9|a\n+100|b')
    expect(diffNumberWidth(rows)).toBe(3)
    expect(diffNumberWidth(parseOmpDiff('-a\n+b'))).toBe(0)
  })

  it('counts the lines the recorded excerpt left out', () => {
    const rows = parseOmpDiff(' 1|a\n 2|b')
    expect(diffMore(rows, 2)).toBe(0)
    expect(diffMore(rows, 17)).toBe(15)
    expect(diffMore(rows)).toBe(0)
  })
})
