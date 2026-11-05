<script setup lang="ts">
import ProviderUsage from './ProviderUsage.vue'
import type { QuotaRow } from '~/utils/quotas'

defineProps<{ rows: QuotaRow[], api?: boolean }>()
</script>

<template>
  <ProviderUsage :rows="rows" :api="api" />
</template>
