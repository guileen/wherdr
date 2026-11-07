import { flushPromises, mount } from '@vue/test-utils'
import { mockNuxtImport, mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { readBody, setResponseStatus } from 'h3'
import { describe, expect, it, vi } from 'vitest'
import GraphRunCanvas from '~/components/bots/GraphRunCanvas.vue'

const route = vi.hoisted(() => ({ query: {} as Record<string, string> }))
mockNuxtImport('useRoute', () => () => route)

let denied = false
const requests: unknown[] = []
const projection = { version: 1, run: { id: 'run1', graph_id: 'g1', revision: '2', definition_revision: '1', state: 'running', updated_at: '2026-01-01T00:00:00.000Z' }, cursor: { journal_id: 'j1', seq: '2' }, nodes: [{ id: 'review', kind: 'human', member: null }, { id: 'publish', kind: 'program', member: null }], edges: [{ id: 'e1', from: 'review', to: 'publish', loop: null }], communications: [{ from: 'author', to: 'reviewer' }], invocations: [{ id: 'inv1', kind: 'node', node: 'review', member: null, state: 'waiting', iteration: 0, scope_id: 'scope1', attempt_id: null, superseded: false }, { id: 'consult1', kind: 'consultation', node: null, member: 'reviewer', state: 'running', iteration: 0, scope_id: 'run', attempt_id: 'attempt1', superseded: false }] }
const initial = { ...projection, run: { ...projection.run, revision: '1', state: 'queued' }, cursor: { journal_id: 'j1', seq: '1' } }
registerEndpoint('/api/bots/graph-observation', { method: 'GET', handler: () => ({ sources: [{ id: 'local', label: 'Local', token: 'token', runs: ['run1'] }] }) })
registerEndpoint('/api/bots/graph-observation', { method: 'POST', handler: async event => {
  const body = await readBody(event)
  requests.push(body)
  if (denied) { setResponseStatus(event, 403); return { code: 'scope_denied', error: 'Denied' } }
  if (body.extensions) return { extensions: [] }
  if (body.history) return body.history.after
    ? { views: [projection], cursor: projection.cursor, watermark: projection.cursor, next_cursor: null }
    : { views: [initial], cursor: initial.cursor, watermark: projection.cursor, next_cursor: initial.cursor }
  return projection
} })

describe('Graph Run canvas', () => {
  it('opens an explicitly authorized Run deep link', async () => {
    denied = false; requests.length = 0
    route.query = { source: 'local', run: 'run1' }
    const wrapper = mount(GraphRunCanvas)
    try {
      await vi.waitFor(() => expect(wrapper.text()).toContain('review → publish'))
      expect(requests).toEqual([{ source_id: 'local', source_token: 'token', run_id: 'run1' }])
    } finally { wrapper.unmount(); route.query = {} }
  })
  it('shows committed topology and invocations, and clears protected results on denial', async () => {
    denied = false; requests.length = 0
    const wrapper = await mountSuspended(GraphRunCanvas)
    try {
      await flushPromises()
      await wrapper.findAll('select')[0]!.setValue('local')
      await wrapper.findAll('select')[1]!.setValue('run1')
      await wrapper.findAll('button').find(button => button.text() === 'Read Run snapshot')!.trigger('click')
      await flushPromises()
      await vi.waitFor(() => expect(wrapper.text()).toContain('review → publish'))
      expect(wrapper.text()).toContain('author → reviewer')
      expect(wrapper.text()).toContain('Consultation executions')
      await wrapper.findAll('button').find(button => button.text().includes('review') && button.attributes('aria-pressed') === 'false')!.trigger('click')
      expect(wrapper.text()).toContain('inv1')
      expect(wrapper.text()).toContain('waiting')
      denied = true
      await wrapper.findAll('button').find(button => button.text() === 'Read Run snapshot')!.trigger('click')
      await flushPromises()
      expect(wrapper.text()).not.toContain('inv1')
      await vi.waitFor(() => expect(wrapper.text()).toContain('access has changed'))
      expect(requests).toEqual([{ source_id: 'local', source_token: 'token', run_id: 'run1' }, { source_id: 'local', source_token: 'token', run_id: 'run1' }])
    } finally { wrapper.unmount(); denied = false }
  })
  it('pages captured history, renders a selected historical view and clears it on denial', async () => {
    denied = false; requests.length = 0
    const wrapper = await mountSuspended(GraphRunCanvas)
    try {
      await flushPromises()
      await wrapper.findAll('select')[0]!.setValue('local')
      await wrapper.findAll('select')[1]!.setValue('run1')
      await wrapper.findAll('button').find(button => button.text() === 'Read Run snapshot')!.trigger('click')
      await flushPromises()
      await vi.waitFor(() => expect(wrapper.text()).toContain('Read history'))
      await wrapper.findAll('button').find(button => button.text() === 'Read history')!.trigger('click')
      await flushPromises()
      await vi.waitFor(() => expect(wrapper.text()).toContain('Cursor 1'))
      expect(requests[1]).toEqual({ source_id: 'local', source_token: 'token', run_id: 'run1', history: { watermark: projection.cursor, limit: 20 } })
      await wrapper.findAll('button').find(button => button.text().includes('Cursor 1'))!.trigger('click')
      expect(wrapper.text()).toContain('Historical view at the selected committed cursor')
      expect(wrapper.text()).toContain('Run revision 1')
      await wrapper.findAll('button').find(button => button.text() === 'Next history page')!.trigger('click')
      await flushPromises()
      await vi.waitFor(() => expect(wrapper.text()).toContain('Cursor 2'))
      expect(requests[2]).toEqual({ source_id: 'local', source_token: 'token', run_id: 'run1', history: { watermark: projection.cursor, after: initial.cursor, limit: 20 } })
      expect(wrapper.text()).toContain('Cursor 2')
      await wrapper.findAll('button').find(button => button.text() === 'Previous history page')!.trigger('click')
      await flushPromises()
      await vi.waitFor(() => expect(wrapper.text()).toContain('Cursor 1'))
      expect(requests[3]).toEqual({ source_id: 'local', source_token: 'token', run_id: 'run1', history: { watermark: projection.cursor, limit: 20 } })
      expect(wrapper.findAll('button').some(button => button.text() === 'Previous history page')).toBe(false)
      await wrapper.findAll('button').find(button => button.text() === 'Return to captured snapshot')!.trigger('click')
      expect(wrapper.text()).toContain('Run revision 2')
      denied = true
      await wrapper.findAll('button').find(button => button.text() === 'Read history')!.trigger('click')
      await flushPromises()
      await vi.waitFor(() => expect(wrapper.text()).toContain('Run history is unavailable'))
      expect(wrapper.text()).not.toContain('inv1')
      expect(wrapper.text()).toContain('Run history is unavailable')
    } finally { wrapper.unmount(); denied = false }
  })
  it('clears captured protected data when capability authorization fails', async () => {
    denied = false; requests.length = 0
    const wrapper = await mountSuspended(GraphRunCanvas)
    try {
      await flushPromises()
      await wrapper.findAll('select')[0]!.setValue('local')
      await wrapper.findAll('select')[1]!.setValue('run1')
      await wrapper.findAll('button').find(button => button.text() === 'Read Run snapshot')!.trigger('click')
      await flushPromises()
      await vi.waitFor(() => expect(wrapper.text()).toContain('consult1'))
      await wrapper.findAll('button').find(button => button.text() === 'Check captured adapter capability')!.trigger('click')
      await flushPromises()
      await vi.waitFor(() => expect(wrapper.findAll('button').find(button => button.text() === 'Check captured adapter capability')!.attributes('disabled')).toBeUndefined())
      expect(wrapper.text()).toContain('consult1')
      denied = true
      await wrapper.findAll('button').find(button => button.text() === 'Check captured adapter capability')!.trigger('click')
      await flushPromises()
      await vi.waitFor(() => expect(wrapper.text()).not.toContain('consult1'))
      expect(wrapper.findAll('select')).toHaveLength(0)
    } finally { wrapper.unmount(); denied = false }
  })
})
