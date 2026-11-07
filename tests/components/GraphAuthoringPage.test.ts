import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { readBody, setResponseStatus } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VueWrapper } from '@vue/test-utils'
import Graphs from '~/pages/graphs.vue'

const blank = '---\nformat: omp.graph/v1\nname: empty\nmembers: {}\nnodes: {}\nedges: []\ncommunications: []\n---\n'
type Command = { action: string, source_token?: string, request_key?: string, graph_id?: string, revision?: string, content?: string }
let calls: Command[] = [], readFails = false, unknown = false, current = blank, revision = '1', sourceToken = 'fixed', locked = false
const storageKey = 'graph.pending-request.v1'
registerEndpoint('/api/bots/graphs', { method: 'GET', handler: event => {
  if (locked) { setResponseStatus(event, 403); return { code: 'locked', error: 'Locked session.' } }
  return { sources: [{ id: 'local', label: 'Local', token: sourceToken }] }
} })
registerEndpoint('/api/bots/graphs', { method: 'POST', handler: async event => {
  const command = await readBody<Command>(event)
  calls.push(command)
  if (command.source_token !== sourceToken) { setResponseStatus(event, 409); return { code: 'source_changed', error: 'Graph source configuration changed.' } }
  if (command.action === 'read') {
    if (readFails) { setResponseStatus(event, 503); return { code: 'source_unavailable', error: 'Cannot read saved definition.' } }
    expect(Object.keys(command).sort()).toEqual(['action', 'graph_id', 'source_id', 'source_token'])
    return { graph_id: 'g1', revision, content: current }
  }
  if (command.action === 'edit') { current = command.content!; revision = '2' }
  return { request_key: command.request_key, graph_id: 'g1', revision, state: unknown && command.action !== 'receipt' ? 'unknown' : 'completed', error_code: null }
} })
const button = (w: VueWrapper, label: string) => w.findAll('button').find(item => item.text() === label)!
const field = (w: VueWrapper, label: string) => w.findAll('label').find(item => item.text().trim().startsWith(label))!
async function mount() {
  const w = await mountSuspended(Graphs, { global: { stubs: { BotsGraphRunCanvas: true } } })
  await expect.poll(() => field(w, 'Name for a new Graph')?.exists()).toBe(true)
  await field(w, 'Name for a new Graph').get('input').setValue('empty')
  return w
}
beforeEach(() => { sessionStorage.removeItem(storageKey); calls = []; readFails = false; unknown = false; current = blank; revision = '1'; sourceToken = 'fixed'; locked = false })
afterEach(() => { vi.restoreAllMocks(); sessionStorage.removeItem(storageKey) })

