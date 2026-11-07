<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { api, ApiError } from '~/composables/useHerdr'
import { t } from '~/utils/i18n'

type Source = { id: string, label: string, token: string }
type Command = { source_id: string, source_token: string, action: 'create' | 'import' | 'edit', request_key: string, name?: string, content?: string, graph_id?: string, revision?: string }
type Receipt = { request_key: string, graph_id: string | null, state: string, revision: string | null, error_code: string | null }
type Recovery = { version: 1, source_id: string, source_token: string, request_key: string }
const recoveryStorageKey = 'graph.pending-request.v1'
const recovery = ref<Recovery | null>(null), recoveryBlocked = ref(false)
const unresolved = computed(() => !!pending.value || !!recovery.value || recoveryBlocked.value)
function restoreRecovery() {
  try {
    const raw = sessionStorage.getItem(recoveryStorageKey)
    if (raw === null) { recoveryBlocked.value = false; return }
    if (raw.length > 4096) throw new Error('Invalid retained request')
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid retained request')
    const item = value as Record<string, unknown>
    if (Object.keys(item).length !== 4 || item.version !== 1 || !['source_id', 'source_token', 'request_key'].every(key => typeof item[key] === 'string' && item[key].length > 0 && item[key].length <= 256)) throw new Error('Invalid retained request')
    const retained = item as Recovery
    source.value = retained.source_id
    requestKey.value = retained.request_key
    recovery.value = retained
    recoveryBlocked.value = false
  } catch {
    recoveryBlocked.value = true
    throw new Error('Cannot recover the original Graph request. Restore browser session storage before submitting another mutation.')
  }
}
function retainRecovery(command: Command) {
  const value: Recovery = { version: 1, source_id: command.source_id, source_token: command.source_token, request_key: command.request_key }
  sessionStorage.setItem(recoveryStorageKey, JSON.stringify(value))
  recovery.value = value
}
function clearRecovery() {
  try {
    sessionStorage.removeItem(recoveryStorageKey)
    recovery.value = null
    recoveryBlocked.value = false
  } catch {
    recoveryBlocked.value = true
    error.value = 'The Graph receipt is resolved, but its recovery key could not be cleared. Restore browser session storage and reconcile before another mutation.'
  }
}
const sources = ref<Source[]>([]), source = ref(''), graphId = ref(''), revision = ref(''), content = ref(''), name = ref(''), requestKey = ref('')
const validName = computed(() => /^[a-z][a-z0-9-]*$/.test(name.value))
const busy = ref(false), error = ref(''), authRequired = ref(false), receipt = ref<Receipt | null>(null), pending = ref<Command | null>(null)
let epoch = 0
let stopped = false
function clearProtected() {
  epoch++
  sources.value = []; source.value = ''; graphId.value = ''; revision.value = ''; content.value = ''; name.value = ''; requestKey.value = ''; receipt.value = null; pending.value = null; recovery.value = null
}
function failure(cause: unknown) {
  if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
    clearProtected(); authRequired.value = true
    error.value = 'Register or unlock a passkey to access Graphs.'
  } else error.value = cause instanceof Error ? cause.message : 'Graph source unavailable.'
}
async function loadSources() {
  busy.value = true; error.value = ''
  const current = epoch
  try {
    const result = await api<{ sources: Source[] }>('/api/bots/graphs')
    if (stopped || current !== epoch) return
    if (!pending.value && sources.value.find(item => item.id === source.value)?.token !== result.sources.find(item => item.id === source.value)?.token) { revision.value = ''; content.value = '' }
    sources.value = result.sources; authRequired.value = false
    if (!pending.value) restoreRecovery()
    if (!source.value && result.sources.length === 1) source.value = result.sources[0]!.id
  } catch (cause) { if (!stopped && current === epoch) failure(cause) }
  finally { busy.value = false }
}
onMounted(() => { curPane.value = null; loadSources() })
onBeforeUnmount(() => { stopped = true; clearProtected() })
watch(source, () => { epoch++; graphId.value = ''; revision.value = ''; content.value = ''; receipt.value = null }, { flush: 'sync' })
watch(graphId, () => { revision.value = '' }, { flush: 'sync' })
type Scope = { source_id: string, source_token: string }
function selectedScope(): Scope | null {
  const token = sources.value.find(item => item.id === source.value)?.token
  return source.value && token ? { source_id: source.value, source_token: token } : null
}
async function loadDefinition(scope: Scope, id: string, current: number) {
  graphId.value = id; revision.value = ''; content.value = ''
  const result = await api<{ graph_id: string, revision: string, content: string }>('/api/bots/graphs', { source_id: scope.source_id, source_token: scope.source_token, action: 'read', graph_id: id })
  if (stopped || current !== epoch) return
  graphId.value = result.graph_id; revision.value = result.revision; content.value = result.content
}
async function acceptReceipt(result: Receipt, scope: Scope, current: number) {
  receipt.value = result
  if (result.state === 'completed' || result.state === 'rejected') { pending.value = null; requestKey.value = ''; clearRecovery() }
  if (result.state === 'completed' && result.graph_id) await loadDefinition(scope, result.graph_id, current)
}
async function readGraph() {
  const scope = selectedScope()
  if (!scope || !graphId.value || busy.value || unresolved.value) return
  busy.value = true; error.value = ''
  const current = epoch
  try { await loadDefinition(scope, graphId.value, current) }
  catch (cause) { if (!stopped && current === epoch) failure(cause) }
  finally { busy.value = false }
}
async function send(command: Command) {
  if (busy.value) return
  try { retainRecovery(command) }
  catch { error.value = 'Cannot retain the Graph request in browser session storage. No mutation was sent.'; return }
  pending.value = command; receipt.value = null; busy.value = true; error.value = ''
  const current = epoch
  try {
    const result = await api<Receipt>('/api/bots/graphs', command)
    if (stopped || current !== epoch) return
    await acceptReceipt(result, command, current)
  } catch (cause) {
    if (!stopped && current === epoch) {
      if (cause instanceof ApiError && cause.code === 'invalid_input') { pending.value = null; clearRecovery() }
      failure(cause)
    }
  }
  finally { busy.value = false }
}
function submit(action: Command['action']) {
  const scope = selectedScope()
  if (!scope || unresolved.value || busy.value) return
  requestKey.value = requestKey.value.trim() || crypto.randomUUID()
  const base = { ...scope, action, request_key: requestKey.value }
  const command: Command = action === 'create' ? { ...base, name: name.value } : action === 'import' ? { ...base, content: content.value } : { ...base, graph_id: graphId.value, revision: revision.value, content: content.value }
  send(command)
}
async function reconcile() {
  const scope = recovery.value ?? pending.value ?? selectedScope()
  const key = recovery.value?.request_key || pending.value?.request_key || requestKey.value.trim() || receipt.value?.request_key
  if (!scope || !key || busy.value) return
  busy.value = true; error.value = ''
  const current = epoch
  try {
    const result = await api<Receipt>('/api/bots/graphs', { source_id: scope.source_id, source_token: scope.source_token, action: 'receipt', request_key: key })
    if (stopped || current !== epoch) return
    await acceptReceipt(result, scope, current)
  } catch (cause) { if (!stopped && current === epoch) failure(cause) }
  finally { busy.value = false }
}
</script>

