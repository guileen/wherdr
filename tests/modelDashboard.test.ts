import { describe, expect, it } from 'vitest'
import type { QuotaWindow } from '../shared/types'
import { dashboardFamily, type DashboardFamily, type DashboardModel } from '../shared/modelDashboard'
import { compareDashboardRoutes, dashboardCards, quotaWindows, remainingPercent, timeRemaining } from '../app/utils/modelDashboard'
import type { QuotaRow } from '../app/utils/quotas'

const now = Date.UTC(2026, 10, 6, 8)
const ids: Record<DashboardFamily, [string, string]> = {
  'gemini-flash': ['google-antigravity', 'gemini-3.8-flash'],
  luna: ['openai-codex', 'gpt-6-luna'], terra: ['openai-codex', 'gpt-6.1-terra'], sol: ['openai-codex', 'gpt-6.1-sol'],
  'deepseek-flash': ['deepseek', 'deepseek-flash'], astra: ['openai-codex', 'gpt-6-astra'],
  argon: ['google-antigravity', 'gemini-4-argon'], opus: ['google-antigravity', 'claude-opus-5-5'],
}
function model(family: DashboardFamily, provider?: string, id?: string): DashboardModel {
  const [p, m] = ids[family]
  return { selector: `${provider || p}/${id || m}`, provider: provider || p, id: id || m,
    family, tier: ['astra', 'argon', 'opus'].includes(family) ? 'expert' : 'regular', name: family,
    cost: family === 'deepseek-flash' ? { input: 0.3, output: 1.2 } : { input: 1, output: 5 } }
}
function window(left: number | null, minutes: number, time: number, label = 'Limit', scope?: QuotaWindow['scope']): QuotaWindow {
  return { used: left == null ? null : 100 - left, minutes, resetsAt: now + minutes * 60000 * time, label, scope }
}
function row(provider: string, windows: QuotaWindow[], at = now): QuotaRow {
  return { key: `omp:${provider}`, agent: 'omp', provider, q: { five: null, week: null, at, windows } }
}

function routes(family: DashboardFamily, rows: QuotaRow[]) {
  return dashboardCards([model(family)], rows, now)[0]!.routes
}

describe('curated model selection', () => {
  it('includes the exact Opus version across providers, never older, batch or unrelated models', () => {
    expect(dashboardFamily('google-antigravity', 'claude-opus-5-5')).toBe('opus')
    expect(dashboardFamily('openrouter', 'anthropic/claude-opus-5.5')).toBe('opus')
    expect(dashboardFamily('devin', 'claude-opus-5-5')).toBe('opus')
    expect(dashboardFamily('openrouter', 'anthropic/claude-opus-5.5:batch')).toBeNull()
    expect(dashboardFamily('google-antigravity', 'claude-opus-4-6')).toBeNull()
    expect(dashboardFamily('openai-codex', 'gpt-6-luna')).toBe('luna')
    expect(dashboardFamily('openrouter', 'openai/gpt-6.1-sol')).toBeNull()
  })
})

