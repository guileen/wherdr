import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { h, nextTick, ref } from 'vue'
import { TooltipProvider } from 'reka-ui'
import { getQuery, readBody } from 'h3'
import ModelPicker from '~/components/ModelPicker.vue'
import ProviderUsage from '~/components/ProviderUsage.vue'
import { useModelDashboard } from '~/composables/useModelDashboard'
import { cachedAt, eventsOpen } from '~/composables/useHerdr'
import { modelDashboard } from '~/demo/scenario'
import { usageOrderedModelOptions } from '~/utils/modelSelection'
import type { Pane } from '#shared/types'

const now = Date.now()
const selectors = ['openai-codex/gpt-6.1-terra', 'google-antigravity/gemini-3.8-flash', 'openrouter/anthropic/claude-opus-5.5', 'unknown/vendor/model']
const switches: unknown[] = []
let modelsHandler: ((pane: string) => unknown) | null = null
let switchHandler: ((body: { label: string }) => unknown) | null = null
registerEndpoint('/api/models', event => {
  const pane = String(getQuery(event).pane)
  return modelsHandler ? modelsHandler(pane) : { agent: pane === 'other' ? 'codex' : 'omp', options: selectors.map(label => ({ label, hint: null })) }
})
registerEndpoint('/api/model-dashboard', () => modelDashboard(now))
registerEndpoint('/api/model', { method: 'POST', handler: async event => {
  const body = await readBody(event)
  switches.push(body)
  return switchHandler ? switchHandler(body) : { model: { id: body.label, label: body.label, effort: null } }
} })

const mounted: { unmount: () => void }[] = []
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  switches.length = 0
  modelsHandler = null
  switchHandler = null
  eventsOpen.value = false
  cachedAt.value = null
})
async function open(agent: 'omp' | 'codex', machine: string) {
  eventsOpen.value = true
  cachedAt.value = null
  const pane = { id: agent === 'omp' ? 'session' : 'other', machine, agent, status: 'idle', model: { id: selectors[0], label: selectors[0], effort: null } } as Pane
  const wrapper = await mountSuspended(TooltipProvider, { slots: { default: () => h(ModelPicker, { pane, header: true }) }, attachTo: document.body })
  mounted.push(wrapper)
  await wrapper.get('.model-pick').trigger('click')
  await vi.waitFor(() => expect(choice(selectors[3]!)).toBeTruthy())
  return wrapper
}
const choice = (selector: string) => [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].find(item => item.textContent?.includes(selector))!

