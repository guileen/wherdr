import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { getQuery, readBody } from 'h3'
import ChatView from '~/components/ChatView.vue'
import { cachedAt, eventsOpen, herdrState, netDown } from '~/composables/useHerdr'
import type { ChatItem, Pane } from '#shared/types'

const pane: Pane = { id: 'w1:p 1', workspace: 'w1', tab: 'w1:t1', tabLabel: null, agent: 'omp', name: null, label: null, status: 'idle', title: null, cwd: '/home/user/demo', agentSession: null }
let chatItems: ChatItem[] = [{ role: 'assistant', text: 'Finished.', ts: '2026-01-01T00:00:00Z' }]
registerEndpoint('/api/chat', () => ({ available: true, token: 'compact-test', file: '/home/user/demo/chat.jsonl', items: chatItems }))
let estimate: () => Promise<{ beforeTokens: number, afterTokens: number }>
const requested: unknown[] = []
const sent: unknown[] = []
registerEndpoint('/api/compact-estimate', event => { requested.push(getQuery(event).pane); return estimate() })
registerEndpoint('/api/input', { method: 'POST', handler: async event => { sent.push(await readBody(event)); return { ok: true } } })
registerEndpoint('/api/prompt', { method: 'POST', handler: async event => { sent.push(await readBody(event)); return { ok: true } } })

const sheet = { props: ['open', 'title'], emits: ['update:open'], template: '<div v-if="open" class="test-sheet"><button class="dismiss" @click="$emit(\'update:open\', false)">Dismiss</button><slot /></div>' }
async function mount() {
  herdrState.value = { ok: true, workspaces: [], panes: [pane] }
  const w = await mountSuspended(ChatView, { props: { pane, localQueued: [] }, global: { stubs: { AppSheet: sheet } } })
  await expect.poll(() => w.find('.completion-actions').exists()).toBe(true)
  return w
}
function button(w: VueWrapper, label: string) {
  return w.findAll('button').find(b => b.text() === label)!
}

