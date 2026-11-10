import { afterEach, describe, expect, it } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import ChatView from '~/components/ChatView.vue'
import { lightboxSet, lightboxSrc } from '~/composables/useUi'
import { herdrState } from '~/composables/useHerdr'
import type { ChatItem, Pane } from '#shared/types'
import { rewindItems } from '../fixtures/ompRewind'

const pane: Pane = { id: 'w1:p1', workspace: 'w1', tab: 'w1:t1', tabLabel: null, agent: 'omp', name: null, label: null, status: 'idle', title: null, cwd: '/home/user', agentSession: null }
let items: ChatItem[] = []
registerEndpoint('/api/chat', () => ({ available: true, token: 'rewind-surface', file: '/home/user/rewind.jsonl', start: 0, end: 1000, items }))

describe('committed rewind conversation surface', () => {
  afterEach(() => { lightboxSrc.value = null; lightboxSet.value = []; herdrState.value = { ok: false, workspaces: [], panes: [] } })

  it('really hides nested history, restores original messages/actions/images in order, then collapses it again', async () => {
    items = rewindItems()
    herdrState.value = { ok: true, workspaces: [], panes: [pane] }
    const w = await mountSuspended(ChatView, { props: { pane, localQueued: [] } })
    try {
      await expect.poll(() => w.findAll('.omp-rewind').length).toBe(2)
      expect(w.find('.omp-rewind-report strong').text()).toBe('Package handoff retained.')
      expect(w.text()).not.toContain('Retired locating explanation.')
      expect(w.text()).not.toContain('Retired child analysis.')
      expect(w.findAll('.msg-user-wrap').map(row => row.text())).toEqual(expect.arrayContaining(['Review the example module.', 'Keep the current request visible.']))
      expect(w.find('.process-images').exists()).toBe(false)
      const parent = w.findAll('.omp-rewind').find(card => card.text().includes('Package handoff retained.'))!
      expect(parent.get('button').attributes('aria-expanded')).toBe('false')
      await parent.get('button').trigger('click')
      await expect.poll(() => w.findAll('.omp-rewind').length).toBe(3)
      expect(w.text()).toContain('Retired child analysis.')
      expect(w.text()).not.toContain('Retired locating explanation.')
      const search = w.findAll('.omp-rewind').find(card => card.text().includes('Search decision retained.'))!
      await search.get('button').trigger('click')
      await expect.poll(() => w.find('.process-images').exists()).toBe(true)
      expect(w.findAll('.msg-ai').map(row => row.text())).toEqual(['Retired locating explanation.', 'Retired child analysis.', 'Current response remains visible.'])
      await w.findAll('.process-summary-button')[0]!.trigger('click')
      expect(w.find('.omp-tool-cmd').text()).toContain('src/item.ts')
      const image = w.get('.process-images .msg-img')
      await image.trigger('click')
      expect(lightboxSrc.value).toBe(image.attributes('src'))
      await search.get('.omp-rewind-material summary').trigger('click')
      expect(search.get('.omp-rewind-material pre').text()).toContain('<img src=x onerror=alert(1)>')
      expect(search.find('img').exists()).toBe(false)
      await search.get('button').trigger('click')
      await expect.poll(() => w.find('.process-images').exists()).toBe(false)
      await parent.get('button').trigger('click')
      await expect.poll(() => w.findAll('.omp-rewind').length).toBe(2)
      expect(w.text()).not.toContain('Retired child analysis.')
      expect(w.text()).toContain('Current response remains visible.')
      const output = w.emitted('output')!.at(-1)![0] as { sourceRanges: unknown }
      expect(output.sourceRanges).toEqual([{ start: 0, end: 1000 }])
    } finally { w.unmount() }
  })

  it('keeps accepted calls and a no-cut closure visible without an archive toggle', async () => {
    items = rewindItems().filter(item => !item.rewind?.contextChanged)
    items.splice(2, 0, { id: 'accepted', offset: 150, role: 'tool', name: 'write', text: 'xd://work-package', out: '{"accepted":true}', ts: null })
    herdrState.value = { ok: true, workspaces: [], panes: [pane] }
    const w = await mountSuspended(ChatView, { props: { pane, localQueued: [] } })
    try {
      await expect.poll(() => w.find('.omp-rewind.no-cut').exists()).toBe(true)
      expect(w.get('.omp-rewind.no-cut').text()).toContain('Context unchanged')
      expect(w.find('.omp-rewind-toggle').exists()).toBe(false)
      expect(w.findAll('.msg-ai').map(row => row.text())).toContain('Retired child analysis.')
      expect(w.findAll('.process-summary-button').length).toBeGreaterThan(0)
    } finally { w.unmount() }
  })

  it('leaves unproven partial history visible and exposes the persisted blocker reason', async () => {
    items = rewindItems().filter(item => item.id !== 'checkpoint' && item.id !== 'search-cut')
    const cut = items.find(item => item.id === 'parent-cut')!
    cut.rewind = { kind: 'work-package', contextChanged: true, checkpointId: 'not-loaded', outcome: 'blocked', reason: 'Waiting for the source dataset.' }
    herdrState.value = { ok: true, workspaces: [], panes: [pane] }
    const w = await mountSuspended(ChatView, { props: { pane, localQueued: [] } })
    try {
      await expect.poll(() => w.find('.omp-rewind.blocked').exists()).toBe(true)
      const card = w.get('.omp-rewind.blocked')
      expect(card.get('.omp-rewind-partial').text()).toContain('partial')
      expect(card.find('button').exists()).toBe(false)
      expect(card.get('.omp-rewind-reason').text()).toContain('Waiting for the source dataset.')
      expect(w.findAll('.msg-ai').map(row => row.text())).toContain('Retired child analysis.')
      expect(w.get('.process-images').exists()).toBe(true)
    } finally { w.unmount() }
  })

  it('renders one enriched handoff and one fold control for a summary/report split between pages', async () => {
    items = rewindItems()
    const summary = items[6]!
    items.splice(7, 0, { ...structuredClone(summary), id: 'report-copy', offset: 550, text: 'Enriched persisted report.', rewind: { ...summary.rewind!, anchorOffset: undefined, parentId: 'reported-parent' } })
    herdrState.value = { ok: true, workspaces: [], panes: [pane] }
    const w = await mountSuspended(ChatView, { props: { pane, localQueued: [] } })
    try {
      await expect.poll(() => w.findAll('.omp-rewind').length).toBe(2)
      expect(w.findAll('.omp-rewind-toggle')).toHaveLength(1)
      expect(w.findAll('.omp-rewind-report').filter(report => report.text() === 'Enriched persisted report.')).toHaveLength(1)
      expect(w.text()).not.toContain('Package handoff retained.')
      expect(w.get('.omp-rewind-parent').text()).toContain('reported-parent')
      await w.get('.omp-rewind-toggle').trigger('click')
      await expect.poll(() => w.findAll('.omp-rewind').length).toBe(3)
      expect(w.findAll('.omp-rewind-toggle')).toHaveLength(2)
    } finally { w.unmount() }
  })
})