describe('Graph definition authoring page', () => {
  it('opens the saved empty canvas directly and saves a draft with a fresh request key and loaded revision', async () => {
    const w = await mount()
    try {
      await button(w, 'Create').trigger('click')
      await expect.poll(() => w.find('[aria-label="Graph definition canvas"]').exists()).toBe(true)
      const content = blank + '\n## brief\nWrite a draft.\n'
      await field(w, 'Graph Markdown').get('textarea').setValue(content)
      await button(w, 'Save at loaded revision').trigger('click')
      await expect.poll(() => calls.filter(item => item.action === 'read').length).toBe(2)
      const create = calls.find(item => item.action === 'create')!, edit = calls.find(item => item.action === 'edit')!
      expect(edit).toMatchObject({ graph_id: 'g1', revision: '1', content })
      expect(edit.request_key).not.toBe(create.request_key)
      expect(w.find('[aria-label="Graph definition canvas"]').exists()).toBe(true)
      expect(field(w, 'Graph Markdown').get('textarea').element.value).toBe(content)
    } finally { w.unmount() }
  })

  it('keeps the completed mutation receipt when automatic loading fails and permits a read-only recovery', async () => {
    readFails = true
    const w = await mount()
    try {
      await button(w, 'Create').trigger('click')
      await expect.poll(() => w.find('[role="alert"]').exists()).toBe(true)
      expect(w.get('dl').text()).toContain('completed')
      expect(w.findAll('button').some(item => item.text() === 'Retry exact request')).toBe(false)
      readFails = false
      await button(w, 'Read definition').trigger('click')
      await expect.poll(() => w.find('[aria-label="Graph definition canvas"]').exists()).toBe(true)
      expect(calls.filter(item => item.action === 'create')).toHaveLength(1)
    } finally { w.unmount() }
  })

  it('retains the exact unknown request until reconciliation opens its confirmed definition', async () => {
    unknown = true
    const w = await mount()
    try {
      await button(w, 'Create').trigger('click')
      await expect.poll(() => w.findAll('button').some(item => item.text() === 'Retry exact request')).toBe(true)
      await expect.poll(() => button(w, 'Retry exact request').attributes('disabled')).toBeUndefined()
      expect(calls.map(item => item.action)).toEqual(['create'])
      await button(w, 'Retry exact request').trigger('click')
      await expect.poll(() => calls.length).toBe(2)
      expect(calls[1]).toEqual(calls[0])
      await expect.poll(() => button(w, 'Get receipt').attributes('disabled')).toBeUndefined()
      await button(w, 'Get receipt').trigger('click')
      await expect.poll(() => w.find('[aria-label="Graph definition canvas"]').exists()).toBe(true)
      expect(calls.find(item => item.action === 'receipt')!.request_key).toBe(calls[0]!.request_key)
      expect(calls.filter(item => item.action === 'read')).toHaveLength(1)
    } finally { w.unmount() }
  })

  it('recovers an unknown request after navigation without creating a replacement mutation', async () => {
    unknown = true
    let w = await mount()
    try {
      await button(w, 'Create').trigger('click')
      await expect.poll(() => button(w, 'Get receipt').attributes('disabled')).toBeUndefined()
      const original = calls[0]!
      w.unmount()
      w = await mount()
      expect(button(w, 'Create').attributes('disabled')).toBeDefined()
      expect(w.findAll('button').some(item => item.text() === 'Retry exact request')).toBe(false)
      expect(calls.map(item => item.action)).toEqual(['create'])
      await button(w, 'Get receipt').trigger('click')
      await expect.poll(() => w.find('[aria-label="Graph definition canvas"]').exists()).toBe(true)
      expect(calls.find(item => item.action === 'receipt')!.request_key).toBe(original.request_key)
      expect(calls.filter(item => item.action === 'create')).toHaveLength(1)
      await expect.poll(() => button(w, 'Read definition').attributes('disabled')).toBeUndefined()
      await field(w, 'Name for a new Graph').get('input').setValue('another')
      await button(w, 'Create').trigger('click')
      await expect.poll(() => calls.filter(item => item.action === 'create').length).toBe(2)
      expect(calls.filter(item => item.action === 'create')[1]!.request_key).not.toBe(original.request_key)
    } finally { w.unmount() }
  })

  it('keeps the original source binding after reload instead of rebinding an unknown mutation', async () => {
    unknown = true
    let w = await mount()
    try {
      await button(w, 'Create').trigger('click')
      await expect.poll(() => button(w, 'Get receipt').attributes('disabled')).toBeUndefined()
      w.unmount()
      sourceToken = 'changed'
      w = await mount()
      await button(w, 'Get receipt').trigger('click')
      await expect.poll(() => w.find('[role="alert"]').exists()).toBe(true)
      expect(calls[1]).toMatchObject({ action: 'receipt', source_token: 'fixed', request_key: calls[0]!.request_key })
      expect(button(w, 'Create').attributes('disabled')).toBeDefined()
      expect(calls.filter(item => item.action === 'create')).toHaveLength(1)
    } finally { w.unmount() }
  })

  it('does not send a mutation when its recovery key cannot be retained', async () => {
    const w = await mount()
    try {
      vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => { throw new Error('Storage unavailable') })
      await button(w, 'Create').trigger('click')
      await expect.poll(() => w.find('[role="alert"]').exists()).toBe(true)
      expect(calls).toEqual([])
    } finally { w.unmount() }
  })

  it('preserves a completed receipt when clearing browser recovery storage fails', async () => {
    const w = await mount()
    const storage = sessionStorage
    const spy = vi.spyOn(window, 'sessionStorage', 'get').mockReturnValue({
      get length() { return storage.length },
      key: index => storage.key(index),
      clear: () => storage.clear(),
      getItem: key => storage.getItem(key),
      setItem: (key, value) => storage.setItem(key, value),
      removeItem: () => { throw new Error('Storage unavailable') },
    })
    try {
      await button(w, 'Create').trigger('click')
      await expect.poll(() => w.find('[aria-label="Graph definition canvas"]').exists()).toBe(true)
      expect(w.get('dl').text()).toContain('completed')
      expect(button(w, 'Create').attributes('disabled')).toBeDefined()
      expect(w.findAll('button').some(item => item.text() === 'Retry exact request')).toBe(false)
      spy.mockRestore()
      await expect.poll(() => button(w, 'Get receipt').attributes('disabled')).toBeUndefined()
      await button(w, 'Get receipt').trigger('click')
      await expect.poll(() => button(w, 'Create').attributes('disabled')).toBeUndefined()
      expect(calls.filter(item => item.action === 'create')).toHaveLength(1)
      expect(sessionStorage.getItem(storageKey)).toBeNull()
    } finally { spy.mockRestore(); w.unmount() }
  })

  it('blocks replacement mutations when the retained request is corrupt', async () => {
    sessionStorage.setItem(storageKey, '{broken')
    const w = await mount()
    try {
      expect(w.find('[role="alert"]').exists()).toBe(true)
      expect(button(w, 'Create').attributes('disabled')).toBeDefined()
      expect(calls).toEqual([])
      expect(sessionStorage.getItem(storageKey)).toBe('{broken')
    } finally { w.unmount() }
  })

  it('restores only the request locator after reauthentication, never task text or an automatic retry', async () => {
    unknown = true
    let w = await mount()
    try {
      const task = blank + '\n## secret\nPrivate task text.\n'
      await field(w, 'Graph Markdown').get('textarea').setValue(task)
      await button(w, 'Import Markdown').trigger('click')
      await expect.poll(() => button(w, 'Get receipt').attributes('disabled')).toBeUndefined()
      expect(Object.keys(JSON.parse(sessionStorage.getItem(storageKey)!)).sort()).toEqual(['request_key', 'source_id', 'source_token', 'version'])
      w.unmount()
      locked = true
      w = await mountSuspended(Graphs, { global: { stubs: { BotsGraphRunCanvas: true } } })
      await expect.poll(() => w.find('[role="alert"]').exists()).toBe(true)
      expect(w.find('textarea').exists()).toBe(false)
      expect(w.text()).not.toContain(calls[0]!.request_key)
      locked = false
      await w.get('[aria-label="Refresh Graph sources"]').trigger('click')
      await expect.poll(() => field(w, 'Graph Markdown')?.exists()).toBe(true)
      expect(field(w, 'Graph Markdown').get('textarea').element.value).toBe('')
      await button(w, 'Get receipt').trigger('click')
      await expect.poll(() => w.find('[aria-label="Graph definition canvas"]').exists()).toBe(true)
      expect(calls.map(item => item.action)).toEqual(['import', 'receipt', 'read'])
    } finally { w.unmount() }
  })
})
