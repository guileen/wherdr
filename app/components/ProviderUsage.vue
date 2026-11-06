<script setup lang="ts">
import type { ModelDashboardSnapshot } from '#shared/modelDashboard'
import { dashboardCards, quotaWindows, remainingPercent, routeProviderName, type DashboardCard, type DashboardRoute } from '~/utils/modelDashboard'
import { type QuotaRow, ompProviderLabel, ompReportToQuota, providerIdentity, STALE_MS } from '~/utils/quotas'
import { useProviderUsage } from '~/composables/useProviderUsage'
import { quotaNow } from '~/composables/useQuotas'
import { api, offlineView, toast } from '~/composables/useHerdr'
import { t, tl } from '~/utils/i18n'

const props = defineProps<{ rows?: QuotaRow[], api?: boolean }>()
const { rows: fallbackRows, api: fallbackApi } = useProviderUsage()
const accountOnly = computed(() => props.rows !== undefined)
const activeRows = computed(() => props.rows ?? fallbackRows.value)
const isApi = computed(() => props.api ?? fallbackApi.value)
const snapshot = ref<ModelDashboardSnapshot | null>(null)
const loading = ref(false)
const loadError = ref('')
const saving = ref<string | null>(null)
const expanded = ref(false)
const poolsExpanded = ref(false)
const opusRail = ref<HTMLElement | null>(null)
const providerCount = ref(1)
let observer: ResizeObserver | null = null
let loadedAt = 0
let requestVersion = 0
const localRows = computed<QuotaRow[]>(() => (snapshot.value?.quota?.reports || []).map((report, index) => ({ key: `local:${report.provider}:${index}`, agent: 'omp', provider: report.provider, q: ompReportToQuota(report) })))
const resetPasses = computed(() => localRows.value.filter(row => row.q.credits != null && Number.isFinite(row.q.credits) && row.q.credits > 0))
const cards = computed(() => dashboardCards(snapshot.value?.models || [], localRows.value, quotaNow.value))
const regular = computed(() => cards.value.filter(c => c.tier === 'regular'))
const experts = computed(() => cards.value.filter(c => c.tier === 'expert'))
const spending = computed(() => snapshot.value?.spending.days || [])
const spendTotal = computed(() => spending.value.length === 3 && spending.value.every(d => d.amount != null) ? spending.value.reduce((sum, d) => sum + d.amount!, 0) : null)
const spendMax = computed(() => Math.max(0, ...spending.value.map(d => d.amount ?? 0)))
const money = (amount: number | null) => amount == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(amount)

async function load() {
  if (loading.value || saving.value) return
  const version = ++requestVersion
  loading.value = true
  loadError.value = ''
  try {
    const result = await api<ModelDashboardSnapshot>('/api/model-dashboard')
    if (version === requestVersion) { snapshot.value = result; loadedAt = quotaNow.value }
  } catch (err) { if (version === requestVersion) loadError.value = (err as Error).message }
  finally { loading.value = false }
}
async function choose(route: DashboardRoute) {
  if (saving.value || offlineView.value || snapshot.value?.defaultSelector === route.model.selector) return
  requestVersion++
  saving.value = route.model.selector
  try { snapshot.value = await api<ModelDashboardSnapshot>('/api/model-dashboard', { selector: route.model.selector }); loadedAt = quotaNow.value }
  catch (err) { toast((err as Error).message, true) }
  finally { saving.value = null }
}
function routes(card: DashboardCard) { return card.family === 'opus' && !expanded.value ? card.routes.slice(0, providerCount.value) : card.routes }
function routeTitle(route: DashboardRoute) { return tl(`${route.model.selector} · ${route.state} · new omp sessions only${route.accountLabel ? ` · ${route.accountLabel}` : ''}`) }
function accountName(row: QuotaRow) {
  const label = row.label?.trim()
  const provider = row.provider || row.agent
  return label && ![provider, routeProviderName(provider), ompProviderLabel(provider)].some(name => name.toLowerCase() === label.toLowerCase()) ? label : null
}
function accountProvider(row: QuotaRow) { return row.agent === 'omp' ? routeProviderName(row.provider || row.agent) : providerIdentity(row).shortName }
function setOpusRail(el: unknown) { opusRail.value = el instanceof HTMLElement ? el : null }
const pools = computed(() => {
  const rank = (pool: { row: QuotaRow, exhausted: boolean }) => pool.exhausted ? 3 : pool.row.provider === 'xai-oauth' ? 0 : pool.row.q.credits != null ? 1 : 2
  return activeRows.value.flatMap(row => quotaWindows(row).map((window, index) => ({ key: `${row.key}:${index}`, row, window, exhausted: remainingPercent(window, quotaNow.value) === 0 && quotaNow.value - row.q.at <= STALE_MS }))).sort((a, b) => rank(a) - rank(b))
})
watch(opusRail, (el) => {
  observer?.disconnect()
  if (!el || typeof ResizeObserver === 'undefined') return
  observer = new ResizeObserver(([entry]) => { if (entry) providerCount.value = Math.max(1, Math.floor(entry.contentRect.width / 176)) })
  observer.observe(el)
}, { flush: 'post' })
function refreshVisible() {
  if (!accountOnly.value && snapshot.value && !loading.value && !saving.value && !offlineView.value && document.visibilityState !== 'hidden' && quotaNow.value - loadedAt >= 60_000) void load()
}
watch(quotaNow, refreshVisible)
onMounted(() => {
  if (!accountOnly.value) void load()
  document.addEventListener('visibilitychange', refreshVisible)
})
onBeforeUnmount(() => { observer?.disconnect(); document.removeEventListener('visibilitychange', refreshVisible) })
</script>

