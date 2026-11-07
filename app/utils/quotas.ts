// Home quotas, split between the top of the list and the machines. Pure, without Vue.
//  - An account shared by all online machines (Codex, or a single Claude
//    account): once at the top, as before.
//  - Different accounts (Claude or Codex): each machine has the table of its
//    account under its header (collapsed with it), nothing left of that agent at the top.
import type { ClaudeSetup, OmpProviderReport, Quota, QuotaWindow, Quotas } from '../../shared/types'
import installer from '../../scripts/install-claude-statusline.sh?raw'

export interface QuotaRow {
  key: string
  agent: 'claude' | 'codex' | 'omp' | string
  q: Quota
  label?: string
  provider?: string
}
// Machines whose Claude Code runs on API billing (usage without quota).
export const claudeApiKeys = (q: Quotas) => (q.claudeSetup || []).filter(s => s.state === 'api').map(s => s.key)
// Claude shown under each machine: several accounts, or a subscription account
// next to machines on API billing.
export function claudeSplit(q: Quotas) {
  const n = q.claudeAccounts?.length || 0
  return n > 1 || (n > 0 && claudeApiKeys(q).length > 0)
}

// "Claude · API usage, no quota" label instead of gauges: at the top (`key`
// null) when every machine read with a Claude reading is on API billing,
// under a machine when it is the API one among subscription machines.
export function claudeApiShown(q: Quotas | null, key: string | null, hidden: readonly string[] = []): boolean {
  if (!q || hidden.includes('claude')) return false
  const api = claudeApiKeys(q)
  if (!api.length) return false
  return key === null ? !q.claude : claudeSplit(q) && api.includes(key)
}

export function ompProviderLabel(provider: string): string {
  const map: Record<string, string> = {
    'openai-codex': 'OpenAI Codex',
    'google-antigravity': 'Google Antigravity',
    'xai-oauth': 'xAI',
    cursor: 'Cursor',
    devin: 'Devin',
    anthropic: 'Anthropic',
  }
  return map[provider] || (provider[0]!.toUpperCase() + provider.slice(1))
}

export interface ProviderIdentity {
  id: string
  name: string
  shortName: string
  icon: string
}

export function providerIdentity(row: QuotaRow): ProviderIdentity {
  const p = (row.provider || (row.agent === 'omp' ? '' : row.agent) || '').toLowerCase()
  if (p === 'anthropic' || p === 'claude') {
    return { id: 'claude', name: 'Anthropic Claude', shortName: 'Claude', icon: 'i-herdr-claude-code' }
  }
  if (p === 'openai-codex' || p === 'codex' || p === 'openai') {
    return { id: 'codex', name: 'OpenAI Codex', shortName: 'Codex', icon: 'i-herdr-codex' }
  }
  if (p === 'google-antigravity' || p === 'gemini' || p === 'google') {
    return { id: 'google', name: 'Google Gemini', shortName: 'Gemini', icon: 'i-lucide-sparkles' }
  }
  if (p === 'xai-oauth' || p === 'xai' || p === 'grok') {
    return { id: 'xai', name: 'xAI Grok', shortName: 'xAI', icon: 'i-lucide-zap' }
  }
  if (p === 'cursor') {
    return { id: 'cursor', name: 'Cursor', shortName: 'Cursor', icon: 'i-lucide-mouse-pointer-2' }
  }
  if (p === 'devin') {
    return { id: 'devin', name: 'Devin', shortName: 'Devin', icon: 'i-lucide-terminal' }
  }
  if (p === 'kimi') {
    return { id: 'kimi', name: 'Kimi', shortName: 'Kimi', icon: 'i-lucide-moon-star' }
  }
  if (row.agent === 'omp') {
    const label = row.label || 'Provider'
    return { id: 'provider', name: label, shortName: label, icon: 'i-lucide-cpu' }
  }
  const label = row.label || (row.agent ? row.agent[0]!.toUpperCase() + row.agent.slice(1) : 'Provider')
  return {
    id: row.agent || 'provider',
    name: label,
    shortName: label,
    icon: row.agent === 'claude' ? 'i-herdr-claude-code' : row.agent === 'codex' ? 'i-herdr-codex' : 'i-lucide-cpu',
  }
}

