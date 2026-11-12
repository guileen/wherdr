<script setup lang="ts">
import type { ContextChain, OmpPromptTemplate, Pane } from '#shared/types'
import { contextLegend, contextParts, parseOmpContext, type ContextLayer } from '~/utils/meters'

// What the next turn really loads: the branch of the omp session tree that
// ends at the last entry, item by item, in the order omp sends it. The
// conversation list reads the file linearly, so a rewind or a compaction can
// show another branch.
const props = defineProps<{ pane: Pane }>()
const chain = ref<ContextChain | null>(null)
const failed = ref(false)
const loading = ref(true)
let seq = 0
async function load() {
  const n = ++seq
  loading.value = true
  failed.value = false
  try {
    const r = await api<ContextChain>(`/api/context?pane=${encodeURIComponent(props.pane.id)}`)
    if (n !== seq) return
    if (!r || !Array.isArray(r.items)) throw new Error('Invalid chain')
    chain.value = r
  } catch {
    if (n === seq) failed.value = true
  } finally {
    if (n === seq) loading.value = false
  }
}
onMounted(load)

const context = computed(() => parseOmpContext(props.pane.ompStatus?.meters))
const parts = computed(() => context.value ? contextParts(context.value, props.pane.ompStatus?.breakdown) : null)
const used = computed(() => parts.value ? parts.value.system + parts.value.tools + parts.value.memory + parts.value.daynotes + parts.value.work : 0)
const legend = computed(() => {
  const p = parts.value
  if (!p || !used.value) return []
  // Assembly order; the shares add up to exactly 100 % of the used context.
  return contextLegend(p)
})
const layerLabel = computed<Record<ContextLayer, string>>(() => ({
  system: tl('System', 'Système'),
  tools: tl('Tools', 'Outils'),
  memory: tl('Memory', 'Mémoire'),
  daynotes: tl('Day notes', 'Notes du jour'),
  work: tl('Work', 'Travail'),
}))
// Free is what the window keeps: another denominator, so it stays out of the
// percentages and reads as a count against the whole window.
const free = computed(() => parts.value?.free ?? 0)
const window = computed(() => context.value?.total ?? 0)
// The bar is the used context, always full width, laid out in assembly order:
// the fixed load first, then every chain item (memory fragments included)
// left to right, each as wide as its own tokens.
const timeline = computed(() => {
  const out: { key: string, layer: string, tokens: number, title: string, index: number }[] = []
  const f = fixed.value
  const system = f ? f.system : parts.value?.system || 0
  const tools = f ? f.tools : parts.value?.tools || 0
  if (system > 0) out.push({ key: 'system', layer: 'system', tokens: system, title: tl('System', 'Système'), index: -1 })
  if (tools > 0) out.push({ key: 'tools', layer: 'tools', tokens: tools, title: tl('Tool schemas', 'Schémas d’outils'), index: -1 })
  for (const [index, item] of (chain.value?.items || []).entries()) {
    if (!(item.tokens > 0)) continue
    const label = item.kind === 'compaction' ? 'compaction' : item.role
    out.push({ key: `i${index}`, layer: layerOf(item.kind), tokens: item.tokens, title: `${label} · ≈${tok(item.tokens)} — ${first(item.text)}`, index })
  }
  return out
})
function jump(index: number) {
  const root = document.querySelector('.context-viewer')
  root?.querySelector(`[data-item="${index}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
}
// Drill-down: a segment or a legend row jumps to that layer in the real list.
function focus(layer: string) {
  if (layer === 'free') return
  const root = document.querySelector('.context-viewer')
  const target = layer === 'system' || layer === 'tools'
    ? root?.querySelector('.ctx-fixed')
    : root?.querySelector(`[data-layer="${layer}"]`)
  target?.scrollIntoView({ block: 'start', behavior: 'smooth' })
}
const tok = (v: number) => v >= 10_000 ? `${Math.round(v / 1000)}K` : v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(Math.round(v))
const first = (text: string) => (text.split('\n').find(line => line.trim()) || '').trim().slice(0, 120)
// Chain items map onto the bar's layers: the two memory layers keep their own
// colour, everything else that the model reads is the work of the conversation.
const layerOf = (kind: string) => kind === 'memory' ? 'memory' : kind === 'daynote' ? 'daynotes' : 'work'
const fixed = computed(() => {
  const snapshot = chain.value?.fixed
  if (!snapshot) return null
  return { system: snapshot.nonMessage - snapshot.tools, tools: snapshot.tools, prompt: snapshot.prompt }
})
const estimated = computed(() => chain.value?.items.reduce((sum, item) => sum + item.tokens, 0) || 0)
// The session keeps only a 16-hex digest of the assembled prompt, so System
// and Tools show this build's own template and say that the project-context
// block (cwd, AGENTS.md) is not part of it.
const template = ref<OmpPromptTemplate | null>(null)
api<OmpPromptTemplate>('/api/omp-prompt').then((r) => { template.value = r }).catch(() => { template.value = null })
</script>

<template>
  <div class="context-viewer">
    <div v-if="timeline.length" class="ctx-bar">
      <button v-for="seg in timeline" :key="seg.key" type="button" :class="`seg-${seg.layer}`"
        :style="{ flexGrow: seg.tokens }" :title="seg.title"
        @click="seg.index >= 0 ? jump(seg.index) : focus(seg.layer)" />
    </div>
    <dl v-if="legend.length" class="ctx-legend">
      <div v-for="row in legend" :key="row.key">
        <dt><button type="button" class="ctx-jump" @click="focus(row.key)"><i :class="`seg-${row.key}`" aria-hidden="true" />{{ layerLabel[row.key] }}</button></dt>
        <dd>{{ tok(row.value) }} · {{ row.pct }}%</dd>
      </div>
    </dl>
    <p v-if="legend.length" class="ctx-free">{{ tl('Free', 'Libre') }} {{ tok(free) }} / {{ tok(window) }}</p>
    <p v-if="legend.length" class="ctx-basis">{{ tl('Shares of the tokens used; Free is of the whole window. Tap a layer to jump to it.', 'Parts des tokens utilisés ; Libre sur la fenêtre entière. Touchez une couche pour y aller.') }}</p>

    <p v-if="loading" class="ctx-note">{{ t('Loading…') }}</p>
    <div v-else-if="failed || !chain" class="ctx-note">
      <p>{{ tl('Context unavailable', 'Contexte indisponible') }}</p>
      <button type="button" class="ctx-retry" @click="load">{{ t('Retry') }}</button>
    </div>
    <template v-else>
      <section class="ctx-fixed">
        <h2>{{ tl('Fixed load', 'Charge fixe') }}</h2>
        <dl class="ctx-legend">
          <div v-if="fixed">
            <dt><i class="seg-system" aria-hidden="true" />{{ tl('System', 'Système') }}</dt>
            <dd>{{ tok(fixed.system) }}</dd>
          </div>
          <div v-if="fixed">
            <dt><i class="seg-tools" aria-hidden="true" />{{ tl('Tool schemas', 'Schémas d’outils') }}</dt>
            <dd>{{ tok(fixed.tools) }}</dd>
          </div>
          <div v-if="chain.digest">
            <dt>{{ tl('Prompt digest', 'Empreinte du prompt') }}</dt>
            <dd>{{ chain.digest.slice(0, 8) }}</dd>
          </div>
        </dl>
        <p v-if="chain.tools.length" class="ctx-tools">
          {{ tl('Tool calls in this context', 'Appels d’outils dans ce contexte') }}:
          <span v-for="tool in chain.tools" :key="tool.name" class="ctx-tool">{{ tool.name }} ×{{ tool.calls }}</span>
        </p>
        <details v-if="template" class="ctx-template">
          <summary>
            <span class="ctx-tag">{{ tl('System prompt', 'Prompt système') }}</span>
            <span class="ctx-preview">{{ tl(`local omp ${template.version} default`, `défaut local omp ${template.version}`) }}</span>
          </summary>
          <div class="ctx-body">
            <p class="ctx-note">{{ tl('This build’s default text. The project-context block (cwd, AGENTS.md) varies per pane and is not part of it.', 'Texte par défaut de cette version. Le bloc project-context (cwd, AGENTS.md) varie par panneau et n’en fait pas partie.') }}</p>
            <pre>{{ template.system }}</pre>
          </div>
        </details>
        <details v-if="template" class="ctx-template">
          <summary>
            <span class="ctx-tag">{{ tl('Tool schemas', 'Schémas d’outils') }}</span>
            <span class="ctx-preview">{{ template.tools.length }} · omp {{ template.version }}</span>
          </summary>
          <div class="ctx-body">
            <section v-for="tool in template.tools" :key="tool.name">
              <h3>{{ tool.name }}</h3>
              <pre>{{ JSON.stringify(tool.parameters, null, 2) }}</pre>
            </section>
          </div>
        </details>
      </section>

      <ol class="ctx-items">
        <li v-for="(item, i) in chain.items" :key="i" :class="item.kind" :data-layer="layerOf(item.kind)" :data-item="i">
          <details v-if="item.text">
            <summary>
              <span class="ctx-tag" :class="`tag-${item.kind}`">{{ item.kind === 'compaction' ? t('Compaction') : item.role }}</span>
              <span class="ctx-preview">{{ first(item.text) }}</span>
              <span class="ctx-tokens">≈{{ tok(item.tokens) }}</span>
            </summary>
            <div class="ctx-body">
              <p v-if="item.truncated" class="ctx-note">{{ tl(`Clipped at 4 000 of ${item.chars.toLocaleString()} characters`, `Coupé à 4 000 sur ${item.chars.toLocaleString()} caractères`) }}</p>
              <div v-if="item.thinking" class="ctx-thinking">
                <span>{{ tl('Thinking (not sent)', 'Réflexion (non envoyée)') }}</span>
                <pre>{{ item.thinking }}</pre>
              </div>
              <pre>{{ item.text }}</pre>
            </div>
          </details>
        </li>
      </ol>
      <p class="ctx-foot">
        {{ tl(`${chain.items.length} items · ≈${tok(estimated)} tokens${chain.dropped ? ` · ${chain.dropped} entries not scanned` : ''}`, `${chain.items.length} éléments · ≈${tok(estimated)} tokens${chain.dropped ? ` · ${chain.dropped} entrées non lues` : ''}`) }}
      </p>
    </template>
  </div>
</template>

<style scoped>
.context-viewer { display: grid; gap: 14px; padding: 4px 0 24px; color: var(--text); font-size: 13px; }
.ctx-bar { display: flex; height: 6px; overflow: hidden; border-radius: 1px; }
.ctx-bar > button { flex: 0 1 0; min-width: 1px; padding: 0; border: 0; cursor: pointer; }
.seg-system { background: var(--dim); }
.seg-tools { background: var(--mauve); }
.seg-memory { background: var(--green); }
.seg-daynotes { background: var(--lav); }
.seg-work { background: var(--ochre); }
.seg-free { background: var(--line-strong); }
.ctx-jump { display: inline-flex; align-items: center; gap: 7px; padding: 2px 0; border: 0; background: none; color: inherit; font: inherit; cursor: pointer; }
.ctx-jump i { flex: none; width: 8px; height: 8px; }
.ctx-legend { display: grid; gap: 5px; }
.ctx-legend > div { display: flex; justify-content: space-between; gap: 10px; }
.ctx-legend dt { display: inline-flex; align-items: center; gap: 7px; color: var(--text-2); }
.ctx-legend dt i { flex: none; width: 8px; height: 8px; }
.ctx-legend dd { margin: 0; color: var(--muted); font-family: var(--mono); font-variant-numeric: tabular-nums; }
.ctx-basis, .ctx-note, .ctx-foot { color: var(--muted); font-size: 12px; }
.ctx-fixed { display: grid; gap: 8px; padding-top: 6px; border-top: 1px solid var(--line); }
.ctx-fixed h2 { color: var(--muted); font: 500 11px/1.2 var(--mono); text-transform: lowercase; letter-spacing: .04em; }
.ctx-template { min-width: 0; border-top: 1px solid var(--line); }
.ctx-template summary { display: flex; align-items: baseline; gap: 8px; min-height: 44px; padding: 10px 2px; cursor: pointer; list-style: none; }
.ctx-template summary::-webkit-details-marker { display: none; }
.ctx-template h3 { color: var(--mauve); font: 500 11.5px/1.7 var(--mono); }
.ctx-template section { margin-bottom: 10px; }
.ctx-tools { color: var(--text-2); font-size: 12px; }
.ctx-tool { display: inline-block; margin-left: 6px; color: var(--muted); font-family: var(--mono); }
.ctx-items { display: grid; margin: 0; padding: 0; list-style: none; }
.ctx-items > li { min-width: 0; border-top: 1px solid var(--line); }
.ctx-items > li:last-child { border-bottom: 1px solid var(--line); }
.ctx-items > li.compaction { border-block: 1px solid var(--mauve); }
.ctx-items summary { display: flex; align-items: baseline; gap: 8px; padding: 10px 2px; cursor: pointer; list-style: none; min-height: 44px; }
.ctx-items summary::-webkit-details-marker { display: none; }
.ctx-tag { flex: none; min-width: 62px; color: var(--muted); font: 500 10.5px/1.6 var(--mono); text-transform: lowercase; }
.tag-assistant { color: var(--green); }
.tag-user { color: var(--text); }
.tag-toolResult { color: var(--mauve); }
.tag-inject { color: var(--dim); }
.ctx-preview { flex: 1; min-width: 0; overflow: hidden; color: var(--text-2); white-space: nowrap; text-overflow: ellipsis; }
.ctx-tokens { flex: none; color: var(--muted); font-family: var(--mono); font-variant-numeric: tabular-nums; }
.ctx-body, .ctx-body pre { white-space: pre-wrap; overflow-wrap: anywhere; }
.ctx-body { padding: 0 2px 12px; }
.ctx-body pre { color: var(--text-2); font: 11.5px/1.5 var(--mono); }
.ctx-thinking { margin-bottom: 10px; padding-left: 8px; border-left: 2px solid var(--line); }
.ctx-thinking span { color: var(--muted); font-size: 11px; }
.ctx-thinking pre { color: var(--muted); }
.ctx-retry { margin-top: 8px; padding: 10px 14px; border: 1px solid var(--line); color: var(--text); font: inherit; }
</style>
