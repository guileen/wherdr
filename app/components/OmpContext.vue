<script setup lang="ts">
import type { Pane } from '#shared/types'
import { contextParts, parseOmpContext } from '~/utils/meters'

const props = defineProps<{ pane: Pane, variant?: 'progress' | 'text' | 'details' }>()
const context = computed(() => parseOmpContext(props.pane.ompStatus?.meters))
const stale = computed(() => props.pane.status !== 'working' || props.pane.ompStatus?.metersFresh !== true)
const open = ref(false)
const breakdown = computed(() => props.pane.ompStatus?.breakdown)
const parts = computed(() => context.value ? contextParts(context.value, breakdown.value) : null)
const split = computed(() => Boolean(breakdown.value && parts.value && parts.value.system + parts.value.tools > 0))
const label = computed(() => {
  const c = context.value
  if (!c) return ''
  const detail = tl(`Context: ${c.pct}% of ${c.total.toLocaleString()} tokens. Approximately ${Math.round(c.estimated).toLocaleString()} tokens, estimated from the rounded percentage.`, `Contexte : ${c.pct} % de ${c.total.toLocaleString()} tokens. Environ ${Math.round(c.estimated).toLocaleString()} tokens, estimés à partir du pourcentage arrondi.`)
  return stale.value ? `${detail} ${tl('Last reading; not live.', 'Dernière mesure ; pas en direct.')}` : detail
})
// Exact fixed load, read from the session file; the messages share stays an
// estimate because the footer only rounds the used tokens. Shares are of the
// context actually in use (they add up to 100 %), except the free row, which
// is of the whole window.
const used = computed(() => parts.value ? parts.value.system + parts.value.tools + parts.value.memory + parts.value.daynotes + parts.value.work : 0)
const legend = computed(() => {
  const p = parts.value
  if (!p || !split.value || !used.value) return []
  // Assembly order, left to right: fixed load, long-term memory, day notes,
  // then the work of the conversation. An empty layer is noise; the row that
  // carries the share stays.
  return [
    { key: 'system', label: tl('System', 'Système'), value: p.system, basis: used.value },
    { key: 'tools', label: tl('Tools', 'Outils'), value: p.tools, basis: used.value },
    { key: 'memory', label: tl('Memory', 'Mémoire'), value: p.memory, basis: used.value },
    { key: 'daynotes', label: tl('Day notes', 'Notes du jour'), value: p.daynotes, basis: used.value },
    { key: 'work', label: tl('Work', 'Travail'), value: p.work, basis: used.value },
    { key: 'free', label: tl('Free', 'Libre'), value: p.free, basis: context.value!.total },
  ].filter(row => row.key === 'free' || row.value > 0)
})
const share = (value: number, total: number) => `${Math.round(value / Math.max(1, total) * 100)}%`
// The real context, item by item: the branch of the session tree ending at the
// last entry, which the conversation list (a linear reading) may not show.
const k = (value: number) => `${Math.round(value / 1000)}K`
</script>

