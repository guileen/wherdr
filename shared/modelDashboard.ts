import type { OmpQuota } from './types'

export type DashboardFamily = 'gemini-flash' | 'terra' | 'sol' | 'deepseek-flash' | 'astra' | 'argon' | 'opus'
export type DashboardTier = 'regular' | 'expert'

export interface DashboardModel {
  selector: string
  provider: string
  id: string
  name: string
  family: DashboardFamily
  tier: DashboardTier
  cost: { input: number, output: number, cacheRead?: number } | null
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
  currency: 'USD'
  days: { date: string, amount: number | null }[]
}
export interface ModelDashboardSnapshot {
  models: DashboardModel[]
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
    if (id === 'gpt-6.1-terra') return 'terra'
    if (id === 'gpt-6.1-sol') return 'sol'
    if (id === 'gpt-6-astra') return 'astra'
  }
  if (provider === 'deepseek' && id === 'deepseek-flash') return 'deepseek-flash'
  if (/(?:^|\/)(?:claude-)?opus-5[.-]5$/.test(id)) return 'opus'
  return null
}

export const DASHBOARD_LABELS: Record<DashboardFamily, string> = {
  'gemini-flash': 'Gemini 3.8 Flash', terra: 'GPT 6.1 Terra', sol: 'GPT 6.1 Sol',
  'deepseek-flash': 'V4 Flash', astra: 'GPT 6 Astra', argon: 'Gemini 4 Argon', opus: 'Opus 5.5',
}
