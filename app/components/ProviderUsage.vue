<script setup lang="ts">
import type { ModelDashboardSnapshot } from '#shared/modelDashboard'
import { compareDashboardRoutes, dashboardCards, providerLabel, quotaWindows, remainingPercent, timeRemaining, routeProviderName, type DashboardRoute } from '~/utils/modelDashboard'
import { beijingClock, DEEPSEEK_PEAK_NOTE, deepseekCnyPrice, deepseekPricing } from '~/utils/deepseekPricing'
import { formatCny, formatCnyTokenPrice } from '~/utils/money'
import { type QuotaRow, ompProviderLabel, ompReportToQuota, providerIdentity, STALE_MS } from '~/utils/quotas'
import { useProviderUsage } from '~/composables/useProviderUsage'
import { useModelDashboard } from '~/composables/useModelDashboard'
import { quotaNow } from '~/composables/useQuotas'
import { api, offlineView, toast } from '~/composables/useHerdr'
import { t, tl } from '~/utils/i18n'
import { hasProviderIcon, providerIcons, providerImages } from '~/utils/providerIcons'

const props = defineProps<{ rows?: QuotaRow[], accountRows?: QuotaRow[], api?: boolean, session?: boolean, collapsible?: boolean, machine?: string, selected?: string, readOnly?: boolean, machineLabel?: string }>()
const emit = defineEmits<{ 'update:selected': [value: string] }>()
const { rows: fallbackRows, api: fallbackApi } = useProviderUsage()
const accountOnly = computed(() => props.rows !== undefined)
const activeRows = computed(() => props.rows ?? props.accountRows ?? fallbackRows.value)
const isApi = computed(() => props.api ?? fallbackApi.value)
const { snapshot, cards: cachedCards, loading, error: loadError, load: loadDashboard, replace, updateRanking } = useModelDashboard(() => props.machine)
const saving = ref<string | null>(null)
const poolsExpanded = ref(false)
// New sheet (`collapsible`): the model list stays folded, showing the model
// this session will start with, and folds back once a model is chosen.
const sessionExpanded = ref(!props.collapsible)
let loadedAt = 0
const sessionNow = ref(Date.now())
const displayNow = ref(quotaNow.value)
let clockAt = Date.now()
let clockTimer: ReturnType<typeof setInterval> | undefined
watch(quotaNow, value => { if (!props.session) { clockAt = Date.now(); displayNow.value = value } })
function providerName(provider: string) {
  return providerLabel(provider)
}
const localRows = computed<QuotaRow[]>(() => (snapshot.value?.quota?.reports || []).map((report, index) => ({ key: `local:${report.provider}:${index}`, agent: 'omp', provider: report.provider, q: ompReportToQuota(report) })))
const resetPasses = computed(() => accountOnly.value ? [] : localRows.value.filter(row => row.provider === 'openai-codex' && row.q.credits != null && Number.isFinite(row.q.credits) && row.q.credits > 0).map(row => {
  const expiries = (row.q.resetCredits?.credits || []).map(credit => Date.parse(credit.expiresAt || '')).filter(Number.isFinite)
  return { row, expiresAt: expiries.length ? Math.min(...expiries) : null }
}))
function passExpiry(expiresAt: number | null) {
  if (expiresAt == null) return ''
  const left = expiresAt - displayNow.value
  if (left <= 0) return t('expired')
  if (left < 3_600_000) return '<1h'
  if (left < 86_400_000) return `${Math.ceil(left / 3_600_000)}h`
  return `${Math.ceil(left / 86_400_000)}d`
}
const cards = computed(() => {
  const all = cachedCards.value
  if (!props.session) return all
  const seen = new Set<string>()
  return all.map(card => ({ ...card, routes: card.routes.filter(route => {
    if (route.model.provider === 'openrouter' || route.state === 'exhausted' || seen.has(route.model.selector)) return false
    seen.add(route.model.selector)
    return true
  }) })).filter(card => card.routes.length)
})
const moreExpanded = ref(false)
const additionalRoutes = computed(() => {
  if (!props.session) return []
  const seen = new Set<string>()
  return dashboardCards(snapshot.value?.additionalModels || [], localRows.value, sessionNow.value)
    .flatMap(card => card.routes)
    .filter(route => {
      if (route.model.provider === 'openrouter' || route.state === 'exhausted' || seen.has(route.model.selector)) return false
      seen.add(route.model.selector)
      return true
    })
})
const additionalNameCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const route of additionalRoutes.value) counts.set(route.model.name, (counts.get(route.model.name) || 0) + 1)
  return counts
})
function additionalName(route: DashboardRoute) {
  return (additionalNameCounts.value.get(route.model.name) || 0) > 1 ? `${route.model.name} · ${providerName(route.model.provider)}` : route.model.name
}
const selectedModel = computed(() => props.session ? props.selected : snapshot.value?.defaultSelector)
const sessionSections = computed(() => (['regular', 'expert'] as const).map(tier => ({
  tier, title: tier === 'regular' ? t('Models') : t('Experts'),
  routes: cards.value.filter(card => card.tier === tier).flatMap(card => card.routes).sort(compareDashboardRoutes),
})))
const recommendedRoute = computed(() => sessionSections.value[0]!.routes.find(route => route.score != null))
const sessionRoutes = computed(() => [...cards.value.flatMap(card => card.routes), ...additionalRoutes.value])
const sessionRouteName = (route: DashboardRoute) => (additionalRoutes.value.includes(route) ? additionalName(route) : routeName(route))
const selectedSessionRoute = computed(() => sessionRoutes.value.find(route => route.model.selector === selectedModel.value))
// Folded picker: the only row is the chosen model, rendered exactly like the
// expanded grid's cards.
const shownSessionSections = computed(() => {
  if (!props.collapsible || sessionExpanded.value) return sessionSections.value.filter(section => section.routes.length)
  return selectedSessionRoute.value ? [{ tier: 'regular' as const, title: t('Models'), routes: [selectedSessionRoute.value] }] : []
})
// With its provider when the name is shared.
const selectedSessionName = computed(() => {
  const route = selectedSessionRoute.value
  if (!route) return ''
  const name = sessionRouteName(route)
  const shared = sessionRoutes.value.some(other => other !== route && sessionRouteName(other) === name)
  return shared ? `${name} · ${providerName(route.model.provider)}` : name
})
function sessionSource(route: DashboardRoute) {
  const name = routeName(route)
  const duplicate = cards.value.flatMap(card => card.routes).some(other => other !== route && routeName(other) === name && other.model.provider !== route.model.provider)
  return duplicate ? (route.model.provider === 'google-antigravity' ? 'Antigravity' : providerName(route.model.provider)) : ''
}
function paidRoute(route: DashboardRoute) {
  return route.model.provider === 'deepseek'
}
function chooseSessionRoute(route: DashboardRoute) {
  void choose(route)
  if (props.collapsible) sessionExpanded.value = false
}
const homeGroups = computed(() => {
  const groups = new Map<string, { provider: string, routes: DashboardRoute[], pools: { key: string, row: QuotaRow, window: ReturnType<typeof quotaWindows>[number] }[] }>()
  const group = (provider: string) => {
    let value = groups.get(provider)
    if (!value) { value = { provider, routes: [], pools: [] }; groups.set(provider, value) }
    return value
  }
  const included = new Set(['openai-codex', 'google-antigravity', 'anthropic', 'devin', 'xai-oauth', 'deepseek'])
  for (const route of cards.value.flatMap(card => card.routes)) {
    if (included.has(route.model.provider)) group(route.model.provider).routes.push(route)
  }
  for (const row of localRows.value.filter(row => row.provider && included.has(row.provider) && row.provider !== 'deepseek')) {
    const target = group(row.provider!)
    for (const [index, window] of quotaWindows(row).entries()) {
      if (!target.routes.some(route => route.row?.key === row.key && route.windows.some(candidate => candidate.id === window.id && candidate.windowId === window.windowId && candidate.resetsAt === window.resetsAt && candidate.label === window.label))) {
        target.pools.push({ key: `${row.key}:${index}`, row, window })
      }
    }
  }
  return [...groups.values()].map(value => ({ ...value, routes: value.routes.sort(compareDashboardRoutes) }))
    .sort((a, b) => a.routes[0] && b.routes[0] ? compareDashboardRoutes(a.routes[0], b.routes[0]) || a.provider.localeCompare(b.provider) : a.routes[0] ? -1 : b.routes[0] ? 1 : a.provider.localeCompare(b.provider))
})
const homeExperts = computed(() => homeGroups.value.flatMap(group => group.routes).filter(route => route.model.tier === 'expert').sort(compareDashboardRoutes))
const deepseekModel = computed(() => snapshot.value?.models.find(candidate => candidate.family === 'deepseek-flash'))
const deepseek = computed(() => deepseekPricing(displayNow.value, deepseekModel.value?.cost?.timeBased))
const deepseekPrice = computed(() => deepseekCnyPrice(deepseekModel.value?.cost, deepseek.value.factor))
const deepseekPriceText = computed(() => formatCnyTokenPrice(deepseekPrice.value))
const deepseekTitle = computed(() => {
  const next = beijingClock(deepseek.value.until)
  const price = deepseekPriceText.value ? `${deepseekPriceText.value} per 1M input / output.` : ''
  return tl([
    deepseek.value.peak ? 'DeepSeek peak: 2× price.' : 'DeepSeek off-peak: half price.',
    deepseek.value.peak ? `Off-peak starts ${next} Beijing time.` : `Peak starts ${next} Beijing time.`,
    price, DEEPSEEK_PEAK_NOTE, 'Recommendations use the current price.',
  ].filter(Boolean).join(' '))
})
const recommendedTitle = computed(() => homeGroups.value[0]?.provider === 'deepseek'
  ? (deepseek.value.peak ? t('Recommended · DeepSeek 2× peak price') : t('Recommended · DeepSeek half price off-peak'))
  : t('Recommended'))
