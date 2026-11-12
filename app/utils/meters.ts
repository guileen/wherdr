import { isKeyLegend, tabsOfRow } from '../../shared/settingsScreen'

// Usage gauges read from a command's screen (Claude Code's /usage,
// Codex's /status), to show them as native bars:
//   Claude:  "Current session" / "████   8% used" / "Resets 2pm (…)"
//   Codex :  "5h limit: [████░░░░] 43% left" / "(resets 15:08)"
// `kind` keeps the direction shown by the agent: "used" (Claude) or "left" (Codex).
export interface Meter { label: string, pct: number, kind: 'used' | 'left', reset: string | null }

const CONTEXT = /◫\s*(\d+(?:\.\d+)?)%\s*\/\s*(\d+(?:\.\d+)?)\s*([kKmM])?\b/
const BORDER_CONTEXT = /^▶[─━│┃╎┆┊:|\s\u{f055d}\u{f0068}-]*(\d+(?:\.\d+)?)%[─━│┃╎┆┊:|\s\u{f055d}\u{f0068}-]*(\d+(?:\.\d+)?)([kKmM])?[─━│┃╎┆┊:|\s\u{f055d}\u{f0068}-]*◀?$/u
const OVERFLOW_CONTEXT = /^▶[─━│┃╎┆┊:|\s\u{f055d}\u{f0068}-]*(\d+(?:\.\d+)?)([kKmM])?[─━│┃╎┆┊:|\s\u{f055d}\u{f0068}-]+(\d+(?:\.\d+)?)%[─━│┃╎┆┊:|\s\u{f055d}\u{f0068}-]*◀$/u

// omp's footer reports a rounded percentage, not an exact token count.
export function parseOmpContext(text: string | null | undefined): { pct: number, total: number, estimated: number } | null {
  const match = CONTEXT.exec(text || '') || BORDER_CONTEXT.exec(text?.trim() || '')
  const overflow = match ? null : OVERFLOW_CONTEXT.exec(text?.trim() || '')
  if (!match && !overflow) return null
  const pct = Number(match?.[1] ?? overflow?.[3])
  const unit = (match?.[3] ?? overflow?.[2])?.toUpperCase()
  const total = Number(match?.[2] ?? overflow?.[1]) * (unit === 'M' ? 1_000_000 : unit === 'K' ? 1_000 : 1)
  if (!Number.isFinite(pct) || !Number.isFinite(total) || total <= 0) return null
  return { pct, total, estimated: total * pct / 100 }
}

// Split of the context window shown by the structure bar. omp's footer gives
// only a rounded share, so the parts omp records in the session file come out
// of the used tokens first: the fixed load (system prompt, tool schemas) and
// the two memory layers (remembered lines, then day notes). What remains is the
// work of the conversation. Free is what the round does not fill. Without a
// breakdown the whole used share is drawn as work, which keeps the plain share
// bar.
export interface ContextParts { system: number, tools: number, memory: number, daynotes: number, work: number, free: number }
export function contextParts(c: { pct: number, total: number, estimated: number }, breakdown?: { nonMessage: number, tools: number, memory?: number, daynotes?: number } | null): ContextParts {
  const used = Math.min(c.total, Math.max(0, c.estimated))
  if (!breakdown || !Number.isFinite(breakdown.nonMessage) || breakdown.nonMessage <= 0) {
    return { system: 0, tools: 0, memory: 0, daynotes: 0, work: used, free: c.total - used }
  }
  const nonMessage = Math.min(used, breakdown.nonMessage)
  const tools = Math.min(nonMessage, Number.isFinite(breakdown.tools) ? Math.max(0, breakdown.tools) : 0)
  const room = used - nonMessage
  const memory = Math.min(room, Number.isFinite(breakdown.memory) ? Math.max(0, breakdown.memory!) : 0)
  const daynotes = Math.min(room - memory, Number.isFinite(breakdown.daynotes) ? Math.max(0, breakdown.daynotes!) : 0)
  return { system: nonMessage - tools, tools, memory, daynotes, work: room - memory - daynotes, free: c.total - used }
}

// The bar always spans what the model will load: the layers add up to 100 % of
// the used context, in assembly order (fixed load, long-term memory, day notes,
// conversation). Free is not a layer and stays out of the bar.
export const contextLayers = (p: ContextParts) => [p.system, p.tools, p.memory, p.daynotes, p.work]

