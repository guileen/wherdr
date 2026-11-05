<script setup lang="ts">
import type { BotWorkspaceBot, JobProjection } from '#shared/botWorkspace'
import { SAMPLE_GRAPH } from '~/utils/bots/sample'
import { t, tl } from '~/utils/i18n'
const props = defineProps<{ bots: BotWorkspaceBot[], selectedJobId: string }>()
const emit = defineEmits<{ select: [bot: BotWorkspaceBot, job: JobProjection] }>()
function select(index: number) {
  const definition = SAMPLE_GRAPH[index]
  const bot = props.bots.find(entry => entry.bot.bot_name === definition?.name)
  const job = bot?.jobs.find(item => item.job_id === definition?.job)
  if (bot && job) emit('select', bot, job)
}
function move(event: KeyboardEvent, index: number) {
  const next = event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : null
  if (next === null) return
  event.preventDefault()
  const parent = (event.currentTarget as HTMLElement).parentElement
  parent?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus()
}
</script>

<template>
  <section class="bot-graph" :aria-label="t('Sample responsibility graph')">
    <p class="graph-label">{{ t('Explicit sample definition') }}</p>
    <h2>{{ t('A draft, a review, a publication') }}</h2>
    <p class="graph-description">{{ t('Responsibility is not completion. These connections describe the fictional workflow; no artifact has been delivered to the publisher.') }}</p>
    <div class="graph-stage">
      <svg class="graph-edges" viewBox="0 0 600 180" preserveAspectRatio="none" aria-hidden="true"><path d="M184 90H206M392 90H414" /><path d="m200 84 6 6 -6 6 M408 84 l6 6 -6 6" /></svg>
      <div class="graph-nodes" role="group" :aria-label="t('Select a sample Job')">
        <button v-for="(node, index) in SAMPLE_GRAPH" :key="node.name" type="button" class="graph-node" :class="{ selected: selectedJobId === node.job }" :aria-pressed="selectedJobId === node.job" :aria-label="tl(`Inspect ${node.name} Job: ${node.label}`)" @click="select(index)" @keydown="move($event, index)">
          <span class="node-step">{{ tl(`0${index + 1}`) }}</span><strong>{{ t(node.label) }}</strong><span>{{ node.name }}</span>
          <small>{{ t(bots.find(bot => bot.bot.bot_name === node.name)?.jobs[0]?.state || 'unknown') }}</small>
        </button>
      </div>
    </div>
    <ul class="graph-legend"><li v-for="node in SAMPLE_GRAPH" :key="node.name"><b>{{ node.name }}</b><span>{{ t(node.note) }}</span></li></ul>
    <p class="graph-hint">{{ t('Tab to a node. Use Left / Right to move and Enter to inspect its Job.') }}</p>
  </section>
</template>

<style scoped>
.bot-graph { padding: 28px 24px; }
.graph-label, .graph-hint { font: 10px var(--mono); color: var(--muted); letter-spacing: .06em; }
.graph-label { text-transform: uppercase; }
h2 { font: 28px var(--display); max-width: 420px; line-height: 1.1; margin: 16px 0; }
.graph-description { max-width: 480px; color: var(--text-2); font-size: 13px; line-height: 1.7; }
.graph-stage { position: relative; margin: 32px 0; min-width: 0; }
.graph-edges { position: absolute; width: 100%; height: 100%; inset: 0; fill: none; stroke: var(--muted); stroke-width: 1; }
.graph-nodes { position: relative; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4%; }
.graph-node { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; text-align: left; min-height: 160px; padding: 14px 10px; border: 1px solid var(--line); background: var(--bg); color: var(--text); cursor: pointer; }
.graph-node:hover, .graph-node.selected { border-color: var(--accent); background: var(--surface); }
.graph-node:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }
.graph-node strong { font: 16px var(--display); overflow-wrap: anywhere; }
.graph-node > span:not(.node-step) { font-size: 12px; color: var(--text-2); }
.node-step, .graph-node small { color: var(--muted); font: 10px var(--mono); }
.graph-node small { margin-top: auto; overflow-wrap: anywhere; }
.graph-legend { list-style: none; padding: 0; margin: 0; }
.graph-legend li { display: grid; grid-template-columns: 90px 1fr; border-top: 1px solid var(--line-soft); padding: 14px 0; gap: 12px; font-size: 12px; }
.graph-legend b { font: 12px var(--mono); }
.graph-legend span { color: var(--text-2); line-height: 1.5; }
.graph-hint { line-height: 1.6; margin-top: 24px; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
@media (max-width: 600px) { .bot-graph { padding: 20px 16px; } .graph-node { padding: 10px 6px; } .graph-node strong { font-size: 14px; } }
</style>