const recommendedProvider = computed(() => {
  const first = homeGroups.value[0]
  return first && first.routes[0]?.score != null ? first.provider : null
})
const usedProvider = computed(() => homeGroups.value.find(group => group.routes.some(route => route.model.selector === selectedModel.value))?.provider ?? null)
function summaryRoutes(group: { provider: string, routes: DashboardRoute[] }) {
  if (group.provider !== 'openai-codex' || !group.routes.length) return group.routes
  const first = group.routes[0]!
  if (!group.routes.every(route => route.row?.key === first.row?.key && route.windows.length === first.windows.length && first.windows.every(window => route.windows.includes(window)))) return group.routes
  return [group.routes.find(route => route.model.selector === selectedModel.value) || first]
}
function sharedCodex(group: { provider: string, routes: DashboardRoute[] }) {
  return group.provider === 'openai-codex' && group.routes.length > 1 && summaryRoutes(group).length === 1
}
const sheetGroup = ref<string | null>(null)
const sheetOpen = computed({ get: () => sheetGroup.value !== null, set: value => { if (!value) sheetGroup.value = null } })
const sheetRoutes = computed(() => sheetGroup.value === '__experts__' ? homeExperts.value : homeGroups.value.find(group => group.provider === sheetGroup.value)?.routes ?? [])
const sheetPools = computed(() => homeGroups.value.find(group => group.provider === sheetGroup.value)?.pools ?? [])
const sheetTitle = computed(() => sheetGroup.value === '__experts__' ? t('Experts') : providerName(sheetGroup.value || ''))
function routeName(route: DashboardRoute) {
  return cards.value.find(card => card.family === route.model.family)?.name || route.model.id
}
const homeNames: Partial<Record<DashboardRoute['model']['family'], string>> = {
  'gemini-flash': 'Flash', 'deepseek-flash': 'V4 Flash', luna: 'Luna', terra: 'Terra',
  sol: 'Sol', astra: 'Astra', argon: 'Argon', opus: 'Opus',
}
function homeRouteName(route: DashboardRoute) {
  return homeNames[route.model.family] || routeName(route)
}
function homeProviderName(provider: string) {
  return provider === 'google-antigravity' ? 'Google' : provider === 'deepseek' ? 'DeepSeek' : provider === 'anthropic' ? 'Claude' : providerName(provider)
}
const spending = computed(() => snapshot.value?.spending.days || [])
const spendToday = computed(() => spending.value.at(-1)?.amount ?? null)
const spendMax = computed(() => Math.max(0, ...spending.value.map(d => d.amount ?? 0)))

