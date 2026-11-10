<script setup lang="ts">
import type { ChatItem } from '#shared/types'
import { tl } from '~/utils/i18n'
import { ompEarlier, ompToolMeta, ompWall } from '~/utils/ompTool'
import { highlightCode, HIGHLIGHT_MAX } from '~/utils/codeHighlight'
import { estimateTokens } from '~/utils/tokenEstimate'
import { projectRewinds, rewindKey, type RewindSourceRange } from '~/utils/ompRewind'

const props = defineProps<{ items: readonly ChatItem[], stale: boolean, activity?: string | null, activityStep?: string | null, liveThinking?: string | null, sourceRanges?: readonly RewindSourceRange[] }>()
const openRewinds = reactive(new Set<string>())
const isOutput = (item: ChatItem) => Boolean(item.rewind) || item.role === 'tool' || item.role === 'thinking' || item.role === 'job' || item.role === 'cmd' || item.role === 'bash'
// Keep the existing output bound. A cut beyond this window is explicitly partial,
// rather than claiming the omitted actions can be expanded here.
const windowItems = computed(() => {
  const candidates = props.items.filter(isOutput)
  if (candidates.length <= 120) return props.items
  const first = candidates[candidates.length - 120]!
  return props.items.slice(props.items.indexOf(first))
})
const rewindProjection = computed(() => {
  const first = windowItems.value === props.items ? undefined : windowItems.value[0]?.offset
  const ranges = (props.sourceRanges || []).map(range => ({ start: Math.max(range.start, first ?? range.start), end: range.end }))
  return projectRewinds(windowItems.value, openRewinds, ranges)
})
const entries = computed(() => windowItems.value.flatMap((item, index) => isOutput(item) && !rewindProjection.value.hidden.has(index) ? [rewindProjection.value.cards.get(item) || item] : []))
function rewindHistory(item: ChatItem) {
  const original = windowItems.value.find(row => row.id === item.id) || item
  const history = rewindProjection.value.histories.get(original)!
  return { ...history, count: history.start === null ? 0 : windowItems.value.slice(history.start, history.end).filter((row, index) => isOutput(row) && !rewindProjection.value.duplicates.has(history.start! + index)).length }
}
async function toggleRewind(item: ChatItem) {
  const key = rewindKey(item)
  if (!key) return
  const el = viewport.value
  const top = el?.scrollTop || 0
  const height = el?.scrollHeight || 0
  if (openRewinds.has(key)) openRewinds.delete(key)
  else openRewinds.add(key)
  await nextTick()
  // Keep the handoff in place while revealing history above it, not force-following.
  if (el) el.scrollTop = top + el.scrollHeight - height
}
type OutputGroup = { item: ChatItem, jobId?: string, updates: ChatItem[] }
const groups = computed(() => {
  const result: OutputGroup[] = []
  const jobs = new Map<string, OutputGroup>()
  for (const item of entries.value) {
    if (item.rewind) {
      jobs.clear()
      result.push({ item, updates: [] })
      continue
    }
    const name = (item.omp?.title || item.name || '').toLowerCase()
    const ids = name === 'wait' ? [...new Set((item.omp?.target || item.text).match(/\bbg_[\w-]+\b/g) || [])] : item.job?.id ? [item.job.id] : []
    const group = ids.length === 1 ? jobs.get(ids[0]!) : undefined
    if (group) { group.updates.push(item); continue }
    const next: OutputGroup = { item, updates: [] }
    result.push(next)
    if (isShell(item)) {
      const id = item.omp?.job || (item.out || item.omp?.out || '').match(/\bBackgrounded as job (bg_[\w-]+)/i)?.[1]
      if (id) { next.jobId = id; jobs.set(id, next) }
    }
  }
  return result
})
function isShell(item: ChatItem) {
  return item.role === 'bash' || /^(bash|shell)$/i.test(item.omp?.title || item.name || '')
}
const active = computed(() => {
  if (props.stale || (props.activity !== 'working' && props.activity !== 'blocked')) return null
  const last = props.items.at(-1)
  if (!last || !entries.value.includes(last) || last.error || last.out !== undefined || last.err || last.job || last.omp?.job || last.omp?.cancelled || last.omp?.ms !== undefined || last.omp?.out !== undefined || last.omp?.exit !== undefined) return null
  return last
})
const thinking = computed(() => !props.stale && props.activity === 'working')
const thinkingLabel = computed(() => props.activityStep || (active.value && active.value.role !== 'thinking'
  ? tl('Agent working…', 'Agent en cours…')
  : tl('Thinking / working…', 'Réflexion / en cours…')))