export function periodLabel(w: QuotaWindow): string {
  if (w.label) {
    const lower = w.label.toLowerCase()
    if (lower === '5 hour' || lower === '5 hours' || lower === '5 h' || lower === '5h') return '5h'
    if (lower === 'weekly' || lower === '7 days' || lower === '7d' || lower === 'week') return '7d'
    if (lower === 'daily' || lower === '24 hour' || lower === '24h' || lower === 'day' || lower === '1d') return '1d'
    if (lower.includes('5h') || lower.includes('5 hour')) return '5h'
    if (lower.includes('weekly') || lower.includes('7d') || lower.includes('7 day') || lower.includes('week')) return '7d'
    if (lower.includes('daily') || lower.includes('24h') || lower.includes('day')) return '1d'
    if (lower.includes('other')) return 'Other'
    if (lower.includes('cursor')) return 'Models'
    if (lower.includes('monthly') || lower.includes('month') || lower.includes('30d')) return '30d'
    if (w.label.length <= 6) return w.label
  }
  if (w.minutes === 300) return '5h'
  if (w.minutes === 10080) return '7d'
  if (w.minutes === 1440) return '1d'
  if (w.minutes === 43200) return '30d'
  if (!w.minutes) return '—'
  if (w.minutes % 1440 === 0) return `${w.minutes / 1440}d`
  if (w.minutes % 60 === 0) return `${w.minutes / 60}h`
  return `${w.minutes}m`
}