async function load(force = false) {
  if (saving.value) return
  const version = ++requestVersion
  if (props.session) { moreExpanded.value = false; emit('update:selected', '') }
  await loadDashboard(force)
  if (version !== requestVersion) return
  if (props.session) { sessionNow.value = Date.now(); displayNow.value = sessionNow.value; clockAt = sessionNow.value }
  if (!loadError.value && snapshot.value) {
    loadedAt = quotaNow.value
    if (props.session) {
      const options = [...cards.value.flatMap(card => card.routes), ...additionalRoutes.value]
      moreExpanded.value = additionalRoutes.value.some(route => route.model.selector === snapshot.value?.defaultSelector)
      emit('update:selected', options.find(route => route.model.selector === snapshot.value?.defaultSelector)?.model.selector || options[0]?.model.selector || '')
    }
  }
}
async function choose(route: DashboardRoute) {
  if (props.session) { emit('update:selected', route.model.selector); return }
  if (props.readOnly || saving.value || offlineView.value || snapshot.value?.defaultSelector === route.model.selector) return
  saving.value = route.model.selector
  try { replace(await api<ModelDashboardSnapshot>('/api/model-dashboard', { selector: route.model.selector })); loadedAt = quotaNow.value }
  catch (err) { toast((err as Error).message, true) }
  finally { saving.value = null }
}
function visibleWindows(route: DashboardRoute) {
  const weekly = route.windows.filter(window => window.minutes >= 10080)
  if (!weekly.length) return route.windows
  const now = displayNow.value
  const fresh = route.row && now - route.row.q.at <= STALE_MS && route.row.q.at <= now + 60000
  const weeklyOver = fresh && weekly.some(window => {
    const left = remainingPercent(window, now)
    const time = timeRemaining(window, now)
    return left != null && time != null && left < time
  })
  const rest = route.windows.filter(window => {
    if (weekly.includes(window)) return false
    if (!weeklyOver || window.minutes <= 0 || window.minutes > 360) return true
    const left = remainingPercent(window, now)
    const time = timeRemaining(window, now)
    return left == null || time == null || left < time
  })
  return [...weekly, ...rest]
}
function summaryWindows(route: DashboardRoute) {
  const first = visibleWindows(route)[0]
  if (!first) return []
  const exhausted = route.state === 'exhausted'
    ? route.windows.filter(window => window !== first && window.minutes === 300 && remainingPercent(window, displayNow.value) === 0)
    : []
  return [first, ...exhausted]
}
function sheetWindows(route: DashboardRoute) {
  const windows = visibleWindows(route)
  return windows.length ? windows : [undefined]
}
function routeTitle(route: DashboardRoute) {
  const price = route.model.family === 'deepseek-flash' ? ` · ${deepseek.value.peak ? 'peak 2×' : 'off-peak ½'}` : ''
  return tl(`${route.model.selector} · ${route.state}${price} · ${props.readOnly ? 'read only' : props.session ? 'this session' : 'new omp sessions only'}${route.accountLabel ? ` · ${route.accountLabel}` : ''}`)
}
function accountName(row: QuotaRow) {
  const label = row.label?.trim()
  const provider = row.provider || row.agent
  return label && ![provider, routeProviderName(provider), ompProviderLabel(provider)].some(name => name.toLowerCase() === label.toLowerCase()) ? label : null
}
function accountProvider(row: QuotaRow) { return row.agent === 'omp' ? providerName(row.provider || row.agent) : providerIdentity(row).shortName }
const pools = computed(() => {
  const rank = (pool: { row: QuotaRow, exhausted: boolean }) => pool.exhausted ? 3 : pool.row.provider === 'xai-oauth' ? 0 : pool.row.q.credits != null ? 1 : 2
  return activeRows.value.flatMap(row => quotaWindows(row).map((window, index) => ({ key: `${row.key}:${index}`, row, window, exhausted: remainingPercent(window, quotaNow.value) === 0 && quotaNow.value - row.q.at <= STALE_MS }))).sort((a, b) => rank(a) - rank(b))
})
let requestVersion = 0
// A read can fail while OMP is busy or a machine restarts: retry on its own
// (5 s, 15 s, 60 s), then leave the error with its Retry button.
const retryDelays = [5_000, 15_000, 60_000]
let retryCount = 0
let retryTimer: ReturnType<typeof setTimeout> | undefined
function stopRetry() { clearTimeout(retryTimer); retryTimer = undefined }
function scheduleRetry() {
  stopRetry()
  if (props.readOnly || accountOnly.value || retryCount >= retryDelays.length) return
  retryTimer = setTimeout(() => {
    retryCount++
    if (document.visibilityState !== 'hidden') void load(true)
  }, retryDelays[retryCount])
}
watch(() => props.machine, () => { retryCount = 0; stopRetry(); if (props.collapsible) sessionExpanded.value = false; if (!accountOnly.value) void load() }, { flush: 'sync' })
watch(loadError, (message) => { if (message) scheduleRetry() })
watch(snapshot, (value) => { if (value) { retryCount = 0; stopRetry() } })
function refreshVisible() {
  if (!props.session && !accountOnly.value && snapshot.value && !loading.value && !saving.value && !offlineView.value && document.visibilityState !== 'hidden' && quotaNow.value - loadedAt >= 60_000) void load(true)
}
watch(quotaNow, refreshVisible)
onMounted(() => {
  if (!accountOnly.value) void load()
  document.addEventListener('visibilitychange', refreshVisible)
  clockTimer = setInterval(() => {
    if (document.visibilityState !== 'hidden') {
      displayNow.value = (props.session ? sessionNow.value : quotaNow.value) + Date.now() - clockAt
      updateRanking(displayNow.value)
    }
  }, 1000)
})
onBeforeUnmount(() => { requestVersion++; stopRetry(); clearInterval(clockTimer); document.removeEventListener('visibilitychange', refreshVisible) })
</script>

