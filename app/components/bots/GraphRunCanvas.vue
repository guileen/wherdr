<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { api } from '~/composables/useHerdr'
import { t, tl } from '~/utils/i18n'

type Source = { id: string, label: string, token: string, runs: string[] }
type Snapshot = {
  run: { id: string, graph_id: string, revision: string, definition_revision: string, state: string, updated_at: string }
  cursor: { journal_id: string, seq: string }
  nodes: { id: string, kind: string, member: string | null }[]
  edges: { id: string, from: string, to: string, loop: string | null }[]
  communications: { from: string, to: string }[]
  invocations: { id: string, kind: 'node' | 'consultation', node: string | null, member: string | null, state: string, iteration: number, scope_id: string, attempt_id: string | null, superseded: boolean }[]
}
type Cursor = Snapshot['cursor']
type HistoryPage = { views: Snapshot[], cursor: Cursor, watermark: Cursor, next_cursor: Cursor | null }
const sources = ref<Source[]>([]), source = ref(''), run = ref(''), snapshot = ref<Snapshot | null>(null), selected = ref(''), error = ref(''), busy = ref(false)
const history = ref<HistoryPage | null>(null), latest = ref<Snapshot | null>(null), historical = ref(false)
const historyStarts = ref<(Cursor | null)[]>([])
const capability = ref<'unchecked' | 'unavailable'>('unchecked')
let generation = 0, disposed = false
const runStates = new Set(['queued', 'running', 'held', 'cancelling', 'cancelled', 'succeeded', 'failed', 'unknown'])
const invocationStates = new Set(['pending', 'ready', 'running', 'waiting', 'succeeded', 'failed', 'blocked', 'skipped', 'cancelled', 'unknown'])
function displayState(state: string, known: Set<string>) { return known.has(state) ? state : `${state} (unsupported)` }
let expiry: ReturnType<typeof setTimeout> | undefined
function clear() { generation++; snapshot.value = null; latest.value = null; history.value = null; historyStarts.value = []; historical.value = false; selected.value = ''; capability.value = 'unchecked'; busy.value = false; if (expiry) clearTimeout(expiry); expiry = undefined }
async function loadSources() {
  clear(); sources.value = []; source.value = ''; run.value = ''; error.value = ''; busy.value = true
  const current = generation
  try {
    const result = await api<{ sources: Source[] }>('/api/bots/graph-observation')
    if (disposed || current !== generation) return
    sources.value = result.sources
  } catch { if (!disposed && current === generation) error.value = 'Cannot read authorized Graph observation sources. Unlock a passkey and try again.' }
  finally { if (!disposed && current === generation) busy.value = false }
}
watch(source, () => { clear(); run.value = '' }, { flush: 'sync' })
watch(run, clear, { flush: 'sync' })
async function checkCapability() {
  const configured = sources.value.find(item => item.id === source.value)
  if (!configured || !run.value || busy.value) return
  const current = generation
  busy.value = true
  try {
    const result = await api<{ extensions: string[] }>('/api/bots/graph-observation', { source_id: configured.id, source_token: configured.token, run_id: run.value, extensions: ['graph.execution.v1'] })
    if (!Array.isArray(result.extensions) || result.extensions.length !== 0) throw new Error('Unsupported capability response')
    if (!disposed && current === generation) capability.value = 'unavailable'
  } catch {
    if (!disposed && current === generation) {
      clear(); sources.value = []; source.value = ''; run.value = ''
      error.value = 'Could not negotiate Graph execution capability. Refresh authorized sources to read again. Execution controls remain disabled.'
    }
  } finally { if (!disposed && current === generation) busy.value = false }
}
async function observe() {
  const configured = sources.value.find(item => item.id === source.value)
  if (!configured || !run.value || busy.value) return
  clear(); busy.value = true; error.value = ''; const current = generation
  try {
    const result = await api<Snapshot>('/api/bots/graph-observation', { source_id: configured.id, source_token: configured.token, run_id: run.value })
    if (!disposed && current === generation) { snapshot.value = result; latest.value = result; expiry = setTimeout(() => { clear(); sources.value = []; source.value = ''; run.value = ''; error.value = 'Observation expired. Refresh authorized sources to read again.' }, 60000) }
  } catch { if (!disposed && current === generation) { snapshot.value = null; error.value = 'Run observation is unavailable or access has changed. Refresh sources before trying again.' } }
  finally { if (!disposed && current === generation) busy.value = false }
}
async function loadHistory(direction: 'first' | 'next' | 'previous') {
  const configured = sources.value.find(item => item.id === source.value)
  if (!configured || !latest.value || busy.value || (direction === 'next' && !history.value?.next_cursor) || (direction === 'previous' && historyStarts.value.length < 2)) return
  const watermark = history.value?.watermark ?? latest.value.cursor
  const after = direction === 'next' ? history.value?.next_cursor : direction === 'previous' ? historyStarts.value[historyStarts.value.length - 2] : undefined
  const current = generation
  busy.value = true; error.value = ''
  try {
    const page = await api<HistoryPage>('/api/bots/graph-observation', {
      source_id: configured.id, source_token: configured.token, run_id: run.value,
      history: { watermark, limit: 20, ...(after ? { after } : {}) },
    })
    if (!disposed && current === generation) {
      history.value = page
      if (direction === 'first') historyStarts.value = [null]
      else if (direction === 'next') historyStarts.value.push(after ?? null)
      else historyStarts.value.pop()
    }
  } catch {
    if (!disposed && current === generation) {
      clear(); sources.value = []; source.value = ''; run.value = ''
      error.value = 'Run history is unavailable or access has changed. Refresh sources before trying again.'
    }
  } finally { if (!disposed && current === generation) busy.value = false }
}
function showHistory(view: Snapshot) { snapshot.value = view; historical.value = true; selected.value = '' }
function showLatest() { snapshot.value = latest.value; historical.value = false; selected.value = '' }
function visibility() { if (document.visibilityState !== 'visible') { clear(); sources.value = []; source.value = ''; run.value = '' } else loadSources() }
onMounted(() => { document.addEventListener('visibilitychange', visibility); loadSources() })
onBeforeUnmount(() => { disposed = true; document.removeEventListener('visibilitychange', visibility); clear() })
</script>

