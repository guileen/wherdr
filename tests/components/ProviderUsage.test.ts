import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { createError, readBody } from 'h3'
import ProviderUsage from '~/components/ProviderUsage.vue'
import { quotaNow } from '~/composables/useQuotas'
import { cachedAt, curPane, eventsOpen, herdrState, homeQuotas, showQuotas } from '~/composables/useHerdr'
import { modelDashboard, quotas } from '~/demo/scenario'
import type { ModelDashboardSnapshot } from '#shared/modelDashboard'
import type { Pane, QuotaWindow } from '#shared/types'
import type { QuotaRow } from '~/utils/quotas'

const now = Date.now()
let snapshot: ModelDashboardSnapshot
let saves: unknown[] = []
let sessionSwitches = 0
let rejectSave = false
let getGate: Promise<void> | null = null
let saveGate: Promise<void> | null = null
let gets = 0
const mounted: { unmount: () => void }[] = []
registerEndpoint('/api/model-dashboard', async () => {
  const result = structuredClone(snapshot)
  gets++
  if (getGate) await getGate
  return result
})
registerEndpoint('/api/model-dashboard', { method: 'POST', handler: async event => {
  const body = await readBody(event)
  saves.push(body)
  if (saveGate) await saveGate
  if (rejectSave) throw createError({ statusCode: 500, statusMessage: 'Default could not be saved' })
  snapshot = { ...snapshot, defaultSelector: body.selector }
  return structuredClone(snapshot)
} })
registerEndpoint('/api/model', { method: 'POST', handler: () => { sessionSwitches++; return {} } })

beforeEach(() => {
  snapshot = modelDashboard(now)
  quotaNow.value = now
  homeQuotas.value = quotas(now)
  showQuotas.value = true
  cachedAt.value = null
  curPane.value = 'w1:p1'
  eventsOpen.value = true
  herdrState.value = { ok: true, workspaces: [], panes: [{ id: 'w1:p1', agent: 'omp', status: 'idle', model: { id: 'old-model', label: 'Existing session model' } } as Pane] }
  saves = []
  sessionSwitches = 0
  rejectSave = false
  getGate = null
  saveGate = null
  gets = 0
})
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  curPane.value = null
  eventsOpen.value = false
  homeQuotas.value = null
  cachedAt.value = null
  herdrState.value = { ok: false, panes: [], workspaces: [] }
  vi.unstubAllGlobals()
})
async function dashboard() {
  const wrapper = await mountSuspended(ProviderUsage)
  mounted.push(wrapper)
  await vi.waitFor(() => expect(wrapper.findAll('.model-card')).toHaveLength(7))
  return wrapper
}
const window = (used: number | null, minutes: number, resetMinutes: number | null, label: string): QuotaWindow => ({ used, minutes, resetsAt: resetMinutes == null ? null : now + resetMinutes * 60_000, label })
const row = (provider: string, windows: QuotaWindow[]): QuotaRow => ({ key: provider, agent: 'omp', provider, q: { five: null, week: null, at: now, windows } })