function langOf(item: ChatItem, text: string) {
  const target = item.omp?.target || item.text
  const ext = target.match(/(?:^|[\/\s])[^ \n]*\.([a-z0-9]+)(?=[:\s]|$)/i)?.[1]
  return ext || (item.role === 'cmd' || item.role === 'bash' || /^(bash|shell)$/i.test(item.name || item.omp?.title || '') ? 'sh' : /^\s*[\[{]/.test(text) ? 'json' : '')
}

// An edit's diff (`omp.diff`): the recorded diff itself, or the item's text
// when the transcript carried it there.
function diffOf(item: ChatItem) {
  if (!item.omp?.diff) return ''
  return item.omp.out || item.out || ''
}

// What the tool returned besides its diff ("Updated TASKS.md"), or its whole
// output when it has none.
function restOf(item: ChatItem) {
  const diff = diffOf(item)
  if (!diff) return item.out !== undefined ? item.out : item.omp?.out
  return item.out !== undefined && item.out !== diff ? item.out : ''
}

function code(text: string, item: ChatItem, result = false) {
  const lang = langOf(item, text)
  // Keep the same bound as the code highlighter, including for multi-line diffs.
  if (text.length > HIGHLIGHT_MAX) return highlightCode(text, '')
  // An edit's diff is drawn as lines (OmpDiff); this path keeps coloured
  // patches and command output.
  if (!result && !item.omp?.diff) return highlightCode(text, lang)
  const diff = item.omp?.diff || /^(?:diff --git |@@ |[*]{3} Begin Patch|--- .+\n\+\+\+ )/m.test(text)
  return text.split('\n').map(line => {
    let kind = ''
    if (diff && (/^\+(?!\+\+)/.test(line))) kind = 'diff-add'
    else if (diff && (/^-(?!--)/.test(line))) kind = 'diff-del'
    else if (diff && /^(?:@@|diff --git |--- |\+\+\+ |[*]{3} (?:Begin|End|Update|Add|Delete|Move)\b|PUT |CUT )/.test(line)) kind = 'diff-hunk'
    else if (result && (/^\s*(?:\[[^\]\n]+\]\s*)?\[?(?:error|fatal|failed|failure)\b/i.test(line) || /^\s*[✗✘×]/.test(line) || /^\s*(?:bg_\w+\s+\[[^\]]+\]\s*[—–-]\s*|deployment\s+)(?:failed|failure|error)\b/i.test(line))) kind = 'log-error'
    else if (result && (/^\s*(?:\[[^\]\n]+\]\s*)?\[?(?:warn(?:ing)?|cancelled|canceled)\b/i.test(line) || /^\s*bg_\w+\s+\[[^\]]+\]\s*[—–-]\s*(?:cancelled|canceled)\b/i.test(line))) kind = 'log-warning'
    else if (result && (/^\s*(?:\[[^\]\n]+\]\s*)?\[?(?:success|succeeded|passed|done)\b/i.test(line) || /^\s*[✓✔]/.test(line) || /^\s*deployment\s+(?:successful|succeeded)\b/i.test(line))) kind = 'log-success'
    else if (result && /^\s*(?:backgrounded as job\b|bg_\w+\s+\[[^\]]+\]\s*[—–-]\s*(?:completed|running)\b|npm notice\b)/i.test(line)) kind = 'log-info'
    const safe = highlightCode(line, lang)
    return kind ? `<span class="conversation-output-${kind}">${safe}</span>` : safe
  }).join('\n')
}

