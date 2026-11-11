import type { ChatItem } from '../../shared/types'
import { tl } from './i18n'
import { ompCommandLine } from './ompTool'

// Keep a summary on one line without changing the detail shown inside it.
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()
const failed = (item: ChatItem) => Boolean(item.error || (item.omp?.exit !== undefined && item.omp.exit !== 0))

// Thinking is not an action; a folded process counts the calls it hides.
export const isAction = (item: ChatItem) => item.role === 'tool' || item.role === 'job'

function actionLabel(item: ChatItem): string {
  if (item.role === 'job') {
    const details = [item.job?.tool, item.job?.id].filter(Boolean).join(' ')
    return [tl('Background job completed', 'Tâche de fond terminée'), details].filter(Boolean).join(' · ')
  }
  if (item.omp) return oneLine(item.omp.intent || ompCommandLine(item.omp))
  const name = oneLine(item.name || '')
  const text = oneLine(item.text)
  return [name, text].filter(Boolean).join(' · ') || tl('Tool', 'Outil')
}

function kind(item: ChatItem): 'read' | 'edit' | undefined {
  if (item.role !== 'tool') return undefined
  const name = (item.omp?.title || item.name || '').toLowerCase()
  if (name === 'read') return 'read'
  if (['edit', 'multiedit', 'write', 'apply_patch'].includes(name)) return 'edit'
}

function runLabel(type: 'read' | 'edit', items: readonly ChatItem[]): string {
  const count = items.length
  const label = type === 'read'
    ? tl(`${count} ${count === 1 ? 'read' : 'reads'}`, `${count} lecture${count === 1 ? '' : 's'}`)
    : tl(`${count} ${count === 1 ? 'edit' : 'edits'}`, `${count} modification${count === 1 ? '' : 's'}`)
  const targets = items.map(item => oneLine(item.omp?.target || item.text)).filter(Boolean).slice(0, 2)
  return targets.length ? `${label}: ${targets.join(', ')}` : label
}

// Thinking does not count as an action; job completions do. A failure remains
// visible even when a later successful action becomes the most recent one.
export function processSummary(items: readonly ChatItem[], live: boolean): string {
  const latest = live ? items.findLast(item => item.role === 'tool' || item.role === 'job' || item.role === 'thinking') : undefined
  if (latest?.role === 'thinking' && oneLine(latest.text)) return oneLine(latest.text)
  const actions = items.filter(isAction)
  if (!actions.length) return tl('Thinking', 'Réflexion')
  const last = actions[actions.length - 1]!
  const lastFailure = actions.findLast(failed)
  const failure = lastFailure ? `${tl('Failed', 'Échec')} · ${actionLabel(lastFailure)}` : ''
  if (live) {
    const current = actionLabel(last)
    return lastFailure === last ? `${tl('Failed', 'Échec')} · ${current}` : [current, failure].filter(Boolean).join(' · ')
  }

  const kinds = actions.map(kind)
  let summary: string
  if (actions.length > 1 && kinds.every(Boolean)) {
    const runs: { type: 'read' | 'edit', items: ChatItem[] }[] = []
    for (let i = 0; i < actions.length; i++) {
      const type = kinds[i]!
      const previous = runs[runs.length - 1]
      if (previous && previous.type === type) previous.items.push(actions[i]!)
      else runs.push({ type, items: [actions[i]!] })
    }
    summary = runs.map(run => runLabel(run.type, run.items)).join(' · ')
  } else {
    summary = `${lastFailure === last ? `${tl('Failed', 'Échec')} · ` : ''}${actionLabel(last)}`
    if (lastFailure === last) return summary
  }
  return [summary, failure].filter(Boolean).join(' · ')
}
