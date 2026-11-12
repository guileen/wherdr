<script setup lang="ts">
// Loaded-context sheet, hosted by the app shell: the entry also lives inside
// the phone identity sheet, which unmounts on close and cannot own the state.
</script>

<template>
  <AppSheet v-model:open="contextViewer.open" :title="tl('Loaded context', 'Contexte chargé')" screen>
    <ContextViewer v-if="contextViewer.open && contextViewer.pane" :pane="contextViewer.pane" />
  </AppSheet>
</template>