function metadata(item: ChatItem) {
  if (!item.omp) return []
  const parts = ompToolMeta(item.omp)
  if (item.omp.ms !== undefined) parts.push(ompWall(item.omp.ms))
  return parts.filter(Boolean)
}

// The call the entry adds to the model's context (command, path, pattern),
// which the body alone does not cover.
function callOf(item: ChatItem) {
  const target = item.omp?.target
  if (isShell(item)) return target || item.text || ''
  const extra = item.text && item.text !== target && item.text !== item.omp?.intent ? item.text : ''
  return [target, extra].filter(Boolean).join('\n')
}
function outputTokens(item: ChatItem): number | null {
  const text = item.out ?? item.job?.out ?? item.omp?.out
  if (text === undefined || (item.outChars === undefined && item.outTruncated)) return null
  const visible = estimateTokens(text)
  // outChars is the whole output; scale the clipped excerpt's estimate to it.
  const output = item.outChars === undefined || !text.length ? visible : Math.ceil(visible * item.outChars / text.length)
  return output + estimateTokens(callOf(item))
}
const highTokens = (item: ChatItem) => (outputTokens(item) || 0) >= 4000
const tokenTitle = tl('Approximate tokens for this entry\'s call and recorded output; actual model usage may differ.')

// Tool output starts collapsed for file reads (the summary names the file) and
// open for everything else, so an edit's diff is visible. A tap overrides the
// default for that entry, and the choice survives updates.
const expanded = ref(new Map<string, boolean>())
function toolKey(item: ChatItem) {
  return item.id || String(item.offset ?? '') || `${item.role}:${item.name || ''}:${item.text}`
}
function toolOpen(item: ChatItem) {
  const read = /^read\b/i.test(item.omp?.title || item.name || '')
  return expanded.value.get(toolKey(item)) ?? !read
}
function onToolToggle(item: ChatItem, event: Event) {
  const next = new Map(expanded.value)
  next.set(toolKey(item), (event.target as HTMLDetailsElement).open)
  expanded.value = next
}

const viewport = ref<HTMLElement | null>(null)
const following = ref(true)
function onScroll() {
  const el = viewport.value
  if (el) following.value = el.scrollHeight - el.clientHeight - el.scrollTop <= 4
}
function scrollToBottom() {
  const el = viewport.value
  if (el) el.scrollTop = el.scrollHeight
}
function resume() {
  following.value = true
  scrollToBottom()
}
watch([() => props.items, thinking, () => props.liveThinking], async () => {
  if (!following.value) return
  await nextTick()
  if (following.value) scrollToBottom()
})
onMounted(scrollToBottom)

function label(item: ChatItem) {
  switch (item.role) {
    case 'thinking': return tl('Thinking', 'Réflexion')
    case 'job': return tl('Background job', 'Tâche de fond')
    case 'cmd': return tl('Command', 'Commande')
    case 'bash': return tl('Shell', 'Shell')
    default: return tl('Tool', 'Outil')
  }
}
function earlier(item: ChatItem) {
  if (item.out !== undefined) return item.outTruncated ? tl('Output truncated.', 'Sortie tronquée.') : ''
  const n = item.omp ? ompEarlier(item.omp) : 0
  return n ? tl(`Output truncated: ${n} earlier ${n === 1 ? 'line' : 'lines'} omitted`, `Sortie tronquée : ${n} ${n === 1 ? 'ligne précédente omise' : 'lignes précédentes omises'}`) : ''
}
</script>

