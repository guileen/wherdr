<script setup lang="ts">
import { mergeToneRuns, type ContextTone } from '~/utils/contextView'
import { contextRows, formatContextTokens, freeSegment, type ContextLayer, type ContextParts } from '~/utils/meters'

// One bar, one order. Both the pane sheet and the Loaded context page draw the
// same fragments in the order omp sends them, each coloured by its kind; the
// sheet is just the same bar without the rows, and tapping it opens the page.
const props = defineProps<{
  context: { pct: number, total: number, estimated: number }
  parts: ContextParts
  segments: { key: string, tone: ContextTone, tokens: number }[]
  variant?: 'sheet' | 'page'
  stale?: boolean
}>()
const emit = defineEmits<{ open: [], pick: [key: string] }>()

const rows = computed(() => contextRows(props.parts))
// The sheet keeps the empty rest of the window in the bar so its width reads as
// the window; the Loaded context page is about the request only, so it drops it.
const drawn = computed(() => {
  const segments = props.segments.map(seg => ({ key: seg.key, tone: seg.tone, tokens: seg.tokens, index: -1 }))
  const free = page.value ? null : freeSegment(props.parts)
  return free ? [...segments, { ...free, index: -1 }] : segments
})
// Runs only for drawing: the underlying segments stay one per fragment.
const runs = computed(() => mergeToneRuns(drawn.value))
const used = computed(() => props.parts.system + props.parts.tools + props.parts.memory + props.parts.daynotes + props.parts.work)
const page = computed(() => props.variant === 'page')
const layerLabel = computed<Record<ContextLayer, string>>(() => ({
  system: tl('System', 'Système'),
  tools: tl('Tools', 'Outils'),
  memory: tl('Memory', 'Mémoire'),
  daynotes: tl('Day notes', 'Notes du jour'),
  work: tl('Work', 'Travail'),
}))
const aria = computed(() => tl(
  page.value
    ? `Context: ${Math.round(props.context.pct)}% of ${props.context.total.toLocaleString()} tokens, ${formatContextTokens(used.value)} used`
    : `Context: ${Math.round(props.context.pct)}% of ${props.context.total.toLocaleString()} tokens, ${formatContextTokens(used.value)} used, ${formatContextTokens(props.parts.free)} free`,
  page.value
    ? `Contexte : ${Math.round(props.context.pct)} % de ${props.context.total.toLocaleString()} tokens, ${formatContextTokens(used.value)} utilisés`
    : `Contexte : ${Math.round(props.context.pct)} % de ${props.context.total.toLocaleString()} tokens, ${formatContextTokens(used.value)} utilisés, ${formatContextTokens(props.parts.free)} libres`,
))

function pick(key: string) {
  if (page.value) emit('pick', key)
}
</script>

<template>
  <div class="cm" :class="[`cm-${variant || 'sheet'}`, { stale }]">
    <p class="cm-head">
      <strong>≈{{ formatContextTokens(used) }}</strong> / {{ formatContextTokens(context.total) }} · {{ Math.round(context.pct) }}%
      <span v-if="!page" class="cm-free">{{ tl(`free ${formatContextTokens(parts.free)}`, `libre ${formatContextTokens(parts.free)}`) }}</span>
    </p>
    <div
      class="cm-bar"
      :role="page ? 'img' : 'button'"
      :tabindex="page ? undefined : 0"
      :aria-label="page ? aria : `${aria}. ${tl('Show loaded context', 'Voir le contexte chargé')}`"
      @click="!page && emit('open')"
      @keydown.enter="!page && emit('open')"
      @keydown.space.prevent="!page && emit('open')"
    >
      <button
        v-for="seg in runs"
        :key="seg.key"
        type="button"
        :class="`t-${seg.tone}`"
        :style="{ flexGrow: seg.tokens }"
        tabindex="-1"
        :aria-label="`${seg.tone} ≈${formatContextTokens(seg.tokens)}`"
        :title="`${seg.tone} ≈${formatContextTokens(seg.tokens)}`"
        @click="pick(seg.key)"
      />
    </div>
    <dl v-if="page" class="cm-rows">
      <div v-for="row in rows" :key="row.key">
        <dt>
          <button type="button" class="cm-row" @click="emit('pick', row.key)">
            <i :class="`t-${row.key}`" aria-hidden="true" />{{ layerLabel[row.key] }}
          </button>
        </dt>
        <dd>{{ formatContextTokens(row.tokens) }} · {{ row.pct >= 1 ? `${row.pct}%` : '<1%' }}</dd>
      </div>
    </dl>
  </div>
</template>
