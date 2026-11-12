<script setup lang="ts">
import type { ContextChain, OmpPromptTemplate, Pane } from '#shared/types'
import { contextFragments, contextTone } from '~/utils/contextView'
import { chainFixed, loadContextChain } from '~/composables/useContextChain'
import { contextParts, formatContextTokens as tok, parseOmpContext } from '~/utils/meters'

// What the next turn really loads: the branch of the omp session tree that
// ends at the last entry, item by item, in the order omp sends it. The
// conversation list reads the file linearly, so a rewind or a compaction can
// show another branch.
const props = defineProps<{ pane: Pane }>()
const chain = ref<ContextChain | null>(null)
const failed = ref(false)
const loading = ref(true)
let seq = 0
async function load(fresh = false) {
  const n = ++seq
  loading.value = true
  failed.value = false
  try {
    const r = await loadContextChain(props.pane.id, { fresh })
    if (n !== seq) return
    chain.value = r
  } catch {
    if (n === seq) failed.value = true
  } finally {
    if (n === seq) loading.value = false
  }
}
onMounted(() => load())

const context = computed(() => parseOmpContext(props.pane.ompStatus?.meters))
const parts = computed(() => context.value ? contextParts(context.value, props.pane.ompStatus?.breakdown) : null)
// One block per fragment: the fixed load first, then every chain entry in the
// order omp sends it. Nothing is merged by layer.
const fragments = computed(() => contextFragments(chain.value?.items || [], fixed.value))
const rows = computed(() => (chain.value?.items || []).map((item, index) => ({ item, index })))
function jump(index: number) {
  const root = document.querySelector('.context-viewer')
  root?.querySelector(`[data-item="${index}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
}
// Drill-down: a segment or a legend row jumps to that layer in the real list.
function focus(layer: string) {
  const root = document.querySelector('.context-viewer')
  const target = layer === 'system' || layer === 'tools'
    ? root?.querySelector('.ctx-fixed')
    : root?.querySelector(`[data-layer="${layer}"]`)
  target?.scrollIntoView({ block: 'start', behavior: 'smooth' })
}
// A fragment segment jumps to its own item; a layer segment jumps to its block.
function pick(key: string) {
  if (key.startsWith('i')) jump(Number(key.slice(1)))
  else focus(key)
}
const first = (text: string) => (text.split('\n').find(line => line.trim()) || '').trim().slice(0, 120)
const fixed = computed(() => chainFixed(chain.value))
const estimated = computed(() => chain.value?.items.reduce((sum, item) => sum + item.tokens, 0) || 0)
// The session keeps only a 16-hex digest of the assembled prompt, so System
// and Tools show this build's own template and say that the project-context
// block (cwd, AGENTS.md) is not part of it.
const template = ref<OmpPromptTemplate | null>(null)
api<OmpPromptTemplate>('/api/omp-prompt').then((r) => { template.value = r }).catch(() => { template.value = null })
</script>

<template>
  <div class="context-viewer">
    <ContextMeter
      v-if="context && parts"
      :context="context"
      :parts="parts"
      :segments="fragments"
      variant="page"
      :stale="pane.status !== 'working' || pane.ompStatus?.metersFresh !== true"
      @pick="pick"
    />

    <p v-if="loading" class="ctx-note">{{ t('Loading…') }}</p>
    <div v-else-if="failed || !chain" class="ctx-note">
      <p>{{ tl('Context unavailable', 'Contexte indisponible') }}</p>
      <button type="button" class="ctx-retry" @click="load(true)">{{ t('Retry') }}</button>
    </div>
    <template v-else>
      <section class="ctx-fixed" data-layer="system">
        <h2><i class="t-system" aria-hidden="true" />{{ tl('Fixed load', 'Charge fixe') }}</h2>
        <dl class="ctx-legend">
          <div v-if="fixed">
            <dt><i class="t-system" aria-hidden="true" />{{ tl('System', 'Système') }}</dt>
            <dd>{{ tok(fixed.system) }}</dd>
          </div>
          <div v-if="fixed">
            <dt><i class="t-tools" aria-hidden="true" />{{ tl('Tool schemas', 'Schémas d’outils') }}</dt>
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
        <li v-for="row in rows" :key="row.index" :class="`k-${row.item.kind}`" :data-item="row.index" :data-layer="contextTone(row.item.kind)">
            <details v-if="row.item.text">
              <summary>
                <span class="ctx-tag" :class="`tag-${row.item.kind}`">{{ row.item.kind === 'compaction' ? t('Compaction') : row.item.role }}</span>
                <span class="ctx-preview">{{ first(row.item.text) }}</span>
                <span class="ctx-tokens">≈{{ tok(row.item.tokens) }}</span>
              </summary>
              <div class="ctx-body">
                <p v-if="row.item.truncated" class="ctx-note">{{ tl(`Clipped at 4 000 of ${row.item.chars.toLocaleString()} characters`, `Coupé à 4 000 sur ${row.item.chars.toLocaleString()} caractères`) }}</p>
                <div v-if="row.item.thinking" class="ctx-thinking">
                  <span>{{ tl('Thinking (not sent)', 'Réflexion (non envoyée)') }}</span>
                  <pre>{{ row.item.thinking }}</pre>
                </div>
                <pre>{{ row.item.text }}</pre>
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
.ctx-legend { display: grid; gap: 5px; }
.ctx-legend > div { display: flex; justify-content: space-between; gap: 10px; }
.ctx-legend dt { display: inline-flex; align-items: center; gap: 7px; color: var(--text-2); }
.ctx-legend dt i { flex: none; width: 8px; height: 8px; }
.ctx-legend dd { margin: 0; color: var(--muted); font-family: var(--mono); font-variant-numeric: tabular-nums; }
.ctx-basis, .ctx-note, .ctx-foot { color: var(--muted); font-size: 12px; }
.ctx-fixed { display: grid; gap: 8px; padding-top: 6px; border-top: 1px solid var(--line); }
.ctx-fixed h2 { display: flex; align-items: center; gap: 7px; margin: 0; color: var(--muted); font: 500 11px/1.2 var(--mono); text-transform: lowercase; letter-spacing: .04em; }
.ctx-fixed h2 i { flex: none; width: 8px; height: 8px; }
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
/* Special context keeps its fragment colour as a background. */
.ctx-items > li.k-memory { background: color-mix(in srgb, var(--green) 12%, transparent); }
.ctx-items > li.k-daynote { background: color-mix(in srgb, var(--lav) 12%, transparent); }
.ctx-items > li.k-inject { background: color-mix(in srgb, var(--muted) 14%, transparent); }
.ctx-items > li.k-compaction { border-block: 1px solid var(--rose); background: color-mix(in srgb, var(--rose) 12%, transparent); }
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
