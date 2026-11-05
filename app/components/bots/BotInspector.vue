<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { BotQuestionDetail, BotWorkspaceBot, BotWorkspaceCommand, JobProjection } from '#shared/botWorkspace'
import type { BotOperation } from '~/composables/useBotWorkspace'
import type { BotAnswers, BotDetailContent, BotDetailTab } from '~/utils/bots/workspace'
import { controlReason } from '~/utils/bots/workspace'
import { md } from '~/utils/markdown'
import { t, tl } from '~/utils/i18n'
import BotQuestionForm from './BotQuestionForm.vue'
const props = defineProps<{
  entry: BotWorkspaceBot, job: JobProjection, selectionKey: string, tab: BotDetailTab, ready: boolean, sampleMode: boolean,
  draft: string, answers: Record<string, BotAnswers>, details: Record<string, BotDetailContent>, detailErrors: Record<string, string>, detailLoading: boolean,
  operations: BotOperation[], sending: boolean, visible: boolean,
}>()
const emit = defineEmits<{
  back: [], 'update:tab': [tab: BotDetailTab], 'update:draft': [value: string], answer: [key: string, answers: BotAnswers],
  command: [action: BotWorkspaceCommand['action'], payload: { text?: string, model?: string, input_request_id?: string, answers?: BotAnswers }],
  detail: [kind: 'inspect' | 'messages', ref?: string, page?: string], reconcile: [operation: BotOperation], retry: [operation: BotOperation],
}>()
const backButton = ref<HTMLButtonElement | null>(null)
function focusInspector() {
  if (props.visible && window.matchMedia('(max-width: 1023px)').matches) backButton.value?.focus({ preventScroll: true })
}
onMounted(focusInspector)
watch([() => props.visible, () => props.selectionKey], focusInspector, { flush: 'post' })
const questionRef = ref('')
const artifactRef = ref('')
const modelOpen = ref(false)
const model = ref('')
const questionRequests = computed(() => props.job.input_requests.filter(request => request.status === 'open'))
const activeRequest = computed(() => questionRequests.value.find(request => request.prompt_ref === questionRef.value) || questionRequests.value[0] || null)
const detailKey = computed(() => `${props.selectionKey}:${props.tab === 'messages' ? 'messages:' : 'inspect:' + (props.tab === 'artifacts' ? artifactRef.value : activeRequest.value?.prompt_ref || '')}`)
const content = computed(() => props.details[detailKey.value])
const answerKey = computed(() => `${props.selectionKey}:${activeRequest.value?.input_request_id || ''}`)
const question = computed<BotQuestionDetail | null>(() => {
  const value = content.value?.question
  return value && value.input_request_id === activeRequest.value?.input_request_id ? value : null
})
const questionPending = computed(() => props.operations.some(operation => operation.command.input_request_id === activeRequest.value?.input_request_id && (operation.uncertain || (!!operation.receipt && operation.outcome?.outcome !== 'rejected' && operation.outcome?.outcome !== 'cancelled'))))
const artifactRefs = computed(() => [...new Set([...(props.job.output_ref ? [props.job.output_ref] : []), ...props.job.artifact_ids])])
const tabs: BotDetailTab[] = ['attention', 'messages', 'artifacts', 'usage']
watch(() => props.selectionKey, () => { questionRef.value = ''; artifactRef.value = ''; modelOpen.value = false; model.value = '' })
function questionSelect(value: string) { questionRef.value = value; emit('detail', 'inspect', value) }
function menuItems(): MenuItem[] {
  const actions: Array<{ action: BotWorkspaceCommand['action'], label: string, icon: string }> = [
    { action: 'interrupt', label: 'Interrupt', icon: 'i-lucide-pause' }, { action: 'resume', label: 'Resume', icon: 'i-lucide-play' }, { action: 'compact', label: 'Compact context', icon: 'i-lucide-minimize-2' }, { action: 'set-model', label: 'Change model', icon: 'i-lucide-sliders-horizontal' }, { action: 'stop', label: 'Stop this Job…', icon: 'i-lucide-square' },
  ]
  return [{ kind: 'note', label: tl(`Controls apply only to ${props.entry.bot.bot_name} / ${props.job.job_id}`) }, ...actions.map(item => ({ label: t(item.label), icon: item.icon, danger: item.action === 'stop', disabled: !props.ready || controlReason(props.job, item.action) !== null || props.operations.some(operation => operation.uncertain && operation.command.action === item.action), desc: controlReason(props.job, item.action) || undefined, run: () => runControl(item.action) }))]
}
async function runControl(action: BotWorkspaceCommand['action']) {
  if (!props.ready || controlReason(props.job, action)) return
  if (action === 'set-model') { modelOpen.value = true; return }
  if (action === 'stop') {
    const scope = props.selectionKey
    const confirmed = await askConfirm(tl(`Stop only Job ${props.job.job_id} on Bot ${props.entry.bot.bot_name}? Other Jobs and Bots stay open. Admission is not proof that this Job has stopped.`), t('Request stop'))
    if (!confirmed || scope !== props.selectionKey || !props.ready) return
  }
  emit('command', action, {})
}
function reply() {
  if (!activeRequest.value || !question.value) return
  emit('command', 'reply', { input_request_id: activeRequest.value.input_request_id, answers: props.answers[answerKey.value] || {} })
}
</script>

