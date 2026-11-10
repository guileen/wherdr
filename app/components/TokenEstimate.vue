<script setup lang="ts">
import { tl } from '~/utils/i18n'

// The badge belongs on an entry's header line, where it stays visible while the
// body is collapsed. It estimates the entry's call and recorded text; see
// `estimateTokens`.
const props = defineProps<{ tokens: number | null }>()
const high = computed(() => (props.tokens || 0) >= 4000)
const title = tl('Approximate tokens for this entry\'s call and recorded output; actual model usage may differ.')
</script>

<template>
  <span v-if="tokens !== null" class="conversation-output-cost" :class="{ 'is-high': high }" :title="title">
    <span class="conversation-output-cost-value">≈ {{ tokens.toLocaleString('en-US') }}</span>
    <span class="conversation-output-cost-unit">{{ tl('tokens', 'jetons') }}</span>
    <span v-if="high" class="conversation-output-cost-high">{{ tl('High output', 'Sortie élevée') }}</span>
  </span>
</template>
