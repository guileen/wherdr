import type { OmpQuota } from './types'

export type DashboardFamily = 'gemini-flash' | 'luna' | 'terra' | 'sol' | 'deepseek-flash' | 'astra' | 'argon' | 'opus' | 'other'
export type DashboardTier = 'regular' | 'expert'
// DeepSeek publishes the same token prices in USD and CNY at this fixed rate.
export const DEEPSEEK_CNY_PER_USD = 20 / 3

export interface DashboardPeakWindow {
  weekdays: number[]
  startMinute: number
  endMinute: number
}
export interface DashboardTimeBasedPricing {
  offPeakMultiplier: number
  peakWindows: DashboardPeakWindow[]
}
export interface DashboardCost {
  input: number
  output: number
  cacheRead?: number
  timeBased?: DashboardTimeBasedPricing
}
export interface DashboardModel {
  selector: string
  provider: string
  id: string
  name: string
  family: DashboardFamily
  tier: DashboardTier
  cost: DashboardCost | null
}
export interface ModelSelection {
  selector: string
  provider: string
  modelId: string
  app: 'omp'
  source: 'manual'
  at: number
  previous: string | null
}
export interface DashboardSpending {
  currency: 'CNY'
  days: { date: string, amount: number | null }[]
}
export interface ModelDashboardSnapshot {
  models: DashboardModel[]
  additionalModels?: DashboardModel[]
  defaultSelector: string | null
  selections: ModelSelection[]
  spending: DashboardSpending
  quota?: OmpQuota | null // Local OMP account reports, never the cross-machine aggregate.
}

// The product's explicit shortlist; catalog updates cannot add unrelated models.
export function dashboardFamily(provider: string, id: string): DashboardFamily | null {
  if (provider === 'google-antigravity' && id === 'gemini-3.8-flash') return 'gemini-flash'
  if (provider === 'google-antigravity' && id === 'gemini-4-argon') return 'argon'
  if (provider === 'openai-codex') {
    if (id === 'gpt-6-luna') return 'luna'
    if (id === 'gpt-6.1-terra') return 'terra'
    if (id === 'gpt-6.1-sol') return 'sol'
    if (id === 'gpt-6-astra') return 'astra'
  }
  if (provider === 'deepseek' && id === 'deepseek-flash') return 'deepseek-flash'
  if (/(?:^|\/)(?:claude-)?opus-5[.-]5$/.test(id)) return 'opus'
  return null
}

export const DASHBOARD_LABELS: Record<DashboardFamily, string> = {
  'gemini-flash': 'Gemini 3.8 Flash', luna: 'GPT 6 Luna', terra: 'GPT 6.1 Terra', sol: 'GPT 6.1 Sol',
  'deepseek-flash': 'V4 Flash', astra: 'GPT 6 Astra', argon: 'Gemini 4 Argon', opus: 'Opus 5.5', other: 'Other',
}