<template>
  <section v-if="!accountOnly || pools.length || isApi" class="provider-usage" :class="{ 'session-usage': session, 'read-only': readOnly }" :aria-label="accountOnly ? t('Account limits') : t('Models')">
    <template v-if="!accountOnly">
      <header v-if="!collapsible" class="usage-heading"><h2>{{ t('Models') }}</h2><span>{{ session ? t('This session') : readOnly ? t('Read only') : t('New sessions · omp') }}<template v-if="machineLabel"> · {{ machineLabel }}</template></span></header>
      <div v-if="!collapsible || sessionExpanded" class="usage-legend" :aria-label="t('Quota usage legend')"><span><i class="legend-used" />{{ t('Used') }}</span><span><i class="legend-under" />{{ t('Under pace') }}</span><span><i class="legend-over" />{{ t('Over pace') }}</span></div>
      <div v-if="loading && !snapshot" class="usage-message" role="status">{{ t('Loading models…') }}</div>
      <div v-if="loadError" class="usage-error" role="alert"><span>{{ loadError }}</span><button type="button" class="mono-btn" @click="load(true)">{{ t('Retry') }}</button></div>
      <div v-if="session && !loading && !loadError && snapshot && !cards.length && !additionalRoutes.length" class="usage-message" role="status">{{ t('No available models') }}</div>
      <div v-if="session && (cards.length || additionalRoutes.length)" class="session-models">
        <section v-for="section in shownSessionSections" :key="section.tier" class="session-section">
          <h3 v-if="!collapsible || sessionExpanded">{{ section.title }}</h3>
          <div class="home-model-grid session-model-grid" :class="{ 'session-picker-single': collapsible && !sessionExpanded }">
            <button v-for="route in section.routes" :key="route.key" type="button" class="session-model-card session-model-choice home-route" :class="{ 'in-use': route.model.selector === selectedModel }" :data-family="route.model.family" :data-route-selector="route.model.selector" :disabled="readOnly" :aria-pressed="selectedModel === route.model.selector" :aria-label="collapsible && !sessionExpanded ? tl(`Change the model for this session: ${selectedSessionName}`, `Changer le modèle de cette session : ${selectedSessionName}`) : tl(`Use ${routeName(route)} via ${providerName(route.model.provider)} for this session`)" :title="routeTitle(route)" @click="collapsible && !sessionExpanded ? (sessionExpanded = true) : chooseSessionRoute(route)">
              <ModelWithUsage :name="[routeName(route), sessionSource(route)].filter(Boolean).join(' · ')" :provider="route.model.provider" :windows="[visibleWindows(route)[0]]" :now="displayNow" :at="route.row?.q.at">
                <template #leading><span v-if="route === recommendedRoute" class="usage-star" :title="t('Recommended')" :aria-label="t('Recommended')">★</span></template>
                <span v-if="route.model.family === 'deepseek-flash'" class="price-badge" :class="deepseek.peak ? 'peak' : 'off'" :title="deepseekTitle" role="img" :aria-label="deepseekTitle">{{ deepseekPriceText || (deepseek.peak ? '2×' : '½') }}</span>
                <span v-if="route.model.selector === selectedModel" class="default-mark" aria-hidden="true">✓</span>
                <UIcon v-if="collapsible && !sessionExpanded" name="i-lucide-chevron-down" class="session-picker-caret" aria-hidden="true" />
              </ModelWithUsage>
            </button>
          </div>
        </section>
        <section v-if="additionalRoutes.length && (!collapsible || sessionExpanded)" class="session-section">
          <button type="button" class="session-more" :aria-expanded="moreExpanded" @click="moreExpanded = !moreExpanded">{{ t('More models') }} <span aria-hidden="true">{{ moreExpanded ? '−' : '+' }}</span></button>
          <div v-if="moreExpanded" class="home-model-grid session-model-grid">
            <button v-for="route in additionalRoutes" :key="route.key" type="button" class="session-model-card session-model-choice home-route" :class="{ 'in-use': route.model.selector === selectedModel }" :data-route-selector="route.model.selector" :disabled="readOnly" :aria-pressed="selectedModel === route.model.selector" :aria-label="tl(`Use ${route.model.name} via ${providerName(route.model.provider)} for this session`)" :title="routeTitle(route)" @click="chooseSessionRoute(route)">
              <ModelWithUsage :name="additionalName(route)" :provider="route.model.provider" :windows="[visibleWindows(route)[0]]" :now="displayNow" :at="route.row?.q.at">
                <span v-if="paidRoute(route)" class="session-paid">{{ t('API paid') }}</span>
                <span v-if="route.model.selector === selectedModel" class="default-mark" aria-hidden="true">✓</span>
              </ModelWithUsage>
            </button>
          </div>
        </section>
      </div>
      <div v-if="!session && homeGroups.length" class="home-model-grid">
          <div v-for="group in homeGroups" :key="group.provider" class="home-model-card" :class="{ 'in-use': group.provider === usedProvider }" :data-provider="group.provider" @click="sheetGroup = group.provider">
            <button type="button" class="home-card-heading" :aria-label="tl(`View ${providerName(group.provider)} models and limits`)" @click.stop="sheetGroup = group.provider"><span class="home-provider"><span v-if="hasProviderIcon(group.provider)" class="provider-brand" aria-hidden="true"><UIcon v-if="providerIcons[group.provider]" :name="providerIcons[group.provider]!" /><img v-else :src="providerImages[group.provider]" alt=""></span><strong>{{ homeProviderName(group.provider) }}</strong></span><span v-if="group.provider === 'deepseek'" class="price-badge" :class="deepseek.peak ? 'peak' : 'off'" :title="deepseekTitle" role="img" :aria-label="deepseekTitle">{{ deepseekPriceText || (deepseek.peak ? '2×' : '½') }}</span><span v-if="group.provider === recommendedProvider" class="usage-star" :title="recommendedTitle" :aria-label="t('Recommended')">★</span></button>
            <span v-for="pass in group.provider === 'openai-codex' ? resetPasses : []" :key="pass.row.key" class="reset-passes" :class="{ urgent: pass.expiresAt != null && pass.expiresAt - displayNow <= 86_400_000 }" :title="pass.expiresAt != null ? tl(`Earliest reset pass expires ${new Date(pass.expiresAt).toLocaleString()}`) : t('Reset pass expiry unknown')"><span>{{ t('Reset') }} · {{ pass.row.q.credits }}</span><span v-if="pass.expiresAt != null">{{ passExpiry(pass.expiresAt) }}</span></span>
            <span class="home-route-list">
              <button v-for="route in summaryRoutes(group)" :key="route.key" type="button" class="home-route home-route-choice" :data-route-selector="route.model.selector" :disabled="!sharedCodex(group) && (Boolean(saving) || readOnly || offlineView)" :aria-pressed="sharedCodex(group) ? undefined : selectedModel === route.model.selector" :aria-label="sharedCodex(group) ? tl(`View ${providerName(group.provider)} models and limits`) : tl(`Use ${routeName(route)} via ${providerName(group.provider)} for new omp sessions`)" :title="routeTitle(route)" @click.stop="sharedCodex(group) ? sheetGroup = group.provider : choose(route)">
                <ModelWithUsage :name="[sharedCodex(group) && route.model.selector !== selectedModel ? t('Shared quota') : homeRouteName(route), route.accountLabel].filter(Boolean).join(' · ')" :provider="route.model.provider" :show-provider="false" :windows="summaryWindows(route)" :now="displayNow" :at="route.row?.q.at">
                  <span v-if="route.model.selector === selectedModel" class="default-mark" aria-hidden="true">✓</span>
                </ModelWithUsage>
              </button>
              <span v-for="pool in group.pools" :key="pool.key" class="home-route">
                <ModelWithUsage :name="pool.window.label || providerName(group.provider)" :show-provider="false" :windows="[pool.window]" :now="displayNow" :at="pool.row.q.at" />
              </span>
            </span>
            <span v-if="group.routes.some(route => route.model.family === 'deepseek-flash')" class="spending" :aria-label="t('DeepSeek model spend recorded by OMP today and the two previous days')">
              <span class="spend-days"><span v-for="day in spending" :key="day.date" class="spend-day" :title="tl(`${day.date}: ${day.amount == null ? 'spend unknown' : `OMP recorded ${formatCny(day.amount)}`}`)"><span class="sr-only">{{ formatCny(day.amount) }}</span><span class="spend-track" aria-hidden="true"><i v-if="day.amount != null" :style="{ height: `${spendMax ? day.amount / spendMax * 100 : 0}%` }" /></span></span></span>
              <span class="spend-total"><small>{{ t('Today') }}</small><strong>{{ formatCny(spendToday) }}</strong></span>
            </span>
          </div>
          <button v-if="homeExperts.length" type="button" class="home-model-card home-experts" :aria-label="t('View expert models')" @click="sheetGroup = '__experts__'">
            <span class="home-card-heading"><strong>{{ t('Experts') }}</strong></span>
            <span class="home-route-list">
              <span v-for="route in homeExperts" :key="route.key" class="home-route" :data-route-selector="route.model.selector">
                <ModelWithUsage :name="[homeRouteName(route), route.accountLabel].filter(Boolean).join(' · ')" :provider="route.model.provider" :windows="summaryWindows(route)" :now="displayNow" :at="route.row?.q.at">
                  <span v-if="route.model.selector === selectedModel" class="default-mark" aria-hidden="true">✓</span>
                </ModelWithUsage>
              </span>
            </span>
          </button>
      </div>
      <AppSheet v-if="!session" v-model:open="sheetOpen" :title="sheetTitle" hide-close tall>
        <div class="home-sheet-routes">
          <template v-if="sheetGroup === 'openai-codex'">
            <div v-for="pass in resetPasses" :key="pass.row.key" class="home-sheet-route">
              <div class="reset-passes" :class="{ urgent: pass.expiresAt != null && pass.expiresAt - displayNow <= 86_400_000 }"><span>{{ t('Reset passes') }} · {{ pass.row.q.credits }}</span><span v-if="pass.expiresAt != null">{{ tl(`Expires ${new Date(pass.expiresAt).toLocaleString()}`) }}</span><span v-else>{{ t('Expiry unknown') }}</span></div>
            </div>
          </template>
          <div v-for="route in sheetRoutes" :key="route.key" class="home-sheet-route" :data-selector="route.model.selector">
            <button type="button" class="home-sheet-choice" :disabled="Boolean(saving) || readOnly || offlineView" :aria-busy="saving === route.model.selector" :aria-pressed="selectedModel === route.model.selector" :title="routeTitle(route)" @click="choose(route)">
              <ModelWithUsage :name="routeName(route)" :provider="route.model.provider" :windows="sheetWindows(route)" :now="displayNow" :at="route.row?.q.at" :summary="false">
                <span v-if="route.model.family === 'deepseek-flash'" class="price-badge" :class="deepseek.peak ? 'peak' : 'off'" :title="deepseekTitle" role="img" :aria-label="deepseekTitle">{{ deepseekPriceText || (deepseek.peak ? '2×' : '½') }}</span>
                <span v-if="saving === route.model.selector" class="default-mark" aria-hidden="true">…</span><span v-else-if="selectedModel === route.model.selector" class="default-mark" aria-hidden="true">✓</span>
              </ModelWithUsage>
            </button>
            <small class="home-sheet-selector">{{ route.model.selector }}<template v-if="route.accountLabel"> · {{ route.accountLabel }}</template></small>
          </div>
          <div v-for="pool in sheetPools" :key="pool.key" class="home-sheet-route">
            <ModelWithUsage :name="pool.window.label || sheetTitle" :show-provider="false" :windows="[pool.window]" :now="displayNow" :at="pool.row.q.at" :summary="false" />
          </div>
        </div>
      </AppSheet>
    </template>
    <div v-if="accountOnly && pools.length" class="usage-legend" :aria-label="t('Quota usage legend')"><span><i class="legend-used" />{{ t('Used') }}</span><span><i class="legend-under" />{{ t('Under pace') }}</span><span><i class="legend-over" />{{ t('Over pace') }}</span></div>
    <div v-if="!session && (pools.length || isApi)" class="account-limits">
      <button class="accounts-toggle" type="button" :aria-expanded="poolsExpanded" :aria-label="t('Account limits')" :title="t('Account limits')" @click="poolsExpanded = !poolsExpanded"><span class="sr-only">{{ t('Account limits') }}</span><span aria-hidden="true">{{ poolsExpanded ? '−' : '+' }}</span></button>
      <div class="account-rail" :class="{ expanded: poolsExpanded }" tabindex="0" :aria-label="t('Read-only account pools')">
        <div v-for="pool in pools" :key="pool.key" class="account-pool" :class="{ exhausted: pool.exhausted && !poolsExpanded }">
          <div class="pool-head home-route">
            <span v-if="hasProviderIcon(pool.row.provider || pool.row.agent)" class="provider-brand" :title="accountProvider(pool.row)" aria-hidden="true"><UIcon v-if="providerIcons[pool.row.provider || pool.row.agent]" :name="providerIcons[pool.row.provider || pool.row.agent]!" /><img v-else :src="providerImages[pool.row.provider || pool.row.agent]" alt=""></span>
            <span class="home-route-name" :title="[accountProvider(pool.row), pool.row.label, pool.window.label].filter(Boolean).join(' · ')"><template v-if="!hasProviderIcon(pool.row.provider || pool.row.agent)">{{ accountProvider(pool.row) }} · </template>{{ pool.window.label || accountProvider(pool.row) }}<template v-if="accountName(pool.row)"> · {{ accountName(pool.row) }}</template></span>
            <ModelQuotaGauge compact summary :window="pool.window" :now="displayNow" :at="pool.row.q.at" :label="pool.window.label" />
          </div>
        </div>
        <div v-if="isApi" class="usage-api">{{ t('Claude · API usage, no quota') }}</div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.provider-usage { min-width: 0; margin-bottom: 18px; color: var(--text); }