describe('model quota ownership', () => {
  it('separates Gemini Flash, Argon and third-party shared pools on Antigravity', () => {
    const flash = window(0, 10080, 0.1, 'Gemini (Weekly)')
    const argon = window(94, 10080, 0.2, 'Gemini (Argon) (Weekly)')
    const shared = window(19, 10080, 0.2, 'Claude & GPT (shared)')
    const rows = [row('google-antigravity', [flash, argon, shared])]
    const cards = dashboardCards([model('gemini-flash'), model('argon'), model('opus')], rows, now)
    expect(cards.find(c => c.family === 'gemini-flash')!.routes[0]!.windows).toEqual([flash])
    expect(cards.find(c => c.family === 'gemini-flash')!.routes[0]!.state).toBe('exhausted')
    expect(cards.find(c => c.family === 'argon')!.routes[0]!.windows).toEqual([argon])
    expect(cards.find(c => c.family === 'opus')!.routes[0]!.windows).toEqual([shared])
  })

  it('deduplicates shared reports while retaining all simultaneous constraints', () => {
    const weekly = window(19, 10080, 0.2, 'Claude & GPT (shared)', { sharedGroup: '3p-weekly' })
    const short = window(100, 300, 0.9, 'Claude & GPT (shared)', { sharedGroup: '3p-5h' })
    const r = row('google-antigravity', [weekly, { ...weekly, used: 82, id: 'other-reader' }, short])
    const selected = routes('opus', [r])[0]!
    expect(selected.windows.map(w => [w.minutes, remainingPercent(w, now)])).toEqual([[300, 100], [10080, 18]])
  })

  it('does not invent a five-hour window for a weekly-only Codex plan', () => {
    const weekly = window(70, 10080, 0.9, '7 days', { shared: true })
    const cards = dashboardCards([model('terra'), model('sol'), model('astra')], [row('openai-codex', [weekly])], now)
    expect(cards.map(c => c.routes[0]!.windows)).toEqual([[weekly], [weekly], [weekly]])
    expect(cards.map(c => c.routes[0]!.state)).toEqual(['available', 'available', 'available'])
  })

  it('honors explicit model scopes rather than provider-wide assumptions', () => {
    const terra = window(80, 300, 0.8, 'Limit', { models: ['gpt-6.1-terra'] })
    const sol = window(10, 10080, 0.9, 'Limit', { modelIds: ['openai-codex/gpt-6.1-sol'] })
    const rows = [row('openai-codex', [terra, sol])]
    expect(routes('terra', rows)[0]!.windows).toEqual([terra])
    expect(routes('sol', rows)[0]!.windows).toEqual([sol])
  })

  it('never assigns Grokbot or Prompt credits to Opus merely because the provider offers it', () => {
    for (const [provider, label] of [['xai-oauth', 'Grokbot Weekly'], ['devin', 'Prompt Credits']]) {
      const cards = dashboardCards([model('opus', provider)], [row(provider!, [window(98, 10080, 0.5, label)])], now)
      expect(cards[0]!.routes[0]!.windows).toEqual([])
      expect(cards[0]!.routes[0]!.state).toBe('unknown')
    }
  })

  it('retains separate account scopes and does not sum their capacities', () => {
    const a = row('google-antigravity', [window(20, 10080, 0.3, 'Claude & GPT (shared)')])
    const b = { ...row('google-antigravity', [window(80, 10080, 0.3, 'Claude & GPT (shared)')]), key: 'account-b' }
    const selected = routes('opus', [a, b])
    expect(selected.map(r => r.key).sort()).toEqual([`${model('opus').selector}:account-b`, `${model('opus').selector}:${a.key}`].sort())
    expect(selected.map(r => remainingPercent(r.windows[0]!, now)).sort()).toEqual([20, 80])
  })
})

describe('quota observation boundaries', () => {
  it('treats an elapsed reset as unknown instead of claiming a full new quota', () => {
    const expired = window(0, 300, -0.1)
    expect(remainingPercent(expired, now)).toBeNull()
    expect(timeRemaining(expired, now)).toBeNull()
    expect(routes('terra', [row('openai-codex', [expired])])[0]!.state).toBe('unknown')
  })

  it('does not plot invalid percentages or impossible time positions', () => {
    expect(remainingPercent({ ...window(20, 300, 0.5), used: Infinity }, now)).toBeNull()
    expect(remainingPercent(window(null, 300, 0.5), now)).toBeNull()
    expect(timeRemaining(window(20, 300, 1.1), now)).toBeNull()
    expect(timeRemaining(window(20, 0, 0), now)).toBeNull()
    expect(timeRemaining(window(20, 300, 0.4), now)).toBeCloseTo(40)
  })

  it('does not recommend stale readings even when they claim abundant quota', () => {
    const selected = routes('terra', [row('openai-codex', [window(100, 10080, 0.9)], now - 3600001)])[0]!
    expect(selected.state).toBe('stale')
    expect(selected.score).toBeNull()
  })

  it('keeps independent same-period pools distinct', () => {
    const r = row('xai-oauth', [window(11, 10080, 0.5, 'Grokbot'), window(98, 10080, 0.5, 'Grokchat')])
    expect(quotaWindows(r).map(w => w.label)).toEqual(['Grokbot', 'Grokchat'])
  })
})

