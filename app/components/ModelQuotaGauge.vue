<script setup lang="ts">
import type { QuotaWindow } from '#shared/types'
import { quotaPeriod, remainingPercent, timeRemaining } from '~/utils/modelDashboard'
import { resetCountdown, STALE_MS } from '~/utils/quotas'
import { t, tl } from '~/utils/i18n'

const props = defineProps<{ window?: QuotaWindow, now: number, at?: number, label?: string }>()
const stale = computed(() => props.at != null && props.now - props.at > STALE_MS)
const reset = computed(() => Boolean(props.window?.resetsAt && props.window.resetsAt <= props.now))
const left = computed(() => props.window ? remainingPercent(props.window, props.now) : null)
const fraction = computed(() => props.window ? timeRemaining(props.window, props.now) : null)
const level = computed(() => left.value == null || stale.value ? 'unknown' : left.value <= 15 ? 'exhausted' : left.value <= 40 ? 'low' : 'available')
const period = computed(() => props.window ? quotaPeriod(props.window) : t('Quota'))
const description = computed(() => tl(`${props.label || period.value}: ${left.value == null ? 'unknown remaining quota' : `${left.value}% remaining`}${stale.value ? ' · stale reading' : ''}${reset.value ? ' · reset, awaiting update' : ''} · ${props.window?.resetsAt ? `reset in ${resetCountdown(props.window, props.now)}` : 'reset unknown'}`))
</script>

<template>
  <div class="model-gauge" :class="level" role="img" :aria-label="description" :title="description">
    <div class="gauge-heading"><span class="gauge-value">{{ left == null ? '—' : `${left}%` }}</span><span class="gauge-period">{{ period }}</span></div>
    <div class="gauge-graph">
      <div class="gauge-track">
        <div v-if="left != null" class="gauge-fill" :style="{ height: `${left}%` }" />
        <span v-if="fraction != null" class="gauge-marker" :style="{ bottom: `${fraction}%` }">
          <i aria-hidden="true" /><span>{{ window ? resetCountdown(window, now) : '—' }}</span>
        </span>
      </div>
      <span v-if="fraction == null" class="gauge-reset">{{ window ? resetCountdown(window, now) : '—' }}</span>
    </div>
  </div>
</template>

<style scoped>
.model-gauge { --gauge-color: var(--teal); display: flex; flex: 0 0 92px; flex-direction: column; align-items: flex-start; gap: 8px; padding: 4px 6px; min-width: 0; font: 500 11px/1.2 var(--mono); }
.model-gauge.low { --gauge-color: var(--ochre); }
.model-gauge.exhausted { --gauge-color: var(--rose); }
.model-gauge.unknown { --gauge-color: var(--muted); }
.gauge-heading { display: flex; align-items: baseline; gap: 8px; width: 100%; }
.gauge-value { color: var(--gauge-color); font-size: 13px; font-weight: 700; }
.gauge-graph { display: flex; align-items: center; height: 44px; width: 100%; }
.gauge-track { position: relative; width: 24px; flex: 0 0 24px; height: 44px; border: 1px solid var(--line); background: var(--surface); }
.gauge-fill { position: absolute; bottom: 0; left: 0; right: 0; background: var(--gauge-color); }
.gauge-marker { position: absolute; left: 100%; display: flex; align-items: center; transform: translateY(50%); color: var(--gauge-color); white-space: nowrap; }
.gauge-marker i { width: 0; height: 0; margin-right: 3px; border-top: 4px solid transparent; border-bottom: 4px solid transparent; border-right: 6px solid var(--gauge-color); }
.gauge-reset { padding-left: 8px; color: var(--muted); }
.gauge-period { max-width: 100%; color: var(--muted); overflow-wrap: anywhere; }
</style>