describe('conversation model picker', () => {
  it('shows cached selectors while reading, merges returned options, and isolates late pane results', async () => {
    eventsOpen.value = true
    const a = modelDashboard(now)
    const b = modelDashboard(now)
    a.models = a.models.filter(model => model.selector === selectors[0] || model.selector === selectors[1])
    b.models = b.models.filter(model => model.selector === selectors[0])
    useModelDashboard('held-a').replace(a)
    useModelDashboard('held-b').replace(b)
    const heldA = Promise.withResolvers<unknown>()
    const heldB = Promise.withResolvers<unknown>()
    modelsHandler = pane => pane === 'held-pane-a' ? heldA.promise : heldB.promise
    const pane = ref({ id: 'held-pane-a', machine: 'held-a', agent: 'omp', status: 'idle', model: { id: selectors[0], label: selectors[0], effort: null } } as Pane)
    const wrapper = await mountSuspended(TooltipProvider, { slots: { default: () => h(ModelPicker, { pane: pane.value, header: true }) }, attachTo: document.body })
    mounted.push(wrapper)
    await wrapper.get('.model-pick').trigger('click')
    await vi.waitFor(() => expect(choice(selectors[1]!)).toBeTruthy())
    expect(document.body.textContent).toContain('Reading models')
    expect(choice(selectors[0]!).getAttribute('aria-checked')).toBe('true')
    const expected = usageOrderedModelOptions(a.models.map(model => ({ label: model.selector, hint: null })), a, now)
    expect([...document.querySelectorAll('[role="menuitemcheckbox"]')].map(item => item.querySelector('[data-slot="itemLabel"]')?.textContent?.trim())).toEqual(expected.map(option => option.label))

    pane.value = { ...pane.value, id: 'held-pane-b', machine: 'held-b' }
    await nextTick()
    await vi.waitFor(() => expect(choice(selectors[1]!)).toBeUndefined())
    heldA.resolve({ agent: 'omp', options: [{ label: 'old-machine/only', hint: null }] })
    await flushPromises()
    expect(choice('old-machine/only')).toBeUndefined()
    heldB.resolve({ agent: 'omp', options: [{ label: 'new-machine/extra', hint: 'Real option' }] })
    await vi.waitFor(() => expect(choice('new-machine/extra')).toBeTruthy())
    expect(choice(selectors[0]!)).toBeTruthy()
    expect(choice(selectors[1]!)).toBeUndefined()
    expect(document.body.textContent).not.toContain('Reading models')
  })

  it('keeps cached choices and offers retry after a failed read, switching only on server success', async () => {
    eventsOpen.value = true
    const snapshot = modelDashboard(now)
    snapshot.models = snapshot.models.filter(model => model.selector === selectors[0] || model.selector === selectors[1])
    useModelDashboard('failed-picker').replace(snapshot)
    const held = Promise.withResolvers<unknown>()
    modelsHandler = () => held.promise
    const pane = { id: 'failed-pane', machine: 'failed-picker', agent: 'omp', status: 'idle', model: { id: selectors[0], label: selectors[0], effort: null } } as Pane
    const wrapper = await mountSuspended(TooltipProvider, { slots: { default: () => h(ModelPicker, { pane, header: true }) }, attachTo: document.body })
    mounted.push(wrapper)
    await wrapper.get('.model-pick').trigger('click')
    await vi.waitFor(() => expect(choice(selectors[1]!)).toBeTruthy())
    held.reject(new Error('read failed'))
    await vi.waitFor(() => expect(document.body.textContent).toContain('Retry'))
    expect(choice(selectors[0]!).getAttribute('aria-checked')).toBe('true')
    modelsHandler = () => ({ agent: 'omp', options: [{ label: 'retry/real', hint: null }] })
    const retry = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent?.includes('Retry'))!
    retry.click()
    await vi.waitFor(() => expect(choice('retry/real')).toBeTruthy())
    choice(selectors[1]!).click()
    await vi.waitFor(() => expect(switches).toEqual([{ pane_id: 'failed-pane', label: selectors[1] }]))
    await vi.waitFor(() => expect(wrapper.get('.model-name').text()).toBe(selectors[1]))
  })

  it('allows a cached selection during a held read without claiming success early', async () => {
    eventsOpen.value = true
    const snapshot = modelDashboard(now)
    snapshot.models = snapshot.models.filter(model => model.selector === selectors[0] || model.selector === selectors[1])
    useModelDashboard('switch-held-picker').replace(snapshot)
    const reading = Promise.withResolvers<unknown>()
    const switching = Promise.withResolvers<unknown>()
    modelsHandler = () => reading.promise
    switchHandler = () => switching.promise
    const pane = { id: 'switch-held-pane', machine: 'switch-held-picker', agent: 'omp', status: 'idle', model: { id: selectors[0], label: selectors[0], effort: null } } as Pane
    const wrapper = await mountSuspended(TooltipProvider, { slots: { default: () => h(ModelPicker, { pane, header: true }) }, attachTo: document.body })
    mounted.push(wrapper)
    await wrapper.get('.model-pick').trigger('click')
    await vi.waitFor(() => expect(choice(selectors[1]!)).toBeTruthy())
    choice(selectors[1]!).click()
    await vi.waitFor(() => expect(switches).toEqual([{ pane_id: 'switch-held-pane', label: selectors[1] }]))
    expect(wrapper.get('.model-name').text()).toBe(selectors[0])
    reading.reject(new Error('cancelled for switch'))
    switching.resolve({ model: { id: selectors[1], label: selectors[1], effort: null } })
    await vi.waitFor(() => expect(wrapper.get('.model-name').text()).toBe(selectors[1]))
  })

  it('uses the same machine-specific quota as its Home dashboard', async () => {
    const remote = modelDashboard(now)
    remote.quota!.reports.find(report => report.provider === 'openai-codex')!.limits[1]!.amount.usedFraction = 0.87
    useModelDashboard('picker-host-a').replace(remote)
    const home = await mountSuspended(ProviderUsage, { props: { machine: 'picker-host-a', readOnly: true, accountRows: [], api: false } })
    mounted.push(home)
    const label = home.get('[data-provider="openai-codex"] .model-gauge').attributes('aria-label')
    expect(label).toContain('87% used')
    await open('omp', 'picker-host-a')
    expect([...choice(selectors[0]!).querySelectorAll('.model-gauge')].some(gauge => gauge.getAttribute('aria-label')?.includes('87% used'))).toBe(true)
  })

  it('retains selectors, shows provider icons and every applicable window, and selects the exact route', async () => {
    await useModelDashboard('picker-menu').load(true)
    await open('omp', 'picker-menu')
    const terra = choice(selectors[0]!)
    expect(terra.getAttribute('aria-checked')).toBe('true')
    expect(terra.querySelector('.model-option-provider')).toBeTruthy()
    expect(terra.querySelectorAll('.model-gauge')).toHaveLength(2)
    expect(terra.querySelectorAll('.model-gauge.compact')).toHaveLength(2)
    expect(choice(selectors[1]!).querySelector('.model-option-provider img')).toBeTruthy()
    expect(choice(selectors[2]!).querySelector('.model-option-provider img')).toBeTruthy()
    const unknown = choice(selectors[3]!)
    expect(unknown.querySelector('.model-option-provider')).toBeNull()
    expect(unknown.querySelector('.model-gauge')?.getAttribute('aria-label')).toContain('unknown used quota')
    expect(unknown.querySelector('.gauge-fill')).toBeNull()
    choice(selectors[2]!).click()
    await vi.waitFor(() => expect(switches).toEqual([{ pane_id: 'session', label: selectors[2] }]))
    await flushPromises()
  })

  it('does not add OMP usage or provider decorations to another agent', async () => {
    await open('codex', 'picker-other')
    expect(choice(selectors[0]!).querySelector('.model-gauge')).toBeNull()
    expect(choice(selectors[0]!).querySelector('.model-option-provider')).toBeNull()
  })

  it('keeps stale quota unknown without losing the original choice', async () => {
    const dashboard = useModelDashboard('picker-stale')
    const stale = modelDashboard(now - 7_200_000)
    dashboard.replace(stale)
    await open('omp', 'picker-stale')
    const terra = choice(selectors[0]!)
    expect(terra.querySelector('.model-gauge')?.getAttribute('aria-label')).toContain('stale reading')
    expect(terra.querySelector('.gauge-fill')).toBeNull()
    expect(terra.getAttribute('aria-checked')).toBe('true')
  })
})
