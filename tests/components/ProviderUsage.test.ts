import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { createError, readBody } from 'h3'
import ProviderUsage from '~/components/ProviderUsage.vue'
import { quotaNow } from '~/composables/useQuotas'
import { useModelDashboard } from '~/composables/useModelDashboard'
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
async function dashboard(readOnly = false) {
  await useModelDashboard(undefined).load(true)
  const wrapper = await mountSuspended(ProviderUsage, { props: { readOnly }, global: { stubs: { AppSheet: { props: ['open'], template: '<div v-if="open"><slot /></div>' } } } })
  mounted.push(wrapper)
  await vi.waitFor(() => expect(wrapper.find('[data-provider="openai-codex"]').exists()).toBe(true))
  return wrapper
}
async function openProvider(wrapper: VueWrapper, provider = 'openai-codex') {
  await wrapper.get(`[data-provider="${provider}"]`).trigger('click')
}
function route(wrapper: VueWrapper, selector: string) {
  return wrapper.get(`[data-selector="${selector}"]`)
}
const terra = 'openai-codex/gpt-6.1-terra'
const sol = 'openai-codex/gpt-6.1-sol'
const window = (used: number | null, minutes: number, resetMinutes: number | null, label: string): QuotaWindow => ({ used, minutes, resetsAt: resetMinutes == null ? null : now + resetMinutes * 60_000, label })
const row = (provider: string, windows: QuotaWindow[]): QuotaRow => ({ key: provider, agent: 'omp', provider, q: { five: null, week: null, at: now, windows } })

