import { parseOmpContext } from '../../app/utils/meters'

// This is a projection, not OMP's private model-specific tokenizer. OMP also
// uses four characters per token for coarse estimates. The fixed contribution
// is inferred from the displayed total less the estimated current transcript.
// Runtime plan/goal/jobs and the regenerated activity tip are not fully visible.
interface RawMessage {
  role?: string
  content?: unknown
  stopReason?: string
  attribution?: string
  customType?: string
}
interface RawEntry extends RawMessage {
  id: string
  type: string
  parentId?: string | null
  activeLeafId?: string | null
  message?: RawMessage
  summary?: unknown
  firstKeptEntryId?: unknown
  method?: unknown
  preserveData?: unknown
  providerReplayThroughEntryId?: unknown
  details?: { kind?: string, retainedEntryIds?: string[], state?: string, toolTip?: string }
}

interface Entry {
  id: string
  type: string
  parentId: string | null
  activeLeafId?: string | null
  customType?: string
  kind?: string
  retainedEntryIds?: string[]
  summaryChars?: number
  firstKeptEntryId?: string
  opaqueCompaction: boolean
  stateChars: number
  toolTipChars: number
  message?: {
    role?: string
    user: boolean
    answer: boolean
    textChars: number
    answerChars: number
    opaque: boolean
    image: boolean
    activity: string[]
  }
}
const tokens = (characters: number) => Math.ceil(characters / 4)

// Reduce each line immediately: image payloads and tool outputs must not remain
// in memory while the active branch is selected. Opaque blocks are tracked, not
// priced; they can only be carried through the meter when retained unchanged.
function summarize(record: RawEntry): Entry {
  const e: Entry = {
    id: record.id, type: record.type, parentId: record.parentId ?? null,
    activeLeafId: record.activeLeafId, customType: record.customType,
    kind: record.details?.kind, retainedEntryIds: record.details?.retainedEntryIds,
    summaryChars: typeof record.summary === 'string' ? record.summary.length : undefined,
    firstKeptEntryId: typeof record.firstKeptEntryId === 'string' ? record.firstKeptEntryId : undefined,
    opaqueCompaction: (record.preserveData != null && (typeof record.preserveData !== 'object' || Object.keys(record.preserveData).length > 0))
      || record.providerReplayThroughEntryId != null || record.method === 'remote' || record.method === 'snapcompact'
      || record.details?.kind === 'experimental-context-rollover',
    stateChars: String(record.details?.state ?? '').length,
    toolTipChars: String(record.details?.toolTip ?? '').length,
  }
  const m = record.type === 'message' ? record.message : record.type === 'custom_message' ? record : null
  if (!m || typeof m !== 'object') return e
  const role = record.type === 'custom_message' ? 'custom' : m.role
  const user = role === 'user' || (role === 'custom' && m.attribution === 'user' && ['skill-prompt', 'collab-prompt'].includes(m.customType ?? ''))
  const content = m.content
  let textChars = 0, textParts = 0, answerChars = 0, answerParts = 0
  const activity: string[] = []
  let opaque = false, image = false
  let answer = role === 'assistant' && m.stopReason === 'stop' && Array.isArray(content)
  let hasAnswer = false
  if (typeof content === 'string') textChars = content.length
  else if (Array.isArray(content)) {
    for (const part of content) {
      if (!part || typeof part !== 'object') { opaque = true; answer = false; continue }
      if (part.type === 'text' || part.type === 'thinking') {
        textChars += String(part.text ?? part.thinking ?? '').length + (textParts++ ? 1 : 0)
      } else if (part.type === 'toolCall') {
        textChars += JSON.stringify(part.arguments ?? {}).length + (textParts++ ? 1 : 0)
        textChars += String(part.name ?? '').length + (textParts++ ? 1 : 0)
        if (part.arguments && typeof part.arguments === 'object') {
          if (typeof part.arguments.path === 'string') activity.push(part.arguments.path)
          if (typeof part.arguments.command === 'string') activity.push(part.arguments.command)
        }
      } else if (part.type === 'image') image = true
      else opaque = true
      if (part.type === 'text') {
        answerChars += String(part.text ?? '').length + (answerParts++ ? 1 : 0)
        if (typeof part.text === 'string' && part.text.trim()) hasAnswer = true
      }
      if (!['text', 'thinking', 'redactedThinking', 'fallback', 'anthropicServerTool'].includes(part.type)) answer = false
    }
  } else opaque = true
  e.message = { role, user, answer: answer && hasAnswer, textChars, answerChars, opaque, image, activity }
  return e
}

