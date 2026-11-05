import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import type { BotRequestProjection, BotWorkspaceBot, BotWorkspaceCommand, BotWorkspaceDetail, BotWorkspaceDetailRequest, BotWorkspaceReceipt, BotWorkspaceSnapshot, BotWorkspaceTarget, JobProjection } from '#shared/botWorkspace'
import { api, ApiError } from '~/composables/useHerdr'
import { botKey, controlReason, decodeBotDetail, jobKey } from '~/utils/bots/workspace'
import type { BotAnswers, BotDetailContent, BotDetailTab, BotView } from '~/utils/bots/workspace'
import { createSampleWorkspace } from '~/utils/bots/sample'
import type { SampleWorkspace } from '~/utils/bots/sample'

export interface BotOperation { command: BotWorkspaceCommand, receipt: BotWorkspaceReceipt | null, outcome: BotRequestProjection | null, error: string, uncertain: boolean }
const POLL_MS = 15000
const STALE_MS = 45000
export function useBotWorkspace(sampleMode: boolean) {
  const sample: SampleWorkspace | null = sampleMode ? createSampleWorkspace() : null
  const snapshot = shallowRef<BotWorkspaceSnapshot | null>(sample?.snapshot || null)
  const loading = ref(false)
  const error = ref('')
  const authRequired = ref(false)
  const online = ref(true)
  const now = ref(Date.now())
  const receivedAt = ref(0)
  const selectedBotKey = ref('')
  const selectedJobId = ref('')
  const inspectorOpen = ref(false)
  const view = ref<BotView>('list')
  const tab = ref<BotDetailTab>('attention')
  const drafts = reactive<Record<string, string>>({})
  const answers = reactive<Record<string, BotAnswers>>({})
  const operations = ref<BotOperation[]>([])
  const details = reactive<Record<string, BotDetailContent>>({})
  const detailErrors = reactive<Record<string, string>>({})
  const detailLoading = ref(false)
  const sending = ref(false)
  let stopped = false
  let poll: number | undefined
  let snapshotController: AbortController | null = null
  let detailController: AbortController | null = null
  let commandController: AbortController | null = null
  let requestController: AbortController | null = null
  let epoch = 0
  const bots = computed(() => snapshot.value?.bots || [])
  const selectedBot = computed(() => bots.value.find(entry => botKey(entry) === selectedBotKey.value) || null)
  const selectedJob = computed(() => selectedBot.value?.jobs.find(job => job.job_id === selectedJobId.value) || null)
  const selectionKey = computed(() => selectedBot.value && selectedJob.value ? jobKey(selectedBot.value, selectedJob.value) : '')
  const selectedSource = computed(() => snapshot.value?.sources.find(source => source.id === selectedBot.value?.source_id))
  const stale = computed(() => !sampleMode && (!receivedAt.value || now.value - receivedAt.value > STALE_MS || !!error.value || (selectedBot.value ? selectedSource.value?.state !== 'live' || now.value - Date.parse(selectedBot.value.observed_at) > STALE_MS : false)))
  const ready = computed(() => !authRequired.value && (sampleMode || online.value) && !stale.value && !!selectedJob.value && !sending.value)
  const selectedOperations = computed(() => operations.value.filter(operation => operation.command.bot_id === selectedJob.value?.bot_id && operation.command.job_id === selectedJob.value?.job_id && operation.command.source_id === selectedBot.value?.source_id))
  const draft = computed({ get: () => drafts[selectionKey.value] || '', set: (value: string) => { if (selectionKey.value) drafts[selectionKey.value] = value } })
  function target(): BotWorkspaceTarget | null {
    const entry = selectedBot.value, job = selectedJob.value
    return entry && job ? { source_id: entry.source_id, bot_name: entry.bot.bot_name, bot_id: job.bot_id, job_id: job.job_id } : null
  }
  function clearProtectedState() {
    epoch++
    snapshotController?.abort(); detailController?.abort(); commandController?.abort(); requestController?.abort()
    snapshot.value = null; selectedBotKey.value = ''; selectedJobId.value = ''; inspectorOpen.value = false
    operations.value = []
    for (const store of [drafts, answers, details, detailErrors]) for (const key of Object.keys(store)) delete store[key]
  }
  function failure(cause: unknown): string {
    if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
      authRequired.value = true
      clearProtectedState()
      error.value = 'Passkey authentication is required to inspect and control Bots. Open Security settings to register or unlock a passkey, then refresh.'
      return error.value
    }
    return cause instanceof Error ? cause.message : 'The Bot source could not be read.'
  }
  async function reload() {
    if (sample || stopped || typeof document === 'undefined' || document.visibilityState !== 'visible' || !online.value) return
    snapshotController?.abort()
    const controller = new AbortController()
    snapshotController = controller
    loading.value = true
    try {
      const result = await api<BotWorkspaceSnapshot>('/api/bots/workspace', undefined, controller.signal)
      if (controller.signal.aborted || stopped) return
      snapshot.value = result; receivedAt.value = Date.now(); now.value = Date.now(); error.value = ''; authRequired.value = false
      // Retain the exact selection. Never silently switch to a different Job.
      if (selectedBotKey.value && !result.bots.some(entry => botKey(entry) === selectedBotKey.value)) selectedJobId.value = ''
    } catch (cause) {
      if (!controller.signal.aborted) error.value = failure(cause)
    } finally { if (snapshotController === controller) loading.value = false }
  }
  function selectBot(entry: BotWorkspaceBot) {
    if (selectedBotKey.value !== botKey(entry)) { selectedBotKey.value = botKey(entry); selectedJobId.value = ''; inspectorOpen.value = false }
  }
  function selectJob(entry: BotWorkspaceBot, job: JobProjection) {
    selectedBotKey.value = botKey(entry); selectedJobId.value = job.job_id; inspectorOpen.value = true
  }
  function detailKey(kind: BotWorkspaceDetailRequest['kind'], ref = ''): string { return `${selectionKey.value}:${kind}:${ref}` }
  async function loadDetail(kind: 'inspect' | 'messages' | 'events', ref = '', pageToken?: string) {
    const scope = target(), job = selectedJob.value
    if (!scope || !job || (!sample && (stale.value || !online.value || authRequired.value))) return
    const key = detailKey(kind, ref)
    detailController?.abort()
    const controller = new AbortController()
    detailController = controller; detailLoading.value = true; delete detailErrors[key]
    try {
      const request: BotWorkspaceDetailRequest = { ...scope, kind, ...(ref ? { ref } : {}), ...(pageToken ? { page_token: pageToken } : {}) }
      const result: BotWorkspaceDetail = sample ? sample.detail(job, kind, ref) : await api<BotWorkspaceDetail>('/api/bots/detail', request, controller.signal)
      if (controller.signal.aborted || stopped) return
      const content = decodeBotDetail(result)
      if (pageToken && details[key]) {
        content.items = [...details[key]!.items, ...content.items]
        if (content.text !== null && details[key]!.text !== null) content.text = details[key]!.text + content.text
      }
      details[key] = content
    } catch (cause) { if (!controller.signal.aborted) { const message = failure(cause); if (!authRequired.value) detailErrors[key] = message } }
    finally { if (detailController === controller) detailLoading.value = false }
  }
  function can(action: BotWorkspaceCommand['action']): boolean { return !!selectedJob.value && ready.value && controlReason(selectedJob.value, action) === null }
  async function dispatch(operation: BotOperation) {
    if (!ready.value || !can(operation.command.action)) return
    sending.value = true
    commandController = new AbortController()
    const currentEpoch = epoch
    try {
      const receipt = sample ? sample.submit(operation.command) : await api<BotWorkspaceReceipt>('/api/bots/command', operation.command, commandController.signal)
      if (currentEpoch !== epoch || stopped) return
      operation.receipt = receipt; operation.uncertain = false; operation.error = ''
      if (operation.command.action === 'send' && drafts[`${operation.command.source_id}:${operation.command.bot_id}:${operation.command.job_id}`] === operation.command.text) drafts[`${operation.command.source_id}:${operation.command.bot_id}:${operation.command.job_id}`] = ''
      await reload()
    } catch (cause) {
      if (currentEpoch !== epoch || stopped) return
      const message = failure(cause)
      if (!authRequired.value) {
        operation.error = message
        operation.uncertain = !(cause instanceof ApiError) || cause.status >= 500
      }
    } finally { sending.value = false }
  }
  async function command(action: BotWorkspaceCommand['action'], payload: { text?: string, model?: string, input_request_id?: string, answers?: BotAnswers } = {}) {
    const scope = target(), job = selectedJob.value
    if (!scope || !job || !can(action)) return
    if (operations.value.some(operation => operation.uncertain && operation.command.source_id === scope.source_id && operation.command.bot_id === scope.bot_id && operation.command.job_id === scope.job_id && operation.command.action === action)) return
    const value: BotOperation = { command: { ...scope, revision: job.revision, request_key: crypto.randomUUID(), action, ...payload }, receipt: null, outcome: null, error: '', uncertain: false }
    // Retain this exact intent/key in memory until resolved. Never automatically retry.
    operations.value.push(value)
    const operation = operations.value[operations.value.length - 1]!
    await dispatch(operation)
  }
  async function reconcile(operation: BotOperation) {
    if (!operation.receipt || !online.value || authRequired.value) return
    requestController?.abort()
    const controller = new AbortController()
    requestController = controller
    const currentEpoch = epoch
    try {
      const request: BotWorkspaceDetailRequest = { source_id: operation.command.source_id, bot_name: operation.command.bot_name, bot_id: operation.command.bot_id, job_id: operation.command.job_id, kind: 'request', request_id: operation.receipt.request_id }
      const result = sample ? sample.observe(operation.receipt.request_id) : await api<BotWorkspaceDetail>('/api/bots/detail', request, controller.signal)
      if (controller.signal.aborted || currentEpoch !== epoch || stopped) return
      if ('kind' in result.data && result.data.kind === 'request') operation.outcome = result.data
      operation.error = ''
      if (sample) snapshot.value = structuredClone(sample.snapshot)
      else await reload()
      // Loaded content changes only on explicit observation, not on admission.
      if (operation.outcome?.outcome === 'applied') {
        for (const key of Object.keys(details)) if (key.startsWith(`${operation.command.source_id}:${operation.command.bot_id}:${operation.command.job_id}:`)) delete details[key]
        await loadActiveDetail()
      }
    } catch (cause) { if (!controller.signal.aborted && currentEpoch === epoch) { const message = failure(cause); if (!authRequired.value) operation.error = message } }
  }
  async function loadActiveDetail() {
    if (!selectedJob.value || !inspectorOpen.value) return
    if (tab.value === 'messages') await loadDetail('messages')
    else if (tab.value === 'attention') {
      const question = selectedJob.value.input_requests.find(item => item.status === 'open')
      if (question) await loadDetail('inspect', question.prompt_ref)
    }
  }
  watch([selectionKey, tab], () => { detailController?.abort(); loadActiveDetail() })
  function visibility() {
    if (document.visibilityState !== 'visible') { snapshotController?.abort(); detailController?.abort(); requestController?.abort() }
    else reload()
  }
  function connection() { online.value = navigator.onLine; if (online.value) reload(); else { snapshotController?.abort(); detailController?.abort() } }
  onMounted(() => {
    online.value = navigator.onLine
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('online', connection); window.addEventListener('offline', connection)
    reload()
    poll = window.setInterval(() => { now.value = Date.now(); if (document.visibilityState === 'visible') reload() }, POLL_MS)
  })
  onBeforeUnmount(() => {
    stopped = true; epoch++; window.clearInterval(poll)
    snapshotController?.abort(); detailController?.abort(); commandController?.abort(); requestController?.abort()
    document.removeEventListener('visibilitychange', visibility)
    window.removeEventListener('online', connection); window.removeEventListener('offline', connection)
  })
  return { sampleMode, snapshot, bots, loading, error, authRequired, online, stale, ready, receivedAt, selectedBot, selectedJob, selectedBotKey, selectionKey, inspectorOpen, view, tab, draft, answers, operations, selectedOperations, details, detailErrors, detailLoading, sending, reload, selectBot, selectJob, detailKey, loadDetail, can, command, reconcile, retry: dispatch }
}