<template>
  <section class="run-observation" :aria-label="t('Graph Run observation')">
    <h2>{{ t('Observe a Graph Run') }}</h2>
    <p>{{ t('Read-only committed snapshots and retained history. Refresh to observe again; this is not a live subscription.') }}</p>
    <button type="button" :disabled="busy" @click="loadSources">{{ t('Refresh authorized sources') }}</button>
    <p v-if="error" role="alert">{{ t(error) }}</p>
    <p v-if="!sources.length && !error && !busy">{{ t('No Graph Run observation policy is configured.') }}</p>
    <template v-if="sources.length">
      <label>{{ t('Observation source') }} <select v-model="source" :disabled="busy"><option value="">{{ t('Choose a source') }}</option><option v-for="item in sources" :key="item.id" :value="item.id">{{ item.label }}</option></select></label>
      <label>{{ t('Authorized Run') }} <select v-model="run" :disabled="busy || !source"><option value="">{{ t('Choose a Run') }}</option><option v-for="id in sources.find(item => item.id === source)?.runs || []" :key="id" :value="id">{{ id }}</option></select></label>
      <button type="button" :disabled="busy || !run" @click="observe">{{ t('Read Run snapshot') }}</button>
      <button type="button" :disabled="busy || !run" @click="checkCapability">{{ t('Check execution capability') }}</button>
      <p v-if="capability === 'unavailable'">{{ t('Graph execution protocol is unavailable for this source. Execution controls remain disabled.') }}</p>
    </template>
    <template v-if="snapshot">
      <h3>{{ tl(`Run ${snapshot.run.id}`) }}</h3>
      <p>{{ tl(`Graph ${snapshot.run.graph_id} · definition ${snapshot.run.definition_revision} · Run revision ${snapshot.run.revision} · ${displayState(snapshot.run.state, runStates)}`) }}</p>
      <p>{{ tl(`Committed cursor ${snapshot.cursor.journal_id}:${snapshot.cursor.seq} · updated ${snapshot.run.updated_at}`) }}</p>
      <p v-if="historical">{{ t('Historical view at the selected committed cursor; not the current Run state.') }}</p>
      <button v-if="historical" type="button" @click="showLatest">{{ t('Return to captured snapshot') }}</button>
      <section aria-label="Run history">
        <h4>{{ t('Committed Run history') }}</h4>
        <p>{{ t('History is read-only and bounded by the captured snapshot cursor. Older Runs may not have retained views.') }}</p>
        <button type="button" :disabled="busy" @click="loadHistory('first')">{{ t('Read history') }}</button>
        <template v-if="history">
          <p>{{ tl(`History watermark ${history.watermark.journal_id}:${history.watermark.seq}`) }}</p>
          <ul><li v-for="view in history.views" :key="view.cursor.seq"><button type="button" @click="showHistory(view)">{{ tl(`Cursor ${view.cursor.seq} · Run revision ${view.run.revision} · ${displayState(view.run.state, runStates)} · ${view.run.updated_at}`) }}</button></li></ul>
          <p v-if="!history.views.length">{{ t('No retained views in this page.') }}</p>
          <button v-if="historyStarts.length > 1" type="button" :disabled="busy" @click="loadHistory('previous')">{{ t('Previous history page') }}</button>
          <button v-if="history.next_cursor" type="button" :disabled="busy" @click="loadHistory('next')">{{ t('Next history page') }}</button>
        </template>
      </section>
      <div class="canvas" :aria-label="t('Frozen Run definition')">
        <div v-if="snapshot.nodes.length" class="canvas-stage" :style="{ width: `${snapshot.nodes.length * 220}px` }">
          <svg :width="snapshot.nodes.length * 220" height="170" aria-hidden="true">
            <defs><marker id="run-edge-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 Z" /></marker></defs>
            <path v-for="edge in snapshot.edges" :key="edge.id" :d="`M ${snapshot.nodes.findIndex(n => n.id === edge.from) * 220 + 100} 50 C ${snapshot.nodes.findIndex(n => n.id === edge.from) * 220 + 100} 5, ${snapshot.nodes.findIndex(n => n.id === edge.to) * 220 + 100} 5, ${snapshot.nodes.findIndex(n => n.id === edge.to) * 220 + 100} 50`" marker-end="url(#run-edge-arrow)" />
          </svg>
          <button v-for="(node, index) in snapshot.nodes" :key="node.id" type="button" class="node" :style="{ left: `${index * 220}px` }" :aria-pressed="selected === node.id" @click="selected = node.id"><strong>{{ node.id }}</strong><span>{{ node.kind }}<template v-if="node.member"> · {{ node.member }}</template></span><small>{{ tl(`${snapshot.invocations.filter(item => item.node === node.id).length} recorded invocations`) }}</small></button>
        </div>
        <p v-else>{{ t('The frozen definition has no nodes.') }}</p>
      </div>
      <h4>{{ t('Orchestration edges') }}</h4><ul><li v-for="edge in snapshot.edges" :key="edge.id">{{ edge.from }} → {{ edge.to }} · {{ edge.id }}<template v-if="edge.loop"> · {{ tl(`loop ${edge.loop}`) }}</template></li></ul><p v-if="!snapshot.edges.length">{{ t('No orchestration edges.') }}</p>
      <h4>{{ t('Communication permissions (members)') }}</h4><ul><li v-for="(edge, index) in snapshot.communications" :key="index">{{ edge.from }} → {{ edge.to }}</li></ul><p v-if="!snapshot.communications.length">{{ t('No communication permissions.') }}</p>
      <section v-if="snapshot.invocations.some(item => item.kind === 'consultation')"><h4>{{ t('Consultation executions') }}</h4><p>{{ t('These auxiliary executions are not orchestration nodes or edges.') }}</p><article v-for="item in snapshot.invocations.filter(entry => entry.kind === 'consultation')" :key="item.id" class="invocation"><strong>{{ item.id }}</strong><span>{{ tl(`Member ${item.member} · state ${displayState(item.state, invocationStates)} · scope ${item.scope_id}`) }}</span><span v-if="item.attempt_id">{{ tl(`Attempt ${item.attempt_id}`) }}</span><span v-if="item.superseded">{{ t('Superseded') }}</span></article></section>
      <section v-if="selected"><h4>{{ tl(`Invocations · ${selected}`) }}</h4><article v-for="item in snapshot.invocations.filter(item => item.node === selected)" :key="item.id" class="invocation"><strong>{{ item.id }}</strong><span>{{ tl(`State ${displayState(item.state, invocationStates)} · iteration ${item.iteration} · scope ${item.scope_id}`) }}</span><span v-if="item.attempt_id">{{ tl(`Attempt ${item.attempt_id}`) }}</span><span v-if="item.superseded">{{ t('Superseded') }}</span></article><p v-if="!snapshot.invocations.some(item => item.node === selected)">{{ t('No invocation recorded for this node.') }}</p><button type="button" @click="selected = ''">{{ t('Back to overview') }}</button></section>
    </template>
  </section>