<template>
  <span v-if="context && parts && variant === 'progress'" class="omp-context-progress" :class="{ working: pane.status === 'working', 'last-known': stale }"
    role="progressbar" :aria-label="label" :aria-valuenow="Math.min(context.pct, 100)" aria-valuemin="0" aria-valuemax="100">
    <i v-if="parts.system > 0" class="seg-system" :style="{ flexGrow: parts.system }" />
    <i v-if="parts.tools > 0" class="seg-tools" :style="{ flexGrow: parts.tools }" />
    <i v-if="parts.memory > 0" class="seg-memory" :style="{ flexGrow: parts.memory }" />
    <i v-if="parts.daynotes > 0" class="seg-daynotes" :style="{ flexGrow: parts.daynotes }" />
    <i v-if="parts.work > 0" class="seg-work" :style="{ flexGrow: parts.work }" />
  </span>
  <span v-else-if="context && variant === 'text'" class="omp-context-tokens" :class="{ 'last-known': stale }" :title="label"><span aria-hidden="true">·</span>{{ Math.round(context.estimated / 1000) }}K</span>
  <div v-else-if="context && variant === 'details'" class="omp-context-detail" role="status">
    <p>{{ label }}</p>
    <dl v-if="legend.length" class="omp-context-legend">
      <div v-for="row in legend" :key="row.key">
        <dt><i :class="`seg-${row.key}`" aria-hidden="true" />{{ row.label }}</dt>
        <dd>{{ k(row.value) }} · {{ share(row.value, row.basis) }}</dd>
      </div>
    </dl>
    <p v-if="pane.ompStatus?.line" class="omp-context-status">{{ pane.ompStatus.line }}</p>
    <p v-if="pane.ompStatus?.meters" class="omp-context-status">{{ pane.ompStatus.meters }}</p>
    <button type="button" class="omp-context-expand" @click="openContextViewer(pane)">{{ tl('Show loaded context', 'Voir le contexte chargé') }}</button>
  </div>
  <span v-else-if="context" class="omp-context-wrap" :class="{ 'last-known': stale }" @click.stop @pointerdown.stop>
    <UPopover v-model:open="open" :content="{ side: 'top', align: 'center' }">
      <button type="button" class="omp-context" :title="label" :aria-label="label">
        {{ Math.round(context.estimated / 1000) }}K
      </button>
      <template #content>
        <div class="omp-context-detail" role="status" tabindex="0" @keydown.esc.stop.prevent="open = false">
          <p>{{ label }}</p>
          <dl v-if="legend.length" class="omp-context-legend">
            <div v-for="row in legend" :key="row.key">
              <dt><i :class="`seg-${row.key}`" aria-hidden="true" />{{ row.label }}</dt>
              <dd>{{ k(row.value) }} · {{ share(row.value, row.basis) }}</dd>
            </div>
          </dl>
          <p v-if="pane.ompStatus?.line" class="omp-context-status">{{ pane.ompStatus.line }}</p>
          <p v-if="pane.ompStatus?.meters" class="omp-context-status">{{ pane.ompStatus.meters }}</p>
          <button type="button" class="omp-context-expand" @click="open = false; openContextViewer(pane)">
            {{ tl('Show loaded context', 'Voir le contexte chargé') }}
          </button>
        </div>
      </template>
    </UPopover>
  </span>
</template>

<style scoped>
.omp-context-progress { position: absolute; left: 0; right: 0; bottom: 0; display: flex; height: 2px; overflow: hidden; pointer-events: none; }
.omp-context-progress > i { flex: 0 1 0; min-width: 0; }
.seg-system { background: var(--dim); }
.seg-tools { background: var(--mauve); }
.seg-memory { background: var(--green); }
.seg-daynotes { background: var(--lav); }
.seg-work { background: var(--coral); }
.omp-context-progress.last-known { opacity: .5; }
.omp-context-progress.working::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgb(255 255 255 / .85), transparent); transform: translateX(-100%); animation: context-sweep 2s ease-in-out infinite; }
@keyframes context-sweep { to { transform: translateX(100%); } }
@media (prefers-reduced-motion: reduce) { .omp-context-progress.working::after { animation: none; display: none; } }
.omp-context-wrap, .omp-context-tokens { display: inline-flex; align-items: center; gap: 5px; flex: none; font: 500 11px/1.2 var(--mono); color: var(--muted); font-variant-numeric: tabular-nums; }
.omp-context-wrap.last-known, .omp-context-tokens.last-known { opacity: .5; }
.omp-context-wrap { font-size: 11.5px; }
.omp-context { position: relative; height: 32px; padding: 0 8px; white-space: nowrap; font: inherit; cursor: pointer; }
.omp-context::after { content: ''; position: absolute; inset: -6px 0; }
.omp-context-detail { width: min(300px, 80vw); padding: 10px; color: var(--text); font-size: 12px; white-space: normal; overflow-wrap: anywhere; }
.omp-context-legend { display: grid; gap: 4px; margin-top: 10px; }
.omp-context-legend > div { display: flex; justify-content: space-between; gap: 10px; }
.omp-context-legend dt { display: inline-flex; align-items: center; gap: 6px; color: var(--text-2); }
.omp-context-legend dt i { flex: none; width: 7px; height: 7px; }
.omp-context-legend dd { margin: 0; color: var(--muted); font-family: var(--mono); font-variant-numeric: tabular-nums; }
.omp-context-status { margin-top: 8px; color: var(--muted); font-family: var(--mono); }
.omp-context-expand { width: 100%; min-height: 36px; margin-top: 10px; border: 1px solid var(--line); color: var(--text); font: inherit; cursor: pointer; }
.omp-context-expand:active { background: var(--surface-2); }
</style>