describe('quota-aware economic ranking', () => {
  const regular = [model('terra'), model('deepseek-flash')]

  it('prefers Sol under pace, Terra over pace, and Luna above 50% excess relative to quota left', () => {
    const gpt = [model('luna'), model('terra'), model('sol')]
    const order = (left: number, time: number) => dashboardCards(gpt, [row('openai-codex', [window(left, 10080, time)])], now).map(card => card.family)
    expect(order(60, 0.5)).toEqual(['sol', 'terra', 'luna'])
    expect(order(40, 0.5)).toEqual(['terra', 'sol', 'luna'])
    expect(order(40, 0.6)).toEqual(['terra', 'sol', 'luna'])
    expect(order(39, 0.6)).toEqual(['luna', 'terra', 'sol'])
  })

  it('ranks DeepSeek first under weekly pressure even when five-hour quota is about to expire', () => {
    const cards = dashboardCards(regular, [row('openai-codex', [window(100, 300, 0.01), window(2, 10080, 0.9)])], now)
    expect(cards[0]!.family).toBe('deepseek-flash')
    expect(cards.find(c => c.family === 'terra')!.routes[0]!.score).toBeGreaterThan(cards[0]!.routes[0]!.score!)
  })

  it('prefers expiring short quota when the weekly budget has headroom', () => {
    const rows = [row('openai-codex', [window(90, 300, 0.05), window(80, 10080, 0.4)])]
    const cards = dashboardCards(regular, rows, now)
    expect(cards[0]!.family).toBe('terra')
    expect(cards[0]!.routes[0]!.score).toBeLessThan(0)
  })

  it('does not give a short-window expiry reward while the weekly budget is under pressure', () => {
    const weekly = window(10, 10080, 0.8)
    const expiring = dashboardCards(regular, [row('openai-codex', [weekly, window(100, 300, 0.01)])], now)
    const later = dashboardCards(regular, [row('openai-codex', [weekly, window(30, 300, 0.9)])], now)
    expect(expiring.find(c => c.family === 'terra')!.routes[0]!.score).toBe(later.find(c => c.family === 'terra')!.routes[0]!.score)
  })

  it('does not treat reset passes as already restored capacity', () => {
    const exhausted = row('openai-codex', [window(0, 10080, 0.7)])
    exhausted.q.credits = 2
    const cards = dashboardCards(regular, [exhausted], now)
    expect(cards[0]!.family).toBe('deepseek-flash')
    expect(cards[1]!.routes[0]!.state).toBe('exhausted')
    expect(cards[1]!.routes[0]!.score).toBeNull()
  })

  it('charges the DeepSeek reference workload at half price off-peak and catalog peak at peak', () => {
    const peak = dashboardCards([model('deepseek-flash')], [], Date.UTC(2026, 10, 2, 8))[0]!.routes[0]!.score
    const offPeak = dashboardCards([model('deepseek-flash')], [], Date.UTC(2026, 10, 2, 5))[0]!.routes[0]!.score
    expect(peak).toBeCloseTo((0.3 + 1.2) / 1000)
    expect(offPeak).toBeCloseTo(peak! / 2)
  })

  it('uses a catalog off-peak multiplier instead of assuming one half', () => {
    const discounted = {
      ...model('deepseek-flash'),
      cost: { input: 0.3, output: 1.2, timeBased: { offPeakMultiplier: 0.25, peakWindows: [{ weekdays: [1], startMinute: 60, endMinute: 240 }] } },
    }
    const offPeak = dashboardCards([discounted], [], Date.UTC(2026, 10, 2, 5))[0]!.routes[0]!.score
    expect(offPeak).toBeCloseTo((0.3 + 1.2) / 1000 * 0.25)
  })

  it('never invents free metered capacity when pricing is unknown', () => {
    const ds = { ...model('deepseek-flash'), cost: null }
    const selected = dashboardCards([ds], [], now)[0]!.routes[0]!
    expect(selected.state).toBe('unknown')
    expect(selected.score).toBeNull()
    expect(selected.windows).toEqual([])
  })

  it('keeps experts outside regular recommendations even when an expert pool is full', () => {
    const cards = dashboardCards([model('opus'), model('argon'), ...regular, model('astra')], [
      row('google-antigravity', [window(100, 10080, 0.1, 'Gemini (Argon)'), window(100, 10080, 0.1, 'Claude & GPT (shared)')]),
    ], now)
    expect(cards.slice(0, 2).every(c => c.tier === 'regular')).toBe(true)
    expect(cards.slice(2).map(c => c.family)).toEqual(['opus', 'argon', 'astra'])
  })
})