<template>
  <section v-if="!accountOnly || pools.length || isApi" class="provider-usage" :aria-label="accountOnly ? t('Account limits') : t('Models')">
    <template v-if="!accountOnly">
      <header class="usage-heading"><h2>{{ t('Models') }}</h2><span>{{ t('New sessions · omp') }}</span></header>
      <div v-if="loading && !snapshot" class="usage-message" role="status">{{ t('Loading models…') }}</div>
      <div v-if="loadError" class="usage-error" role="alert"><span>{{ loadError }}</span><button type="button" class="mono-btn" @click="load">{{ t('Retry') }}</button></div>
      <template v-for="section in [{ key: 'regular', label: t('Regular'), cards: regular }, { key: 'expert', label: t('Experts'), cards: experts }]" :key="section.key">
        <div v-if="section.cards.length" class="model-section">
          <h3>{{ section.label }}</h3>
          <div class="model-grid" :class="{ 'regular-rail': section.key === 'regular' }">
            <article v-for="card in section.cards" :key="card.family" class="model-card" :class="{ 'opus-card': card.family === 'opus', recommended: card.tier === 'regular' && regular[0]?.family === card.family && card.routes[0]?.score != null }" :data-family="card.family" @click="card.family !== 'opus' && card.routes[0] && choose(card.routes[0])">
              <template v-if="card.family === 'opus'">
                <div class="opus-heading"><h4>{{ card.name }}</h4><button v-if="card.routes.length > providerCount" type="button" class="mono-btn providers-toggle" :aria-expanded="expanded" @click="expanded = !expanded">{{ expanded ? t('Less') : tl(`+${card.routes.length - providerCount}`) }}</button></div>
                <div :ref="setOpusRail" class="provider-rail" :class="{ expanded }">
                  <div v-for="route in routes(card)" :key="route.key" class="provider-route" :data-selector="route.model.selector" @click="choose(route)">
                    <button class="model-choice provider-choice" type="button" :disabled="Boolean(saving) || offlineView" :aria-busy="saving === route.model.selector" :aria-pressed="snapshot?.defaultSelector === route.model.selector" :title="routeTitle(route)" :aria-label="tl(`Use ${card.name} via ${routeProviderName(route.model.provider)} for new omp sessions`)" @click.stop="choose(route)">
                      <span>{{ routeProviderName(route.model.provider) }}</span><span v-if="saving === route.model.selector" class="default-mark" aria-hidden="true">…</span><span v-else-if="snapshot?.defaultSelector === route.model.selector" class="default-mark" aria-hidden="true">✓</span>
                    </button>
                    <div class="model-windows" :aria-label="tl(`${routeProviderName(route.model.provider)} remaining limits`)"><ModelQuotaGauge v-for="(window, index) in route.windows" :key="index" :window="window" :now="quotaNow" :at="route.row?.q.at" /><ModelQuotaGauge v-if="!route.windows.length" :now="quotaNow" /></div>
                  </div>
                </div>
              </template>
              <template v-else>
                <template v-for="route in card.routes" :key="route.key">
                  <button class="model-choice" type="button" :disabled="Boolean(saving) || offlineView" :aria-busy="saving === route.model.selector" :aria-pressed="snapshot?.defaultSelector === route.model.selector" :title="routeTitle(route)" :aria-label="tl(`Use ${card.name} for new omp sessions`)" @click.stop="choose(route)">
                    <span class="model-identity"><strong>{{ card.name }}</strong><small>{{ routeProviderName(route.model.provider) }}</small></span><span v-if="saving === route.model.selector" class="default-mark" aria-hidden="true">…</span><span v-else-if="snapshot?.defaultSelector === route.model.selector" class="default-mark" aria-hidden="true">✓</span>
                  </button>
                  <div v-if="card.family !== 'deepseek-flash'" class="model-windows" :aria-label="tl(`${card.name} remaining limits`)"><ModelQuotaGauge v-for="(window, index) in route.windows" :key="index" :window="window" :now="quotaNow" :at="route.row?.q.at" /><ModelQuotaGauge v-if="!route.windows.length" :now="quotaNow" /></div>
                </template>
                <div v-if="card.family === 'deepseek-flash'" class="spending" :aria-label="t('DeepSeek spending, last three calendar days')">
                  <div class="spend-days"><div v-for="day in spending" :key="day.date" class="spend-day" :title="tl(`${day.date}: ${day.amount == null ? 'spending unknown' : money(day.amount)}`)"><span>{{ money(day.amount) }}</span><div class="spend-track"><i v-if="day.amount != null" :style="{ height: `${spendMax ? day.amount / spendMax * 100 : 0}%` }" /><span v-else aria-hidden="true">—</span></div><small>{{ day.date.slice(5) }}</small></div></div>
                  <span class="spend-total">{{ t('3 days') }} <strong>{{ money(spendTotal) }}</strong></span>
                </div>
              </template>
            </article>
          </div>
        </div>
      </template>
    </template>
    <div v-if="pools.length || isApi || resetPasses.length" class="account-limits">
      <button class="accounts-toggle" type="button" :aria-expanded="poolsExpanded" :aria-label="t('Account limits')" :title="t('Account limits')" @click="poolsExpanded = !poolsExpanded"><span class="sr-only">{{ t('Account limits') }}</span><span aria-hidden="true">{{ poolsExpanded ? '−' : '+' }}</span></button>
      <div class="account-rail" :class="{ expanded: poolsExpanded }" tabindex="0" :aria-label="t('Read-only account pools')">
        <div v-for="pool in pools" :key="pool.key" class="account-pool" :class="{ exhausted: pool.exhausted && !poolsExpanded }">
          <div class="pool-name" :title="[pool.row.provider || pool.row.agent, pool.row.label, pool.window.label].filter(Boolean).join(' · ')"><strong>{{ pool.window.label || accountProvider(pool.row) }}</strong><small>{{ accountName(pool.row) || accountProvider(pool.row) }}<template v-if="pool.row.q.credits != null"> · {{ tl(`${pool.row.q.credits} resets`) }}</template></small></div>
          <ModelQuotaGauge :window="pool.window" :now="quotaNow" :at="pool.row.q.at" :label="pool.window.label" />
        </div>
        <div v-for="row in resetPasses" :key="`passes:${row.key}`" class="account-pool reset-passes"><div class="pool-name"><strong>{{ routeProviderName(row.provider || row.agent) }}</strong><small>{{ t('Reset passes') }}</small></div><strong>{{ row.q.credits }}</strong></div>
        <div v-if="isApi" class="usage-api">{{ t('Claude · API usage, no quota') }}</div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.provider-usage { min-width: 0; margin-bottom: 14px; color: var(--text); }