// Display shares that add up to exactly 100: rounding each part on its own
// shows a total like 101 %, so the largest remainders take the leftover points.
export function shares(values: number[]): number[] {
  const sum = values.reduce((total, value) => total + value, 0)
  if (!(sum > 0)) return values.map(() => 0)
  const exact = values.map(value => value / sum * 100)
  const out = exact.map(value => Math.floor(value))
  let rest = 100 - out.reduce((total, value) => total + value, 0)
  const order = exact.map((value, i) => ({ rest: value - (out[i] ?? 0), i }))
  order.sort((a, b) => b.rest - a.rest || a.i - b.i)
  for (let k = 0; k < order.length && rest > 0; k++, rest--) {
    const at = order[k]!.i
    out[at] = (out[at] ?? 0) + 1
  }
  return out
}

// The legend's rows and their share of the whole window, in assembly order.
// One denominator for every row, free included, so the column adds up to
// exactly 100.
export type ContextLayer = 'system' | 'tools' | 'memory' | 'daynotes' | 'work' | 'free'
export function contextLegend(p: ContextParts): { key: ContextLayer, value: number, pct: number }[] {
  const rows = [
    { key: 'system' as const, value: p.system },
    { key: 'tools' as const, value: p.tools },
    { key: 'memory' as const, value: p.memory },
    { key: 'daynotes' as const, value: p.daynotes },
    { key: 'work' as const, value: p.work },
    { key: 'free' as const, value: p.free },
  ].filter(row => row.key === 'free' || row.value > 0)
  const pct = shares(rows.map(row => row.value))
  return rows.map((row, i) => ({ ...row, pct: pct[i] ?? 0 }))
}

const BAR = /[█▉▊▋▌▍▎▏░▒▓■□]/
const CLAUDE_PCT = /^\s*[█▉▊▋▌▍▎▏░▒▓\s]*?\s*(\d{1,3})%\s+(used|left)\s*$/
const INLINE = /^\s*(.+?):\s*\[?[█▉▊▋▌▍▎▏░▒▓■□\s]*\]?\s*(\d{1,3})%\s+(used|left)\s*(?:\((?:resets\s+)?(.+?)\))?\s*$/i
const RESET_LINE = /^\s*\(resets\s+(.+?)\)\s*$/i

// Share used (0-100), whatever the direction shown.
export const usedOf = (m: Meter) => (m.kind === 'left' ? 100 - m.pct : m.pct)

export function parseMeters(text: string): { meters: Meter[], rest: string } {
  const lines = text.split('\n')
  const meters: Meter[] = []
  const drop = new Set<number>()
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!
    const m = CLAUDE_PCT.exec(l)
    // An empty gauge (0%) is drawn without any bar character: its reset line tells it.
    const drawn = BAR.test(l) || /^\s*Resets?\s+/i.test(lines[i + 1] || '')
    if (m && drawn && i > 0 && lines[i - 1]!.trim() && !BAR.test(lines[i - 1]!)) {
      const next = lines[i + 1] || ''
      const reset = /^\s*Resets?\s+/i.test(next) ? next.trim().replace(/^Resets?\s+/i, '') : null
      meters.push({ label: lines[i - 1]!.trim(), pct: Math.min(100, Number(m[1])), kind: m[2] as 'used' | 'left', reset })
      drop.add(i - 1).add(i)
      if (reset) drop.add(i + 1)
      continue
    }
    const n = INLINE.exec(l)
    if (n && BAR.test(l)) {
      let reset = n[4] ? n[4].trim() : null
      const r = RESET_LINE.exec(lines[i + 1] || '')
      if (!reset && r) { reset = r[1]!.trim(); drop.add(i + 1) }
      meters.push({ label: n[1]!.trim(), pct: Math.min(100, Number(n[2])), kind: n[3]!.toLowerCase() as 'used' | 'left', reset })
      drop.add(i)
    }
  }
  const rest = lines.filter((_, i) => !drop.has(i))
    // Settings panel tabs, keyboard help ("Esc to cancel", "d to day · w to week")
    // and the Config tab's search box: not relevant here.
    .filter(l => !tabsOfRow(l) && !isKeyLegend(l) && !/^\s*(?:[╭╰]─+[╮╯]|│\s*⌕.*│)\s*$/.test(l))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return { meters, rest }
}

// Box drawn by the agent (╭─╮ │ … │ ╰─╯, Codex): we keep the content.
export function unbox(lines: string[]): string[] {
  const out: string[] = []
  for (const l of lines) {
    if (/^\s*[╭╰┌└][─━]+[╮╯┐┘]\s*$/.test(l)) continue
    const m = /^\s*[│┃]\s?(.*?)\s*[│┃]\s*$/.exec(l)
    out.push(m ? m[1]! : l)
  }
  return out
}
