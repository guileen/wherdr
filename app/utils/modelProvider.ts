import type { ModelInfo } from '../../shared/types'
import { DASHBOARD_LABELS, dashboardFamily, type DashboardFamily } from '../../shared/modelDashboard'

// Provider behind a session's model. omp names it in its id
// (`provider/model`); the other agents carry it in the id or label
// ("claude-sonnet-4-5", "GPT-5 Codex", "Gemini 3.8 Flash").
const BY_MODEL: [RegExp, string][] = [
  [/^(?:claude|opus|sonnet|haiku)\b/i, 'anthropic'],
  [/^(?:gpt|codex|o[1-9])\b/i, 'openai-codex'],
  [/^(?:gemini|antigravity)\b/i, 'google-antigravity'],
  [/^deepseek\b/i, 'deepseek'],
  [/^grok\b/i, 'xai-oauth'],
  [/^devin\b/i, 'devin'],
]
// Provider of an agent whose model is not known yet (or says nothing).
const BY_AGENT: Record<string, string> = { claude: 'anthropic', codex: 'openai-codex' }

export function modelProvider(agent: string | null | undefined, model: ModelInfo | null | undefined): string {
  const id = model?.id || ''
  const slash = id.indexOf('/')
  if (slash > 0) return id.slice(0, slash)
  for (const [pattern, provider] of BY_MODEL) if (pattern.test(id) || pattern.test(model?.label || '')) return provider
  return (agent && BY_AGENT[agent]) || ''
}

// Family of a session's model, as the dashboard shortlist names it: read from
// its id when known, else from the label of a listed family.
export function modelFamily(agent: string | null | undefined, model: ModelInfo | null | undefined): DashboardFamily | null {
  const id = model?.id || ''
  const slash = id.indexOf('/')
  const direct = dashboardFamily(modelProvider(agent, model), slash >= 0 ? id.slice(slash + 1) : id)
  if (direct) return direct
  const label = (model?.label || '').trim().toLowerCase().replace(/\s*\([^)]*\)\s*$/, '')
  if (!label) return null
  const hit = (Object.entries(DASHBOARD_LABELS) as [DashboardFamily, string][]).find(([, name]) => name.toLowerCase() === label)
  return hit ? hit[0] : null
}

// Models whose name a list row spells out: the experts and GPT 6.1 Sol.
const NAMED_FAMILIES: DashboardFamily[] = ['astra', 'argon', 'opus', 'sol']
export function namedModel(agent: string | null | undefined, model: ModelInfo | null | undefined): boolean {
  const family = modelFamily(agent, model)
  return Boolean(family && NAMED_FAMILIES.includes(family))
}