.usage-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 34px; border-bottom: 1px solid var(--line); }
.usage-heading h2 { margin: 0; font: 700 18px/1.2 var(--display); }
.usage-heading > span, .model-section > h3 { color: var(--muted); font: 500 11px/1.3 var(--mono); letter-spacing: .08em; text-transform: uppercase; }
.model-section > h3 { margin: 8px 0 5px; }
.model-grid { display: flex; gap: 6px; overflow-x: auto; overscroll-behavior-x: contain; }
.model-card { flex: 1 0 190px; min-width: 0; border: 1px solid var(--line); background: var(--bg); overflow: hidden; }
.model-card:not(.opus-card), .provider-route { cursor: pointer; }
.model-card.recommended { border-color: var(--accent); }
.model-choice { display: flex; width: 100%; min-height: 44px; padding: 5px 8px; gap: 5px; align-items: center; justify-content: space-between; text-align: left; cursor: pointer; }
.model-choice[aria-pressed="true"] { background: var(--surface); }
.model-choice:disabled { cursor: default; }
.model-choice:focus-visible, .accounts-toggle:focus-visible, .providers-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.model-identity { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.model-identity strong, .opus-heading h4 { margin: 0; font: 700 13px/1.1 var(--display); overflow-wrap: anywhere; }
.model-identity small, .provider-choice, .pool-name small { font: 500 11px/1.2 var(--mono); color: var(--muted); overflow-wrap: anywhere; }
.default-mark { color: var(--accent); font: 600 13px/1 var(--mono); flex: 0 0 14px; text-align: center; }
.model-windows { display: flex; overflow-x: auto; min-width: 0; padding: 3px 2px 5px; overscroll-behavior-x: contain; }
.opus-card { flex: 2 0 min(380px, 100%); }
.opus-heading { display: flex; justify-content: space-between; align-items: center; min-height: 32px; padding-left: 8px; border-bottom: 1px solid var(--line-soft); }
.providers-toggle { min-height: 44px; min-width: 44px; font-size: 10px; }
.provider-rail { display: grid; grid-template-columns: repeat(auto-fit, minmax(176px, 1fr)); min-width: 0; }
.provider-rail.expanded { display: flex; overflow-x: auto; overscroll-behavior-x: contain; }
.provider-rail.expanded .provider-route { flex: 0 0 184px; }
.provider-route { min-width: 0; border-right: 1px solid var(--line-soft); }
.provider-route:last-child { border-right: 0; }
.provider-choice { min-height: 44px; padding-top: 4px; padding-bottom: 4px; }
.spending { padding: 3px 8px 5px; font: 500 9px/1.2 var(--mono); color: var(--muted); }
.spend-days { display: flex; justify-content: space-between; gap: 6px; }
.spend-day { min-width: 0; flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; }
.spend-day > span { font-size: 11px; color: var(--text-2); }
.spend-track { height: 30px; width: 20px; position: relative; background: var(--surface); display: grid; place-items: center; }
.spend-track i { position: absolute; bottom: 0; left: 0; right: 0; background: var(--teal); }
.spend-total { display: flex; justify-content: space-between; gap: 6px; margin-top: 4px; }
.spend-total strong { color: var(--text-2); }
.account-limits { display: flex; align-items: stretch; margin-top: 8px; border: 1px solid var(--line); }
.accounts-toggle { flex: 0 0 44px; width: 44px; min-height: 44px; padding: 4px; display: flex; align-items: center; justify-content: center; border-right: 1px solid var(--line-soft); font: 600 14px/1.2 var(--mono); cursor: pointer; }
.account-rail { display: flex; flex: 1; min-width: 0; overflow-x: auto; overscroll-behavior-x: contain; }
.account-rail.expanded { flex-wrap: wrap; }
.account-pool { display: flex; flex: 0 0 208px; min-width: 0; padding: 5px; align-items: center; border-right: 1px solid var(--line-soft); }
.pool-name { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; padding-left: 3px; }
.pool-name strong { font: 600 10px/1.2 var(--mono); overflow-wrap: anywhere; }
.reset-passes { flex-basis: 160px; }
.reset-passes > strong { padding: 8px; font: 700 18px/1 var(--mono); }
.account-pool.exhausted { flex-basis: 156px; }
.account-pool.exhausted :deep(.gauge-graph), .account-pool.exhausted :deep(.gauge-period) { display: none; }
.account-pool.exhausted :deep(.model-gauge) { flex-basis: 34px; }
.usage-api, .usage-message { padding: 8px; font: 400 10px/1.3 var(--mono); color: var(--muted); }
.usage-error { display: flex; align-items: center; justify-content: space-between; gap: 8px; font: 400 11px/1.3 var(--mono); color: var(--rose); }
</style>
