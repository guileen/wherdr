import type { ModelInfo, ModelOption } from '#shared/types'
import type { ModelDashboardSnapshot } from '#shared/modelDashboard'
import { dashboardCards, type DashboardCard, type DashboardRoute } from './modelDashboard'
import { ompReportToQuota } from './quotas'

// The dashboard only supplies hints for selectors actually present in the
// session menu. Pick the best observed account when a provider has several.
export function usageModelRoutes(snapshot: ModelDashboardSnapshot | null, now: number, cards?: DashboardCard[]): Map<string, DashboardRoute> {
  const routes = new Map<string, DashboardRoute>()
  if (!snapshot) return routes
  const stateRank: Record<DashboardRoute['state'], number> = { available: 0, unknown: 1, stale: 2, exhausted: 3 }
  const rankedCards = cards ?? dashboardCards(snapshot.models, (snapshot.quota?.reports || []).map((report, index) => ({
    key: `${report.provider}:${index}`, agent: 'omp', provider: report.provider, q: ompReportToQuota(report),
  })), now)
  for (const card of rankedCards) {
    for (const route of card.routes) {
      const existing = routes.get(route.model.selector)
      if (!existing || stateRank[route.state] < stateRank[existing.state]) routes.set(route.model.selector, route)
    }
  }
  return routes
}

// Keep the session's actual options and their identities; the dashboard is
// only an ordering hint and does not contain the full omp model catalog.
export function usageOrderedModelOptions(options: ModelOption[], snapshot: ModelDashboardSnapshot | null, now: number, cards?: DashboardCard[]): ModelOption[] {
  if (!snapshot?.quota?.reports.length) return options
  const routes = usageModelRoutes(snapshot, now, cards)
  const hasExhausted = options.some(option => routes.get(option.label)?.state === 'exhausted')
  const ranks = new Map([...routes.keys()].map((selector, index) => [selector, index]))
  const category = (option: ModelOption) => {
    const route = routes.get(option.label)
    if (route?.state === 'available') return 0
    // An unmetered/unknown Flash route is a fallback, not proof of quota.
    if (hasExhausted && route?.state === 'unknown' && route.model.family === 'deepseek-flash') return 1
    if (route?.state === 'exhausted') return 3
    return 2
  }
  return options.map((option, index) => ({ option, index, category: category(option), rank: ranks.get(option.label) }))
    .sort((a, b) => a.category - b.category
      || (a.category === 0 ? (a.rank ?? Infinity) - (b.rank ?? Infinity) : 0)
      || a.index - b.index)
    .map(({ option }) => option)
}

// Claude sometimes shows "Opus (1M)" while its description gives
// "Opus 5.5 with 1M context" and the transcript "Opus 5.5 (1M)".
const key = (value: string) => value.toLowerCase()
  .replace(/\bwith 1m context\b/g, '(1m)')
  .replace(/\b1m context\b/g, '1m')
  .replace(/\s*\((?:default|current)\)/g, '')
  .replace(/\s+/g, ' ').trim()

export function modelOptionCurrent(option: ModelOption, model: ModelInfo | null | undefined): boolean {
  if (!model) return false
  // omp: the options are the raw ids ("anthropic/claude-opus-5-5"), the
  // state carries the same id — compare it before the labels.
  if (model.id && option.label.includes('/')) return option.label === model.id || option.label === model.label
  const wanted = key(model.label)
  if (key(option.label) === wanted) return true
  const hintName = option.hint?.split('·')[0]?.trim() || ''
  return Boolean(hintName) && key(hintName) === wanted
}

export function currentModelOption(options: ModelOption[], model: ModelInfo | null | undefined): number {
  // Prefer the explicit name over "Default (recommended)" when both
  // point to the same model. Only check a single row.
  const explicit = options.findIndex(o => !/^default\b/i.test(o.label) && modelOptionCurrent(o, model))
  return explicit >= 0 ? explicit : options.findIndex(o => modelOptionCurrent(o, model))
}
