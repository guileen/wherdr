<script setup lang="ts">
import type { ChatItem } from '#shared/types'
import type { RewindHistory } from '~/utils/ompRewind'

const props = defineProps<{ item: ChatItem, history: RewindHistory, expanded: boolean }>()
const emit = defineEmits<{ toggle: [] }>()
const rewind = computed(() => props.item.rewind!)
const report = computed(() => md(props.item.text))
const label = computed(() => rewind.value.kind === 'search' ? t('Search decision') : t('Work package closure'))
const status = computed(() => {
  if (!rewind.value.contextChanged) return t('Context unchanged')
  return rewind.value.kind === 'search' ? t('Search rewound') : t('Context rewound')
})
const outcome = computed(() => {
  switch (rewind.value.outcome) {
    case 'completed': return t('Completed')
    case 'blocked': return t('Blocked')
    case 'in_progress': return t('In progress')
    default: return ''
  }
})
</script>

<template>
  <section class="omp-rewind" :class="[rewind.kind, { 'no-cut': !rewind.contextChanged, blocked: rewind.outcome === 'blocked' }]" :data-hit-key="item.id">
    <div class="omp-rewind-head">
      <UIcon :name="rewind.contextChanged ? 'i-lucide-history' : 'i-lucide-package-check'" aria-hidden="true" />
      <span>{{ label }}</span><span v-if="outcome" class="omp-rewind-outcome">{{ outcome }}</span>
    </div>
    <p class="omp-rewind-status">{{ status }}</p>
    <p v-if="history.partial" class="omp-rewind-partial" role="status">{{ t('Earlier context unavailable or partial. Loaded history is left visible.') }}</p>
    <button v-else-if="rewind.contextChanged && history.count" type="button" class="omp-rewind-toggle" :aria-expanded="expanded" @click="emit('toggle')">
      <UIcon :name="expanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" aria-hidden="true" />
      <span>{{ expanded ? t('Collapse retired history') : t('Show retired history') }} · {{ history.count }} {{ t('loaded entries') }}</span>
    </button>
    <p v-else-if="rewind.contextChanged" class="omp-rewind-partial">{{ t('No retired entries in this loaded range.') }}</p>
    <ChatMarkdown v-if="item.text" class="omp-rewind-report md" :html="report" :typing="null" />
    <div v-if="rewind.outcome === 'blocked' && rewind.reason" class="omp-rewind-reason"><span class="omp-rewind-detail-label">{{ t('Blocker') }}</span><ChatMarkdown class="md" :html="md(rewind.reason)" :typing="null" /></div>
    <div v-if="rewind.parentId" class="omp-rewind-parent"><span>{{ t('Resumed parent') }}</span><code>{{ rewind.parentId }}</code></div>
    <div v-if="rewind.nextAction && rewind.nextAction.trim() !== item.text.trim()" class="omp-rewind-next">
      <span class="omp-rewind-detail-label">{{ t('Next action') }}</span><ChatMarkdown class="md" :html="md(rewind.nextAction)" :typing="null" />
    </div>
    <div v-if="rewind.materials?.length" class="omp-rewind-materials">
      <div class="omp-rewind-detail-label">{{ t('Retained materials') }}</div>
      <details v-for="material in rewind.materials" :key="material.ref" class="omp-rewind-material">
        <summary><code>{{ material.path }}<template v-if="material.first !== undefined">:{{ material.first }}<template v-if="material.last !== undefined">–{{ material.last }}</template></template></code><span>{{ material.ref }}</span></summary>
        <div v-if="material.tag" class="omp-rewind-material-tag">{{ material.tag }}</div>
        <ChatMarkdown v-if="material.note" class="md" :html="md(material.note)" :typing="null" />
        <pre v-if="material.body">{{ material.body }}</pre>
      </details>
    </div>
  </section>
</template>
