// Lines of an edit's diff, for the output panes: omp writes its hashline form
// (" 14|context", "+15|added", "-16|removed"), a patch's unified form has no
// numbers ("+added", "-removed"), and headers ("@@", "*** Begin Patch") mark a
// hunk. The number is the line's own side of the file: the old one for a
// removal, the new one for an addition.
export interface OmpDiffRow {
  kind: 'add' | 'del' | 'ctx' | 'hunk' | 'raw'
  sign: string
  num: string
  text: string
}

const HUNK = /^(?:@@|diff --git |index [0-9a-f]{7,}\.\.[0-9a-f]+ |--- |\+\+\+ |\*\*\* )/
const HASHLINE = /^([ +\-])\s*(\d+)\|(.*)$/

export function parseOmpDiff(text: string): OmpDiffRow[] {
  return text.split('\n').map((line) => {
    const m = HASHLINE.exec(line)
    if (m) {
      const sign = m[1] === ' ' ? ' ' : m[1]!
      return { kind: sign === '+' ? 'add' : sign === '-' ? 'del' : 'ctx', sign, num: m[2]!, text: m[3]! }
    }
    if (HUNK.test(line)) return { kind: 'hunk', sign: '', num: '', text: line }
    if (line.startsWith('+')) return { kind: 'add', sign: '+', num: '', text: line.slice(1) }
    if (line.startsWith('-')) return { kind: 'del', sign: '-', num: '', text: line.slice(1) }
    if (line.startsWith(' ')) return { kind: 'ctx', sign: ' ', num: '', text: line.slice(1) }
    return line ? { kind: 'raw', sign: '', num: '', text: line } : { kind: 'ctx', sign: ' ', num: '', text: '' }
  })
}

// Width of the widest line number, in digits: every number is right-aligned in
// that column, so the code of every row starts on the same x.
export function diffNumberWidth(rows: readonly OmpDiffRow[]): number {
  return rows.reduce((n, row) => Math.max(n, row.num.length), 0)
}

// Lines of the whole diff that the recorded excerpt does not show.
export function diffMore(rows: readonly OmpDiffRow[], total?: number): number {
  return Math.max(0, (total || 0) - rows.length)
}
