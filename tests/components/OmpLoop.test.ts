import { afterEach, expect, it, vi } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { createError, readBody } from 'h3'
import OmpLoop from '~/components/OmpLoop.vue'

type State = 'active' | 'paused' | 'inactive' | null
let current: { state: State, session: string | null, command?: string } = { state: 'active', session: 's1' }
let delayedRead: Promise<{ state: State, session: string | null }> | null = null
let readFailure = false
let postFailure = false
let posted: unknown[] = []
let acknowledge: (() => void) | null = null
let holdPost = false
registerEndpoint('/api/omp-loop', { method: 'GET', handler: () => {
  if (readFailure) throw createError({ statusCode: 503 })
  if (delayedRead) return delayedRead
  return { ...current }
} })
registerEndpoint('/api/omp-loop', { method: 'POST', handler: async event => {
  posted.push(await readBody(event))
  if (holdPost) {
    const { promise, resolve } = Promise.withResolvers<void>()
    acknowledge = resolve
    await promise
  }
  if (postFailure) throw createError({ statusCode: 409 })
  return { ok: true }
} })
afterEach(() => {
  vi.useRealTimers()
  current = { state: 'active', session: 's1' }
  readFailure = false; postFailure = false; posted = []; holdPost = false; acknowledge = null; delayedRead = null
})

it('waits for acknowledgement, fences the session and refreshes actual state', async () => {
  holdPost = true
  const w = await mountSuspended(OmpLoop, { props: { pane: 'remote~pane', identity: 's1' } })
  try {
    await vi.waitFor(() => expect(w.text()).toContain('Loop active'))
    await w.get('button').trigger('click')
    await vi.waitFor(() => expect(posted).toEqual([{ pane: 'remote~pane', session: 's1' }]))
    expect(w.get('button').attributes('disabled')).toBeDefined()
    expect(w.text()).toContain('Loop active')
    current = { state: 'inactive', session: 's1' }
    acknowledge!()
    await vi.waitFor(() => expect(w.find('.omp-loop').exists()).toBe(false))
    expect(w.find('button').exists()).toBe(false)
  } finally { w.unmount() }
})

it('reports stop failures and does not claim the loop stopped', async () => {
  postFailure = true
  const w = await mountSuspended(OmpLoop, { props: { pane: 'p1' } })
  try {
    await vi.waitFor(() => expect(w.text()).toContain('Loop active'))
    await w.get('button').trigger('click')
    await vi.waitFor(() => expect(w.text()).toContain('Could not stop loop'))
    await vi.waitFor(() => expect(w.text()).toContain('Loop active'))
    expect(w.text()).not.toContain('Loop inactive')
  } finally { w.unmount() }
})

it('polls changes, clears unavailable state and follows pane identity', async () => {
  const w = await mountSuspended(OmpLoop, { props: { pane: 'p0' } })
  try {
    await vi.waitFor(() => expect(w.text()).toContain('Loop active'))
    vi.useFakeTimers()
    await w.setProps({ pane: 'p1' }); await flushPromises()
    current = { state: 'paused', session: 's2' }
    await vi.advanceTimersByTimeAsync(3000); await flushPromises()
    expect(w.text()).toContain('Loop paused')
    readFailure = true
    await vi.advanceTimersByTimeAsync(3000); await flushPromises()
    expect(w.text()).not.toContain('Loop paused')
    expect(w.find('.omp-loop').exists()).toBe(false)
    expect(w.find('button').exists()).toBe(false)
    readFailure = false
    current = { state: 'active', session: 's3' }
    await w.setProps({ pane: 'p2', identity: 'different' }); await flushPromises()
    expect(w.find('.omp-loop').exists()).toBe(false)
    expect(w.find('button').exists()).toBe(false)
    vi.useRealTimers()
    await w.setProps({ identity: 's3' })
    await vi.waitFor(() => expect(w.text()).toContain('Loop active'))
    await w.get('button').trigger('click'); await flushPromises()
    expect(posted).toEqual([{ pane: 'p2', session: 's3' }])
  } finally { w.unmount() }
})

it('expires the last state when a poll remains pending', async () => {
  const w = await mountSuspended(OmpLoop, { props: { pane: 'p0' } })
  const pending = Promise.withResolvers<{ state: State, session: string | null }>()
  try {
    await vi.waitFor(() => expect(w.text()).toContain('Loop active'))
    vi.useFakeTimers()
    await w.setProps({ pane: 'p1' }); await flushPromises()
    delayedRead = pending.promise
    await vi.advanceTimersByTimeAsync(3000); await flushPromises()
    expect(w.text()).toContain('Loop active')
    await vi.advanceTimersByTimeAsync(2000); await flushPromises()
    expect(w.find('.omp-loop').exists()).toBe(false)
    expect(w.text()).not.toContain('Loop active')
    expect(w.find('button').exists()).toBe(false)
    vi.useRealTimers()
    pending.resolve({ state: 'paused', session: 's1' })
    await vi.waitFor(() => expect(w.text()).toContain('Loop paused'))
  } finally { w.unmount() }
})

it('shows and copies the complete command and hides inactive loops', async () => {
  const text = "/loop 100 5m --until 'test -f done' first line\nsecond line"
  current = { state: 'active', session: 's1', command: text }
  const writeText = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  const w = await mountSuspended(OmpLoop, { props: { pane: 'p1' } })
  try {
    await vi.waitFor(() => expect(w.find('.loop-command').text()).toBe(text))
    expect(w.get('.loop-command').attributes('aria-expanded')).toBe('false')
    await w.get('.loop-command').trigger('click')
    expect(w.get('.loop-command').attributes('aria-expanded')).toBe('true')
    await w.findAll('.loop-actions button')[1]!.trigger('click')
    expect(writeText).toHaveBeenCalledWith(text)
    current = { state: 'inactive', session: 's1' }
    await w.setProps({ pane: 'p2' }); await flushPromises()
    expect(w.find('.omp-loop').exists()).toBe(false)
  } finally { w.unmount(); vi.unstubAllGlobals() }
})
