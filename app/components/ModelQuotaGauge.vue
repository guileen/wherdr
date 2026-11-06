<script setup lang="ts">
import type { QuotaWindow } from '#shared/types'
import { quotaPeriod, remainingPercent, timeRemaining } from '~/utils/modelDashboard'
import { STALE_MS } from '~/utils/quotas'
import { t, tl } from '~/utils/i18n'

const props = defineProps<{ window?: QuotaWindow, now: number, at?: number, label?: string }>()
const stale = computed(() => props.at != null && props.now - props.at > STALE_MS)
const reset = computed(() => Boolean(props.window?.resetsAt && props.window.resetsAt <= props.now))
const left = computed(() => props.window ? remainingPercent(props.window, props.now) : null)
const fraction = computed(() => props.window ? timeRemaining(props.window, props.now) : null)
const level = computed(() => left.value == null || stale.value ? 'unknown' : left.value <= 15 ? 'exhausted' : left.value <= 40 ? 'low' : 'available')
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
const elapsed = computed(() => fraction.value == null ? null : 1 + 58 * (1 - fraction.value / 100))
const description = computed(() => tl(`${props.label || period.value}: ${left.value == null ? 'unknown remaining quota' : `${left.value}% remaining`}${stale.value ? ' · stale reading' : ''}${reset.value ? ' · reset, awaiting update' : ''} · ${props.window?.resetsAt ? `reset in ${countdown.value}` : 'reset unknown'}`))
</script>

<template>
  <div class="model-gauge" :class="level" role="img" :aria-label="description" :title="description">
    <span class="gauge-value sr-only">{{ left == null ? '—' : `${left}%` }}</span>
    <span class="gauge-reset"><span class="gauge-countdown">{{ countdown }}</span><span class="gauge-period">/{{ period }}</span></span>
    <svg class="gauge-tube" viewBox="0 0 60 12" preserveAspectRatio="none" aria-hidden="true">
      <rect v-if="left != null && !stale" class="gauge-fill" :x="1 + 58 * (1 - left / 100)" y="2" :width="58 * left / 100" height="8" />
      <path v-if="elapsed != null && !stale" class="gauge-marker" :d="`M 1 10 H ${elapsed} V 2`" />
      <rect class="gauge-frame" x=".5" y="1" width="59" height="10" />
    </svg>
  </div>
</template>

<style scoped>
.model-gauge { --gauge-color: var(--teal); display: flex; align-items: center; gap: 4px; min-width: 0; height: 14px; font: 500 9px/14px var(--mono); font-variant-numeric: tabular-nums; }
.model-gauge.low { --gauge-color: var(--ochre); }
.model-gauge.exhausted { --gauge-color: var(--rose); }
.model-gauge.unknown { --gauge-color: var(--muted); }
.gauge-reset { flex: 1 0 auto; color: var(--text-2); white-space: nowrap; }
.gauge-period { color: var(--muted); }
.gauge-tube { display: block; flex: 0 0 56px; width: 56px; height: 10px; overflow: hidden; }
.gauge-fill { fill: var(--gauge-color); fill-opacity: .75; }
.gauge-marker { fill: none; stroke: var(--text-2); stroke-width: 1; vector-effect: non-scaling-stroke; }
.gauge-frame { fill: none; stroke: var(--line); stroke-width: 1; vector-effect: non-scaling-stroke; }
</style>
