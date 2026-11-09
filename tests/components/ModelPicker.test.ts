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
const choice = (selector: string) => [...document.querySelectorAll<HTMLElement>('[role="radio"], [role="menuitemcheckbox"]')].find(item => item.getAttribute('aria-label') === selector || item.textContent?.includes(selector))!

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
    expect(wrapper.get('.model-pick').attributes('aria-busy')).toBe('true')
    expect(choice(selectors[0]!).getAttribute('aria-checked')).toBe('true')
    expect([...document.querySelectorAll('[role="radio"]')].map(item => item.getAttribute('aria-label')).sort()).toEqual(a.models.map(model => model.selector).sort())

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
    expect(wrapper.get('.model-pick').attributes('aria-busy')).toBe('false')
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
    const retry = document.querySelector<HTMLElement>('.omp-picker-reload')!
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
    expect(choice(selectors[0]!).querySelector('.model-gauge')?.getAttribute('aria-label')).toContain('87% used')
  })

  it('shows every model directly with its own quota, including shared Codex quota', async () => {
    await useModelDashboard('picker-menu').load(true)
    await open('omp', 'picker-menu')
    const expected = new Set([...selectors, ...modelDashboard(now).models.map(model => model.selector)].filter(selector => !selector.startsWith('openrouter/')))
    const radios = [...document.querySelectorAll('[role="radio"]')]
    expect(radios).toHaveLength(expected.size)
    expect(new Set(radios.map(row => row.getAttribute('aria-label')))).toEqual(expected)
    expect(document.querySelector('[aria-expanded] .omp-picker-source')).toBeNull()
    const terra = choice(selectors[0]!)
    expect(choice(selectors[1]!).querySelector('.provider-brand img')).toBeTruthy()
    expect(terra.querySelector('.provider-brand')).toBeTruthy()
    const sol = choice('openai-codex/gpt-6.1-sol')
    expect(terra.getAttribute('aria-checked')).toBe('true')
    expect(terra.textContent).toContain('✓')
    expect(sol.getAttribute('aria-checked')).toBe('false')
    expect(sol.textContent).not.toContain('✓')
    expect(document.querySelectorAll('.omp-picker-star').length).toBeLessThanOrEqual(1)
    const recommended = document.querySelector('.omp-picker-star')?.closest('[role="radio"]')
    if (recommended) expect(recommended.getAttribute('aria-checked')).toBe(String(recommended === terra))
    expect(document.querySelector('.omp-picker-shared')).toBeNull()
    const terraGauge = terra.querySelector('.model-gauge.compact.summary')
    const solGauge = sol.querySelector('.model-gauge.compact.summary')
    expect(terraGauge).toBeTruthy()
    expect(solGauge?.getAttribute('aria-label')).toBe(terraGauge?.getAttribute('aria-label'))
    const unknown = choice(selectors[3]!)
    expect(unknown.querySelector('.model-gauge')?.getAttribute('aria-label')).toContain('unknown used quota')
    expect(unknown.querySelector('.gauge-fill')).toBeNull()
    expect(choice(selectors[2]!)).toBeUndefined()
    choice(selectors[1]!).click()
    await vi.waitFor(() => expect(switches).toEqual([{ pane_id: 'session', label: selectors[1] }]))
  })

  it('shows the DeepSeek CNY peak/off-peak price beside its choice', async () => {
    const snapshot = modelDashboard(now)
    snapshot.models.find(model => model.family === 'deepseek-flash')!.cost = { input: 0.3, output: 1.2 }
    useModelDashboard('picker-cny').replace(snapshot)
    await open('omp', 'picker-cny')
    const row = choice('deepseek/deepseek-flash')
    const badge = row.querySelector('.price-badge')
    expect(badge).toBeTruthy()
    expect(badge!.textContent).toMatch(/¥(1|2)\/(4|8)/)
    expect(badge!.getAttribute('title')).toContain('per 1M input / output')
  })

  it('shows same-name providers as distinct direct choices and switches the exact selector', async () => {
    const snapshot = modelDashboard(now)
    const original = snapshot.models.find(model => model.selector === selectors[1])!
    snapshot.models = [...snapshot.models, { ...original, selector: 'devin/gemini-3.8-flash', provider: 'devin', cost: null }]
    useModelDashboard('picker-sources').replace(snapshot)
    await open('omp', 'picker-sources')
    const first = choice(selectors[1]!)
    const second = choice('devin/gemini-3.8-flash')
    expect(first).not.toBe(second)
    expect(first.textContent).toContain('Google Antigravity')
    expect(second.textContent).toContain('Devin')
    expect(first.getAttribute('aria-checked')).toBe('false')
    expect(second.getAttribute('aria-checked')).toBe('false')
    expect(first.querySelector('.model-gauge.compact.summary')).toBeTruthy()
    expect(second.querySelector('.model-gauge.compact.summary')).toBeTruthy()
    second.click()
    await vi.waitFor(() => expect(switches).toEqual([{ pane_id: 'session', label: 'devin/gemini-3.8-flash' }]))
  })

  it('switches an unrecognized model only in the current pane', async () => {
    await useModelDashboard('picker-unknown').load(true)
    const wrapper = await open('omp', 'picker-unknown')
    choice(selectors[3]!).click()
    await vi.waitFor(() => expect(switches).toEqual([{ pane_id: 'session', label: selectors[3] }]))
    await vi.waitFor(() => expect(wrapper.get('.model-name').text()).toBe(selectors[3]))
  })

  it('does not open the OMP picker while the pane is working', async () => {
    eventsOpen.value = true
    const pane = { id: 'busy-pane', machine: 'picker-busy', agent: 'omp', status: 'working', model: { id: selectors[0], label: selectors[0], effort: null } } as Pane
    const wrapper = await mountSuspended(TooltipProvider, { slots: { default: () => h(ModelPicker, { pane, header: true }) }, attachTo: document.body })
    mounted.push(wrapper)
    await wrapper.get('.model-pick').trigger('click')
    expect(document.querySelector('.omp-picker-grid')).toBeNull()
    expect(switches).toEqual([])
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