export function resetCountdown(w: QuotaWindow, now: number): string {
  if (w.fresh) return 'new'
  if (!w.resetsAt) return '—'
  if (w.resetsAt <= now) return 'reset'
  const minutes = Math.ceil((w.resetsAt - now) / 60000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h${minutes % 60 ? `${minutes % 60}m` : ''}`
  return `${Math.floor(hours / 24)}d${hours % 24 ? `${hours % 24}h` : ''}`
}

export function ompReportToQuota(report: OmpProviderReport): Quota {
  const at = report.fetchedAt
  const windows: QuotaWindow[] = []

  for (const l of report.limits) {
    const amount = l.amount
    let used: number | null = null
    if (amount.unit === 'percent' && typeof amount.used === 'number' && Number.isFinite(amount.used)) {
      used = amount.used
    } else if (typeof amount.usedFraction === 'number' && Number.isFinite(amount.usedFraction)) {
      used = amount.usedFraction * 100
    } else if (typeof amount.used === 'number' && Number.isFinite(amount.used)
      && typeof amount.limit === 'number' && Number.isFinite(amount.limit) && amount.limit > 0) {
      used = amount.used / amount.limit * 100
    }
    if (used !== null) used = Math.max(0, Math.min(100, Math.round(used)))

    const minutes = l.window?.durationMs ? Math.round(l.window.durationMs / 60000) : (
      l.window?.id === '5h' ? 300 :
      (l.window?.id === '7d' || l.window?.id === '1w' || l.window?.id === 'weekly') ? 10080 :
      l.window?.id === '1d' ? 1440 : 0
    )
    const rawResetsAt = l.window?.resetsAt
    const resetsAt = typeof rawResetsAt === 'number' ? rawResetsAt : (
      typeof rawResetsAt === 'string' && !isNaN(Date.parse(rawResetsAt)) ? Date.parse(rawResetsAt) : null
    )
    const windowLabel = l.window?.label || (minutes === 300 ? '5h' : minutes === 10080 ? '7d' : '')
    const label = l.label && windowLabel && !l.label.toLowerCase().includes(windowLabel.toLowerCase())
      ? `${l.label} (${windowLabel})`
      : (l.label || windowLabel || 'Limit')
    windows.push({ used, resetsAt, minutes, label, id: l.id, scope: l.scope, windowId: l.window?.id, amount })
  }

  const five = windows.find(w => w.minutes > 0 && w.minutes <= 360) || null
  const week = windows.find(w => w.minutes >= 1440) || null
  const credits = report.resetCredits?.availableCount
  const resetCredits = report.resetCredits ? {
    availableCount: credits,
    ...(Array.isArray(report.resetCredits.credits) ? {
      credits: report.resetCredits.credits.filter(credit => credit?.status === 'available').map(credit => ({
        grantedAt: credit.grantedAt, expiresAt: credit.expiresAt, status: credit.status,
      })),
    } : {}),
  } : undefined
  const plan = typeof report.metadata?.planType === 'string' ? report.metadata.planType : undefined
  return { five, week, at, windows, credits, resetCredits, plan }
}

 // Rows at the top of the home screen.
 export function quotaRows(q: Quotas | null, hidden: readonly string[] = []): QuotaRow[] {
   if (!q) return []
   const rows: QuotaRow[] = []

  const ompReports = q.omp && !hidden.includes('omp') ? [...q.omp.reports] : []
  const codexOmp = ompReports.find(r => r.provider === 'openai-codex' || r.provider === 'codex')
  const claudeOmp = ompReports.find(r => r.provider === 'anthropic' || r.provider === 'claude')

  // Standalone Claude: if omp covers Claude, only include the latest data
  const standaloneClaude = q.claude && !hidden.includes('claude') && !claudeSplit(q) ? q.claude : null
  if (standaloneClaude) {
    if (!claudeOmp || standaloneClaude.at > claudeOmp.fetchedAt) {
      rows.push({ key: 'claude', agent: 'claude', q: standaloneClaude })
    }
  }

  // Standalone Codex: if omp covers Codex, only include the latest data
  const standaloneCodex = q.codex && !hidden.includes('codex') && !((q.codexAccounts?.length || 0) > 0) ? q.codex : null
  if (standaloneCodex) {
    if (!codexOmp || standaloneCodex.at > codexOmp.fetchedAt) {
      rows.push({ key: 'codex', agent: 'codex', q: standaloneCodex })
    }
  }

  // Omp reports
  for (const report of ompReports) {
    const isCodex = report.provider === 'openai-codex' || report.provider === 'codex'
    const isClaude = report.provider === 'anthropic' || report.provider === 'claude'

    if (isCodex) {
      if (hidden.includes('codex')) continue
      if (standaloneCodex && standaloneCodex.at >= report.fetchedAt) continue
    }
    if (isClaude) {
      if (hidden.includes('claude')) continue
      if (standaloneClaude && standaloneClaude.at >= report.fetchedAt) continue
    }

    rows.push({
      key: `omp:${report.provider}`,
      agent: 'omp',
      label: ompProviderLabel(report.provider),
      provider: report.provider,
      q: ompReportToQuota(report),
    })
  }

   return rows
 }
// Rows specific to a machine (key '' = local): its Claude account, its Codex
// account, when accounts differ or the Codex identity is unknown.
export function machineQuotaRows(q: Quotas | null, key: string, hidden: readonly string[] = []): QuotaRow[] {
  if (!q) return []
  const rows: QuotaRow[] = []
  for (const agent of ['claude', 'codex'] as const) {
    const list = agent === 'claude' ? q.claudeAccounts : q.codexAccounts
    if (hidden.includes(agent) || !(agent === 'claude' ? claudeSplit(q) : (list?.length || 0) > 0)) continue
    const a = list!.find(a => a.machines.some(m => m.key === key))
    if (!a) continue
    const { machines: _, ...quota } = a
    rows.push({ key: `${agent}:${key}`, agent, q: quota })
  }
  return rows
}

// A machine bar tab showing one machine: the shared rows and that machine's
// own rows together, Claude first, then Codex.
 export function tabQuotaRows(top: readonly QuotaRow[], machine: readonly QuotaRow[]): QuotaRow[] {
  return (['claude', 'codex', 'omp'] as const).flatMap(agent => [...top, ...machine].filter(r => r.agent === agent))
 }

// Claude quota status line of a machine (key '' = local), as the server read it.
export function claudeSetupOf(q: Quotas | null, key: string): ClaudeSetup | null {
  return q?.claudeSetup?.find(s => s.key === key) || null
}

// Something to offer for a machine with Claude: install (`missing`) or update
// (`outdated`), unless declined or skipped. Never a block in the home list:
// an item of the machine's "…" menu and a step of the setup guide.
export function claudeSuggestion(q: Quotas | null, key: string, hasClaude: boolean, hidden: readonly string[] = []): ClaudeSetup | null {
  if (!hasClaude || hidden.includes('claude')) return null
  const s = claudeSetupOf(q, key)
  return s && (s.state === 'missing' || s.state === 'outdated') && !s.dismissed ? s : null
}

// Self-contained command to paste into a terminal on the machine: the install
// script (status line included) passed to sh, identical everywhere.
export const claudeInstallCommand = `sh <<'WHERDR_INSTALL'\n${installer.trimEnd()}\nWHERDR_INSTALL\n`

// Remaining share (%); window already reset since the reading: everything is back.
export function quotaLeft(w: QuotaWindow, now: number) {
  if (w.used === null) return null
  if (w.resetsAt && w.resetsAt <= now) return 100
  return Math.round(100 - w.used)
}
// Settings → Appearance → Quotas: remaining share (default, like Codex) or used
// share (like Claude, 100 % for an exhausted window).
export type QuotaDisplay = 'left' | 'used'
export function readQuotaDisplay(raw: string | null): QuotaDisplay {
  return raw === 'used' ? 'used' : 'left'
}
// Percentage shown (number and bar); the alert (`quotaLevel`) always follows
// what remains.
export function quotaShown(w: QuotaWindow, now: number, display: QuotaDisplay) {
  const l = quotaLeft(w, now)
  return l === null ? null : display === 'used' ? 100 - l : l
}
export const quotaLevel = (w: QuotaWindow, now: number) => {
  const l = quotaLeft(w, now)
  return l === null ? 'unknown' : l <= 15 ? 'hi' : l <= 40 ? 'mid' : 'lo'
}

// Reading older than an hour: numbers to take with caution.
export const STALE_MS = 3600000

// Reset time: the time alone within the next 24 h (even the
// next day: "00:00" and not "Sun 00:00", which looks like the weekly one),
// with the day beyond that. `null`: already reset; '': unknown.
export function resetText(w: QuotaWindow, now: number, locale: string): string | null {
  if (!w.resetsAt) return ''
  if (w.resetsAt <= now) return null
  const d = new Date(w.resetsAt)
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  return w.resetsAt - now < 86400000 ? time : `${d.toLocaleDateString(locale, { weekday: 'short' })} ${time}`
}

// Machines listed in Settings › Agents › Claude quotas and the setup guide:
// those where Claude is installed, and those whose status line was found
// anyway. `setup` null: not read (offline, read failed, not loaded yet).
export interface ClaudeSetupRow { key: string, name: string, online: boolean, setup: ClaudeSetup | null }
export function claudeSetupRows(q: Quotas | null, machines: readonly { key: string, name: string, online: boolean, kinds: readonly string[] }[]): ClaudeSetupRow[] {
  return machines.flatMap((m) => {
    const setup = m.online ? claudeSetupOf(q, m.key) : null
    if (!m.kinds.includes('claude') && (!setup || setup.state === 'missing')) return []
    return [{ key: m.key, name: m.name, online: m.online, setup }]
  })
}