</template>

<style scoped>
.run-observation { border: 1px solid var(--line); padding: 16px; margin: 24px 0; overflow-wrap: anywhere; }
h2 { font: 22px var(--display); } h3, h4 { font: 12px var(--mono); } p, li { color: var(--text-2); font-size: 12px; line-height: 1.6; }
label { display: grid; gap: 6px; margin: 12px 0; font: 11px var(--mono); } select, button { min-height: 44px; padding: 8px 12px; border: 1px solid var(--line); border-radius: 0; color: var(--text); background: var(--surface); } button { cursor: pointer; } button:disabled { opacity: .5; cursor: not-allowed; } button:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.canvas { overflow-x: auto; margin: 20px 0; }.canvas-stage { position: relative; height: 170px; }.canvas-stage svg { position: absolute; inset: 0; fill: none; stroke: var(--muted); }.canvas-stage marker path { fill: var(--muted); stroke: none; }.node { position: absolute; top: 50px; width: 200px; height: 110px; text-align: left; display: flex; flex-direction: column; gap: 8px; overflow-wrap: anywhere; }.node[aria-pressed=true] { border-color: var(--accent); }.node strong { font: 16px var(--display); }.node span, .node small { font: 10px var(--mono); }.invocation { display: flex; flex-direction: column; gap: 6px; padding: 12px; border: 1px solid var(--line); font: 11px var(--mono); }
</style>
