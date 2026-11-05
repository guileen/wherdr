<script setup lang="ts">
// Provider usage counters and progress: one row per provider (Claude, Codex, Google Antigravity, etc.).
// Decoupled into an independent component with high information density,
// native provider branding (no repeating omp icons), and clean typography.
import type { QuotaWindow } from '#shared/types'
import {
  type QuotaRow,
  periodLabel,
  providerIdentity,
  quotaLevel,
  quotaShown,
  resetCountdown,
  resetText,
  STALE_MS,
} from '~/utils/quotas'
import { useProviderUsage } from '~/composables/useProviderUsage'
import { quotaNow } from '~/composables/useQuotas'
import { desk, quotaDisplay } from '~/composables/useHerdr'
import { t, tl } from '~/utils/i18n'
import { kindLabel } from '~/utils/format'

const props = withDefaults(defineProps<{
  rows?: QuotaRow[]
  api?: boolean
}>(), {
  rows: undefined,
  api: undefined,
})

const { rows: fallbackRows, api: fallbackApi } = useProviderUsage()
const activeRows = computed(() => (props.rows !== undefined ? props.rows : fallbackRows.value))
const isApi = computed(() => (props.api !== undefined ? props.api : fallbackApi.value))

const now = quotaNow
const shown = (w: QuotaWindow) => quotaShown(w, now.value, quotaDisplay.value)
const level = (w: QuotaWindow) => quotaLevel(w, now.value)
const stale = (r: QuotaRow) => now.value - r.q.at > STALE_MS
const used = (w: QuotaWindow) => quotaShown(w, now.value, 'used')
const providerOf = (r: QuotaRow) => providerIdentity(r)

function getWindows(r: QuotaRow): { key: string, w: QuotaWindow | null, label?: string }[] {
  if (r.q.windows && r.q.windows.length > 0) {
    return r.q.windows.map((w, i) => ({
      key: `w-${i}-${w.label || w.minutes}`,
      w,
      label: w.label || (w.minutes === 300 ? '5 h' : w.minutes === 10080 ? t('Week') : periodLabel(w)),
    }))
  }
  return [
    { key: 'five', w: r.q.five, label: '5 h' },
    { key: 'week', w: r.q.week, label: t('Week') },
  ]
}

function getMobileWindows(r: QuotaRow): { key: string, w: QuotaWindow | null }[] {
  if (r.q.five || r.q.week) {
    return [
      { key: 'five', w: r.q.five },
      { key: 'week', w: r.q.week },
    ]
  }
  if (r.q.windows && r.q.windows.length > 0) {
    return r.q.windows.slice(0, 2).map((w, i) => ({ key: `w-${i}`, w }))
  }
  return [
    { key: 'five', w: null },
    { key: 'week', w: null },
  ]
}

function resetLabel(w: QuotaWindow) {
  if (w.fresh) return t('new window')
  const s = resetText(w, now.value, language)
  return s === null ? t('reset') : s || '—'
}

function agoShort(at: number) {
  const m = Math.round((now.value - at) / 60000)
  if (m < 1) return '< 1 min'
  if (m < 60) return `${m} min`
  const h = Math.round(m / 60)
  return h < 48 ? `${h} h` : tl(`${Math.round(h / 24)} d`, `${Math.round(h / 24)} j`)
}

function ago(at: number) {
  const m = Math.round((now.value - at) / 60000)
  if (m < 1) return t('just now')
  if (m < 60) return tl(`${m} min ago`, `il y a ${m} min`)
  const h = Math.round(m / 60)
  return h < 48 ? tl(`${h} h ago`, `il y a ${h} h`) : tl(`${Math.round(h / 24)} d ago`, `il y a ${Math.round(h / 24)} j`)
}
</script>

