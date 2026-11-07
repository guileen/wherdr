<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { GRAPH_WIRE_EXECUTION_EXTENSION, GRAPH_WIRE_PROTOCOL, GraphWireSourceState, validateGraphWireArtifactFrame, type GraphWireArtifactFrame, type GraphWireSourceFrame, type GraphWireSourceStateView } from '@oh-my-pi/pi-wire/graph'
import { locked, wsBase } from '~/composables/useHerdr'
import { t, tl } from '~/utils/i18n'

const props = defineProps<{ source: { id: string, token: string }, runId: string }>()
const emit = defineEmits<{ invalidated: [] }>()
const view = shallowRef<GraphWireSourceStateView | null>(null)
const status = ref<'idle' | 'connecting' | 'live' | 'stale' | 'unavailable'>('idle')
const error = ref('')
const executionSupport = ref<boolean | null>(null)
let socket: WebSocket | null = null
let consumer: GraphWireSourceState | null = null
let freshness: number | undefined, deadline: number | undefined
let detailDeadline: number | undefined
type ConsultationDetail = {
  conversationId: string, ref: string, sourceId: string, runId: string, messageId: string,
  availability: GraphWireArtifactFrame['availability'] | 'pending' | 'timeout', content: string | null,
}
const detail = shallowRef<ConsultationDetail | null>(null)
const projection = computed(() => view.value?.sources.find(source => source.source.source_id === props.source.id))
const records = computed(() => projection.value?.hasProjection ? projection.value.records : [])
const runRecord = computed(() => records.value.find(record => record.kind === 'run')?.value)
const bindings = computed(() => records.value.filter(record => record.kind === 'binding').map(record => record.value))
const dependencies = computed(() => records.value.filter(record => record.kind === 'dependency').map(record => record.value))
const transfers = computed(() => records.value.filter(record => record.kind === 'transfer').map(record => record.value))
const executionRun = computed(() => records.value.find(record => record.kind === 'execution_run')?.value)
const members = computed(() => records.value.filter(record => record.kind === 'execution_member').map(record => record.value))
const invocations = computed(() => records.value.filter(record => record.kind === 'execution_invocation').map(record => record.value))
const attempts = computed(() => records.value.filter(record => record.kind === 'execution_attempt').map(record => record.value))
const conversations = computed(() => records.value.filter(record => record.kind === 'execution_conversation').map(record => record.value))
const budgets = computed(() => records.value.filter(record => record.kind === 'execution_budget').map(record => record.value))
const canReadConsultation = computed(() => executionSupport.value === true && status.value === 'live' && projection.value?.ready === true && projection.value.state === 'live' && !view.value?.transportStale && !view.value?.authorizationPending && !locked.value && !document.hidden)
function consultationRefs(conversation: (typeof conversations.value)[number]) {
  return [...new Set([conversation.content_ref, ...conversation.message_refs].filter((value): value is string => typeof value === 'string' && value.startsWith('consultation-message:')))]
}
function detailIsReferenced(value: ConsultationDetail) {
  return value.sourceId === props.source.id && value.runId === props.runId && conversations.value.some(conversation => conversation.graph_run_id === value.runId && conversation.conversation_id === value.conversationId && consultationRefs(conversation).includes(value.ref))
}
function clearDetail() {
  clearTimeout(detailDeadline); detailDeadline = undefined; detail.value = null
}
function readConsultation(conversationId: string, ref: string) {
  refresh()
  if (detail.value || !canReadConsultation.value || !socket) return
  const request: ConsultationDetail = { conversationId, ref, sourceId: props.source.id, runId: props.runId, messageId: crypto.randomUUID(), availability: 'pending', content: null }
  if (!detailIsReferenced(request)) return
  detail.value = request
  detailDeadline = window.setTimeout(() => {
    detailDeadline = undefined
    if (detail.value === request) detail.value = { ...request, availability: 'timeout' }
  }, 10000)
  try {
    socket.send(JSON.stringify({ protocol: GRAPH_WIRE_PROTOCOL, type: 'graph.artifact.get', message_id: request.messageId, source_id: request.sourceId, graph_run_id: request.runId, ref: request.ref, page_token: null, limit: 1 }))
  } catch { fail() }
}
function stop() {
  clearDetail()
  clearTimeout(freshness); clearTimeout(deadline)
  freshness = undefined; deadline = undefined
  const previous = socket
  socket = null; consumer = null; view.value = null; executionSupport.value = null; status.value = 'idle'
  if (previous) { previous.onopen = null; previous.onmessage = null; previous.onclose = null; previous.onerror = null; previous.close() }
}
function fail() {
  stop(); status.value = 'unavailable'
  error.value = 'Live observation ended or access changed. Refresh authorized sources before reconnecting.'
  emit('invalidated')
}
function refresh() {
  if (!consumer) return
  clearTimeout(freshness)
  const next = consumer.read()
  if (next.invalidated || !next.scopeId) { fail(); return }
  view.value = next
  const source = next.sources.find(item => item.source.source_id === props.source.id)
  if (!source || source.state === 'denied' || source.state === 'unsupported') { fail(); return }
  status.value = next.transportStale || source.state === 'stale' ? 'stale' : source.ready ? 'live' : 'connecting'
  if (source.ready) { clearTimeout(deadline); deadline = undefined }
  const expiresIn = Date.parse(next.authorizationExpiresAt!) - Date.now()
  freshness = window.setTimeout(refresh, Math.max(1, next.transportStale ? expiresIn : Math.min(15000, expiresIn)))
}
function connect() {
  stop(); error.value = ''
  if (locked.value || document.hidden) return
  status.value = 'connecting'
  const subscriptionId = crypto.randomUUID(), helloId = crypto.randomUUID()
  const current = new WebSocket(`${wsBase()}/ws/graphs`)
  let state: GraphWireSourceState | null = null
  socket = current
  const send = (value: unknown) => current.send(JSON.stringify(value))
  deadline = window.setTimeout(() => { if (socket === current) fail() }, 10000)
  current.onopen = () => {
    if (socket !== current) return
    try {
      send({ type: 'open', source_id: props.source.id, source_token: props.source.token, run_id: props.runId })
      send({ protocol: GRAPH_WIRE_PROTOCOL, type: 'hello', message_id: helloId, supported_protocols: [GRAPH_WIRE_PROTOCOL], extensions: [GRAPH_WIRE_EXECUTION_EXTENSION] })
    } catch { fail() }
  }
  current.onmessage = event => {
    if (socket !== current) return
    try {
      if (typeof event.data !== 'string' || new TextEncoder().encode(event.data).byteLength > 2 * 1024 * 1024) throw new Error()
      const frame: unknown = JSON.parse(event.data)
      if (!frame || typeof frame !== 'object' || Array.isArray(frame)) throw new Error()
      const envelope = frame as Record<string, unknown>
      if (envelope.protocol !== GRAPH_WIRE_PROTOCOL || typeof envelope.type !== 'string' || envelope.type === 'error') throw new Error()
      if (!state) {
        const sources = envelope.sources
        if (envelope.type !== 'hello' || envelope.in_reply_to !== helloId || !Array.isArray(envelope.extensions) || envelope.extensions.length > 1 || envelope.extensions.some(extension => extension !== GRAPH_WIRE_EXECUTION_EXTENSION) || !Array.isArray(sources) || sources.length !== 1 || sources[0]?.source_id !== props.source.id || sources[0]?.kind !== 'graph' || sources[0]?.profile_id !== null || sources[0]?.bot_id !== null) throw new Error()
        const capabilities = sources[0].capabilities
        if (!Array.isArray(capabilities) || capabilities.some(capability => !['graph.runs.v1', 'graph.history.v1', GRAPH_WIRE_EXECUTION_EXTENSION].includes(capability))) throw new Error()
        const supportsExecution = envelope.extensions.includes(GRAPH_WIRE_EXECUTION_EXTENSION)
        if (supportsExecution && !capabilities.includes(GRAPH_WIRE_EXECUTION_EXTENSION)) throw new Error()
        state = new GraphWireSourceState({ subscriptionId, mode: 'live', scope: { graph_run_id: props.runId, source_ids: [props.source.id] }, extensions: [...envelope.extensions], limits: { maxRecords: 10000, maxPages: 128, maxEvents: 10000 } })
        consumer = state; executionSupport.value = supportsExecution
        send({ protocol: GRAPH_WIRE_PROTOCOL, type: 'subscribe', message_id: crypto.randomUUID(), subscription_id: subscriptionId, mode: 'live', scope: { source_ids: [props.source.id], graph_run_id: props.runId }, resume: null })
        return
      }
      if (envelope.type === 'hello') throw new Error()
      if (envelope.type === 'graph.artifact') {
        validateGraphWireArtifactFrame(frame)
        // Recheck the live grant and observed references before every protected output.
        refresh()
        const request = detail.value
        if (socket !== current || !canReadConsultation.value || !request || request.availability !== 'pending' || !detailIsReferenced(request) || frame.in_reply_to !== request.messageId || frame.source_id !== request.sourceId || frame.graph_run_id !== request.runId || frame.ref !== request.ref) throw new Error()
        clearTimeout(detailDeadline); detailDeadline = undefined
        detail.value = { ...request, availability: frame.availability, content: frame.content }
        return
      }
      // The shared consumer validates source membership, leases, records and revisions.
      state.apply(frame as GraphWireSourceFrame)
      refresh()
    } catch { fail() }
  }
  current.onclose = current.onerror = () => { if (socket === current) fail() }
}
function visibility() { if (document.hidden && socket) { stop(); emit('invalidated') } }
watch(() => [props.source.id, props.source.token, props.runId], stop, { flush: 'sync' })
watch(locked, value => { if (value && socket) { stop(); emit('invalidated') } }, { flush: 'sync' })
watch([canReadConsultation, conversations], () => {
  if (detail.value && (!canReadConsultation.value || !detailIsReferenced(detail.value))) clearDetail()
}, { flush: 'sync' })
onMounted(() => document.addEventListener('visibilitychange', visibility))
onBeforeUnmount(() => { document.removeEventListener('visibilitychange', visibility); stop() })
</script>

