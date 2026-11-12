import type { ContextChain, ContextChainItem } from '#shared/types'

// omp session files hold a tree: every top-level entry has an `id` and the
// `parentId` of the entry it continues. The prompt of the next turn is the
// branch ending at the last entry; the file's order is a linear transcript of
// all branches, which a rewind or a compaction makes differ from the branch.

const CLIP = 4000
const RECORDS = 20_000

interface Snapshot { prompt: number, nonMessage: number, tools: number }
interface Node { parentId: string | null, item: ContextChainItem | null, tools: string[], digest: string | null, snapshot: Snapshot | null }

type Entry = {
  type?: string
  id?: string
  parentId?: string | null
  message?: { role?: string, content?: unknown, contextSnapshot?: Record<string, unknown> }
  customType?: string
  data?: { reminder?: unknown, text?: unknown } | string
  content?: unknown
  summary?: unknown
}

const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null)

function partsOf(content: unknown): { type?: string, text?: unknown, thinking?: unknown, name?: unknown }[] {
  if (Array.isArray(content)) return content as { type?: string, text?: unknown, thinking?: unknown, name?: unknown }[]
  return typeof content === 'string' ? [{ type: 'text', text: content }] : []
}

function itemOf(kind: ContextChainItem['kind'], role: string, text: string, clip: number): ContextChainItem | null {
  if (!text.trim()) return null
  return {
    kind,
    role,
    text: text.length > clip ? text.slice(0, clip) : text,
    chars: text.length,
    tokens: Math.ceil(text.length / 4),
    ...(text.length > clip ? { truncated: true } : {}),
  }
}

// `push` takes one JSONL record at a time; `finish` walks the branch backwards
// from the last record and returns it root first.
export function createContextChain(options: { clip?: number, records?: number } = {}) {
  const clip = options.clip ?? CLIP
  const max = options.records ?? RECORDS
  const nodes = new Map<string, Node>()
  let last: string | null = null
  let dropped = 0

  function push(line: string) {
    if (!line.includes('"id"')) return
    let d: Entry
    try { d = JSON.parse(line) } catch { return }
    if (typeof d.id !== 'string') return
    const node: Node = { parentId: typeof d.parentId === 'string' ? d.parentId : null, item: null, tools: [], digest: null, snapshot: null }
    if (d.type === 'message') {
      const message = d.message || {}
      const role = typeof message.role === 'string' ? message.role : 'message'
      let text = ''
      let thinking = ''
      for (const part of partsOf(message.content)) {
        if (part?.type === 'text' && typeof part.text === 'string') text += (text ? '\n' : '') + part.text
        else if (part?.type === 'thinking' && typeof part.thinking === 'string') thinking += (thinking ? '\n' : '') + part.thinking
        else if (part?.type === 'toolCall' && typeof part.name === 'string') node.tools.push(part.name)
      }
      node.item = itemOf('message', role, text, clip)
      if (node.item && thinking) node.item.thinking = thinking.length > clip ? thinking.slice(0, clip) : thinking
      const snapshot = message.contextSnapshot
      if (role === 'assistant' && snapshot) {
        const prompt = count(snapshot.promptTokens)
        const nonMessage = count(snapshot.nonMessageTokens)
        if (prompt !== null && nonMessage !== null) node.snapshot = { prompt, nonMessage, tools: count(snapshot.toolSchemaTokens) ?? 0 }
      }
    } else if (d.type === 'custom') {
      const data = typeof d.data === 'object' && d.data ? d.data : {}
      if (d.customType === 'system-prompt-digest') node.digest = typeof d.data === 'string' ? d.data : null
      else if (d.customType === 'date-cwd-reminder') node.item = itemOf('inject', d.customType, typeof data.reminder === 'string' ? data.reminder : '', clip)
      else if (d.customType === 'context-memory-day-note') node.item = itemOf('daynote', 'day note', typeof data.text === 'string' ? data.text : '', clip)
      else if (d.customType === 'context-memory-line') node.item = itemOf('memory', 'memory', typeof data.text === 'string' ? data.text : '', clip)
    } else if (d.type === 'custom_message') {
      const text = typeof d.content === 'string'
        ? d.content
        : partsOf(d.content).map(part => typeof part.text === 'string' ? part.text : '').join('\n')
      node.item = itemOf('inject', typeof d.customType === 'string' ? d.customType : 'context', text, clip)
    } else if (d.type === 'branch_summary') {
      node.item = itemOf('compaction', 'compaction', typeof d.summary === 'string' ? d.summary : '', clip)
    }
    nodes.set(d.id, node)
    last = d.id
    while (nodes.size > max) {
      const oldest = nodes.keys().next().value
      if (oldest === undefined) break
      nodes.delete(oldest)
      dropped++
    }
  }

  function finish(): ContextChain | null {
    const branch: Node[] = []
    const seen = new Set<string>()
    for (let id = last; id && !seen.has(id);) {
      const node = nodes.get(id)
      if (!node) break
      seen.add(id)
      branch.push(node)
      id = node.parentId
    }
    if (!branch.length) return null
    branch.reverse()
    const calls = new Map<string, number>()
    let digest: string | null = null
    let snapshot: Snapshot | null = null
    const items: ContextChainItem[] = []
    for (const node of branch) {
      if (node.item) items.push(node.item)
      for (const name of node.tools) calls.set(name, (calls.get(name) || 0) + 1)
      digest = node.digest || digest
      snapshot = node.snapshot || snapshot
    }
    return {
      items,
      tools: [...calls].map(([name, uses]) => ({ name, calls: uses })).sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name)),
      digest,
      fixed: snapshot,
      entries: branch.length,
      dropped,
    }
  }

  return { push, finish }
}
