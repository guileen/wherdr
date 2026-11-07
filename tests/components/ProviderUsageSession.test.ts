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
    await vi.waitFor(() => expect(wrapper.find('[data-family="sol"] .model-choice').exists()).toBe(true))
    expect(wrapper.emitted('update:selected')?.at(-1)).toEqual(['openai-codex/gpt-6.1-sol'])
    expect(wrapper.find('[data-family="sol"] .model-gauge').exists()).toBe(true)
    await wrapper.get('[data-family="terra"] .model-choice').trigger('click')
    expect(wrapper.emitted('update:selected')?.at(-1)).toEqual(['openai-codex/gpt-6.1-terra'])
    wrapper.unmount()
  })

  it('excludes an exhausted default but keeps a stale reading selectable', async () => {
    const report = snapshot.quota!.reports.find(r => r.provider === 'openai-codex')!
    const original = structuredClone(report)
    report.limits[0]!.amount.usedFraction = 1
    await useModelDashboard(undefined).load(true)
    const wrapper = await mountSuspended(ProviderUsage, { props: { session: true, machine: '', selected: '' } })
    await vi.waitFor(() => expect(wrapper.find('[data-family="gemini-flash"] .model-choice').exists()).toBe(true))
    expect(wrapper.find('[data-family="sol"] .model-choice').exists()).toBe(false)
    expect(wrapper.emitted('update:selected')?.at(-1)?.[0]).not.toBe('openai-codex/gpt-6.1-sol')
    wrapper.unmount()
    report.fetchedAt = now - 86_400_000
    await useModelDashboard(undefined).load(true)
    const stale = await mountSuspended(ProviderUsage, { props: { session: true, machine: '', selected: '' } })
    await vi.waitFor(() => expect(stale.find('[data-family="sol"] .model-choice').exists()).toBe(true))
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
