// Hidden agents are remembered rather than an allow list: a newly
// installed agent stays checked by default on each device.
export function readHiddenAgents(raw: string | null): string[] {
  try {
    const value: unknown = JSON.parse(raw || '[]')
    return Array.isArray(value) ? [...new Set(value.filter((kind): kind is string => typeof kind === 'string' && kind !== 'shell'))] : []
  } catch { return [] }
}

export function visibleAgentKinds(installed: readonly string[], hidden: readonly string[]): string[] {
  const excluded = new Set(hidden)
  return [...new Set(installed.filter(kind => kind !== 'shell' && !excluded.has(kind))), 'shell']
}

export function selectedAgentKind(current: string, available: readonly string[], last = ''): string {
  if (available.includes(current)) return current
  if (!current && available.includes(last)) return last
  return available[0] || 'shell'
}

// Agents used from this device (terminal aside): the New sheet offers those
// by default and keeps the other installed ones behind "+N".
export function readUsedAgentKinds(raw: string | null): string[] {
  try {
    const value: unknown = JSON.parse(raw || '[]')
    return Array.isArray(value) ? [...new Set(value.filter((kind): kind is string => typeof kind === 'string' && kind !== 'shell'))] : []
  } catch { return [] }
}

// Adds the kinds just used, keeping the oldest first.
export function rememberAgentKinds(used: readonly string[], kinds: readonly (string | null | undefined)[]): string[] {
  const next = [...used]
  for (const kind of kinds) if (kind && kind !== 'shell' && !next.includes(kind)) next.push(kind)
  return next
}

// The New sheet's Type row: used agents (plus the selected one) when folded,
// every installed agent when unfolded. Terminal always stays.
export function offeredAgentKinds(available: readonly string[], used: readonly string[], current: string, unfolded = false): string[] {
  if (unfolded) return [...available]
  const picked = new Set(used)
  if (current) picked.add(current)
  return available.filter(kind => kind === 'shell' || picked.has(kind))
}

// A task's Start row: its default agent first (as herdr-projects resolves it,
// model included), then the other agents installed on its machine that
// Settings › Agents offers. The default is always shown, even unchecked
// (`hidden`): it is what Start runs. `usable`: the default is installed there;
// unknown (no agent found: the machine could not be checked) it stays usable.
export interface StartAgentChoice { id: string | null, label: string, isDefault: boolean, usable: boolean, hidden: boolean }
export function startAgentChoices(
  o: { agent: { value: string, kind: string } | null, agents: readonly string[] },
  hidden: readonly string[],
  defaultLabel: string,
): StartAgentChoice[] {
  const excluded = new Set(hidden)
  const kind = o.agent?.kind || ''
  const usable = !o.agent || !o.agents.length || o.agents.includes(kind)
  return [
    { id: null, label: o.agent?.value || defaultLabel, isDefault: true, usable, hidden: Boolean(kind) && excluded.has(kind) },
    ...[...new Set(o.agents)].filter(k => k !== kind && !excluded.has(k)).map(k => ({ id: k, label: k, isDefault: false, usable: true, hidden: false })),
  ]
}