<template>
  <main class="graphs">
    <header class="graphs-head">
      <NuxtLink to="/bots" class="back-link" :aria-label="t('Back to Bots')"><UIcon name="i-lucide-chevron-left" /><span>{{ t('Bots') }}</span></NuxtLink>
      <h1>{{ t('Graph definitions') }}</h1>
      <button type="button" class="refresh" :disabled="busy" :aria-label="t('Refresh Graph sources')" @click="loadSources"><UIcon name="i-lucide-refresh-cw" /></button>
    </header>
    <div class="graphs-scroll">
      <div class="graphs-content">
        <div class="intro"><p class="eyebrow">{{ t('Authoring / local sources') }}</p><h2>{{ t('Define the work.') }}</h2><p>{{ t('Create or edit Graph Markdown in a trusted local profile. Saving a definition does not start a Run.') }}</p></div>
        <BotsGraphRunCanvas />
        <div v-if="error" role="alert" class="notice error"><strong>{{ t(authRequired ? 'Passkey required' : 'Source unavailable') }}</strong><p>{{ t(error) }}</p><NuxtLink v-if="authRequired" to="/settings?section=security" class="notice-link">{{ t('Open Security settings') }} <UIcon name="i-lucide-arrow-up-right" /></NuxtLink></div>
        <section v-if="!sources.length && !authRequired && !error && !busy" class="notice empty"><UIcon name="i-lucide-workflow" /><h3>{{ t('No Graph sources configured') }}</h3><p>{{ t('An administrator must add graph-sources.json to the server data directory. A registered passkey and unlocked session are required.') }}</p></section>
        <p v-if="busy && !sources.length" class="loading" role="status">{{ t('Reading Graph sources…') }}</p>
    <template v-if="sources.length || recovery">
      <label>{{ t('Trusted source') }} <select v-model="source" :disabled="busy || unresolved"><option value="">{{ t('Choose a source') }}</option><option v-for="item in sources" :key="item.id" :value="item.id">{{ item.label }}</option></select></label>
      <label>{{ t('Graph ID') }} <input v-model="graphId" :disabled="busy || unresolved" autocomplete="off"></label>
      <button type="button" :disabled="busy || unresolved || !source || !graphId" @click="readGraph">{{ t('Read definition') }}</button>
      <p>{{ revision ? `${t('Loaded revision')}: ${revision}` : t('Read a definition to obtain a revision before editing. Reading replaces the editor contents.') }}</p>
      <BotsGraphDefinitionCanvas v-if="revision" v-model:content="content" :disabled="busy || unresolved" />
      <label>{{ t('Name for a new Graph') }} <input v-model="name" :disabled="busy || unresolved" autocomplete="off" pattern="[a-z][a-z0-9-]*" :placeholder="t('project-plan')" aria-describedby="graph-name-hint"></label>
      <p id="graph-name-hint">{{ t('Lowercase letters, digits and hyphens, starting with a letter.') }}</p>
      <label>{{ t('Graph Markdown') }} <textarea v-model="content" :disabled="busy || unresolved" rows="18" spellcheck="false" /></label>
      <label>{{ t('Request key (optional)') }} <input v-model="requestKey" :disabled="busy || unresolved" autocomplete="off" :placeholder="t('Generated automatically')"></label>
      <p>{{ t('A fresh key is generated for each operation. Unknown requests retain their original source and key across reloads; recovery never resubmits them automatically.') }}</p>
      <div class="actions"><button type="button" :disabled="busy || unresolved || !source || !validName" @click="submit('create')">{{ t('Create') }}</button><button type="button" :disabled="busy || unresolved || !source || !content" @click="submit('import')">{{ t('Import Markdown') }}</button><button type="button" :disabled="busy || unresolved || !source || !revision || !content" @click="submit('edit')">{{ t('Save at loaded revision') }}</button><button type="button" :disabled="busy || !source || !(pending || recovery || requestKey.trim() || receipt)" @click="reconcile">{{ t('Get receipt') }}</button><button v-if="pending" type="button" :disabled="busy" @click="send(pending)">{{ t('Retry exact request') }}</button></div>
      <p v-if="recovery" role="status">{{ t('Request outcome not yet resolved. Reconcile using the original request key.') }} {{ recovery.request_key }}</p>
      <dl v-if="receipt" role="status"><dt>{{ t('Request') }}</dt><dd>{{ receipt.request_key }}</dd><dt>{{ t('State') }}</dt><dd>{{ receipt.state }}</dd><template v-if="receipt.graph_id"><dt>{{ t('Graph ID') }}</dt><dd>{{ receipt.graph_id }}</dd></template><template v-if="receipt.revision"><dt>{{ t('Revision') }}</dt><dd>{{ receipt.revision }}</dd></template><template v-if="receipt.error_code"><dt>{{ t('Error') }}</dt><dd>{{ receipt.error_code }}</dd></template></dl>
        </template>
      </div>
    </div>
  </main>
