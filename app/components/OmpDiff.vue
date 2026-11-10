<script setup lang="ts">
// An edit's diff as lines, in the output panes: a sign and an aligned line
// number per row, the added and removed rows tinted, every row's code on the
// same x. See app/utils/ompDiff.ts for the formats it reads.
import { highlightCode } from '~/utils/codeHighlight'
import { tl } from '~/utils/i18n'
import { diffMore, diffNumberWidth, parseOmpDiff } from '~/utils/ompDiff'

const props = defineProps<{ text: string, lang?: string, total?: number }>()

const rows = computed(() => parseOmpDiff(props.text).map(row => ({ ...row, html: highlightCode(row.text, props.lang || '') })))
const width = computed(() => diffNumberWidth(rows.value))
const more = computed(() => diffMore(rows.value, props.total))
const style = computed(() => (width.value ? { '--omp-diff-num': `${width.value}ch` } : undefined))
</script>

<template>
  <div class="omp-diff" :class="{ 'has-numbers': width > 0 }" :style="style" role="group" :aria-label="tl('Diff', 'Diff')">
    <div v-for="(row, i) in rows" :key="i" class="omp-diff-row" :class="`is-${row.kind}`">
      <span class="omp-diff-sign" aria-hidden="true">{{ row.sign }}</span>
      <span class="omp-diff-num">{{ row.num }}</span>
      <span class="omp-diff-code" v-html="row.html" />
    </div>
    <div v-if="more" class="omp-diff-more">{{ tl(`… ${more} more ${more === 1 ? 'line' : 'lines'}`, `… ${more} ligne${more === 1 ? '' : 's'} de plus`) }}</div>
  </div>
</template>
