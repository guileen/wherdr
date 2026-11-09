<script setup lang="ts">
import type { QuotaWindow } from '#shared/types'
import { providerLabel, quotaPeriod } from '~/utils/modelDashboard'
import { providerIcons, providerImages } from '~/utils/providerIcons'

const props = withDefaults(defineProps<{
  name: string
  provider?: string
  showProvider?: boolean
  windows?: (QuotaWindow | undefined)[]
  now: number
  at?: number
  summary?: boolean
}>(), { showProvider: true, windows: () => [undefined], summary: true })
const shownWindows = computed(() => props.windows)
</script>

<template>
  <span class="model-with-usage" :class="{ 'with-provider': showProvider }">
    <span v-if="showProvider" class="provider-brand" :title="provider ? providerLabel(provider) : undefined" aria-hidden="true">
      <UIcon v-if="provider && providerIcons[provider]" :name="providerIcons[provider]!" />
      <img v-else-if="provider && providerImages[provider]" :src="providerImages[provider]" alt="">
      <span v-else-if="provider">{{ providerLabel(provider).slice(0, 2) }}</span>
    </span>
    <span class="model-usage-windows">
      <ModelQuotaGauge v-for="(window, index) in shownWindows" :key="index" :window="window" :now="now" :at="at" :label="index ? window?.label : name" compact :summary="summary">
        <template #label>
          <span v-if="index === 0" class="model-usage-identity">
            <slot name="leading" />
            <span class="model-usage-name" :title="name">{{ name }}</span>
            <slot />
          </span>
          <span v-else class="model-usage-window">{{ window?.label || (window && quotaPeriod(window)) }}</span>
        </template>
      </ModelQuotaGauge>
    </span>
  </span>
</template>

<style scoped>
.model-with-usage { display: grid; flex: 1 1 0; grid-template-columns: minmax(0, 1fr); align-items: stretch; gap: 4px; width: 100%; min-width: 0; }
.model-with-usage.with-provider { grid-template-columns: 14px minmax(0, 1fr); }
.model-usage-windows { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.model-usage-windows :deep(.stacked.model-gauge) { display: grid; grid-template-rows: 80% 20%; gap: 0; height: 15px; min-height: 15px; box-sizing: border-box; }
.model-usage-windows :deep(.gauge-heading) { min-height: 0; }
.model-usage-windows :deep(.stacked .gauge-reset) { line-height: 11px; }
.model-usage-windows :deep(.gauge-label) { min-width: 0; }
.model-usage-windows :deep(.stacked .gauge-tube) { align-self: end; height: 1px; }
.model-usage-identity { display: flex; align-items: center; gap: 4px; min-width: 0; height: 100%; }
.model-usage-name { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-2); font: 500 9px/11px var(--mono); }
.model-usage-window { color: var(--muted); font: 500 8px/12px var(--mono); }
.provider-brand { display: inline-flex; align-items: center; justify-content: center; align-self: stretch; flex: 0 0 14px; width: 14px; height: auto; min-height: 15px; color: var(--muted); font: 600 8px/1 var(--mono); }
.provider-brand img, .provider-brand .iconify { width: 12px; height: 12px; object-fit: contain; }
</style>