describe('ProviderUsage model defaults', () => {
  it.each([
    [24, ['7d']],
    [80, ['7d', '5h']],
  ])('shows the weekly window first and hides an under-pace short window when weekly is over pace (short used %i%%)', async (used, periods) => {
    const report = snapshot.quota!.reports.find(report => report.provider === 'openai-codex')!
    report.limits[0]!.amount.usedFraction = used / 100
    const wrapper = await dashboard()
    await openProvider(wrapper)
    expect(route(wrapper, terra).findAll('.gauge-period').map(period => period.text().slice(1))).toEqual(periods)
  })
  it('keeps the short window when the weekly window is under pace', async () => {
    const report = snapshot.quota!.reports.find(report => report.provider === 'openai-codex')!
    report.limits[1]!.amount.usedFraction = 0.1
    const wrapper = await dashboard()
    await openProvider(wrapper)
    expect(route(wrapper, terra).findAll('.gauge-period').map(period => period.text())).toEqual(['/7d', '/5h'])
  })

  it('selects a model directly from its usage row for new sessions', async () => {
    const wrapper = await dashboard()
    const choice = wrapper.get('[data-provider="google-antigravity"] [data-route-selector="google-antigravity/claude-opus-5-5"]')
    await choice.trigger('click')
    await vi.waitFor(() => expect(choice.attributes('aria-pressed')).toBe('true'))
    expect(saves).toEqual([{ selector: 'google-antigravity/claude-opus-5-5' }])
    expect(sessionSwitches).toBe(0)
    expect(wrapper.find('.home-sheet-routes').exists()).toBe(false)
  })

  it('opens shared Codex choices instead of selecting an arbitrary model', async () => {
    const wrapper = await dashboard()
    await wrapper.get(`[data-provider="openai-codex"] [data-route-selector="${sol}"]`).trigger('click')
    expect(wrapper.findAll('.home-sheet-choice')).toHaveLength(4)
    expect(saves).toEqual([])
  })


  it('saves a global default from the sheet without changing an open session', async () => {
    const wrapper = await dashboard()
    const before = JSON.stringify(herdrState.value.panes)
    await openProvider(wrapper)
    const choice = route(wrapper, terra).get('.home-sheet-choice')
    expect(choice.attributes('aria-pressed')).toBe('false')
    await choice.trigger('click')
    await vi.waitFor(() => expect(choice.attributes('aria-pressed')).toBe('true'))
    expect(saves).toEqual([{ selector: 'openai-codex/gpt-6.1-terra' }])
    expect(sessionSwitches).toBe(0)
    expect(JSON.stringify(herdrState.value.panes)).toBe(before)
    expect(route(wrapper, sol).get('.home-sheet-choice').attributes('aria-pressed')).toBe('false')
  })

  it('shares the saved default with a newly mounted local session without another read', async () => {
    const home = await dashboard()
    await openProvider(home)
    await route(home, terra).get('.home-sheet-choice').trigger('click')
    await vi.waitFor(() => expect(route(home, terra).get('.home-sheet-choice').attributes('aria-pressed')).toBe('true'))
    const reads = gets
    const session = await mountSuspended(ProviderUsage, { props: { session: true, machine: '', selected: '' } })
    mounted.push(session)
    await vi.waitFor(() => expect(session.emitted('update:selected')?.at(-1)).toEqual(['openai-codex/gpt-6.1-terra']))
    expect(gets).toBe(reads)
  })

  it('marks the chosen model busy while keeping the confirmed default until persistence completes', async () => {
    const wrapper = await dashboard()
    const { promise, resolve } = Promise.withResolvers<void>()
    saveGate = promise
    await openProvider(wrapper)
    const choice = route(wrapper, terra).get('.home-sheet-choice')
    await choice.trigger('click')
    try {
      await vi.waitFor(() => expect(saves).toHaveLength(1))
      expect(choice.attributes('aria-busy')).toBe('true')
      expect(choice.attributes('aria-pressed')).toBe('false')
      expect(route(wrapper, sol).get('.home-sheet-choice').attributes('aria-pressed')).toBe('true')
    } finally { resolve() }
    await vi.waitFor(() => expect(choice.attributes('aria-pressed')).toBe('true'))
    expect(choice.attributes('aria-busy')).toBe('false')
  })

  it('keeps the saved tick unchanged when persistence fails', async () => {
    rejectSave = true
    const wrapper = await dashboard()
    await openProvider(wrapper)
    const oldChoice = route(wrapper, sol).get('.home-sheet-choice')
    const newChoice = route(wrapper, terra).get('.home-sheet-choice')
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
    await openProvider(wrapper)
    const choice = route(wrapper, terra).get('.home-sheet-choice')
    await choice.trigger('click')
    await vi.waitFor(() => expect(choice.attributes('aria-pressed')).toBe('true'))
    release()
    await flushPromises()
    expect(choice.attributes('aria-pressed')).toBe('true')
    expect(route(wrapper, sol).get('.home-sheet-choice').attributes('aria-pressed')).toBe('false')
    expect(saves).toHaveLength(1)
  })

  it('groups subscription routes by provider, includes Antigravity Opus and excludes OpenRouter', async () => {
    const wrapper = await dashboard()
    const antigravity = wrapper.get('[data-provider="google-antigravity"]')
    expect(antigravity.find('[data-route-selector="google-antigravity/claude-opus-5-5"]').exists()).toBe(true)
    expect(wrapper.find('[data-provider="openrouter"]').exists()).toBe(false)
    await openProvider(wrapper, 'google-antigravity')
    const chosen = route(wrapper, 'google-antigravity/claude-opus-5-5').get('.home-sheet-choice')
    await chosen.trigger('click')
    await vi.waitFor(() => expect(chosen.attributes('aria-pressed')).toBe('true'))
    expect(saves).toEqual([{ selector: 'google-antigravity/claude-opus-5-5' }])
    expect(sessionSwitches).toBe(0)
  })

  it('shows shared Codex quota once, while keeping all model choices in the sheet', async () => {
    const wrapper = await dashboard()
    const codex = wrapper.get('[data-provider="openai-codex"]')
    expect(codex.findAll('.home-route .model-gauge')).toHaveLength(1)
    expect(codex.get(`[data-route-selector="${sol}"] .default-mark`).text()).toBe('✓')
    await openProvider(wrapper)
    expect(wrapper.findAll('.home-sheet-choice')).toHaveLength(4)
  })

  it('restores the Experts card with Antigravity Opus and excludes OpenRouter', async () => {
    const wrapper = await dashboard()
    const experts = wrapper.get('.home-experts')
    expect(experts.find('[data-route-selector="google-antigravity/claude-opus-5-5"]').exists()).toBe(true)
    expect(experts.find('[data-route-selector="openrouter/anthropic/claude-opus-5.5"]').exists()).toBe(false)
    await experts.trigger('click')
    expect(route(wrapper, 'google-antigravity/claude-opus-5-5').exists()).toBe(true)
    expect(wrapper.find('[data-selector="openrouter/anthropic/claude-opus-5.5"]').exists()).toBe(false)
  })

  it('preserves separate account routes rather than blending their quotas', async () => {
    const report = snapshot.quota!.reports.find(item => item.provider === 'openai-codex')!
    snapshot.quota!.reports.push(structuredClone(report))
    const wrapper = await dashboard()
    await openProvider(wrapper)
    expect(wrapper.findAll(`[data-selector="${terra}"]`)).toHaveLength(2)
  })

  it('opens read-only provider sheets without allowing default changes', async () => {
    const wrapper = await dashboard(true)
    await openProvider(wrapper)
    const choice = route(wrapper, terra).get('.home-sheet-choice')
    expect(choice.attributes('disabled')).toBeDefined()
    expect(route(wrapper, sol).get('.home-sheet-choice').attributes('aria-pressed')).toBe('true')
    expect(saves).toHaveLength(0)
  })

  it('keeps unknown three-day DeepSeek spending unknown instead of manufacturing a total or quota', async () => {
    const wrapper = await dashboard()
    const deepseek = wrapper.find('[data-provider="deepseek"]')
    expect(deepseek.findAll('.spend-day')).toHaveLength(3)
    expect(deepseek.findAll('.spend-day > span:first-child').map(d => d.text())).toEqual(['—', '—', '—'])
    expect(deepseek.find('.spend-total strong').text()).toBe('—')
    expect(deepseek.find('.model-gauge').exists()).toBe(false)
    expect(deepseek.text()).not.toContain('$')
  })

  it('shows xAI pools separately without assigning them to Opus', async () => {
    const wrapper = await dashboard()
    const xai = wrapper.get('[data-provider="xai-oauth"]')
    expect(xai.text()).toContain('Grokbot / Rockbot')
    expect(xai.text()).toContain('Grokchat')
    expect(xai.findAll('.home-route .model-gauge')).toHaveLength(3)
    await openProvider(wrapper, 'google-antigravity')
    expect(route(wrapper, 'google-antigravity/claude-opus-5-5').find('[role="img"]').attributes('aria-label')).not.toContain('Grok')
    expect(wrapper.get('.home-sheet-routes').text()).not.toContain('Grokbot')
  })

  it('does not take model capacity from merged remote account readings', async () => {
    snapshot.quota = null
    const wrapper = await dashboard()
    await openProvider(wrapper)
    const astra = route(wrapper, 'openai-codex/gpt-6-astra')
    expect(astra.find('[role="img"]').attributes('aria-label')).toContain('unknown used quota')
    expect(astra.find('.gauge-fill').exists()).toBe(false)
    expect(wrapper.find('.account-rail').text()).toContain('Grokbot')
  })
  it('shows available reset passes with Codex rather than in the account rail', async () => {
    snapshot.quota!.reports.find(report => report.provider === 'openai-codex')!.resetCredits = { availableCount: 2 }
    homeQuotas.value = null
    const wrapper = await dashboard()
    expect(wrapper.get('[data-provider="openai-codex"] .reset-passes').text()).toContain('2')
    expect(wrapper.find('.account-rail .reset-passes').exists()).toBe(false)
    expect(saves).toHaveLength(0)
  })

  it('highlights the nearest available reset-pass expiry and ignores spent passes', async () => {
    snapshot.quota!.reports.find(report => report.provider === 'openai-codex')!.resetCredits = {
      availableCount: 2,
      credits: [
        { status: 'available', expiresAt: new Date(now + 25 * 3_600_000).toISOString() },
        { status: 'available', expiresAt: new Date(now + 2 * 3_600_000).toISOString() },
        { status: 'used', expiresAt: new Date(now + 60_000).toISOString() },
      ],
    }
    const wrapper = await dashboard()
    const passes = wrapper.get('[data-provider="openai-codex"] .reset-passes')
    expect(passes.text()).toContain('2h')
    expect(passes.classes()).toContain('urgent')
    expect(passes.attributes('title')).toContain('Earliest reset pass expires')
  })
})

describe('ProviderUsage account compatibility', () => {
  it('keeps explicit machine rows read only, preserving separate pools and periods', async () => {
    const shared = { ...window(50, 10080, 6000, 'Shared'), scope: { sharedGroup: 'pool' } }
    const wrapper = await mountSuspended(ProviderUsage, { props: { rows: [row('xai-oauth', [shared, { ...shared }, { ...shared, minutes: 300 }, window(null, 0, null, 'Grokchat')])] } })
    mounted.push(wrapper)
    expect(wrapper.get('.usage-legend').text()).toBe('UsedUnder paceOver pace')
    expect(wrapper.get('.account-pool .home-route-name').text()).toContain('xAI')
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