<template>
  <aside class="conversation-output" :aria-label="tl('Conversation output', 'Sortie de la conversation')">
    <div class="conversation-output-panel">
      <div class="conversation-output-heading"><UIcon name="i-lucide-square-terminal" aria-hidden="true" />{{ tl('Conversation output', 'Sortie de la conversation') }}</div>
      <div v-if="stale" class="conversation-output-stale" role="status">{{ tl('Output may be out of date.', 'La sortie peut ne pas être à jour.') }}</div>
      <div ref="viewport" class="conversation-output-viewport" @scroll="onScroll">
        <div v-if="!entries.length && !thinking" class="conversation-output-empty">{{ tl('No process output yet.', 'Aucune sortie de processus pour le moment.') }}</div>
        <template v-for="{ item, updates, jobId } in groups" :key="item.id || entries.indexOf(item)">
        <OmpRewind v-if="item.rewind" :item="item" :history="rewindHistory(item)" :expanded="openRewinds.has(rewindKey(item) || '')" @toggle="toggleRewind(item)" />
        <article v-else-if="isShell(item)" class="conversation-output-entry">
          <div class="conversation-output-label">
            <span>{{ label(item) }}</span>
            <span class="conversation-output-label-side">
              <TokenEstimate :tokens="outputTokens(item)" />
              <span v-if="item === active && !thinking" class="conversation-output-activity"><i aria-hidden="true" />{{ activity === 'blocked' ? tl('Awaiting input', 'En attente') : tl('Agent working', 'Agent en cours') }}</span>
              <span v-if="item.error || (item.omp?.exit !== undefined && item.omp.exit !== 0)" class="conversation-output-error">{{ tl('Error', 'Erreur') }}</span>
            </span>
          </div>
          <div v-if="item.omp?.intent" class="conversation-output-intent">{{ item.omp.intent }}</div>
          <div v-if="item.omp?.target && item.text && item.text !== item.omp.target && item.text !== item.omp.intent" class="conversation-output-intent">{{ item.text }}</div>
          <div class="conversation-output-terminal">
            <div class="conversation-output-terminal-head"><span>{{ item.omp?.title || item.name || tl('Shell', 'Shell') }}</span><span v-if="item.omp?.ms !== undefined">{{ ompWall(item.omp.ms) }}</span><span v-if="jobId">{{ jobId }}</span></div>
            <pre class="conversation-output-terminal-command"><span aria-hidden="true">$ </span>{{ item.omp?.target || item.text }}</pre>
            <div v-if="earlier(item)" class="conversation-output-note">{{ earlier(item) }}</div>
            <pre v-if="item.out !== undefined ? item.out : item.omp?.out" class="conversation-output-text conversation-output-terminal-result" v-html="code((item.out !== undefined ? item.out : item.omp?.out) || '', item, true)" />
            <div v-if="item.omp?.exit !== undefined" class="conversation-output-note">{{ tl('Exit', 'Code de sortie') }} {{ item.omp.exit }}</div>
            <pre v-if="item.err" class="conversation-output-text conversation-output-error">{{ item.err }}</pre>
            <template v-for="(update, updateIndex) in updates" :key="update.id || updateIndex">
              <div class="conversation-output-terminal-wait"><span>{{ update.omp?.intent || label(update) }}<template v-if="(update.omp?.target || update.text) && (update.omp?.target || update.text) !== jobId"> · {{ update.omp?.target || update.text }}</template></span><span v-if="update === active && !thinking" class="conversation-output-activity"><i aria-hidden="true" />{{ activity === 'blocked' ? tl('Awaiting input', 'En attente') : tl('Agent working', 'Agent en cours') }}</span></div>
              <div v-if="outputTokens(update) !== null" class="conversation-output-cost" :class="{ 'is-high': highTokens(update) }" :title="tokenTitle">
                <span class="conversation-output-cost-value">≈ {{ outputTokens(update)?.toLocaleString('en-US') }}</span>
                <span class="conversation-output-cost-unit">{{ tl('tokens', 'jetons') }}</span>
                <span v-if="highTokens(update)" class="conversation-output-cost-high">{{ tl('High output', 'Sortie élevée') }}</span>
              </div>
              <div v-if="update.error || update.omp?.exit !== undefined" :class="update.error || update.omp?.exit ? 'conversation-output-error' : 'conversation-output-note'">{{ update.error ? tl('Error', 'Erreur') : '' }}<template v-if="update.omp?.exit !== undefined">{{ update.error ? ' · ' : '' }}{{ tl('Exit', 'Code de sortie') }} {{ update.omp.exit }}</template></div>
              <div v-if="earlier(update)" class="conversation-output-note">{{ earlier(update) }}</div>
              <pre v-if="update.out !== undefined ? update.out : update.omp?.out" class="conversation-output-text conversation-output-terminal-result" v-html="code((update.out !== undefined ? update.out : update.omp?.out) || '', update, true)" />
              <pre v-if="update.err" class="conversation-output-text conversation-output-error">{{ update.err }}</pre>
              <pre v-if="update.job?.out" class="conversation-output-text conversation-output-terminal-result" v-html="code(update.job.out, update, true)" />
            </template>
          </div>
        </article>
        <details v-else-if="item.role === 'tool'" :open="toolOpen(item)" class="conversation-output-entry conversation-output-tool" :class="{ 'is-active': item === active, 'is-blocked': item === active && activity === 'blocked' }" @toggle="onToolToggle(item, $event)">
          <summary class="conversation-output-tool-summary">
            <span class="conversation-output-tool-heading">
              <span class="conversation-output-tool-label">{{ tl('Tool', 'Outil') }}</span>
              <span class="conversation-output-tool-name">{{ item.omp?.title || item.name || tl('Tool', 'Outil') }}</span>
              <span v-if="item.omp?.intent" class="conversation-output-tool-intent">{{ item.omp.intent }}</span>
              <span v-if="item.omp?.ms !== undefined" class="conversation-output-tool-time">{{ ompWall(item.omp.ms) }}</span>
              <TokenEstimate :tokens="outputTokens(item)" class="conversation-output-tool-cost" />
              <UIcon name="i-lucide-chevron-right" class="conversation-output-tool-chevron" aria-hidden="true" />
            </span>
            <span v-if="item.omp?.target || (item.text && item.text !== item.omp?.intent)" class="conversation-output-tool-target">{{ item.omp?.target || item.text }}</span>
            <span v-if="item.omp" class="conversation-output-tool-meta">{{ ompToolMeta(item.omp).join(' · ') }}</span>
            <span v-if="item === active && !thinking" class="conversation-output-activity"><i aria-hidden="true" />{{ activity === 'blocked' ? tl('Awaiting input', 'En attente') : tl('Agent working', 'Agent en cours') }}</span>
            <span v-if="item.error || (item.omp?.exit !== undefined && item.omp.exit !== 0)" class="conversation-output-error">{{ tl('Error', 'Erreur') }}<template v-if="item.omp?.exit !== undefined"> · {{ tl('Exit', 'Code de sortie') }} {{ item.omp.exit }}</template></span>
          </summary>
          <div class="conversation-output-tool-body">
            <pre v-if="item.omp?.target && item.text && item.text !== item.omp.target && item.text !== item.omp.intent" class="conversation-output-text" v-html="code(item.text, item)" />
            <template v-if="diffOf(item)">
              <div class="conversation-output-tool-detail-label">
                <span>{{ tl('Diff', 'Diff') }}</span>
                <span v-if="item.omp?.added !== undefined || item.omp?.removed !== undefined" class="conversation-output-diff-stats">
                  <span class="is-add">+{{ item.omp?.added || 0 }}</span><span class="is-del">−{{ item.omp?.removed || 0 }}</span>
                </span>
              </div>
              <OmpDiff :text="diffOf(item)" :lang="langOf(item, diffOf(item))" :total="item.omp?.outLines" />
            </template>
            <div v-if="diffOf(item) && restOf(item)" class="conversation-output-tool-detail-label">{{ tl('Output', 'Sortie') }}</div>
            <div v-if="earlier(item) && !diffOf(item)" class="conversation-output-note">{{ earlier(item) }}</div>
            <pre v-if="restOf(item)" class="conversation-output-text conversation-output-result" v-html="code(restOf(item) || '', item, true)" />
            <pre v-if="item.err" class="conversation-output-text conversation-output-result conversation-output-error">{{ item.err }}</pre>
          </div>
        </details>
        <article v-else class="conversation-output-entry" :class="{ 'is-active': item === active, 'is-blocked': item === active && activity === 'blocked', 'is-thinking': item.role === 'thinking' }">
          <div class="conversation-output-label">
            <span>{{ label(item) }}</span>
            <span class="conversation-output-label-side">
              <span v-if="item === active && item.role !== 'thinking' && !thinking" class="conversation-output-activity"><i aria-hidden="true" />{{ activity === 'blocked' ? tl('Awaiting input', 'En attente') : tl('Agent working', 'Agent en cours') }}</span>
              <span v-if="item.error || (item.omp?.exit !== undefined && item.omp.exit !== 0)" class="conversation-output-error">{{ tl('Error', 'Erreur') }}</span>
              <span v-if="item.omp?.exit !== undefined">{{ tl('Exit', 'Code de sortie') }} {{ item.omp.exit }}</span>
              <TokenEstimate :tokens="outputTokens(item)" />
            </span>
          </div>
          <div v-if="item.omp?.title || item.name || item.job?.tool || item.job?.id" class="conversation-output-name">{{ [item.omp?.title || item.name, item.job?.tool, item.job?.id].filter(Boolean).join(' · ') }}</div>
          <pre v-if="item.omp?.target" class="conversation-output-text conversation-output-target">{{ item.omp.target }}</pre>
          <div v-if="item.omp?.intent" class="conversation-output-intent">{{ item.omp.intent }}</div>
          <pre v-if="item.role === 'thinking' && item.text" class="conversation-output-text">{{ item.text }}</pre>
          <pre v-else-if="item.text && item.text !== item.omp?.target && item.text !== item.omp?.intent" class="conversation-output-text" v-html="code(item.text, item)" />
          <div v-if="metadata(item).length" class="conversation-output-meta"><span v-for="(part, metaIndex) in metadata(item)" :key="metaIndex">{{ part }}</span></div>
          <div v-if="earlier(item)" class="conversation-output-note">{{ earlier(item) }}</div>
          <pre v-if="item.out !== undefined ? item.out : item.omp?.out" class="conversation-output-text conversation-output-result" v-html="code((item.out !== undefined ? item.out : item.omp?.out) || '', item, true)" />
          <pre v-if="item.err" class="conversation-output-text conversation-output-result conversation-output-error">{{ item.err }}</pre>
          <pre v-if="item.job?.out" class="conversation-output-text conversation-output-result" v-html="code(item.job.out, item, true)" />
        </article>
        </template>
        <article v-if="thinking && liveThinking" class="conversation-output-entry is-thinking">
          <div class="conversation-output-label">{{ tl('Thinking') }}</div>
          <pre class="conversation-output-text">{{ liveThinking }}</pre>
        </article>
        <div v-if="thinking" class="conversation-output-thinking" role="status">
          <span class="conversation-output-thinking-dots" aria-hidden="true"><i /><i /><i /></span>
          <span>{{ thinkingLabel }}</span>
        </div>
      </div>
      <button v-if="!following" type="button" class="conversation-output-resume mono-btn" @click="resume">{{ tl('Follow output', 'Suivre la sortie') }}</button>
    </div>
  </aside>
</template>
