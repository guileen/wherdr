import type { QuotaWindow } from '../../shared/types'
import { DASHBOARD_LABELS, type DashboardFamily, type DashboardModel, type DashboardTier } from '../../shared/modelDashboard'
import type { QuotaRow } from './quotas'
import { STALE_MS } from './quotas'
import { deepseekPricing } from './deepseekPricing'

export interface DashboardRoute {
  key: string
  model: DashboardModel
  row: QuotaRow | null
  windows: QuotaWindow[]
  accountLabel: string | null
  state: 'available' | 'unknown' | 'stale' | 'exhausted'
  score: number | null
}
export interface DashboardCard {
  family: DashboardFamily
  name: string
  tier: DashboardTier
  routes: DashboardRoute[]
}

const ORDER: DashboardFamily[] = ['gemini-flash', 'luna', 'terra', 'sol', 'deepseek-flash', 'astra', 'argon', 'opus', 'other']
const DAY = 1440

export function routeProviderName(provider: string): string {
  return ({ 'google-antigravity': 'Antigravity', 'openai-codex': 'Codex', deepseek: 'DeepSeek',
    anthropic: 'Claude Code', 'xai-oauth': 'X', devin: 'Devin', openrouter: 'OpenRouter' } as Record<string, string>)[provider] || provider
}

export const providerLabel = (provider: string) => provider
  ? ({ 'google-antigravity': 'Google Antigravity', 'xai-oauth': 'xAI' } as Record<string, string>)[provider] || routeProviderName(provider)
  : ''

export function quotaPeriod(w: QuotaWindow): string {
  const minutes = w.minutes
  if (!Number.isFinite(minutes) || minutes <= 0) return '—'
  if (minutes % DAY === 0) return `${minutes / DAY}d`
  if (minutes % 60 === 0) return `${minutes / 60}h`
  return `${minutes}m`
}

// A past reset is an unobserved transition, not evidence of a full new bucket.
export function remainingPercent(w: QuotaWindow, now: number): number | null {
  if (w.resetsAt != null && w.resetsAt <= now) return null
  if (w.used == null || !Number.isFinite(w.used) || w.used < 0 || w.used > 100) return null
  return Math.round((100 - w.used) * 10) / 10
}

export function timeRemaining(w: QuotaWindow, now: number): number | null {
  if (!w.resetsAt || !Number.isFinite(w.resetsAt) || !Number.isFinite(w.minutes) || w.minutes <= 0) return null
  const ratio = (w.resetsAt - now) / (w.minutes * 60000)
  return ratio > 0 && ratio <= 1 ? ratio * 100 : null
}

export function quotaWindows(row: QuotaRow): QuotaWindow[] {
  const source = row.q.windows?.length ? row.q.windows : [row.q.five, row.q.week].filter((w): w is QuotaWindow => w != null)
  const pools = new Map<string, QuotaWindow>()
  for (const w of source) {
    const scope = w.scope
    const key = JSON.stringify([scope?.sharedGroup || w.id || w.label || '', w.minutes, w.windowId,
      w.resetsAt, scope?.accountScope, scope?.projectId, scope?.accountId])
    const previous = pools.get(key)
    if (!previous || (w.used != null && (previous.used == null || w.used > previous.used))) pools.set(key, w)
  }
  return [...pools.values()].sort((a, b) => (a.minutes || Infinity) - (b.minutes || Infinity))
}

function explicitModels(w: QuotaWindow): string[] | null {
  const s = w.scope
  if (!s) return null
  const value = s.modelIds ?? s.models ?? s.modelId ?? s.model
  if (typeof value === 'string') return [value.toLowerCase()]
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string').map(v => v.toLowerCase())
  return null
}

function applies(w: QuotaWindow, model: DashboardModel): boolean {
  const explicit = explicitModels(w)
  if (explicit) return explicit.includes(model.id.toLowerCase()) || explicit.includes(model.selector.toLowerCase())
  if (model.family === 'other') return false
  const text = `${w.id || ''} ${w.label || ''} ${w.scope?.sharedGroup || ''}`.toLowerCase()
  if (model.provider === 'google-antigravity') {
    if (model.family === 'argon') return /argon/.test(text)
    if (model.family === 'gemini-flash') return /gemini/.test(text) && !/argon|pro|claude|gpt/.test(text)
    if (model.family === 'opus') return /opus|claude.*gpt|3p-(?:5h|weekly)/.test(text)
    return false
  }
  if (model.provider === 'openai-codex') {
    const named = /astra|terra|sol|luna|gpt-/.test(text)
    return named ? text.includes(model.id.toLowerCase()) || text.includes(model.family) : true
  }
  if (model.provider === 'anthropic') return !/sonnet|haiku/.test(text)
  // Third-party route names do not establish their relationship to Grokbot,
  // Prompt or Flow credits. Exact model scope or an explicit Opus pool does.
  return model.family === 'opus' && /\bopus\b/.test(text)
}

function routeState(row: QuotaRow | null, windows: QuotaWindow[], now: number): DashboardRoute['state'] {
  if (!row || !windows.length) return 'unknown'
  if (now - row.q.at > STALE_MS || row.q.at > now + 60000) return 'stale'
  if (windows.some(w => remainingPercent(w, now) === 0)) return 'exhausted'
  if (windows.some(w => remainingPercent(w, now) == null)) return 'unknown'
  return 'available'
}

