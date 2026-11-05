<script setup lang="ts">
import BotWorkspaceView from '~/components/bots/BotWorkspaceView.vue'
const route = useRoute()
const sampleMode = computed(() => route.query.sample === '1')
onMounted(() => { curPane.value = null })
</script>

<template>
  <BotWorkspaceView :key="sampleMode ? 'sample' : 'production'" :sample-mode="sampleMode" />
</template>