<template>
  <aside class="bot-inspector" :aria-label="t('Job inspector')">
    <header class="inspector-head">
      <button ref="backButton" type="button" class="icon-btn inspector-back" :aria-label="t('Back to Jobs')" @click="emit('back')"><UIcon name="i-lucide-chevron-left" /></button>
      <div><strong>{{ entry.bot.bot_name }}</strong><small>{{ sampleMode ? tl(`Sample · ${job.job_id}`) : job.job_id }}</small></div>
      <SpaceMenu :items="menuItems" :title="tl(`Job controls · ${entry.bot.bot_name}`)" :label="t('Job controls')" />
    </header>
    <div class="inspector-scroll">
      <div class="job-summary">
        <p class="job-state" :class="job.state"><i aria-hidden="true" />{{ t(job.state.replaceAll('_', ' ')) }}<span>{{ t(job.phase) }}</span></p>
        <h2>{{ job.goal_preview }}</h2>
        <p v-if="job.progress" class="measured-progress">{{ tl(`${job.progress.completed} / ${job.progress.total} ${job.progress.unit}`) }} <small>{{ tl(`Measured by ${job.progress.source}`) }}</small></p>
        <p v-if="job.wait" class="job-wait">{{ job.wait.message }}</p>
        <p v-if="job.error" class="inspector-error">{{ t(job.error.message) }}</p>
        <dl class="model-summary"><dt>{{ t('Current model') }}</dt><dd>{{ job.model.current || t('Unknown') }}</dd><dt>{{ t('Pending model') }}</dt><dd>{{ job.model.pending || t('None') }}</dd></dl>
        <p v-if="!ready" class="read-only-note">{{ t('Read only until this source is fresh, online and ready.') }}</p>
      </div>
      <form v-if="modelOpen" class="model-form" @submit.prevent="emit('command', 'set-model', { model: model.trim() }); modelOpen = false">
        <label for="bot-pending-model">{{ t('Model for this Job only') }}</label><input id="bot-pending-model" v-model="model" type="text" required :placeholder="t('provider/model')">
        <p>{{ t('A requested model may remain pending until the runtime can apply it.') }}</p>
        <div><button type="button" class="mono-btn" @click="modelOpen = false">{{ t('Cancel') }}</button><button type="submit" class="mono-btn" :disabled="!ready || !model.trim()">{{ t('Request model') }}</button></div>
      </form>
      <nav class="inspector-tabs" :aria-label="t('Job details')"><button v-for="value in tabs" :key="value" type="button" :aria-pressed="tab === value" :class="{ selected: tab === value }" @click="emit('update:tab', value)">{{ t(value === 'attention' ? 'Attention' : value === 'messages' ? 'Messages' : value === 'artifacts' ? 'Artifacts' : 'Usage') }}</button></nav>
      <section class="inspector-detail" :aria-busy="detailLoading">
        <template v-if="tab === 'attention'">
          <label v-if="questionRequests.length > 1" class="question-picker">{{ t('Open question') }}<select :value="activeRequest?.prompt_ref" @change="questionSelect(($event.target as HTMLSelectElement).value)"><option v-for="request in questionRequests" :key="request.input_request_id" :value="request.prompt_ref">{{ request.input_request_id }}</option></select></label>
          <BotQuestionForm v-if="question" :question="question" :answers="answers[answerKey] || {}" :disabled="!ready || questionPending" @update:answers="emit('answer', answerKey, $event)" @submit="reply" />
          <template v-else-if="activeRequest"><p>{{ t(content?.text || 'Question details load only for this selected Job.') }}</p><button type="button" class="mono-btn" :disabled="detailLoading" @click="emit('detail', 'inspect', activeRequest.prompt_ref)">{{ t('Load question') }}</button></template>
          <template v-else><h3>{{ t('No open question') }}</h3><p>{{ t('A follow-up is a separate message, not an answer to a closed question.') }}</p></template>
          <p v-if="job.ownership.state === 'uncertain'" class="inspector-error">{{ t('Runtime ownership is uncertain. Inspect the actual runtime before resuming work.') }}</p>
          <p v-if="job.input_requests.some(request => request.status !== 'open')" class="detail-note">{{ t('A reply or completion is queued. This is not proof that the question was consumed.') }}</p>
        </template>
        <template v-else-if="tab === 'messages'">
          <p class="detail-note">{{ t('Messages are fetched on demand for this exact Job.') }}</p>
          <article v-for="item in content?.items || []" :key="item.id" class="message"><h3>{{ t(item.label) }}</h3><ChatMarkdown :html="md(item.text, { plain: true })" :typing="null" /></article>
          <p v-if="content && !content.items.length">{{ t('No renderable messages in this page.') }}</p>
          <button type="button" class="mono-btn" :disabled="detailLoading" @click="emit('detail', 'messages')">{{ t('Refresh messages') }}</button>
        </template>
        <template v-else-if="tab === 'artifacts'">
          <p class="detail-note">{{ t('References belong to this Job. Content is fetched only when opened and is never executed.') }}</p>
          <button v-for="refValue in artifactRefs" :key="refValue" type="button" class="artifact-ref" :aria-pressed="artifactRef === refValue" @click="artifactRef = refValue; emit('detail', 'inspect', refValue)"><UIcon name="i-lucide-file-text" /><span>{{ refValue === job.output_ref ? t('Output') : t('Artifact') }}<small>{{ refValue }}</small></span></button>
          <p v-if="!artifactRefs.length">{{ t('No output or artifact reference has been reported.') }}</p>
          <ChatMarkdown v-if="content?.text !== null && content?.text !== undefined" class="artifact-content" :html="md(content.text, { plain: true })" :typing="null" />
        </template>
        <template v-else>
          <p class="detail-note">{{ t('Reported usage and context estimates. Unknown values are not zero.') }}</p>
          <dl class="usage-grid"><dt>{{ t('Input tokens') }}</dt><dd>{{ job.usage.input_tokens ?? t('Unknown') }}</dd><dt>{{ t('Output tokens') }}</dt><dd>{{ job.usage.output_tokens ?? t('Unknown') }}</dd><dt>{{ t('Cache read') }}</dt><dd>{{ job.usage.cache_read_tokens ?? t('Unknown') }}</dd><dt>{{ t('Cache write') }}</dt><dd>{{ job.usage.cache_write_tokens ?? t('Unknown') }}</dd><dt>{{ t('Cost · USD') }}</dt><dd>{{ job.usage.cost_usd ?? t('Unknown') }}</dd><dt>{{ t('Completeness') }}</dt><dd>{{ t(job.usage.completeness) }}</dd><dt>{{ t('Measured at') }}</dt><dd>{{ job.usage.measured_at || t('Unknown') }}</dd><dt>{{ t('Context used / limit') }}</dt><dd>{{ job.context.used_tokens ?? t('Unknown') }} / {{ job.context.limit_tokens ?? t('Unknown') }}</dd><dt>{{ t('Revision') }}</dt><dd>{{ job.revision }}</dd><dt>{{ t('Ownership') }}</dt><dd>{{ t(job.ownership.state) }}</dd><dt>{{ t('Pending deliveries') }}</dt><dd>{{ job.pending_delivery_count }}</dd></dl>
        </template>
        <p v-if="detailLoading" role="status">{{ t('Loading Job details…') }}</p>
        <p v-if="detailErrors[detailKey]" role="alert" class="inspector-error">{{ t(detailErrors[detailKey]!) }}</p>
        <p v-if="content?.availability && content.availability !== 'available'" class="detail-note">{{ tl(`Reference is ${content.availability}.`) }}</p>
        <button v-if="content?.next" type="button" class="mono-btn" :disabled="detailLoading" @click="emit('detail', tab === 'messages' ? 'messages' : 'inspect', tab === 'artifacts' ? artifactRef : activeRequest?.prompt_ref, content.next)">{{ t('Load next page') }}</button>
      </section>
      <section v-if="operations.length" class="operations" :aria-label="t('Operation receipts')" aria-live="polite">
        <h3>{{ t('Requests · admission and outcome') }}</h3>
        <article v-for="operation in operations" :key="operation.command.request_key" class="operation">
          <strong>{{ t(operation.command.action) }} · {{ operation.receipt ? t('Admitted') : operation.uncertain ? t('Admission unknown') : operation.error ? t('Not admitted') : t('Sending') }}</strong>
          <small v-if="operation.receipt">{{ operation.receipt.request_id }}</small>
          <p v-if="operation.receipt">{{ t('Actual outcome') }}: {{ t(operation.outcome?.outcome || 'Not yet observed') }}</p>
          <p v-if="operation.outcome?.error">{{ t(operation.outcome.error.message) }}</p>
          <p v-if="operation.error" class="inspector-error">{{ t(operation.error) }}</p>
          <p v-if="operation.uncertain" class="detail-note">{{ t('Do not create a replacement request. Retrying below reuses the original intent and key.') }}</p>
          <button v-if="operation.receipt" type="button" class="mono-btn" :disabled="!ready" @click="emit('reconcile', operation)">{{ t(sampleMode ? 'Observe sample outcome' : 'Check actual outcome') }}</button>
          <button v-else-if="operation.uncertain" type="button" class="mono-btn" :disabled="!ready || sending" @click="emit('retry', operation)">{{ t('Retry original request') }}</button>
        </article>
      </section>
      <form class="follow-up" @submit.prevent="emit('command', 'send', { text: draft.trim() })">
        <label for="bot-follow-up">{{ t('Separate follow-up') }}</label><p>{{ t('Appends input to this Job. Does not answer the question above.') }}</p>
        <textarea id="bot-follow-up" :value="draft" rows="3" :placeholder="t('Add context for this Job…')" @input="emit('update:draft', ($event.target as HTMLTextAreaElement).value)" />
        <button type="submit" class="mono-btn" :disabled="!ready || !draft.trim() || controlReason(job, 'send') !== null || operations.some(operation => operation.uncertain && operation.command.action === 'send')"><UIcon name="i-lucide-arrow-up" />{{ t('Send follow-up') }}</button>
        <p>{{ t('Nothing is queued while offline. Drafts stay on this page until sent or authentication is lost.') }}</p>
      </form>
    </div>
  </aside>