describe('ProviderUsage model defaults', () => {
  it('saves a global default with one click without changing an open session', async () => {
    const wrapper = await dashboard()
    const before = JSON.stringify(herdrState.value.panes)
    const choice = wrapper.find('[data-family="terra"] .model-choice')
    expect(choice.attributes('aria-pressed')).toBe('false')
    await wrapper.find('[data-family="terra"]').trigger('click')
    await vi.waitFor(() => expect(choice.attributes('aria-pressed')).toBe('true'))
    expect(saves).toEqual([{ selector: 'openai-codex/gpt-6.1-terra' }])
    expect(sessionSwitches).toBe(0)
    expect(JSON.stringify(herdrState.value.panes)).toBe(before)
    expect(wrapper.find('[data-family="sol"] .model-choice').attributes('aria-pressed')).toBe('false')
  })

  it('marks the chosen model busy while keeping the confirmed default until persistence completes', async () => {
    const wrapper = await dashboard()
    const { promise, resolve } = Promise.withResolvers<void>()
    saveGate = promise
    const choice = wrapper.find('[data-family="terra"] .model-choice')
    await choice.trigger('click')
    try {
      await vi.waitFor(() => expect(saves).toHaveLength(1))
      expect(choice.attributes('aria-busy')).toBe('true')
      expect(choice.attributes('aria-pressed')).toBe('false')
      expect(wrapper.find('[data-family="sol"] .model-choice').attributes('aria-pressed')).toBe('true')
    } finally { resolve() }
    await vi.waitFor(() => expect(choice.attributes('aria-pressed')).toBe('true'))
    expect(choice.attributes('aria-busy')).toBe('false')
  })

  it('keeps the saved tick unchanged when persistence fails', async () => {
    rejectSave = true
    const wrapper = await dashboard()
    const oldChoice = wrapper.find('[data-family="sol"] .model-choice')
    const newChoice = wrapper.find('[data-family="terra"] .model-choice')
    await newChoice.trigger('click')
    await vi.waitFor(() => expect(saves).toHaveLength(1))
    await vi.waitFor(() => expect(newChoice.attributes('disabled')).toBeUndefined())
    expect(newChoice.attributes('aria-pressed')).toBe('false')
    expect(oldChoice.attributes('aria-pressed')).toBe('true')
    expect(sessionSwitches).toBe(0)
  })

  it('does not let an older refresh undo a successful default save or overlap reads', async () => {
    const wrapper = await dashboard()
    const { promise, resolve: release } = Promise.withResolvers<void>()
    getGate = promise
    quotaNow.value = now + 300_000
    await vi.waitFor(() => expect(gets).toBe(2))
    quotaNow.value += 60_000
    await flushPromises()
    expect(gets).toBe(2)
    const choice = wrapper.find('[data-family="terra"] .model-choice')
    await choice.trigger('click')
    await vi.waitFor(() => expect(choice.attributes('aria-pressed')).toBe('true'))
    release()
    await flushPromises()
    expect(choice.attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('[data-family="sol"] .model-choice').attributes('aria-pressed')).toBe('false')
    expect(saves).toHaveLength(1)
  })

  it('expands provider routes and saves the exact provider selector, then collapses', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    const wrapper = await dashboard()
    const opus = wrapper.find('[data-family="opus"]')
    expect(opus.findAll('.provider-route')).toHaveLength(1)
    await opus.find('button[aria-expanded]').trigger('click')
    expect(opus.findAll('.provider-route')).toHaveLength(4)
    const chosen = opus.find('[data-selector="openrouter/anthropic/claude-opus-5.5"] button')
    await chosen.trigger('click')
    await vi.waitFor(() => expect(chosen.attributes('aria-pressed')).toBe('true'))
    expect(saves).toEqual([{ selector: 'openrouter/anthropic/claude-opus-5.5' }])
    await opus.find('button[aria-expanded]').trigger('click')
    expect(opus.findAll('.provider-route')).toHaveLength(1)
    expect(sessionSwitches).toBe(0)
  })

  it('keeps unknown three-day DeepSeek spending unknown instead of manufacturing a total or quota', async () => {
    const wrapper = await dashboard()
    const deepseek = wrapper.find('[data-family="deepseek-flash"]')
    expect(deepseek.findAll('.spend-day')).toHaveLength(3)
    expect(deepseek.findAll('.spend-day > span').map(d => d.text())).toEqual(['—', '—', '—'])
    expect(deepseek.find('.spend-total strong').text()).toBe('—')
    expect(deepseek.find('.model-gauge').exists()).toBe(false)
    expect(deepseek.text()).not.toContain('$')
  })

  it('shows model-specific expert windows and never uses unrelated X pools as Opus capacity', async () => {
    const wrapper = await dashboard()
    expect(wrapper.find('[data-family="astra"]').findAll('[role="img"]')).toHaveLength(2)
    expect(wrapper.find('[data-family="argon"]').findAll('[role="img"]')).toHaveLength(1)
    const accountRail = wrapper.find('[aria-label="Read-only account pools"]')
    expect(accountRail.text()).toContain('Grokbot / Rockbot')
    expect(accountRail.text()).toContain('Grokchat')
    expect(accountRail.findAll('button')).toHaveLength(0)
    expect(wrapper.find('[data-family="opus"]').text()).not.toContain('Grokbot')
    expect(wrapper.findAll('.model-card').map(c => c.attributes('data-family')).sort()).toEqual(['argon', 'astra', 'deepseek-flash', 'gemini-flash', 'opus', 'sol', 'terra'])
  })

  it('does not take model capacity from merged remote account readings', async () => {
    snapshot.quota = null
    const wrapper = await dashboard()
    const astra = wrapper.find('[data-family="astra"]')
    expect(astra.find('[role="img"]').attributes('aria-label')).toContain('unknown remaining quota')
    expect(astra.find('.gauge-fill').exists()).toBe(false)
    expect(wrapper.find('.account-rail').text()).toContain('Grokbot')
  })
  it('retains local reset passes as a separate read-only value without unrelated account rows', async () => {
    snapshot.quota!.reports.find(report => report.provider === 'openai-codex')!.resetCredits = { availableCount: 2 }
    homeQuotas.value = null
    const wrapper = await dashboard()
    const passes = wrapper.find('.reset-passes')
    expect(passes.find('strong:last-child').text()).toBe('2')
    expect(passes.findAll('button')).toHaveLength(0)
    expect(saves).toHaveLength(0)
  })
})