export function createQaCompactionEstimator(meter: string): { push(line: string): void, finish(): { beforeTokens: number, afterTokens: number, imageSavingsExcluded?: boolean } | null } {
  const usage = parseOmpContext(meter)
  const entries: Entry[] = []
  let invalid = !usage || usage.estimated <= 0
  return {
    push(line) {
      if (invalid || !line.trim()) return
      try {
        const record: RawEntry | null = JSON.parse(line)
        if (record && typeof record.id === 'string' && typeof record.type === 'string' && record.type !== 'session') entries.push(summarize(record))
      } catch { invalid = true }
    },
    finish() {
      if (invalid || !usage || !entries.length || new Set(entries.map(e => e.id)).size !== entries.length) return null
      const index = new Map(entries.map(e => [e.id, e]))
      const last = entries.at(-1)!
      let id: string | null = last.activeLeafId !== undefined ? last.activeLeafId : last.id
      if (id !== null && !index.has(id)) id = entries.findLast(e => e.activeLeafId === undefined || e.activeLeafId === e.id)?.id ?? null
      const branch: Entry[] = []
      const seen = new Set<string>()
      while (id) {
        const entry = index.get(id)
        if (!entry || seen.has(id)) return null
        seen.add(id); branch.push(entry); id = entry.parentId
      }
      branch.reverse()
      const reset = branch.findLastIndex(e => e.type === 'reset_boundary')
      const ci = branch.findLastIndex((e, i) => i > reset && e.type === 'compaction')
      const compact = ci < 0 ? null : branch[ci]!
      const qa = compact?.kind === 'qaonly'
      if (qa && !Array.isArray(compact?.retainedEntryIds)) return null
      let firstKept = -1
      if (compact && !qa) {
        // Provider replay and archived histories cannot be priced from a summary.
        if (compact.opaqueCompaction || compact.summaryChars === undefined || compact.firstKeptEntryId === undefined) return null
        if (compact.firstKeptEntryId) {
          firstKept = branch.findIndex((e, i) => i < ci && e.id === compact.firstKeptEntryId)
          if (firstKept < 0) return null
        }
      }
      if (branch.some((e, i) => i > reset && e.type === 'custom' && /checkpoint/i.test(String(e.customType)))) return null
      const retained = new Set<string>(compact?.retainedEntryIds ?? [])
      let currentChars = 0, projectedChars = 0, requests = 0, imageSavingsExcluded = false
      const activity = new Set<string>()
      for (let i = 0; i < branch.length; i++) {
        const e = branch[i]!
        const inCurrent = ci < 0 ? i > reset : i > ci || (i < ci && (qa ? i > reset && retained.has(e.id) : firstKept >= 0 && i >= firstKept))
        if (e.type === 'branch_summary' && inCurrent && !(branch[i + 1]?.type === 'custom_message' && branch[i + 1]?.customType === 'rewind-report')) {
          currentChars += e.summaryChars ?? 0
        }
        const m = e.message
        if (!m) continue
        const currentTextOnly = !!qa && i < ci && m.role === 'assistant'
        const inProjected = i > reset && (m.user || m.answer)
        // Only retained user content is carried through byte-for-byte. Unknown
        // content present on just one side cannot be inferred from the meter.
        if (m.opaque && ((inCurrent && !currentTextOnly) || (inProjected && m.user)) && !(m.user && inCurrent && inProjected)) return null
        if (m.image && m.user && inProjected && !inCurrent) return null
        if (m.image && inCurrent && !m.user) imageSavingsExcluded = true
        if (i > reset && m.user) requests++
        if (inProjected) projectedChars += m.answer ? m.answerChars : m.textChars
        if (inCurrent) currentChars += currentTextOnly ? m.answerChars : m.textChars
        if (i > reset && i > ci && m.role === 'assistant') for (const value of m.activity) activity.add(value)
      }
      if (!requests) return null
      if (compact) currentChars += qa ? compact.stateChars + compact.toolTipChars : compact.summaryChars!
      const beforeTokens = Math.round(usage.estimated)
      const current = tokens(currentChars)
      if (current > beforeTokens) return null
      const fixed = beforeTokens - current
      const activityChars = [...activity].reduce((sum, value) => sum + value.length + 3, 0)
      return { beforeTokens, afterTokens: fixed + tokens(projectedChars + activityChars + (qa ? compact!.stateChars : 0)), ...(imageSavingsExcluded ? { imageSavingsExcluded: true } : {}) }
    },
  }
}

export function estimateQaCompaction(jsonl: string, meter: string): { beforeTokens: number, afterTokens: number, imageSavingsExcluded?: boolean } | null {
  const estimator = createQaCompactionEstimator(meter)
  for (const line of jsonl.split('\n')) estimator.push(line)
  return estimator.finish()
}
