import { describe, expect, it, vi } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { createError, getQuery } from 'h3'
import ProviderUsage from '~/components/ProviderUsage.vue'
import { useModelDashboard } from '~/composables/useModelDashboard'
import { modelDashboard } from '~/demo/scenario'

const now = Date.now()
const snapshot = modelDashboard(now)
const requests: string[] = []
const responses = new Map<string, typeof snapshot>()
const gates = new Map<string, Promise<void>>()
const failures = new Set<string>()
registerEndpoint('/api/model-dashboard', async event => {
  const machine = String(getQuery(event).machine || '')
  requests.push(machine)
  const result = structuredClone(responses.get(machine) || snapshot)
  if (gates.has(machine)) await gates.get(machine)
  if (failures.has(machine)) throw createError({ statusCode: 500, statusMessage: 'Dashboard unavailable' })
  return result
})

describe('OMP launch model picker', () => {
  it('selects the machine default, shows usage, and emits a session-only choice', async () => {
    await useModelDashboard(undefined).load(true)
    const wrapper = await mountSuspended(ProviderUsage, { props: { session: true, machine: '', selected: '' } })
    await vi.waitFor(() => expect(wrapper.find('[data-route-selector="openai-codex/gpt-6.1-sol"]').exists()).toBe(true))
    expect(wrapper.emitted('update:selected')?.at(-1)).toEqual(['openai-codex/gpt-6.1-sol'])
    expect(wrapper.get('[data-route-selector="google-antigravity/gemini-3.8-flash"] .provider-brand img').exists()).toBe(true)
    expect(wrapper.get('[data-route-selector="openai-codex/gpt-6.1-terra"] .provider-brand').exists()).toBe(true)
    expect(wrapper.find('.session-shared').exists()).toBe(false)
    for (const selector of ['openai-codex/gpt-6.1-sol', 'openai-codex/gpt-6.1-terra']) {
      expect(wrapper.get(`[data-route-selector="${selector}"] .model-gauge`).attributes('aria-label')).toContain('used')
    }
    const expectedRoutes = useModelDashboard(undefined).cards.value.flatMap(card => card.routes.filter(route => route.state !== 'exhausted' && route.model.provider !== 'openrouter'))
    expect(wrapper.findAll('.session-model-card')).toHaveLength(new Set(expectedRoutes.map(route => route.model.selector)).size)
    const stars = wrapper.findAll('.session-model-card .usage-star')
    expect(stars).toHaveLength(1)
    expect(stars[0]!.element.closest('.session-model-card')!.classList.contains('recommended')).toBe(false)
    expect(wrapper.findAll('.session-model-card.in-use')).toHaveLength(0)
    expect(wrapper.findAll('.session-section h3').map(heading => heading.text())).toContain('Experts')
    expect(wrapper.findComponent({ name: 'AppSheet' }).exists()).toBe(false)
    const before = requests.length
    await wrapper.get('[data-route-selector="openai-codex/gpt-6.1-terra"]').trigger('click')
    expect(wrapper.emitted('update:selected')?.at(-1)).toEqual(['openai-codex/gpt-6.1-terra'])
    await wrapper.setProps({ selected: 'openai-codex/gpt-6.1-terra' })
    expect(wrapper.get('[data-route-selector="openai-codex/gpt-6.1-terra"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.findAll('.session-model-card.in-use').map(card => card.attributes('data-route-selector'))).toEqual(['openai-codex/gpt-6.1-terra'])
    const opus = expectedRoutes.filter(route => route.model.family === 'opus')
    expect(opus.length).toBeGreaterThan(1)
    for (const route of opus) {
      const choice = wrapper.get(`[data-route-selector="${route.model.selector}"]`)
      expect(choice.classes()).toContain('session-model-choice')
      expect(choice.text()).toContain('Opus')
      expect(choice.find('.model-gauge').exists()).toBe(true)
    }
    expect(wrapper.find('[data-route-selector="openrouter/anthropic/claude-opus-5.5"]').exists()).toBe(false)
    expect(wrapper.find('.session-sources').exists()).toBe(false)
    expect(requests).toHaveLength(before)
    expect(useModelDashboard(undefined).snapshot.value?.defaultSelector).toBe('openai-codex/gpt-6.1-sol')
    wrapper.unmount()
  })

  it('keeps the New-page picker folded on the current model, styled like the expanded grid', async () => {
    const wrapper = await mountSuspended(ProviderUsage, { props: { session: true, collapsible: true, machine: '', selected: '' } })
    await vi.waitFor(() => expect(wrapper.emitted('update:selected')?.at(-1)).toEqual(['openai-codex/gpt-6.1-sol']))
    await wrapper.setProps({ selected: 'openai-codex/gpt-6.1-sol' })
    const folded = wrapper.findAll('.session-model-card')
    expect(folded).toHaveLength(1)
    expect(folded[0]!.attributes('data-route-selector')).toBe('openai-codex/gpt-6.1-sol')
    expect(folded[0]!.classes()).toContain('in-use')
    expect(folded[0]!.text()).toContain('GPT 6.1 Sol')
    expect(wrapper.find('.usage-legend').exists()).toBe(false)
    expect(wrapper.find('.session-section h3').exists()).toBe(false)
    expect(wrapper.find('.session-more').exists()).toBe(false)
    await folded[0]!.trigger('click')
    expect(wrapper.findAll('.session-model-card').length).toBeGreaterThan(1)
    expect(wrapper.find('.usage-legend').exists()).toBe(true)
    expect(wrapper.findAll('.session-section h3').map(heading => heading.text())).toContain('Experts')
    await wrapper.get('[data-route-selector="openai-codex/gpt-6.1-terra"]').trigger('click')
    expect(wrapper.findAll('.session-model-card')).toHaveLength(1)
    expect(wrapper.emitted('update:selected')?.at(-1)).toEqual(['openai-codex/gpt-6.1-terra'])
    await wrapper.setProps({ selected: 'openai-codex/gpt-6.1-terra' })
    expect(wrapper.get('.session-model-card').text()).toContain('GPT 6.1 Terra')
    wrapper.unmount()
  })

  it('does not merge distinct model-scoped Codex quotas', async () => {
    const key = 'session-distinct-codex'
    const scoped = structuredClone(snapshot)
    const report = scoped.quota!.reports.find(r => r.provider === 'openai-codex')!
    report.limits[0]!.id = 'luna-5h'
    report.limits[0]!.label = 'Luna'
    report.limits[1]!.id = 'terra-weekly'
    report.limits[1]!.label = 'Terra'
    responses.set(key, scoped)
    const wrapper = await mountSuspended(ProviderUsage, { props: { session: true, machine: key, selected: '' } })
    try {
      await vi.waitFor(() => expect(wrapper.find('[data-family="luna"]').exists()).toBe(true))
      expect(wrapper.find('.session-shared').exists()).toBe(false)
      expect(wrapper.get('[data-family="luna"] .model-gauge').exists()).toBe(true)
      expect(wrapper.get('[data-family="terra"] .model-gauge').exists()).toBe(true)
    } finally {
      responses.delete(key)
      wrapper.unmount()
    }
  })
  it('shows the DeepSeek CNY price badge for this launch', async () => {
    const key = 'session-deepseek-cny'
    const catalog = structuredClone(snapshot)
    catalog.models.find(model => model.family === 'deepseek-flash')!.cost = { input: 0.3, output: 1.2 }
    responses.set(key, catalog)
    const wrapper = await mountSuspended(ProviderUsage, { props: { session: true, machine: key, selected: '' } })
    try {
      await vi.waitFor(() => expect(wrapper.find('[data-route-selector="deepseek/deepseek-flash"] .price-badge').exists()).toBe(true))
      const badge = wrapper.get('[data-route-selector="deepseek/deepseek-flash"] .price-badge')
      expect(badge.text()).toMatch(/¥(1|2)\/(4|8)/)
    } finally {
      responses.delete(key)
      wrapper.unmount()
    }
  })

  it('offers additional catalog models for this machine without changing the default', async () => {
    const key = 'session-more-models'
    const catalog = structuredClone(snapshot)
    catalog.additionalModels = [
      { selector: 'deepseek/deepseek-v4-flash', provider: 'deepseek', id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', family: 'other', tier: 'regular', cost: null },
      { selector: 'openrouter/vendor/extra', provider: 'openrouter', id: 'vendor/extra', name: 'Extra', family: 'other', tier: 'regular', cost: null },
    ]
    responses.set(key, catalog)
    const wrapper = await mountSuspended(ProviderUsage, { props: { session: true, machine: key, selected: '' } })
    try {
      await vi.waitFor(() => expect(wrapper.find('.session-more').exists()).toBe(true))
      expect(wrapper.find('[data-route-selector="deepseek/deepseek-v4-flash"]').exists()).toBe(false)
      await wrapper.get('.session-more').trigger('click')
      expect(wrapper.find('[data-route-selector="openrouter/vendor/extra"]').exists()).toBe(false)
      expect(wrapper.get('[data-route-selector="deepseek/deepseek-v4-flash"] .provider-brand img').exists()).toBe(true)
      const choice = wrapper.get('[data-route-selector="deepseek/deepseek-v4-flash"]')
      expect(choice.text()).toContain('DeepSeek V4 Flash')
      await choice.trigger('click')
      expect(wrapper.emitted('update:selected')?.at(-1)).toEqual(['deepseek/deepseek-v4-flash'])
      expect(useModelDashboard(key).snapshot.value?.defaultSelector).toBe(catalog.defaultSelector)
    } finally {
      responses.delete(key)
      wrapper.unmount()
    }
  })


  it('excludes an exhausted default but keeps a stale reading selectable', async () => {
    const report = snapshot.quota!.reports.find(r => r.provider === 'openai-codex')!
    const original = structuredClone(report)
    report.limits[0]!.amount.usedFraction = 1
    await useModelDashboard(undefined).load(true)
    const wrapper = await mountSuspended(ProviderUsage, { props: { session: true, machine: '', selected: '' } })
    await vi.waitFor(() => expect(wrapper.find('[data-route-selector="google-antigravity/gemini-3.8-flash"]').exists()).toBe(true))
    expect(wrapper.find('[data-route-selector="openai-codex/gpt-6.1-sol"]').exists()).toBe(false)
    expect(wrapper.emitted('update:selected')?.at(-1)?.[0]).not.toBe('openai-codex/gpt-6.1-sol')
    wrapper.unmount()
    report.fetchedAt = now - 86_400_000
    await useModelDashboard(undefined).load(true)
    const stale = await mountSuspended(ProviderUsage, { props: { session: true, machine: '', selected: '' } })
    await vi.waitFor(() => expect(stale.find('[data-route-selector="openai-codex/gpt-6.1-sol"]').exists()).toBe(true))
    expect(stale.emitted('update:selected')?.at(-1)).toEqual(['openai-codex/gpt-6.1-sol'])
    stale.unmount()
    Object.assign(report, original)
  })
})

describe('shared model dashboard cache', () => {
  it('shares one recommendation calculation per machine and invalidates stale readings', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    try {
      const first = useModelDashboard('shared-ranking')
      const second = useModelDashboard('shared-ranking')
      const other = useModelDashboard('other-ranking')
      first.replace(structuredClone(snapshot))
      other.replace(structuredClone(snapshot))
      expect(first.cards.value).toBe(second.cards.value)
      expect(first.cards.value).not.toBe(other.cards.value)
      const before = first.cards.value
      clock.mockReturnValue(now + 86_400_000)
      second.updateRanking()
      expect(first.cards.value).not.toBe(before)
      expect(first.cards.value).toBe(second.cards.value)
      expect(first.cards.value.flatMap(card => card.routes).some(route => route.state === 'stale')).toBe(true)
    } finally { clock.mockRestore() }
  })

  it('shows the selected remote machine without offering a local default change', async () => {
    const key = 'read-only-machine'
    responses.set(key, { ...structuredClone(snapshot), defaultSelector: 'openai-codex/gpt-6.1-terra' })
    const wrapper = await mountSuspended(ProviderUsage, { props: { machine: key, readOnly: true, machineLabel: 'host-a', accountRows: [], api: false } })
    try {
      await vi.waitFor(() => expect(wrapper.find('[data-provider="openai-codex"] .default-mark').exists()).toBe(true))
      expect(wrapper.text()).toContain('host-a')
      expect(wrapper.text()).toContain('Read only')
      expect(wrapper.find('[data-provider="openai-codex"] .model-gauge').exists()).toBe(true)
      await wrapper.get('[data-provider="openai-codex"]').trigger('click')
      await vi.waitFor(() => expect(document.querySelector('.home-sheet-choice[aria-pressed="true"]')).not.toBeNull())
      expect(document.querySelector<HTMLButtonElement>('.home-sheet-choice')?.disabled).toBe(true)
    } finally {
      wrapper.unmount()
      responses.delete(key)
    }
  })

  it('deduplicates reads, reuses fresh data, refreshes after expiry, and keeps data on failure', async () => {
    const key = 'cache-single-flight'
    const gate = Promise.withResolvers<void>()
    gates.set(key, gate.promise)
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    const first = useModelDashboard(key)
    const second = useModelDashboard(key)
    try {
      const a = first.load()
      const b = second.load()
      await vi.waitFor(() => expect(requests.filter(value => value === key)).toHaveLength(1))
      expect(first.loading.value).toBe(true)
      gate.resolve()
      await Promise.all([a, b])
      gates.delete(key)
      expect(second.snapshot.value?.defaultSelector).toBe(snapshot.defaultSelector)
      await second.load()
      expect(requests.filter(value => value === key)).toHaveLength(1)
      clock.mockReturnValue(now + 60_000)
      failures.add(key)
      await first.load()
      expect(requests.filter(value => value === key)).toHaveLength(2)
      expect(first.error.value).toBeTruthy()
      expect(first.snapshot.value?.defaultSelector).toBe(snapshot.defaultSelector)
      failures.delete(key)
      await second.load(true)
      expect(first.error.value).toBe('')
      expect(requests.filter(value => value === key)).toHaveLength(3)
    } finally {
      gate.resolve()
      gates.delete(key)
      failures.delete(key)
      clock.mockRestore()
    }
  })

  it('isolates machines and prevents an older read from overwriting a replacement', async () => {
    const machine = ref('cache-old-read')
    const dashboard = useModelDashboard(machine)
    const gate = Promise.withResolvers<void>()
    gates.set(machine.value, gate.promise)
    const pending = dashboard.load()
    await vi.waitFor(() => expect(requests).toContain('cache-old-read'))
    const saved = { ...structuredClone(snapshot), defaultSelector: 'saved-selector' }
    dashboard.replace(saved)
    machine.value = 'cache-other-machine'
    expect(dashboard.snapshot.value).toBeNull()
    await dashboard.load()
    expect(dashboard.snapshot.value?.defaultSelector).toBe(snapshot.defaultSelector)
    gate.resolve()
    await pending
    gates.delete('cache-old-read')
    machine.value = 'cache-old-read'
    expect(dashboard.snapshot.value?.defaultSelector).toBe('saved-selector')
  })

  it('preselects the new machine default and ignores an earlier machine response', async () => {
    const slow = 'session-slow'
    const fast = 'session-fast'
    const gate = Promise.withResolvers<void>()
    gates.set(slow, gate.promise)
    responses.set(fast, { ...structuredClone(snapshot), defaultSelector: 'openai-codex/gpt-6.1-terra' })
    const wrapper = await mountSuspended(ProviderUsage, { props: { session: true, machine: slow, selected: '' } })
    try {
      await vi.waitFor(() => expect(requests).toContain(slow))
      await wrapper.setProps({ machine: fast })
      await vi.waitFor(() => expect(wrapper.emitted('update:selected')?.at(-1)).toEqual(['openai-codex/gpt-6.1-terra']))
      gate.resolve()
      await flushPromises()
      expect(wrapper.emitted('update:selected')?.at(-1)).toEqual(['openai-codex/gpt-6.1-terra'])
    } finally {
      gate.resolve()
      gates.delete(slow)
      responses.delete(fast)
      wrapper.unmount()
    }
  })
})
