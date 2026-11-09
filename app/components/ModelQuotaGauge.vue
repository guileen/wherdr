<script setup lang="ts">
import type { QuotaWindow } from '#shared/types'
import { quotaPeriod, remainingPercent, timeRemaining } from '~/utils/modelDashboard'
import { STALE_MS } from '~/utils/quotas'
import { t, tl } from '~/utils/i18n'

const props = defineProps<{ window?: QuotaWindow, now: number, at?: number, label?: string, compact?: boolean, summary?: boolean }>()
const stale = computed(() => props.at != null && props.now - props.at > STALE_MS)
const reset = computed(() => Boolean(props.window?.resetsAt && props.window.resetsAt <= props.now))
const left = computed(() => props.window ? remainingPercent(props.window, props.now) : null)
const fraction = computed(() => props.window ? timeRemaining(props.window, props.now) : null)
const used = computed(() => left.value == null || stale.value ? null : 100 - left.value)
const elapsedPercent = computed(() => fraction.value == null || stale.value ? null : 100 - fraction.value)
const onPace = computed(() => used.value == null ? 0 : elapsedPercent.value == null ? used.value : Math.min(used.value, elapsedPercent.value))
const underPace = computed(() => used.value == null || elapsedPercent.value == null ? 0 : Math.max(0, elapsedPercent.value - used.value))
const overPace = computed(() => used.value == null || elapsedPercent.value == null ? 0 : Math.max(0, used.value - elapsedPercent.value))
const period = computed(() => props.window ? quotaPeriod(props.window) : t('Quota'))
const countdown = computed(() => {
  const w = props.window
  if (w?.fresh) return t('new')
  if (!w?.resetsAt || !Number.isFinite(w.resetsAt)) return '—'
  if (w.resetsAt <= props.now) return t('reset')
  const seconds = Math.ceil((w.resetsAt - props.now) / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  if (hours >= 24) return `${Math.floor(hours / 24)}d${hours % 24 ? `${hours % 24}h` : ''}`
  if (hours) return `${hours}h${minutes % 60 ? `${String(minutes % 60).padStart(2, '0')}m` : ''}`
  if (minutes) return `${minutes}m${seconds % 60 ? `${String(seconds % 60).padStart(2, '0')}s` : ''}`
  return `${seconds}s`
})
const shortCountdown = computed(() => {
  const w = props.window
  if (w?.fresh || !w?.resetsAt || !Number.isFinite(w.resetsAt) || w.resetsAt <= props.now) return countdown.value
  const remaining = w.resetsAt - props.now
  if (remaining < 3_600_000) return '<1h'
  if (remaining < 86_400_000) return `${Math.ceil(remaining / 3_600_000)}h`
  return `${Math.ceil(remaining / 86_400_000)}d`
})
const elapsed = computed(() => elapsedPercent.value == null ? null : 1.5 + 57 * elapsedPercent.value / 100)
const description = computed(() => tl(`${period.value}: ${used.value == null ? 'unknown used quota' : `${used.value}% used`}${elapsedPercent.value == null ? ' · elapsed time unknown' : ` · ${Math.round(elapsedPercent.value * 10) / 10}% of period elapsed`}${stale.value ? ' · stale reading' : ''}${reset.value ? ' · reset, awaiting update' : ''} · ${props.window?.resetsAt ? `reset in ${countdown.value}` : 'reset unknown'}`))
</script>

<template>
  <span class="model-gauge" :class="{ compact, summary, stacked: Boolean($slots.label) }" role="img" :aria-label="description" :title="description">
    <span class="gauge-value sr-only">{{ left == null || stale ? '—' : `${left}%` }}</span>
    <span v-if="$slots.label" class="gauge-heading">
      <span class="gauge-label"><slot name="label" /></span>
      <span class="gauge-reset">{{ summary ? shortCountdown : countdown }}<span v-if="!summary" class="gauge-period">/{{ period }}</span></span>
    </span>
    <span v-else-if="!summary" class="gauge-reset"><span class="gauge-countdown">{{ countdown }}</span><span class="gauge-period">/{{ period }}</span></span>
    <svg class="gauge-tube" viewBox="0 0 60 10" preserveAspectRatio="none" aria-hidden="true">
      <rect v-if="used != null" class="gauge-remaining" :x="1.5 + 57 * used / 100" y="1.5" :width="57 * (100 - used) / 100" height="7" />
      <rect v-if="used != null" :class="elapsedPercent == null ? 'gauge-unrated' : 'gauge-fill'" x="1.5" y="1.5" :width="57 * onPace / 100" height="7" />
      <rect v-if="underPace > 0" class="gauge-under" :x="1.5 + 57 * onPace / 100" y="1.5" :width="57 * underPace / 100" height="7" />
      <rect v-if="overPace > 0" class="gauge-over" :x="1.5 + 57 * onPace / 100" y="1.5" :width="57 * overPace / 100" height="7" />
      <path v-if="elapsed != null && !stale" class="gauge-marker" :d="`M 1.5 8 H ${elapsed} V 2`" />
      <rect class="gauge-frame" x=".5" y=".5" width="59" height="9" />
    </svg>
    <span v-if="summary && !$slots.label" class="gauge-reset">{{ shortCountdown }}</span>
  </span>
</template>

<style scoped>
.model-gauge { position: relative; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 2px 6px; min-width: 0; min-height: 13px; font: 500 9.5px/13px var(--mono); font-variant-numeric: tabular-nums; }
.gauge-reset { flex: 0 0 auto; min-width: 52px; color: var(--text-2); white-space: nowrap; letter-spacing: -.02em; }
.gauge-period { color: var(--dim); }
.gauge-tube { display: block; flex: 1 1 56px; min-width: 44px; height: 9px; overflow: hidden; background: var(--bg-2); }
.compact .gauge-tube { height: 4px; }
.summary.model-gauge { flex-wrap: nowrap; gap: 3px; min-height: 0; }
.summary .gauge-tube { flex: 1 1 24px; min-width: 20px; }
.summary .gauge-reset { flex: 0 0 5ch; min-width: 5ch; text-align: right; font-size: 9px; }
.stacked.model-gauge { display: flex; flex-direction: column; align-items: stretch; gap: 1px; width: 100%; }
.gauge-heading { display: flex; align-items: center; gap: 6px; width: 100%; min-width: 0; }
.gauge-label { flex: 1 1 0; min-width: 0; }
.stacked .gauge-tube { flex: none; width: 100%; min-width: 0; height: 2px; background: var(--line); }
.stacked .gauge-frame { stroke: none; }
.stacked .gauge-marker { stroke-width: .5; }
.stacked .gauge-reset { flex: none; min-width: 3ch; text-align: right; }
.gauge-remaining { fill: #888; fill-opacity: .5; }
.gauge-fill { fill: var(--ochre); }
.gauge-under { fill: color-mix(in srgb, var(--green) 60%, var(--text)); }
.gauge-over { fill: var(--rose); }
.gauge-unrated { fill: var(--muted); }
.gauge-marker { fill: none; stroke: var(--text); stroke-width: 1; vector-effect: non-scaling-stroke; }
.gauge-frame { fill: none; stroke: var(--line); stroke-width: 1; vector-effect: non-scaling-stroke; }
</style>