// A fixed 1k-input/1k-output reference workload makes the cost heuristic
// comparable. It is a ranking proxy, not a prediction or a billed amount.
function referenceCost(model: DashboardModel): number | null {
  if (!model.cost || !Number.isFinite(model.cost.input) || !Number.isFinite(model.cost.output)
    || model.cost.input < 0 || model.cost.output < 0) return null
  return (model.cost.input + model.cost.output) / 1000
}

export function recommendationScore(route: DashboardRoute, now: number, meteredReference: number): number | null {
  if (route.state === 'exhausted' || route.state === 'stale') return null
  if (route.model.family === 'deepseek-flash') {
    const cost = referenceCost(route.model)
    return cost == null ? null : cost * deepseekPricing(now, route.model.cost?.timeBased).factor
  }
  if (route.state !== 'available') return null
  const weekly = route.windows.filter(w => w.minutes >= 7 * DAY)
  // Do not rank a subscription with an unobserved weekly reset as cheap.
  if (weekly.some(w => timeRemaining(w, now) == null)) return null
  let pressure = 0
  let headroom = 1
  for (const w of weekly) {
    const remaining = remainingPercent(w, now)! / 100
    const time = timeRemaining(w, now)! / 100
    pressure = Math.max(pressure, time - remaining, 0)
    headroom = Math.min(headroom, Math.max(0, remaining - time))
  }
  let expiringCapacity = 0
  for (const w of route.windows.filter(w => w.minutes > 0 && w.minutes <= 360)) {
    const time = timeRemaining(w, now)
    if (time != null) expiringCapacity = Math.max(expiringCapacity, (remainingPercent(w, now)! / 100) * (1 - time / 100))
  }
  // Any weekly shortage cancels the short-window incentive. Unknown API
  // routes retain catalog cost rather than being treated as free subscriptions.
  const subscription = ['openai-codex', 'google-antigravity', 'anthropic', 'devin', 'xai-oauth'].includes(route.model.provider)
  const cash = subscription ? 0 : referenceCost(route.model)
  if (cash == null) return null
  const gpt = ['luna', 'terra', 'sol'] as const
  const family = route.model.family
  let preference = 0
  if (family === 'luna' || family === 'terra' || family === 'sol') {
    const windows = weekly.length ? weekly : route.windows
    let excess: number | null = null
    for (const w of windows) {
      const left = remainingPercent(w, now)
      const time = timeRemaining(w, now)
      if (left != null && time != null && left > 0) excess = Math.max(excess ?? 0, (time - left) / left)
    }
    if (excess != null) {
      const order: readonly string[] = excess > 0.5 + 1e-9 ? gpt : excess > 0 ? ['terra', 'sol', 'luna'] : ['sol', 'terra', 'luna']
      preference = order.indexOf(family) * 0.01
    }
  }
  return cash + meteredReference * (8 * pressure - Math.max(0, headroom) * expiringCapacity + preference)
}

export function compareDashboardRoutes(a: DashboardRoute, b: DashboardRoute): number {
  const rank = (r: DashboardRoute) => r.state === 'exhausted' ? 3 : r.state === 'stale' ? 2 : r.score == null ? 1 : 0
  return rank(a) - rank(b) || (a.score ?? 0) - (b.score ?? 0) || a.model.selector.localeCompare(b.model.selector) || a.key.localeCompare(b.key)
}

export function dashboardCards(models: DashboardModel[], rows: QuotaRow[], now: number): DashboardCard[] {
  const metered = models.find(m => m.family === 'deepseek-flash')
  const reference = metered && referenceCost(metered)
  // Without observed catalog pricing the numeric pressure ordering is still
  // relative; the fallback is a unitless scale, never displayed as money.
  const scale = reference != null && reference > 0 ? reference : 1
  const cards = new Map<DashboardFamily, DashboardCard>()
  const selectors = new Set<string>()
  for (const model of models) {
    if (selectors.has(model.selector)) continue
    selectors.add(model.selector)
    const matches = rows.filter(r => r.agent === 'omp' && r.provider === model.provider)
    const routes: DashboardRoute[] = (matches.length ? matches : [null]).map(row => {
      const windows = row ? quotaWindows(row).filter(w => applies(w, model)) : []
      const route: DashboardRoute = {
        key: `${model.selector}:${row?.key || 'unknown'}`, model, row, windows,
        accountLabel: windows.length ? (row?.label || null) : null,
        state: routeState(row, windows, now), score: null,
      }
      route.score = recommendationScore(route, now, scale)
      return route
    })
    const card = cards.get(model.family) || { family: model.family, name: DASHBOARD_LABELS[model.family], tier: model.tier, routes: [] }
    card.routes.push(...routes)
    cards.set(model.family, card)
  }
  for (const card of cards.values()) card.routes.sort(compareDashboardRoutes)
  return [...cards.values()].sort((a, b) => {
    if (a.tier !== b.tier) return a.tier === 'regular' ? -1 : 1
    return compareDashboardRoutes(a.routes[0]!, b.routes[0]!) || ORDER.indexOf(a.family) - ORDER.indexOf(b.family)
  })
}