</template>

<style scoped>
.graphs { position: fixed; inset: 0; top: var(--demo-h, 0px); z-index: 3; display: flex; flex-direction: column; background: var(--bg); color: var(--text); font-family: var(--sans); padding-top: env(safe-area-inset-top); }
.graphs-head { flex: none; display: flex; align-items: center; min-height: 44px; border-bottom: 1px solid var(--line); padding: 0 8px 0 4px; gap: 8px; }
.graphs-head h1 { flex: 1; min-width: 0; margin: 0; font: 22px var(--display); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.back-link, .refresh { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; color: var(--text); }
.back-link { gap: 2px; padding: 0 8px 0 4px; font: 10px var(--mono); text-decoration: none; }
.back-link .iconify { font-size: 18px; }
.refresh { width: 44px; padding: 0; border: 0; background: none; }
.graphs-scroll { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.graphs-content { max-width: 760px; margin: 0 auto; padding: 32px 24px 64px; font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; }
.intro .eyebrow { color: var(--muted); font: 10px var(--mono); letter-spacing: .08em; text-transform: uppercase; }
.intro h2 { margin: 20px 0 12px; font: 32px/1.1 var(--display); }
.intro > p:last-child { max-width: 520px; color: var(--text-2); }
.boundary { margin: 24px 0; padding: 12px 14px; border-left: 2px solid var(--line); color: var(--muted); font: 11px/1.7 var(--mono); }
.notice { margin: 24px 0; padding: 20px; border: 1px solid var(--line); background: var(--surface); }
.notice p { margin: 8px 0 0; color: var(--text-2); }
.notice strong { font: 12px var(--mono); }
.notice.error { border-color: var(--blocked); }.notice.error strong { color: var(--blocked); }
.notice-link { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; color: var(--text); font: 11px var(--mono); text-decoration: underline; }
.empty > .iconify { color: var(--muted); font-size: 24px; }.empty h3 { margin: 14px 0 0; font: 18px var(--display); }.loading { color: var(--muted); }
label { display: grid; gap: 6px; margin: 18px 0; color: var(--text-2); font: 11px var(--mono); }
input, select, textarea { width: 100%; min-width: 0; background: var(--surface); color: var(--text); border: 1px solid var(--line); border-radius: 0; padding: 10px; font: 13px var(--sans); }
input, select { min-height: 44px; } textarea { font: 12px/1.5 var(--mono); resize: vertical; }
button { min-height: 44px; padding: 8px 14px; background: var(--surface); color: var(--text); border: 1px solid var(--line); font: 11px var(--mono); cursor: pointer; }
button:disabled { opacity: .5; cursor: not-allowed; } button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; } dl { border: 1px solid var(--line); padding: 16px; overflow-wrap: anywhere; } dt { font: 10px var(--mono); color: var(--muted); text-transform: uppercase; } dd { margin: 4px 0 12px; }
@media (max-width: 480px) { .graphs-content { padding: 24px 16px 48px; }.intro h2 { font-size: 28px; }.actions button { flex: 1 1 140px; } }
</style>