describe('ProviderUsage account compatibility', () => {
  it('keeps explicit machine rows read only, preserving separate pools and periods', async () => {
    const shared = { ...window(50, 10080, 6000, 'Shared'), scope: { sharedGroup: 'pool' } }
    const wrapper = await mountSuspended(ProviderUsage, { props: { rows: [row('xai-oauth', [shared, { ...shared }, { ...shared, minutes: 300 }, window(null, 0, null, 'Grokchat')])] } })
    mounted.push(wrapper)
    expect(wrapper.findAll('[role="img"]')).toHaveLength(3)
    expect(wrapper.findAll('.model-choice')).toHaveLength(0)
    expect(wrapper.findAll('.gauge-value').map(v => v.text())).toContain('—')
    await wrapper.find('.accounts-toggle').trigger('click')
    expect(wrapper.find('.accounts-toggle').attributes('aria-expanded')).toBe('true')
    expect(saves).toHaveLength(0)
    expect(sessionSwitches).toBe(0)
  })

  it('hides an empty account section and retains API billing without offering model changes', async () => {
    const wrapper = await mountSuspended(ProviderUsage, { props: { rows: [], api: false } })
    mounted.push(wrapper)
    expect(wrapper.find('.provider-usage').exists()).toBe(false)
    await wrapper.setProps({ api: true })
    expect(wrapper.find('.usage-api').exists()).toBe(true)
    expect(wrapper.findAll('.model-choice')).toHaveLength(0)
    expect(wrapper.findAll('[role="img"]')).toHaveLength(0)
    expect(saves).toHaveLength(0)
  })

  it('distinguishes independent accounts of the same provider by their machine labels', async () => {
    const first = { ...row('anthropic', [window(20, 300, 100, '5 Hour')]), key: 'server', label: 'Server' }
    const second = { ...row('anthropic', [window(50, 300, 100, '5 Hour')]), key: 'laptop', label: 'Laptop' }
    const wrapper = await mountSuspended(ProviderUsage, { props: { rows: [first, second] } })
    mounted.push(wrapper)
    expect(wrapper.findAll('.account-pool').map(pool => pool.text())).toEqual([expect.stringContaining('Server'), expect.stringContaining('Laptop')])
    expect(wrapper.findAll('.gauge-value').map(value => value.text())).toEqual(['80%', '50%'])
  })

  it('marks stale and reset readings accessibly without inventing a fresh full bucket', async () => {
    const stale = row('cursor', [window(25, 300, 0, 'Models')])
    stale.q.at = now - 7_200_000
    const wrapper = await mountSuspended(ProviderUsage, { props: { rows: [stale] } })
    mounted.push(wrapper)
    expect(wrapper.find('[role="img"]').attributes('aria-label')).toContain('stale reading')
    expect(wrapper.find('[role="img"]').attributes('aria-label')).toContain('awaiting update')
    expect(wrapper.find('.gauge-value').text()).toBe('—')
    expect(wrapper.find('.gauge-fill').exists()).toBe(false)
  })
})