describe('expert route recommendations', () => {
  it('orders expert families and merged routes using the same quota pressure and expiry score', () => {
    const cards = dashboardCards([model('astra'), model('argon'), model('opus')], [
      row('openai-codex', [window(10, 10080, 0.8)]),
      row('google-antigravity', [
        window(90, 10080, 0.4, 'Gemini Argon'),
        window(90, 300, 0.05, 'Gemini Argon'),
        window(50, 10080, 0.5, 'Claude & GPT shared'),
      ]),
    ], now)
    expect(cards.map(c => c.family)).toEqual(['argon', 'opus', 'astra'])
    const merged = cards.flatMap(c => c.routes).reverse().sort(compareDashboardRoutes)
    expect(merged.map(r => r.model.family)).toEqual(['argon', 'opus', 'astra'])
    expect(merged[0]!.score).toBeLessThan(merged[1]!.score!)
    expect(merged[1]!.score).toBeLessThan(merged[2]!.score!)
  })

  it('sorts expert provider routes by comparable cost and observed quota', () => {
    const models = [
      model('opus', 'openrouter', 'claude-opus-5-5'),
      model('opus', 'anthropic', 'claude-opus-5-5'),
    ]
    const scoped = { modelIds: ['claude-opus-5-5'] }
    const selected = dashboardCards(models, [
      row('openrouter', [window(100, 10080, 0.5, 'Opus', scoped)]),
      row('anthropic', [window(100, 10080, 0.5, 'Opus')]),
    ], now)[0]!.routes
    expect(selected.map(r => r.model.provider)).toEqual(['anthropic', 'openrouter'])
    expect(selected[0]!.score).toBeLessThan(selected[1]!.score!)
  })

  it('places unknown, stale and exhausted expert routes after scored routes without inventing capacity', () => {
    const models = [
      model('opus', 'openrouter', 'claude-opus-5-5'),
      model('opus', 'anthropic', 'claude-opus-5-5'),
      model('opus', 'devin', 'claude-opus-5-5'),
      model('opus', 'xai-oauth', 'claude-opus-5-5'),
    ]
    const selected = dashboardCards(models, [
      row('anthropic', [window(80, 10080, 0.5, 'Opus')]),
      row('openrouter', [window(0, 10080, 0.5, 'Opus')]),
      row('devin', [window(100, 10080, 0.5, 'Opus')], now - 3600001),
      row('xai-oauth', [window(0, 10080, -0.1, 'Opus')]),
    ], now)[0]!.routes
    expect(selected.map(r => r.state)).toEqual(['available', 'unknown', 'stale', 'exhausted'])
    expect(selected[0]!.score).not.toBeNull()
    expect(selected.slice(1).map(r => r.score)).toEqual([null, null, null])
  })

  it('does not score an expert route when its weekly reset or catalog price is unknown', () => {
    const unknownReset = { ...window(80, 10080, 0.5, 'Opus'), resetsAt: null }
    const noPrice = { ...model('opus', 'openrouter', 'claude-opus-5-5'), cost: null }
    const cards = dashboardCards([model('opus', 'anthropic', 'claude-opus-5-5'), noPrice], [
      row('anthropic', [unknownReset]),
      row('openrouter', [window(80, 10080, 0.5, 'Opus')]),
    ], now)
    expect(cards[0]!.routes.map(r => r.score)).toEqual([null, null])
  })
})
