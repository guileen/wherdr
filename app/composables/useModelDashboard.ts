import { computed, shallowRef, ref, toValue, type MaybeRefOrGetter, type Ref, type ShallowRef } from 'vue'
import type { ModelDashboardSnapshot } from '#shared/modelDashboard'
import { api, machineInfo } from '~/composables/useHerdr'
import { dashboardCards, type DashboardCard } from '~/utils/modelDashboard'
import { ompReportToQuota, STALE_MS } from '~/utils/quotas'

interface DashboardEntry {
  snapshot: ShallowRef<ModelDashboardSnapshot | null>
  loading: Ref<boolean>
  error: Ref<string>
  loadedAt: number
  version: number
  pending: Promise<void> | null
  rankingAt: Ref<number>
  cards: Readonly<Ref<DashboardCard[]>>
}

const entries = new Map<string, DashboardEntry>()

function entryFor(machine: string): DashboardEntry {
  let entry = entries.get(machine)
  if (!entry) {
    const snapshot = shallowRef<ModelDashboardSnapshot | null>(null)
    const rankingAt = ref(Date.now())
    const cards = computed(() => dashboardCards(snapshot.value?.models || [], (snapshot.value?.quota?.reports || []).map((report, index) => ({
      key: `local:${report.provider}:${index}`, agent: 'omp', provider: report.provider, q: ompReportToQuota(report),
    })), rankingAt.value))
    entry = { snapshot, loading: ref(false), error: ref(''), loadedAt: 0, version: 0, pending: null, rankingAt, cards }
    entries.set(machine, entry)
  }
  return entry
}

export function useModelDashboard(machine: MaybeRefOrGetter<string | undefined>) {
  const key = computed(() => {
    const value = toValue(machine) || ''
    const info = machineInfo(value)
    if (info?.local) return ''
    return info?.baseKey && machineInfo(info.baseKey) ? info.baseKey : value
  })
  const entry = computed(() => entryFor(key.value))
  const snapshot = computed(() => entry.value.snapshot.value)
  const loading = computed(() => entry.value.loading.value)
  const error = computed(() => entry.value.error.value)
  const cards = computed(() => entry.value.cards.value)

  function updateRanking(now = Date.now()) {
    const current = entry.value
    const previous = current.rankingAt.value
    if (now < previous || now - previous >= 60_000 || current.cards.value.some(card => card.routes.some(route =>
      (route.row && previous - route.row.q.at <= STALE_MS && now - route.row.q.at > STALE_MS)
      || route.windows.some(window => window.resetsAt != null && previous < window.resetsAt && now >= window.resetsAt),
    ))) current.rankingAt.value = now
  }

  function load(force = false): Promise<void> {
    const current = entry.value
    updateRanking()
    if (current.pending) return current.pending
    if (!force && current.snapshot.value && Date.now() - current.loadedAt < 60_000) return Promise.resolve()
    const version = ++current.version
    current.loading.value = true
    current.error.value = ''
    const url = key.value ? `/api/model-dashboard?${new URLSearchParams({ machine: key.value })}` : '/api/model-dashboard'
    const pending = (async () => {
      try {
        const result = await api<ModelDashboardSnapshot>(url)
        if (current.version === version) {
          current.snapshot.value = result
          current.rankingAt.value = Date.now()
          current.loadedAt = Date.now()
        }
      } catch (err) {
        if (current.version === version) current.error.value = (err as Error).message
      } finally {
        current.loading.value = false
        current.pending = null
      }
    })()
    current.pending = pending
    return pending
  }

  function replace(value: ModelDashboardSnapshot) {
    const current = entry.value
    current.version++
    current.snapshot.value = value
    current.rankingAt.value = Date.now()
    current.loadedAt = Date.now()
    current.error.value = ''
  }

  return { snapshot, cards, loading, error, load, replace, updateRanking }
}
