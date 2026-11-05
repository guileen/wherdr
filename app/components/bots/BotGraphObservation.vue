<script setup lang="ts">
import type { BotWorkspaceBot, JobProjection } from '#shared/botWorkspace'
import { t, tl } from '~/utils/i18n'
defineProps<{ bots: BotWorkspaceBot[] }>()
defineEmits<{ select: [entry: BotWorkspaceBot, job: JobProjection] }>()
</script>

<template>
  <section class="graph-observation">
    <h3>{{ t('Graph-correlated Jobs') }}</h3>
    <p>{{ t('These are observed Job correlations, not Graph Run status or topology. Upstream edge IDs do not identify their endpoints. The list may be incomplete.') }}</p>
    <NuxtLink to="/graphs">{{ t('Author Graph definitions') }}</NuxtLink>
    <p>{{ t('Graph Run observation is unavailable here. An administrator may configure per-Run authorization on the Graph definitions page.') }}</p>
    <template v-for="entry in bots" :key="`${entry.source_id}:${entry.bot.bot_id}`">
      <button v-for="job in entry.jobs.filter(item => item.graph_context)" :key="job.job_id" type="button" @click="$emit('select', entry, job)">
        <strong>{{ entry.bot.bot_name }} · {{ job.job_id }}</strong>
        <span>{{ tl(`Graph ${job.graph_context!.graph_id} · Run ${job.graph_context!.graph_run_id}`) }}</span>
        <span>{{ tl(`Node ${job.graph_context!.node_id} · Invocation ${job.graph_context!.invocation_id} · Attempt ${job.graph_context!.attempt}`) }}</span>
        <span>{{ t('Job state') }}: {{ job.state }}</span>
        <span v-if="job.graph_context!.upstream.length">{{ t('Upstream edge IDs') }}: {{ job.graph_context!.upstream.map(edge => edge.edge_id).join(', ') }}</span>
      </button>
    </template>
    <p v-if="!bots.some(entry => entry.jobs.some(job => job.graph_context))">{{ t('No Graph-correlated Jobs in the current observation.') }}</p>
  </section>
</template>

<style scoped>
.graph-observation { padding: 24px 0; font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
.graph-observation p { color: var(--text-2); }.graph-observation a { text-decoration: underline; }
.graph-observation button { display: flex; flex-direction: column; gap: 6px; width: 100%; text-align: left; background: var(--surface); color: var(--text); border: 1px solid var(--line); padding: 14px; cursor: pointer; overflow-wrap: anywhere; }
.graph-observation button + button { border-top: 0; }.graph-observation button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