<template>
  <section class="live-run" :aria-label="t('Live Graph observation')">
    <h3>{{ t('Live Graph observation') }}</h3>
    <p>{{ t('Read-only live Graph observation. Negotiated live sources can read protected consultation text referenced by this Run. No execution controls are available.') }}</p>
    <p v-if="executionSupport === true">{{ t('Execution summaries negotiated for this source.') }}</p>
    <p v-else-if="executionSupport === false">{{ t('Base-only legacy source: live topology, Bot bindings, dependencies and transfers. Execution summaries are unavailable on this connection.') }}</p>
    <button type="button" :disabled="status === 'connecting' || status === 'live'" @click="connect">{{ t('Observe live') }}</button>
    <button v-if="status === 'connecting' || status === 'live' || status === 'stale'" type="button" @click="stop">{{ t('Disconnect live observation') }}</button>
    <p role="status">{{ tl(`Connection: ${status}`) }}</p>
    <p v-if="status === 'stale'">{{ t('Connection is stale. Displayed records are not confirmed current.') }}</p>
    <p v-if="error" role="alert">{{ t(error) }}</p>
    <template v-if="runRecord && projection?.cursor">
      <p>{{ tl(`Graph ${runRecord.graph_id} · definition ${runRecord.definition_revision} · topology revision ${runRecord.revision}`) }}</p>
      <p>{{ tl(`Committed cursor ${projection.cursor.journal_id}:${projection.cursor.seq}`) }}</p>
      <h4>{{ t('Live topology') }}</h4>
      <ul><li v-for="node in runRecord.definition.nodes" :key="node.node_id"><strong>{{ node.label }}</strong> · {{ node.node_id }}<template v-if="node.bot"> · {{ node.bot.bot_id }}</template></li></ul>
      <ul><li v-for="edge in runRecord.definition.edges" :key="edge.edge_id">{{ edge.from_node_id }} → {{ edge.to_node_id }} · {{ edge.edge_id }}</li></ul>
      <h4>{{ t('Bot bindings') }}</h4>
      <ul><li v-for="binding in bindings" :key="binding.binding_id">{{ binding.node_id }} · {{ binding.job.bot_id }} / {{ binding.job.job_id }} · {{ binding.acceptance }}<template v-if="binding.reason"> · {{ binding.reason }}</template></li></ul>
      <h4>{{ t('Dependencies') }}</h4>
      <ul><li v-for="dependency in dependencies" :key="dependency.dependency_id">{{ dependency.edge_id }} · {{ dependency.state }}<template v-if="dependency.reason"> · {{ dependency.reason }}</template></li></ul>
      <h4>{{ t('Transfers') }}</h4>
      <ul><li v-for="transfer in transfers" :key="transfer.transfer_id">{{ transfer.edge_id }} · {{ transfer.state }}<template v-if="transfer.reason"> · {{ transfer.reason }}</template></li></ul>
      <template v-if="executionSupport">
        <h4>{{ t('Execution Run') }}</h4>
        <p v-if="executionRun">{{ tl(`Run ${executionRun.graph_run_id} · ${executionRun.state} · revision ${executionRun.revision}`) }}<template v-if="executionRun.reason"> · {{ executionRun.reason }}</template></p>
        <p v-else>{{ t('No execution records have been published for this Run.') }}</p>
        <h4>{{ t('Members') }}</h4>
        <ul><li v-for="member in members" :key="member.member_id"><strong>{{ member.label }}</strong> · {{ member.member_id }} · {{ member.duty }}<template v-if="member.bot"> · {{ member.bot.bot_id }}</template><template v-else> · {{ t('No Bot binding') }}</template></li></ul>
        <h4>{{ t('Invocations') }}</h4>
        <ul><li v-for="invocation in invocations" :key="invocation.invocation_id">{{ invocation.invocation_id }} · {{ invocation.node_id }} · {{ invocation.kind }} · {{ invocation.state }} · {{ invocation.origin }} · {{ tl(`iteration ${invocation.iteration}`) }}<template v-if="invocation.member_id"> · {{ tl(`member ${invocation.member_id}`) }}</template><template v-if="invocation.selected_outcome"> · {{ tl(`outcome ${invocation.selected_outcome}`) }}</template><template v-if="invocation.wait_reason"> · {{ invocation.wait_reason }}</template></li></ul>
        <h4>{{ t('Attempts') }}</h4>
        <ul><li v-for="attempt in attempts" :key="attempt.attempt_id">{{ attempt.attempt_id }} · {{ attempt.invocation_id }} · {{ tl(`attempt ${attempt.number}`) }} · {{ attempt.executor_kind }} · {{ attempt.state }}<template v-if="attempt.job"> · {{ attempt.job.bot_id }} / {{ attempt.job.job_id }}</template><template v-else> · {{ attempt.executor_kind === 'bot' ? t('No Bot Job reported') : t('Non-Bot work (no Bot Job)') }}</template></li></ul>
        <h4>{{ t('Conversations') }}</h4>
        <ul>
          <li v-for="conversation in conversations" :key="conversation.conversation_id">
            {{ conversation.conversation_id }} · {{ conversation.requester_member }} → {{ conversation.responder_member }} · {{ conversation.state }} · {{ tl(`${conversation.remaining_rounds} rounds remaining`) }} · {{ tl(`deadline ${conversation.deadline}`) }}
            <ul><li v-for="ref in consultationRefs(conversation)" :key="ref"><button type="button" :disabled="!canReadConsultation || detail !== null" @click="readConsultation(conversation.conversation_id, ref)">{{ tl(`Read consultation text: ${ref}`) }}</button></li></ul>
          </li>
        </ul>
        <section v-if="detail" :aria-label="t('Protected consultation text')">
          <p>{{ tl(`Consultation ${detail.conversationId} · ${detail.ref}`) }}</p>
          <p v-if="detail.availability === 'pending'" role="status">{{ t('Reading protected consultation text…') }}</p>
          <pre v-else-if="detail.availability === 'available'">{{ detail.content }}</pre>
          <p v-else-if="detail.availability === 'expired'" role="status">{{ t('This consultation text has expired.') }}</p>
          <p v-else-if="detail.availability === 'missing'" role="status">{{ t('This consultation text is missing.') }}</p>
          <p v-else-if="detail.availability === 'unknown'" role="status">{{ t('Availability of this consultation text is unknown.') }}</p>
          <p v-else role="status">{{ t('The consultation text request timed out.') }}</p>
          <button type="button" :disabled="detail.availability === 'pending'" @click="clearDetail">{{ t('Close consultation text') }}</button>
        </section>
        <h4>{{ t('Budgets') }}</h4>
        <ul><li v-for="budget in budgets" :key="budget.budget_id">{{ budget.budget_id }} · {{ budget.scope_key }} · {{ tl(`${budget.consumed} / ${budget.limit} consumed`) }}</li></ul>
      </template>
    </template>
  </section>
</template>

<style scoped>
.live-run { margin: 16px 0; padding: 12px; border: 1px solid var(--line); overflow-wrap: anywhere; }
h3, h4 { font: 12px var(--mono); } p, li { color: var(--text-2); font-size: 12px; line-height: 1.6; }
button { min-height: 44px; padding: 8px 12px; margin: 0 8px 8px 0; border: 1px solid var(--line); color: var(--text); background: var(--surface); cursor: pointer; }
button:disabled { opacity: .5; cursor: not-allowed; } button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; font: 12px var(--mono); }
</style>