<template>
  <section v-if="activeRows.length || isApi" class="quotas provider-usage" :class="{ 'quotas-phone': !desk }" :aria-label="t('Quotas')">
    <!-- Desktop Layout -->
    <div v-if="isApi" class="quota-row quota-api quota-desktop" data-testid="quota-claude-api">
      <div class="quota-who" :title="kindLabel('claude')">
        <div class="avatar claude"><UIcon name="i-herdr-claude-code" /></div>
      </div>
      <p class="quota-api-label">{{ tl('Claude · API usage, no quota', 'Claude · usage API, pas de quota') }}</p>
    </div>
    <div v-for="r in activeRows" :key="r.key" class="quota-row quota-desktop" :class="{ stale: stale(r) }">
      <div class="quota-who" :title="`${r.label ? `${r.label} · ` : ''}${providerOf(r).name} · ${t('updated')} ${ago(r.q.at)}`">
        <div class="avatar" :class="providerOf(r).id">
          <UIcon :name="providerOf(r).icon" />
        </div>
        <span v-if="r.label" class="quota-who-label" :title="r.label">{{ r.label }}</span>
        <span v-else-if="r.agent === 'omp'" class="quota-who-label" :title="providerOf(r).name">{{ providerOf(r).shortName }}</span>
        <span v-if="r.q.plan" class="quota-who-plan">{{ r.q.plan }}</span>
        <span v-if="r.q.credits" class="quota-who-credits" :title="`${r.q.credits} saved resets`">✦ {{ r.q.credits }}</span>
        <small>{{ agoShort(r.q.at) }}</small>
      </div>
      <div class="quota-windows">
        <template v-for="item in getWindows(r)" :key="item.key">
          <div v-if="item.w" class="quota" :class="[level(item.w), { guessed: item.w.resetsAt && item.w.resetsAt <= now }]">
            <div class="quota-top">
              <span class="quota-label" :title="item.label">{{ item.label }}</span>
              <b>{{ shown(item.w) }}<small>%</small></b>
            </div>
            <div class="quota-bar"><i :style="{ width: `${shown(item.w)}%` }" /></div>
            <div class="quota-reset" :title="resetLabel(item.w)">{{ resetLabel(item.w) }}</div>
          </div>
          <div v-else class="quota empty" />
        </template>
      </div>
    </div>

    <!-- Mobile Layout -->
    <div class="quota-mobile" role="group" :aria-label="t('Used quotas')">
      <div v-if="isApi" class="quota-mobile-card quota-mobile-api-card" role="group" :aria-label="kindLabel('claude')">
        <div class="quota-mobile-avatar">
          <div class="avatar claude"><UIcon name="i-herdr-claude-code" /></div>
        </div>
        <div class="quota-mobile-api-content">
          <span class="quota-mobile-api">{{ tl('API usage, no quota', 'Usage API, pas de quota') }}</span>
        </div>
      </div>
      <div
        v-for="r in activeRows"
        :key="r.key"
        class="quota-mobile-card"
        :class="{ stale: stale(r) }"
        role="group"
        :title="`${r.label || providerOf(r).name} · ${t('updated')} ${ago(r.q.at)}`"
        :aria-label="`${r.label || providerOf(r).name} · ${t('updated')} ${ago(r.q.at)}`"
      >
        <div class="quota-mobile-avatar">
          <div class="avatar" :class="providerOf(r).id">
            <UIcon :name="providerOf(r).icon" />
          </div>
          <span v-if="r.q.credits" class="quota-mobile-credits" :title="`${r.q.credits} saved resets`">✦{{ r.q.credits }}</span>
        </div>
        <div class="quota-mobile-windows">
          <div
            v-for="item in getMobileWindows(r)"
            :key="item.key"
            class="quota-mobile-window"
            :class="item.w ? [level(item.w), { guessed: item.w.resetsAt && item.w.resetsAt <= now }] : 'missing'"
          >
            <template v-if="item.w">
              <div class="quota-mobile-line">
                <span>{{ periodLabel(item.w) }}</span>
                <b>{{ used(item.w) }}%</b>
                <span class="quota-mobile-reset" :title="resetLabel(item.w)" :aria-label="`${t('Resets')}: ${resetCountdown(item.w, now)}`">
                  {{ resetCountdown(item.w, now) }}
                </span>
              </div>
              <div class="quota-mobile-bar"><i :style="{ width: `${used(item.w)}%` }" /></div>
            </template>
            <span v-else>—</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.quota-who-plan {
  display: inline-block;
  padding: 1px 3px;
  font: 600 7.5px/1 var(--mono);
  letter-spacing: .04em;
  text-transform: uppercase;
  color: var(--muted);
  border: 1px solid var(--line);
  background: var(--surface);
}

.avatar.claude { color: var(--ochre); }
.avatar.codex { color: var(--teal); }
.avatar.google { color: var(--accent); }
.avatar.xai { color: var(--text); }
.avatar.cursor { color: var(--text-2); }
.avatar.devin { color: var(--teal); }

.quota-mobile { display: none; }
.quotas-phone .quota-desktop { display: none; }
.quotas-phone .quota-mobile { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-top: 1px solid var(--line); border-left: 1px solid var(--line); }
.quota-mobile-card { display: flex; align-items: center; gap: 4px; min-width: 0; padding: 6px 4px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.quota-mobile-avatar { position: relative; flex: none; display: flex; flex-direction: column; align-items: center; }
.quota-mobile-card :deep(.avatar) { flex: none; width: 18px; height: 18px; border: 0; background: none; }
.quota-mobile-card :deep(.avatar .iconify) { width: 14px; height: 14px; }
.quota-mobile-card :deep(.avatar.claude) { color: var(--ochre); }
.quota-mobile-card :deep(.avatar.codex) { color: var(--teal); }
.quota-mobile-card :deep(.avatar.google) { color: var(--accent); }
.quota-mobile-credits { font: 600 7.5px/1 var(--mono); color: var(--ochre); margin-top: 1px; }
.stale .quota-mobile-avatar::after { content: ''; position: absolute; right: -1px; bottom: -1px; width: 4px; height: 4px; background: var(--ochre); border-radius: 1px; }
.quota-mobile-windows { flex: 1; min-width: 0; display: grid; gap: 5px; }
.quota-mobile-window { min-width: 0; font: 400 8px/1.1 var(--mono); color: var(--muted); }
.quota-mobile-line { display: flex; justify-content: space-between; gap: 1px; white-space: nowrap; }
.quota-mobile-line b { color: var(--text); font-weight: 600; }
.stale .quota-mobile-line b { color: var(--muted); }
.hi .quota-mobile-line b { color: var(--rose); }
.quota-mobile-bar { height: 2px; margin-top: 2px; background: var(--line); }
.quota-mobile-bar i { display: block; height: 100%; background: var(--teal); }
.mid .quota-mobile-bar i { background: var(--ochre); }
.hi .quota-mobile-bar i { background: var(--rose); }
.guessed .quota-mobile-bar i { background: repeating-linear-gradient(90deg, var(--teal) 0 4px, transparent 4px 7px); }
.quota-mobile-reset { color: var(--dim); }
.quota-mobile-api-content { display: flex; align-items: center; gap: 4px; min-width: 0; }
.quota-mobile-api { min-width: 0; font: 400 9px/1.2 var(--mono); color: var(--dim); overflow-wrap: anywhere; }
</style>