describe('compact conversation', () => {
  beforeEach(() => { eventsOpen.value = true; netDown.value = false; cachedAt.value = null; requested.length = 0; sent.length = 0; chatItems = [{ role: 'assistant', text: 'Finished.', ts: '2026-01-01T00:00:00Z' }]; estimate = async () => ({ beforeTokens: 1200, afterTokens: 300 }) })
  afterEach(() => { eventsOpen.value = false; herdrState.value = { ok: false, workspaces: [], panes: [] } })

  it('targets loop controls at the omp conversation and disables them offline', async () => {
    herdrState.value = { ok: true, workspaces: [], panes: [pane] }
    const loop = { props: ['pane', 'identity'], template: '<div class="test-loop">{{ pane }}</div>' }
    const w = await mountSuspended(ChatView, { props: { pane, localQueued: [] }, global: { stubs: { OmpLoop: loop } } })
    try {
      expect(w.get('.test-loop').text()).toBe(pane.id)
      netDown.value = true
      await flushPromises()
      expect(w.get('.test-loop').text()).toBe('')
      await w.setProps({ pane: { ...pane, agent: 'claude' } })
      expect(w.find('.test-loop').exists()).toBe(false)
    } finally { w.unmount() }
  })

  it('shows a checkpoint without a reply and lets the user request continuation once', async () => {
    chatItems = [{ role: 'system', text: 'Conversation compacted', checkpoint: true, ts: '2026-01-01T00:00:00Z' }]
    herdrState.value = { ok: true, workspaces: [], panes: [pane] }
    const w = await mountSuspended(ChatView, { props: { pane, localQueued: [] } })
    try {
      await expect.poll(() => w.find('.checkpoint-status').text()).toContain('Agent idle · no reply since checkpoint')
      await w.find('.checkpoint-continue').trigger('click')
      await flushPromises()
      expect(sent).toHaveLength(1)
      await expect.poll(() => w.find('.checkpoint-status').text()).toContain('Continuation requested')
      expect(w.find('.checkpoint-continue').exists()).toBe(false)
      netDown.value = true
      await flushPromises()
      expect(w.find('.checkpoint-status').text()).toContain('Agent status unknown')
    } finally { w.unmount() }
  })

  it('shows the estimate before QA only can be selected', async () => {
    const pending = Promise.withResolvers<{ beforeTokens: number, afterTokens: number }>()
    estimate = () => pending.promise
    const w = await mount()
    try {
      await button(w, 'Compact').trigger('click')
      expect(w.get('.compact-qa').attributes('disabled')).toBeDefined()
      expect(w.get('.compact-relay').exists()).toBe(true)
      await expect.poll(() => requested.length).toBe(1)
      expect(requested).toEqual([pane.id])
      expect(w.find('.test-sheet').text()).toContain('Loading estimate')
      expect(sent).toEqual([])
      pending.resolve({ beforeTokens: 1200, afterTokens: 300 })
      await expect.poll(() => w.find('.test-sheet').text()).toContain('≈ 1.2K → 300')
      expect(sent).toEqual([])
      await w.get('.compact-qa').trigger('click')
      await expect.poll(() => sent.length).toBe(1)
      expect(sent[0]).toMatchObject({ pane_id: pane.id, text: '/compact qaonly' })
    } finally { w.unmount() }
  })

  it('sends Rewind once while the unrelated QA estimate is still loading', async () => {
    const pending = Promise.withResolvers<{ beforeTokens: number, afterTokens: number }>()
    estimate = () => pending.promise
    const w = await mount()
    try {
      await button(w, 'Compact').trigger('click')
      await expect.poll(() => requested.length).toBe(1)
      const rewind = w.get('.compact-rewind')
      expect(rewind.text()).toBe('Rewind')
      expect(rewind.attributes('disabled')).toBeUndefined()
      expect(rewind.find('.compact-estimate').exists()).toBe(false)
      expect(w.get('.compact-qa').attributes('disabled')).toBeDefined()
      await Promise.all([rewind.trigger('click'), rewind.trigger('click')])
      await expect.poll(() => sent.length).toBe(1)
      expect(sent[0]).toMatchObject({ pane_id: pane.id, text: '/compact rewind' })
      expect(w.find('.test-sheet').exists()).toBe(false)
      expect(w.find('.completion-actions').exists()).toBe(false)
      pending.resolve({ beforeTokens: 1200, afterTokens: 300 })
      await flushPromises()
      await rewind.trigger('click')
      expect(sent).toHaveLength(1)
      expect(w.find('.test-sheet').exists()).toBe(false)
    } finally { w.unmount() }
  })

  it('keeps QA estimates on QA only and allows Rewind after an estimate failure', async () => {
    const w = await mount()
    try {
      await button(w, 'Compact').trigger('click')
      await expect.poll(() => w.find('.compact-qa').text()).toContain('≈ 1.2K → 300')
      expect(w.get('.compact-rewind').text()).toBe('Rewind')
      expect(w.get('.compact-rewind').find('.compact-estimate').exists()).toBe(false)
      await w.get('.dismiss').trigger('click')
      estimate = async () => { throw new Error('unavailable') }
      await button(w, 'Compact').trigger('click')
      await expect.poll(() => w.find('.compact-qa').text()).toContain('Estimate unavailable')
      expect(w.get('.compact-rewind').attributes('disabled')).toBeUndefined()
      await w.get('.compact-rewind').trigger('click')
      await expect.poll(() => sent.length).toBe(1)
      expect(sent[0]).toMatchObject({ pane_id: pane.id, text: '/compact rewind' })
    } finally { w.unmount() }
  })

  it('ignores a Rewind selection from a stale pane', async () => {
    estimate = () => new Promise(() => {})
    const w = await mount()
    try {
      await button(w, 'Compact').trigger('click')
      const rewind = w.get('.compact-rewind')
      await w.setProps({ pane: { ...pane, id: 'w1:p2' } })
      expect(w.find('.test-sheet').exists()).toBe(false)
      await rewind.trigger('click')
      await flushPromises()
      expect(sent).toEqual([])
    } finally { w.unmount() }
  })

  it('ignores a Rewind selection after the completed reply changes', async () => {
    estimate = () => new Promise(() => {})
    const w = await mount()
    try {
      await button(w, 'Compact').trigger('click')
      const rewind = w.get('.compact-rewind')
      chatItems = [...chatItems, { role: 'assistant', text: 'A newer reply.', ts: '2026-01-01T00:00:01Z' }]
      w.vm.reload()
      await expect.poll(() => w.find('.test-sheet').exists(), { timeout: 3000 }).toBe(false)
      await rewind.trigger('click')
      await flushPromises()
      expect(sent).toEqual([])
    } finally { w.unmount() }
  })

  it('hides completion actions during automatic interval rewind', async () => {
    const w = await mount()
    try {
      await button(w, 'Compact').trigger('click')
      await w.setProps({ pane: { ...pane, ompActivity: { step: 'Auto interval rewind… (⎋ to cancel)', since: null } } })
      expect(w.find('.completion-actions').exists()).toBe(false)
      expect(w.find('.test-sheet').exists()).toBe(false)
      await w.setProps({ pane })
      await expect.poll(() => w.find('.completion-actions').exists()).toBe(true)
    } finally { w.unmount() }
  })

  it('offers Compact again after a witnessed compaction completes', async () => {
    const w = await mount()
    try {
      await button(w, 'Compact').trigger('click')
      await expect.poll(() => w.get('.compact-qa').attributes('disabled')).toBeUndefined()
      await w.get('.compact-qa').trigger('click')
      await expect.poll(() => sent.length).toBe(1)
      expect(w.find('.completion-actions').exists()).toBe(false)
      await w.setProps({ pane: { ...pane, ompActivity: { step: 'Compacting context...', since: null } } })
      expect(w.find('.completion-actions').exists()).toBe(false)
      await w.setProps({ pane })
      await expect.poll(() => w.find('.completion-actions').exists()).toBe(true)
      await button(w, 'Compact').trigger('click')
      await expect.poll(() => w.get('.compact-qa').attributes('disabled')).toBeUndefined()
      await w.get('.compact-qa').trigger('click')
      await expect.poll(() => sent.length).toBe(2)
    } finally { w.unmount() }
  })

  it('restores Compact on a new compaction transcript event without a status transition', async () => {
    const w = await mount()
    try {
      await button(w, 'Compact').trigger('click')
      await expect.poll(() => w.get('.compact-qa').attributes('disabled')).toBeUndefined()
      await w.get('.compact-qa').trigger('click')
      await expect.poll(() => sent.length).toBe(1)
      expect(w.find('.completion-actions').exists()).toBe(false)
      chatItems = [...chatItems, { role: 'system', text: 'Conversation compacted', ts: null }]
      w.vm.reload()
      await expect.poll(() => w.find('.completion-actions').exists(), { timeout: 3000 }).toBe(true)
    } finally { w.unmount() }
  })

  it('offers retry on an unavailable estimate without sending', async () => {
    estimate = async () => { throw new Error('unavailable') }
    const w = await mount()
    try {
      await button(w, 'Compact').trigger('click')
      await expect.poll(() => w.find('.test-sheet').text()).toContain('Estimate unavailable')
      expect(w.get('.compact-qa').attributes('disabled')).toBeUndefined()
      expect(sent).toEqual([])
      estimate = async () => ({ beforeTokens: 900, afterTokens: 100 })
      await button(w, 'Retry').trigger('click')
      await expect.poll(() => w.find('.test-sheet').text()).toContain('≈ 900 → 100')
      expect(sent).toEqual([])
    } finally { w.unmount() }
  })

  it('allows QA only after explicitly reporting an unavailable estimate', async () => {
    estimate = async () => { throw new Error('unavailable') }
    const w = await mount()
    try {
      await button(w, 'Compact').trigger('click')
      await expect.poll(() => w.find('.test-sheet').text()).toContain('Estimate unavailable')
      expect(sent).toEqual([])
      await w.get('.compact-qa').trigger('click')
      await expect.poll(() => sent.length).toBe(1)
      expect(sent[0]).toMatchObject({ pane_id: pane.id, text: '/compact qaonly' })
    } finally { w.unmount() }
  })

  it('discards late estimates after dismissal or a pane change', async () => {
    const pending = Promise.withResolvers<{ beforeTokens: number, afterTokens: number }>()
    estimate = () => pending.promise
    const w = await mount()
    try {
      await button(w, 'Compact').trigger('click')
      await expect.poll(() => requested.length).toBe(1)
      await w.get('.dismiss').trigger('click')
      pending.resolve({ beforeTokens: 1000, afterTokens: 200 })
      await flushPromises()
      estimate = () => new Promise(() => {})
      await button(w, 'Compact').trigger('click')
      expect(w.find('.test-sheet').text()).not.toContain('1,000')
      await w.setProps({ pane: { ...pane, id: 'w1:p2' } })
      expect(w.find('.test-sheet').exists()).toBe(false)
      expect(sent).toEqual([])
    } finally { w.unmount() }
  })

  it('ignores an estimate that resolves after the pane changes', async () => {
    const pending = Promise.withResolvers<{ beforeTokens: number, afterTokens: number }>()
    estimate = () => pending.promise
    const w = await mount()
    try {
      await button(w, 'Compact').trigger('click')
      await expect.poll(() => requested.length).toBe(1)
      await w.setProps({ pane: { ...pane, id: 'w1:p2' } })
      pending.resolve({ beforeTokens: 1000, afterTokens: 200 })
      await flushPromises()
      expect(w.find('.test-sheet').exists()).toBe(false)
      expect(sent).toEqual([])
    } finally { w.unmount() }
  })

  it('selects Relay without sending while an estimate is pending', async () => {
    estimate = () => new Promise(() => {})
    const w = await mount()
    try {
      await button(w, 'Compact').trigger('click')
      await expect.poll(() => requested.length).toBe(1)
      await w.get('.compact-relay').trigger('click')
      expect(w.emitted('relay')).toHaveLength(1)
      expect(requested).toEqual([pane.id])
      expect(sent).toEqual([])
      expect(w.find('.test-sheet').exists()).toBe(false)
    } finally { w.unmount() }
  })
})
