<script setup lang="ts">
import { t } from '~/utils/i18n'

defineProps<{
  peak: boolean
  prices: { input: string, output: string } | null
  description: string
}>()
</script>

<template>
  <span class="price-badge" :class="peak ? 'peak' : 'off'" role="img" :title="description" :aria-label="description">
    <template v-if="prices">
      <span class="price-line">{{ prices.input }} {{ t('in') }}</span>
      <span class="price-line">{{ prices.output }} {{ t('out') }}</span>
    </template>
    <template v-else>{{ peak ? '2×' : '½' }}</template>
  </span>
</template>
