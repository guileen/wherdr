<script setup lang="ts">
import type { ContextChain, Pane } from '#shared/types'
import { contextFragments, type ContextTone } from '~/utils/contextView'
import { chainFixed, loadContextChain } from '~/composables/useContextChain'
import { contextParts, contextSegments, freeSegment, parseOmpContext } from '~/utils/meters'

const props = defineProps<{ pane: Pane, variant?: 'progress' | 'text' | 'details' }>()
const context = computed(() => parseOmpContext(props.pane.ompStatus?.meters))
const stale = computed(() => props.pane.status !== 'working' || props.pane.ompStatus?.metersFresh !== true)
const open = ref(false)
const breakdown = computed(() => props.pane.ompStatus?.breakdown)
const parts = computed(() => context.value ? contextParts(context.value, breakdown.value) : null)
const label = computed(() => {
  const c = context.value
  if (!c) return ''
  const detail = tl(`Context: ${c.pct}% of ${c.total.toLocaleString()} tokens. Approximately ${Math.round(c.estimated).toLocaleString()} tokens, estimated from the rounded percentage.`, `Contexte : ${c.pct} % de ${c.total.toLocaleString()} tokens. Environ ${Math.round(c.estimated).toLocaleString()} tokens, estimés à partir du pourcentage arrondi.`)
  return stale.value ? `${detail} ${tl('Last reading; not live.', 'Dernière mesure ; pas en direct.')}` : detail
})
// The sheet and the Loaded context page must show the same fragments in the
// same order, so the sheet reads the same chain instead of aggregating layers.
// Only the detail surfaces load it: the progress strip and the text control
// stay request-free, and until the chain lands the sheet draws the coarse
// layers — same order, no jump from a different order.
const chain = ref<ContextChain | null>(null)
let chainFor: string | null = null
async function ensureChain() {
  if (chainFor === props.pane.id) return
  chainFor = props.pane.id
  chain.value = null
  try {
    chain.value = await loadContextChain(props.pane.id)
  } catch {
    chainFor = null
  }
}
watch(() => [props.variant, props.pane.id, open.value] as const, ([variant, , isOpen]) => {
  if (variant === 'details' || isOpen) void ensureChain()
}, { immediate: true })

// The progress strip is not the Loaded context page: it keeps the free tail.
const progressSegments = computed(() => {
  const free = parts.value ? freeSegment(parts.value) : null
  return free ? [...segments.value, free] : segments.value
})
const segments = computed<{ key: string, tone: ContextTone, tokens: number }[]>(() => {
  const p = parts.value
  if (!p) return []
  const items = chain.value?.items
  if (items) return contextFragments(items, chainFixed(chain.value))
  return contextSegments(p)
})
function openViewer() {
  open.value = false
  openContextViewer(props.pane)
}
</script>

<template>
  <span v-if="context && parts && variant === 'progress'" class="omp-context-progress" :class="{ working: pane.status === 'working', 'last-known': stale }"
    role="progressbar" :aria-label="label" :aria-valuenow="Math.min(context.pct, 100)" aria-valuemin="0" aria-valuemax="100">
    <i v-for="seg in progressSegments" :key="seg.key" :class="`t-${seg.tone}`" :style="{ flexGrow: seg.tokens }" />
  </span>
  <span v-else-if="context && variant === 'text'" class="omp-context-tokens" :class="{ 'last-known': stale }" :title="label"><span aria-hidden="true">·</span>{{ Math.round(context.estimated / 1000) }}K</span>
  <div v-else-if="context && parts && variant === 'details'" class="omp-context-detail">
    <ContextMeter :context="context" :parts="parts" :segments="segments" :stale="stale" @open="openViewer" />
  </div>
  <span v-else-if="context && parts" class="omp-context-wrap" :class="{ 'last-known': stale }" @click.stop @pointerdown.stop>
    <UPopover v-model:open="open" :content="{ side: 'top', align: 'center' }">
      <button type="button" class="omp-context" :title="label" :aria-label="label">
        {{ Math.round(context.estimated / 1000) }}K
      </button>
      <template #content>
        <div class="omp-context-detail" tabindex="0" @keydown.esc.stop.prevent="open = false">
          <ContextMeter :context="context" :parts="parts" :segments="segments" :stale="stale" @open="openViewer" />
        </div>
      </template>
    </UPopover>
  </span>
</template>

<style scoped>
.omp-context-progress { position: absolute; left: 0; right: 0; bottom: 0; display: flex; height: 2px; overflow: hidden; pointer-events: none; }
.omp-context-progress > i { flex: 0 1 0; min-width: 0; }
.omp-context-progress.last-known { opacity: .5; }
.omp-context-progress.working::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgb(255 255 255 / .85), transparent); transform: translateX(-100%); animation: context-sweep 2s ease-in-out infinite; }
@keyframes context-sweep { to { transform: translateX(100%); } }
@media (prefers-reduced-motion: reduce) { .omp-context-progress.working::after { animation: none; display: none; } }
.omp-context-wrap, .omp-context-tokens { display: inline-flex; align-items: center; gap: 5px; flex: none; font: 500 11px/1.2 var(--mono); color: var(--muted); font-variant-numeric: tabular-nums; }
.omp-context-wrap.last-known, .omp-context-tokens.last-known { opacity: .5; }
.omp-context-wrap { font-size: 11.5px; }
.omp-context { position: relative; height: 32px; padding: 0 8px; white-space: nowrap; font: inherit; cursor: pointer; }
.omp-context::after { content: ''; position: absolute; inset: -6px 0; }
.omp-context-detail { width: min(340px, 86vw); padding: 10px; color: var(--text); font-size: 12px; white-space: normal; overflow-wrap: anywhere; }
</style>
