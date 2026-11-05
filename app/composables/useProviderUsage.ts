// Composable for Home Provider Usage: gathers top quotas, multi-machine account quotas, and API state.
import type { QuotaRow } from '~/utils/quotas'
import { claudeApiKeys, claudeSplit, quotaRows } from '~/utils/quotas'
import { hiddenAgents, homeQuotas, showQuotas } from '~/composables/useHerdr'

export function useProviderUsage() {
  const topQuotas = computed(() => (showQuotas.value ? quotaRows(homeQuotas.value, hiddenAgents.value) : []))
  const isApi = computed(() => showQuotas.value && Boolean(homeQuotas.value && claudeApiKeys(homeQuotas.value).length > 0))

  const rows = computed<QuotaRow[]>(() => {
    if (!showQuotas.value || !homeQuotas.value) return []
    const q = homeQuotas.value
    const list = [...topQuotas.value]

    // Per-machine Claude accounts
    if (q.claudeAccounts && claudeSplit(q) && !hiddenAgents.value.includes('claude')) {
      for (const a of q.claudeAccounts) {
        const { machines: mList, ...quota } = a
        list.push({
          key: `claude:${mList.map(m => m.key).join(':')}`,
          agent: 'claude',
          label: mList.map(m => m.label || m.key).join(', ') || 'Claude',
          q: quota,
        })
      }
    }

    // Per-machine Codex accounts
    if (q.codexAccounts && q.codexAccounts.length > 0 && !hiddenAgents.value.includes('codex')) {
      for (const a of q.codexAccounts) {
        const { machines: mList, ...quota } = a
        list.push({
          key: `codex:${mList.map(m => m.key).join(':')}`,
          agent: 'codex',
          label: mList.map(m => m.label || m.key).join(', ') || 'Codex',
          q: quota,
        })
      }
    }

    return list
  })

  const visible = computed(() => showQuotas.value && (rows.value.length > 0 || isApi.value))

  return {
    rows,
    api: isApi,
    visible,
    topQuotas,
  }
}
