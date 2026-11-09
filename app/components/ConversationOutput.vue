<script setup lang="ts">
import type { ChatItem } from '#shared/types'
import { tl } from '~/utils/i18n'
import { ompEarlier, ompToolMeta, ompWall } from '~/utils/ompTool'
import { highlightCode, HIGHLIGHT_MAX } from '~/utils/codeHighlight'

const props = defineProps<{ items: readonly ChatItem[], stale: boolean, activity?: string | null, activityStep?: string | null }>()
const entries = computed(() => props.items.filter(item =>
  item.role === 'tool' || item.role === 'thinking' || item.role === 'job' || item.role === 'cmd' || item.role === 'bash',
).slice(-120))
type OutputGroup = { item: ChatItem, jobId?: string, updates: ChatItem[] }
const groups = computed(() => {
  const result: OutputGroup[] = []
  const jobs = new Map<string, OutputGroup>()
  for (const item of entries.value) {
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

function code(text: string, item: ChatItem, result = false) {
  const target = item.omp?.target || item.text
  const ext = target.match(/(?:^|[\/\s])[^ \n]*\.([a-z0-9]+)(?=[:\s]|$)/i)?.[1]
  const lang = ext || (item.role === 'cmd' || item.role === 'bash' || /^(bash|shell)$/i.test(item.name || item.omp?.title || '') ? 'sh' : /^\s*[\[{]/.test(text) ? 'json' : '')
  // Keep the same bound as the code highlighter, including for multi-line diffs.
  if (text.length > HIGHLIGHT_MAX) return highlightCode(text, '')
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
watch([entries, thinking], async () => {
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
        <article v-if="isShell(item)" class="conversation-output-entry">
          <div class="conversation-output-label">
            <span>{{ label(item) }}</span>
            <span v-if="item === active && !thinking" class="conversation-output-activity"><i aria-hidden="true" />{{ activity === 'blocked' ? tl('Awaiting input', 'En attente') : tl('Agent working', 'Agent en cours') }}</span>
            <span v-if="item.error || (item.omp?.exit !== undefined && item.omp.exit !== 0)" class="conversation-output-error">{{ tl('Error', 'Erreur') }}</span>
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
              <div v-if="update.error || update.omp?.exit !== undefined" :class="update.error || update.omp?.exit ? 'conversation-output-error' : 'conversation-output-note'">{{ update.error ? tl('Error', 'Erreur') : '' }}<template v-if="update.omp?.exit !== undefined">{{ update.error ? ' · ' : '' }}{{ tl('Exit', 'Code de sortie') }} {{ update.omp.exit }}</template></div>
              <div v-if="earlier(update)" class="conversation-output-note">{{ earlier(update) }}</div>
              <pre v-if="update.out !== undefined ? update.out : update.omp?.out" class="conversation-output-text conversation-output-terminal-result" v-html="code((update.out !== undefined ? update.out : update.omp?.out) || '', update, true)" />
              <pre v-if="update.err" class="conversation-output-text conversation-output-error">{{ update.err }}</pre>
              <pre v-if="update.job?.out" class="conversation-output-text conversation-output-terminal-result" v-html="code(update.job.out, update, true)" />
            </template>
          </div>
        </article>
        <details v-else-if="item.role === 'tool'" class="conversation-output-entry conversation-output-tool" :class="{ 'is-active': item === active, 'is-blocked': item === active && activity === 'blocked' }">
          <summary class="conversation-output-tool-summary">
            <span class="conversation-output-tool-heading">
              <span class="conversation-output-tool-label">{{ tl('Tool', 'Outil') }}</span>
              <span class="conversation-output-tool-name">{{ item.omp?.title || item.name || tl('Tool', 'Outil') }}</span>
              <span v-if="item.omp?.intent" class="conversation-output-tool-intent">{{ item.omp.intent }}</span>
              <span v-if="item.omp?.ms !== undefined" class="conversation-output-tool-time">{{ ompWall(item.omp.ms) }}</span>
              <UIcon name="i-lucide-chevron-right" class="conversation-output-tool-chevron" aria-hidden="true" />
            </span>
            <span v-if="item.omp?.target || (item.text && item.text !== item.omp?.intent)" class="conversation-output-tool-target">{{ item.omp?.target || item.text }}</span>
            <span v-if="item.omp" class="conversation-output-tool-meta">{{ ompToolMeta(item.omp).join(' · ') }}</span>
            <span v-if="item === active && !thinking" class="conversation-output-activity"><i aria-hidden="true" />{{ activity === 'blocked' ? tl('Awaiting input', 'En attente') : tl('Agent working', 'Agent en cours') }}</span>
            <span v-if="item.error || (item.omp?.exit !== undefined && item.omp.exit !== 0)" class="conversation-output-error">{{ tl('Error', 'Erreur') }}<template v-if="item.omp?.exit !== undefined"> · {{ tl('Exit', 'Code de sortie') }} {{ item.omp.exit }}</template></span>
          </summary>
          <div class="conversation-output-tool-body">
            <pre v-if="item.omp?.target && item.text && item.text !== item.omp.target && item.text !== item.omp.intent" class="conversation-output-text" v-html="code(item.text, item)" />
            <template v-if="item.omp?.diff && item.omp.out && item.out !== undefined && item.omp.out !== item.out">
              <div class="conversation-output-tool-detail-label">{{ tl('Diff', 'Diff') }}</div>
              <pre class="conversation-output-text conversation-output-result" v-html="code(item.omp.out, item, true)" />
              <div v-if="item.out" class="conversation-output-tool-detail-label">{{ tl('Output', 'Sortie') }}</div>
            </template>
            <div v-if="earlier(item)" class="conversation-output-note">{{ earlier(item) }}</div>
            <pre v-if="item.out !== undefined ? item.out : item.omp?.out" class="conversation-output-text conversation-output-result" v-html="code((item.out !== undefined ? item.out : item.omp?.out) || '', item, true)" />
            <pre v-if="item.err" class="conversation-output-text conversation-output-result conversation-output-error">{{ item.err }}</pre>
          </div>
        </details>
        <article v-else class="conversation-output-entry" :class="{ 'is-active': item === active, 'is-blocked': item === active && activity === 'blocked', 'is-thinking': item.role === 'thinking' }">
          <div class="conversation-output-label">
            <span>{{ label(item) }}</span>
            <span v-if="item === active && item.role !== 'thinking' && !thinking" class="conversation-output-activity"><i aria-hidden="true" />{{ activity === 'blocked' ? tl('Awaiting input', 'En attente') : tl('Agent working', 'Agent en cours') }}</span>
            <span v-if="item.error || (item.omp?.exit !== undefined && item.omp.exit !== 0)" class="conversation-output-error">{{ tl('Error', 'Erreur') }}</span>
            <span v-if="item.omp?.exit !== undefined">{{ tl('Exit', 'Code de sortie') }} {{ item.omp.exit }}</span>
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
        <div v-if="thinking" class="conversation-output-thinking" role="status">
          <span class="conversation-output-thinking-dots" aria-hidden="true"><i /><i /><i /></span>
          <span>{{ thinkingLabel }}</span>
        </div>
      </div>
      <button v-if="!following" type="button" class="conversation-output-resume mono-btn" @click="resume">{{ tl('Follow output', 'Suivre la sortie') }}</button>
    </div>
  </aside>
</template>