.session-usage { margin-top: 14px; }
.usage-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.usage-heading h2 { display: inline-flex; align-items: center; gap: 8px; margin: 0; font: 600 10.5px/1 var(--mono); letter-spacing: .16em; text-transform: uppercase; color: var(--mauve); }
.home-model-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; }
.home-model-card { display: flex; flex-direction: column; gap: 3px; width: 100%; min-height: 44px; min-width: 0; overflow: hidden; padding: 5px; border: 1px solid var(--line); background: var(--bg-2); text-align: left; cursor: pointer; }
.home-model-card.in-use { border-color: var(--accent); }
.home-model-card:hover { background: var(--surface); }
.home-model-card:focus-visible, .home-sheet-choice:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.home-card-heading { display: flex; align-items: center; justify-content: space-between; gap: 2px; min-width: 0; }
.home-provider { display: flex; align-items: center; gap: 3px; min-width: 0; }
.home-card-heading strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); font: 700 10px/14px var(--display); }
.home-route-list { display: flex; flex: none; flex-direction: column; gap: 2px; min-width: 0; }
.home-route { display: flex; align-items: center; gap: 4px; min-width: 0; }
.home-route-name { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-2); font: 500 9px/12px var(--mono); }
.home-route-choice { width: 100%; text-align: left; cursor: pointer; }
.home-route-choice:disabled { cursor: default; }
.home-card-heading { width: 100%; text-align: left; cursor: pointer; }
.home-route-choice:focus-visible, .home-card-heading:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.pool-head > .model-gauge { flex: 0 0 54px; width: 54px; }
.pool-head :deep(.summary .gauge-reset) { flex: 0 0 auto; min-width: 3ch; }
.session-section + .session-section { margin-top: 8px; }
.session-section h3 { margin: 0 0 4px; color: var(--muted); font: 600 9px/1.2 var(--mono); text-transform: uppercase; }
.session-model-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 164px), 1fr)); align-items: start; }
.session-model-grid.session-picker-single { grid-template-columns: minmax(0, 1fr); }
.session-model-card { min-width: 0; border: 1px solid var(--line); background: var(--bg-2); }
.session-model-card.in-use { border-color: var(--accent); }
.session-model-choice { width: 100%; min-width: 0; min-height: 28px; padding: 4px 6px; text-align: left; cursor: pointer; }
.session-model-choice:hover, .session-more:hover { background: var(--surface); }
.session-model-choice:focus-visible, .session-more:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.session-more { width: 100%; padding: 4px 5px; text-align: left; color: var(--text-2); font: 600 9px/1.2 var(--mono); cursor: pointer; }
.usage-star { flex: none; align-self: center; color: var(--accent); font-size: 9px; line-height: 1; }
.session-paid { flex: none; color: var(--muted); font: 500 8px/1 var(--mono); white-space: nowrap; }
.home-sheet-routes { display: flex; flex-direction: column; }
.home-sheet-route { padding: 4px 10px 8px; border-bottom: 1px solid var(--line-soft); }
.home-sheet-choice { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; min-height: 44px; text-align: left; cursor: pointer; }
.home-sheet-choice:disabled { cursor: default; }
.home-sheet-selector { display: block; overflow-wrap: anywhere; color: var(--muted); font: 500 9px/1.2 var(--mono); }
.usage-heading h2::before { content: ''; width: 18px; height: 1px; background: var(--mauve); opacity: .6; flex: none; }
.usage-heading > span { color: var(--dim); font: 500 9.5px/1 var(--mono); letter-spacing: .1em; text-transform: uppercase; }
.session-picker-caret { flex: none; width: 14px; height: 14px; color: var(--muted); }
.usage-legend { display: flex; align-items: center; gap: 10px; margin: 0 0 6px; color: var(--dim); font: 500 9px/1.2 var(--mono); white-space: nowrap; }
.usage-legend span { display: inline-flex; align-items: center; gap: 4px; }
.usage-legend i { width: 6px; height: 6px; flex: none; }
.legend-used { background: var(--ochre); }
.legend-under { background: color-mix(in srgb, var(--green) 60%, var(--text)); }
.legend-over { background: var(--rose); }
.accounts-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.provider-brand { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 15px; width: 15px; height: 15px; background: var(--surface); border: 1px solid var(--line-soft); color: var(--text-2); font: 600 8.5px/1 var(--mono); }
.provider-brand > span { flex: 0 0 auto; }
.provider-brand > .iconify, .provider-brand > img { width: 11px; height: 11px; object-fit: contain; }
.default-mark { color: var(--accent); font: 700 11px/15px var(--mono); flex: 0 0 12px; text-align: right; }
.accounts-toggle:hover { background: var(--surface); color: var(--text); }
.spending { display: flex; align-items: center; gap: 4px; min-width: 0; margin-top: 2px; font: 500 8px/1.1 var(--mono); color: var(--muted); font-variant-numeric: tabular-nums; }
.spend-total { display: flex; align-items: baseline; gap: 3px; order: -1; min-width: 0; }
.spend-total small { font-size: 7px; color: var(--dim); text-transform: uppercase; }
.spend-total strong { font-size: 8px; color: var(--text-2); white-space: nowrap; }
.spend-days { display: flex; align-items: end; gap: 2px; flex: 1; min-width: 0; height: 10px; }
.spend-day { flex: 1; min-width: 0; height: 100%; }
.spend-track { display: block; height: 100%; width: 100%; position: relative; background: var(--line-soft); overflow: hidden; }
.spend-track i { position: absolute; bottom: 0; left: 0; right: 0; background: var(--teal); }
.account-limits { display: flex; align-items: stretch; margin-top: 6px; border: 1px solid var(--line); background: var(--bg-2); }
.accounts-toggle { order: 2; flex: 0 0 44px; width: 44px; min-height: 44px; padding: 4px; display: flex; align-items: center; justify-content: center; border-left: 1px solid var(--line); background: var(--bg); color: var(--muted); font: 600 13px/1 var(--mono); cursor: pointer; }
.account-rail { display: flex; flex: 1; min-width: 0; overflow-x: auto; overscroll-behavior-x: contain; scroll-snap-type: x mandatory; scrollbar-width: none; }
.account-rail::-webkit-scrollbar { display: none; }
.account-rail.expanded { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); overflow-x: visible; }
.account-pool { display: flex; justify-content: center; flex: 0 0 50%; min-width: 0; min-height: 44px; padding: 5px 7px 6px; gap: 4px; border-right: 1px solid var(--line-soft); scroll-snap-align: start; }
.account-rail.expanded .account-pool { flex: initial; min-width: 0; border-bottom: 1px solid var(--line-soft); }
.account-pool:last-child { border-right: 0; }
.account-pool.exhausted { opacity: .75; }
.pool-head { display: flex; flex-wrap: wrap; align-items: center; gap: 0 5px; min-width: 0; }
.pool-head.home-route { flex-wrap: nowrap; width: 100%; gap: 4px; }
.pool-name { min-width: 0; flex: 1; display: flex; align-items: baseline; justify-content: space-between; gap: 4px; }
.pool-name strong { font: 600 9.5px/1.2 var(--mono); color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pool-name small { flex: none; font: 500 8px/1.1 var(--mono); color: var(--dim); text-transform: uppercase; }
.reset-passes { display: flex; justify-content: space-between; gap: 4px; color: var(--text-2); font: 600 9px/12px var(--mono); }
.reset-passes.urgent { color: var(--rose); }
.usage-api, .usage-message { padding: 8px 10px; font: 400 10px/1.3 var(--mono); color: var(--muted); }
.usage-error { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 0; font: 400 11px/1.3 var(--mono); color: var(--rose); }
</style>
