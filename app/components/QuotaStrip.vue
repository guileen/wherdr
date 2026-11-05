<script setup lang="ts">
// Table of remaining quotas (5-hour window and week), one row per account:
// at the top of the home screen (accounts shared by all machines) and under the header
// of a machine (its Claude account, when accounts differ). Same thin-line
// grid as the counters; the bar shows what remains, like a battery,
// or what is used (Settings → Appearance → Quotas). The color follows urgency.
// Reading older than an hour: age in ochre, numbers dimmed; window
// reset since the reading: "reset", 100 % assumed; window (5 h or
// week) missing from Claude's reading (it just restarted): "fresh window".
// `api`: Claude Code runs on API billing there (no rate limits): a muted
// label in place of the gauges, never a warning colour.
import type { QuotaWindow } from '#shared/types'
import { type QuotaRow, quotaLevel, quotaShown, resetText, STALE_MS } from '~/utils/quotas'

defineProps<{ rows: QuotaRow[], api?: boolean }>()

const now = quotaNow
const shown = (w: QuotaWindow) => quotaShown(w, now.value, quotaDisplay.value)
const level = (w: QuotaWindow) => quotaLevel(w, now.value)
 const stale = (r: QuotaRow) => now.value - r.q.at > STALE_MS

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

 function resetLabel(w: QuotaWindow) {
   if (w.fresh) return t('new window')
   const s = resetText(w, now.value, language)
   return s === null ? t('reset') : s || '—'
 }
 function periodLabel(w: QuotaWindow) {
  if (w.label) return w.label
   if (w.minutes === 10080) return '7d'
   if (!w.minutes) return '—'
   if (w.minutes % 1440 === 0) return `${w.minutes / 1440}d`
   if (w.minutes % 60 === 0) return `${w.minutes / 60}h`
  return `${w.minutes}m`
}
function resetCountdown(w: QuotaWindow) {
  if (w.fresh) return t('new')
  if (!w.resetsAt) return '—'
  const minutes = Math.ceil((w.resetsAt - now.value) / 60000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h${minutes % 60 ? `${minutes % 60}m` : ''}`
  return `${Math.floor(hours / 24)}d${hours % 24 ? `${hours % 24}h` : ''}`
}
const used = (w: QuotaWindow) => quotaShown(w, now.value, 'used')
// Short age of the reading, under each row's logo ("3 min", "2 h").
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
  <section v-if="rows.length || api" class="quotas" :class="{ 'quotas-phone': !desk }" :aria-label="t('Quotas')">
    <div v-if="api" class="quota-row quota-api quota-desktop" data-testid="quota-claude-api">
      <div class="quota-who" :title="kindLabel('claude')">
        <AgentAvatar agent="claude" />
      </div>
      <p class="quota-api-label">{{ tl('Claude · API usage, no quota', 'Claude · usage API, pas de quota') }}</p>
    </div>
    <div v-for="r in rows" :key="r.key" class="quota-row quota-desktop" :class="{ stale: stale(r) }">
      <div class="quota-who" :title="`${r.label ? `${r.label} · ` : ''}${kindLabel(r.agent)} · ${t('updated')} ${ago(r.q.at)}`">
        <AgentAvatar :agent="r.agent" />
        <span v-if="r.label" class="quota-who-label" :title="r.label">{{ r.label }}</span>
        <span v-if="r.q.credits" class="quota-who-credits" :title="`${r.q.credits} saved resets`">✦ {{ r.q.credits }}</span>
        <small><UIcon v-if="stale(r)" name="i-lucide-clock-alert" />{{ agoShort(r.q.at) }}</small>
      </div>
      <template v-for="item in getWindows(r)" :key="item.key">
        <div v-if="item.w" class="quota" :class="[level(item.w), { guessed: item.w.resetsAt && item.w.resetsAt <= now }]">
          <div class="quota-top">
            <span class="quota-label">{{ item.label }}</span>
            <b>{{ shown(item.w) }}<small>%</small></b>
          </div>
          <div class="quota-bar"><i :style="{ width: `${shown(item.w)}%` }" /></div>
          <div class="quota-reset"><UIcon name="i-lucide-rotate-cw" />{{ resetLabel(item.w) }}</div>
        </div>
        <div v-else class="quota empty" />
      </template>
    </div>
    <div class="quota-mobile" role="group" :aria-label="t('Used quotas')">
      <div v-if="api" class="quota-mobile-card" role="group" :aria-label="kindLabel('claude')">
        <AgentAvatar agent="claude" />
        <span class="quota-mobile-api">{{ tl('API usage, no quota', 'Usage API, pas de quota') }}</span>
      </div>
      <div v-for="r in rows" :key="r.key" class="quota-mobile-card" :class="{ stale: stale(r) }" role="group" :title="`${kindLabel(r.agent)}${r.label ? ` · ${r.label}` : ''}`" :aria-label="`${kindLabel(r.agent)}${r.label ? ` · ${r.label}` : ''} · ${t('updated')} ${ago(r.q.at)}`">
        <div class="quota-mobile-avatar">
          <AgentAvatar :agent="r.agent" />
          <UIcon v-if="stale(r)" name="i-lucide-clock-alert" :aria-label="`${t('updated')} ${ago(r.q.at)}`" />
        </div>
        <span v-if="r.label" class="quota-mobile-provider-tag" :title="r.label">
          {{ r.label }}<b v-if="r.q.credits" class="quota-mobile-credits" :title="`${r.q.credits} saved resets`"> ✦{{ r.q.credits }}</b>
        </span>
        <div class="quota-mobile-windows">
          <div v-for="item in getWindows(r)" :key="item.key" class="quota-mobile-window" :class="item.w ? [level(item.w), { guessed: item.w.resetsAt && item.w.resetsAt <= now }] : 'missing'">
            <template v-if="item.w">
              <div class="quota-mobile-line">
                <span>{{ periodLabel(item.w) }}</span>
                <b>{{ used(item.w) }}%</b>
                <span class="quota-mobile-reset" :title="resetLabel(item.w)" :aria-label="`${t('Resets')}: ${resetCountdown(item.w)}`">{{ resetCountdown(item.w) }}</span>
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
.quota-mobile { display: none; }
.quotas-phone .quota-desktop { display: none; }
.quotas-phone .quota-mobile { display: flex; flex-direction: column; width: auto; border-top: 1px solid var(--line); border-left: 1px solid var(--line); }
.quota-mobile-card { display: flex; align-items: center; gap: 6px; min-width: 0; width: auto; padding: 6px 8px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.quota-mobile-avatar { position: relative; flex: none; }
.quota-mobile-avatar > .iconify { position: absolute; right: -2px; bottom: -3px; width: 9px; height: 9px; color: var(--ochre); }
.quota-mobile-card :deep(.avatar) { flex: none; width: 18px; height: 18px; border: 0; background: none; }
.quota-mobile-card :deep(.avatar .iconify) { width: 14px; height: 14px; }
.quota-mobile-provider-tag {
  flex: none;
  font: 600 8.5px/1.1 var(--mono);
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--muted);
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.quota-mobile-credits {
  margin-left: 2px;
  color: var(--ochre);
}
.quota-mobile-windows { flex: 1 1 auto; min-width: 0; width: auto; display: flex; flex-wrap: wrap; gap: 4px 8px; }
.quota-mobile-window { flex: 1 1 110px; min-width: 0; width: auto; font: 400 8px/1.1 var(--mono); color: var(--muted); }
.quota-mobile-line { display: flex; justify-content: space-between; align-items: baseline; gap: 4px; white-space: nowrap; min-width: 0; }
.quota-mobile-line > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 0 1 auto; min-width: 0; }
.quota-mobile-line b { color: var(--text); font-weight: 600; flex: none; }
.stale .quota-mobile-line b { color: var(--muted); }
.hi .quota-mobile-line b { color: var(--rose); }
.quota-mobile-bar { height: 2px; margin-top: 2px; background: var(--line); width: 100%; }
.quota-mobile-bar i { display: block; height: 100%; background: var(--teal); }
.mid .quota-mobile-bar i { background: var(--ochre); }
.hi .quota-mobile-bar i { background: var(--rose); }
.guessed .quota-mobile-bar i { background: repeating-linear-gradient(90deg, var(--teal) 0 4px, transparent 4px 7px); }
.quota-mobile-reset { color: var(--dim); flex: none; }
.quota-mobile-api { min-width: 0; font: 400 9px/1.2 var(--mono); color: var(--dim); overflow-wrap: anywhere; }
</style>
