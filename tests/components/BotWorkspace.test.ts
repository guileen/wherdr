import { defineComponent } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { readBody, setResponseStatus } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BotWorkspaceCommand, BotWorkspaceDetailRequest } from '#shared/botWorkspace'
import { useBotWorkspace } from '~/composables/useBotWorkspace'
import { createSampleWorkspace } from '~/utils/bots/sample'
import BotWorkspaceView from '~/components/bots/BotWorkspaceView.vue'

let source = createSampleWorkspace()
let reads = 0
let detailReads = 0
let unauthorized = false
const commands: BotWorkspaceCommand[] = []
registerEndpoint('/api/bots/workspace', { method: 'GET', handler: event => {
  reads++
  if (unauthorized) { setResponseStatus(event, 401); return { code: 'auth_required', error: 'Passkey required' } }
  const snapshot = structuredClone(source.snapshot)
  snapshot.observed_at = new Date().toISOString()
  for (const entry of snapshot.bots) entry.observed_at = snapshot.observed_at
  return snapshot
} })
registerEndpoint('/api/bots/detail', { method: 'POST', handler: async event => {
  detailReads++
  const body = await readBody<BotWorkspaceDetailRequest>(event)
  if (body.kind === 'request') return source.observe(body.request_id!)
  const job = source.snapshot.bots.find(entry => entry.bot.bot_id === body.bot_id)!.jobs.find(job => job.job_id === body.job_id)!
  return source.detail(job, body.kind, body.ref)
} })
registerEndpoint('/api/bots/command', { method: 'POST', handler: async event => {
  const body = await readBody<BotWorkspaceCommand>(event)
  commands.push(body)
  return source.submit(body)
} })
const Harness = defineComponent({
  props: { sample: Boolean },
  setup(props) { return { state: useBotWorkspace(props.sample) } },
  template: '<div />',
})
beforeEach(() => {
  source = createSampleWorkspace(); reads = 0; detailReads = 0; unauthorized = false; commands.length = 0
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})
afterEach(() => { vi.restoreAllMocks() })

describe('Bot workspace transport and local state', () => {
  it('shows observed Graph correlations without inferring a live topology', async () => {
    const wrapper = await mountSuspended(BotWorkspaceView, { props: { sampleMode: false } })
    try {
      await flushPromises()
      const graph = wrapper.findAll('button').find(button => button.text() === 'Graph')!
      await graph.trigger('click')
      expect(wrapper.text()).toContain('Graph-correlated Jobs')
      expect(wrapper.text()).toContain('not Graph Run status or topology')
      expect(wrapper.text()).toContain('sample-run')
      expect(wrapper.text()).toContain('Graph Run observation is unavailable')
      expect(wrapper.find('.bot-graph').exists()).toBe(false)
      expect(commands).toEqual([])
    } finally { wrapper.unmount() }
  })
  it('keeps the fictional graph confined to sample mode', async () => {
    const wrapper = await mountSuspended(BotWorkspaceView, { props: { sampleMode: true } })
    try {
      await wrapper.findAll('button').find(button => button.text() === 'Graph')!.trigger('click')
      expect(wrapper.find('.bot-graph').exists()).toBe(true)
      expect(wrapper.text()).toContain('Sample workspace')
      expect([reads, detailReads, commands.length]).toEqual([0, 0, 0])
    } finally { wrapper.unmount() }
  })
  it('isolates sample interactions from every production workspace endpoint', async () => {
    const wrapper = await mountSuspended(Harness, { props: { sample: true } })
    try {
      const state = wrapper.vm.state
      const reviewer = state.bots.value[1]!
      state.selectJob(reviewer, reviewer.jobs[0]!)
      await flushPromises()
      await state.command('reply', { input_request_id: 'sample-direction', answers: { audience: 'newcomers', checks: [], note: 'Use plain language' } })
      expect(state.selectedJob.value!.state).toBe('waiting_input')
      await state.reconcile(state.selectedOperations.value[0]!)
      expect(state.selectedJob.value!.state).toBe('running')
      expect([reads, detailReads, commands.length]).toEqual([0, 0, 0])
    } finally { wrapper.unmount() }
  })
  it('requires explicit Job selection and retains the exact selection and draft across snapshots', async () => {
    const wrapper = await mountSuspended(Harness)
    try {
      await flushPromises()
      const state = wrapper.vm.state
      expect(state.selectedJob.value).toBeNull()
      const writer = state.bots.value[0]!
      state.selectBot(writer)
      expect(state.selectedJob.value).toBeNull()
      state.selectJob(writer, writer.jobs[0]!)
      state.draft.value = 'An unsent follow-up'
      const selected = state.selectionKey.value
      source.snapshot.bots[0]!.jobs[0]!.revision = '9007199254740999'
      await state.reload()
      expect(state.selectionKey.value).toBe(selected)
      expect(state.selectedJob.value!.revision).toBe('9007199254740999')
      expect(state.draft.value).toBe('An unsent follow-up')
    } finally { wrapper.unmount() }
  })
  it('uses source reachability rather than worker liveness to enable admissible controls', async () => {
    const wrapper = await mountSuspended(Harness)
    try {
      await flushPromises()
      const state = wrapper.vm.state
      const writer = state.bots.value[0]!
      state.selectJob(writer, writer.jobs[0]!)
      source.snapshot.bots[0]!.bot.worker.state = 'offline'
      await state.reload()
      expect(state.can('send')).toBe(true)
      source.snapshot.sources[0]!.state = 'unavailable'
      await state.reload()
      expect(state.can('send')).toBe(false)
    } finally { wrapper.unmount() }
  })
  it('clears protected observations, answers and drafts on an authentication failure', async () => {
    const wrapper = await mountSuspended(Harness)
    try {
      await flushPromises()
      const state = wrapper.vm.state
      const writer = state.bots.value[0]!
      state.selectJob(writer, writer.jobs[0]!)
      state.draft.value = 'Private draft'
      state.answers.private = { answer: 'Private answer' }
      unauthorized = true
      await state.reload()
      expect(state.authRequired.value).toBe(true)
      expect(state.snapshot.value).toBeNull()
      expect(state.selectedJob.value).toBeNull()
      expect(state.draft.value).toBe('')
      expect(Object.keys(state.answers)).toEqual([])
      expect(state.operations.value).toEqual([])
      expect(Object.keys(state.details)).toEqual([])
    } finally { wrapper.unmount() }
  })
  it('does not read hidden sources or queue an offline command for reconnection', async () => {
    const wrapper = await mountSuspended(Harness)
    try {
      await flushPromises()
      const state = wrapper.vm.state
      const writer = state.bots.value[0]!
      state.selectJob(writer, writer.jobs[0]!)
      const beforeHidden = reads
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
      await state.reload()
      expect(reads).toBe(beforeHidden)
      state.online.value = false
      await state.command('send', { text: 'Do not queue this input' })
      expect(commands).toEqual([])
      expect(state.operations.value).toEqual([])
      state.online.value = true
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
      await state.reload()
      expect(commands).toEqual([])
    } finally { wrapper.unmount() }
  })
})