</template>

<style scoped>
.bot-inspector { display: flex; flex-direction: column; height: 100%; min-width: 0; background: var(--bg); border-left: 1px solid var(--line); }
.inspector-head { height: 44px; min-height: 44px; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--line); padding: 0 8px 0 16px; }
.inspector-head > div { flex: 1; min-width: 0; }.inspector-head strong { font: 14px var(--display); }.inspector-head small { font: 9px var(--mono); color: var(--muted); overflow: hidden; text-overflow: ellipsis; display: block; white-space: nowrap; margin-top: 3px; }
.inspector-head :deep(button.space-menu) { min-width: 44px; min-height: 44px; border-radius: 0; }
.inspector-back { display: none; }.inspector-scroll { overflow-y: auto; flex: 1; min-height: 0; overscroll-behavior: contain; }
.job-summary { padding: 20px 16px; }.job-state { display: flex; align-items: center; gap: 7px; text-transform: uppercase; font: 10px var(--mono); color: var(--muted); margin: 0 0 14px; }.job-state i { width: 7px; height: 7px; background: var(--muted); }.job-state.waiting_input i, .job-state.failed i { background: var(--blocked); }.job-state.running i { background: var(--working); }.job-state.idle i { background: none; border: 1px solid var(--idle); }.job-state span { margin-left: auto; font-size: 9px; }
h2 { font: 22px/1.2 var(--display); margin: 0 0 16px; overflow-wrap: anywhere; }h3 { font: 12px var(--mono); margin: 0 0 12px; }.measured-progress, .job-wait { font-size: 12px; line-height: 1.6; }.measured-progress small { display: block; color: var(--muted); font-size: 10px; }
.model-summary, .usage-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr); gap: 8px 12px; font-size: 11px; }.model-summary { margin: 20px 0 0; }.model-summary dt, .usage-grid dt { color: var(--muted); }.model-summary dd, .usage-grid dd { margin: 0; font-family: var(--mono); overflow-wrap: anywhere; }.read-only-note, .detail-note { color: var(--muted); font-size: 11px; line-height: 1.65; }.read-only-note { color: var(--blocked); margin-bottom: 0; }
.inspector-tabs { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-block: 1px solid var(--line); }.inspector-tabs button { min-height: 44px; font: 10px var(--mono); background: none; border: 0; color: var(--muted); cursor: pointer; padding: 0 2px; }.inspector-tabs button.selected { color: var(--text); box-shadow: inset 0 -2px var(--accent); }
.inspector-detail { padding: 20px 16px; font-size: 13px; line-height: 1.6; }.inspector-detail > p:first-child { margin-top: 0; }.question-picker { display: grid; gap: 8px; font: 11px var(--mono); margin-bottom: 16px; }
.message { border-bottom: 1px solid var(--line-soft); padding: 16px 0; }.message h3 { color: var(--muted); text-transform: uppercase; font-size: 10px; }.message p { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; }
.artifact-ref { display: flex; align-items: center; gap: 10px; background: none; color: var(--text); border: 1px solid var(--line); padding: 10px; width: 100%; min-height: 52px; text-align: left; margin: 10px 0; cursor: pointer; }.artifact-ref[aria-pressed=true] { border-color: var(--accent); }.artifact-ref span { min-width: 0; }.artifact-ref small { display: block; font: 9px var(--mono); color: var(--muted); overflow-wrap: anywhere; margin-top: 4px; }.artifact-content { white-space: pre-wrap; overflow-wrap: anywhere; font: 11px/1.7 var(--mono); border: 1px solid var(--line); background: var(--surface); padding: 12px; }
.operations { border-top: 1px solid var(--line); padding: 20px 16px; }.operations > h3 { font-size: 10px; text-transform: uppercase; color: var(--muted); }.operation { padding: 14px 0; border-bottom: 1px solid var(--line-soft); font-size: 12px; }.operation strong { font-size: 12px; }.operation small { display: block; font: 9px var(--mono); color: var(--muted); overflow-wrap: anywhere; margin-top: 7px; }
.follow-up, .model-form { border-top: 1px solid var(--line); padding: 20px 16px max(20px, env(safe-area-inset-bottom)); }.follow-up label, .model-form label { font: 11px var(--mono); text-transform: uppercase; }.follow-up p, .model-form p { font-size: 11px; color: var(--muted); line-height: 1.6; }.follow-up textarea, .model-form input, select { width: 100%; min-height: 44px; border: 1px solid var(--line); background: var(--bg); color: var(--text); border-radius: 0; font: 14px var(--sans); padding: 10px; }.follow-up textarea { resize: vertical; }.follow-up button { margin-top: 10px; width: 100%; justify-content: center; gap: 8px; }.model-form input { margin-top: 10px; }.model-form > div { display: flex; gap: 8px; }
.mono-btn { min-height: 44px; }.inspector-error { color: var(--blocked); font-size: 12px; overflow-wrap: anywhere; }button:disabled { opacity: .5; cursor: not-allowed; }
@media (max-width: 1023px) { .bot-inspector { border-left: 0; }.inspector-back { display: inline-flex; min-width: 44px; height: 44px; align-items: center; justify-content: center; }.inspector-head { padding-left: 0; }.inspector-head strong { font-size: 15px; }.inspector-scroll { padding-inline: max(0px, env(safe-area-inset-left)) max(0px, env(safe-area-inset-right)); } }
</style>
