import { describe, expect, it } from 'vitest'
import { readHomeGrouping, sortMobileRows, stateEntries, stateMachines } from '../app/utils/homeGrouping'
import type { BoardSections, Member } from '../shared/boardLinks'
import type { Pane } from '../shared/types'
import type { Row } from '../shared/spaces'

const row = (id: string, agent: string | null = 'codex'): Row => {
  const pane = { id, agent } as Pane
  return { kind: 'pane', key: id, pane, lead: pane }
}
const coordinator = row('coordinator')
const task = { row: row('task'), task: { id: 'demo/1' }, role: 'worker' } as Member
const shell = row('shell', null)
const sections: BoardSections = {
  coordinators: [{ row: row('machine-coordinator'), level: 'machine' }],
  projects: [{ id: 'demo', repo: 'demo', key: 'DEMO', info: null, coordinator, space: shell, remote: null,
    members: [task, { row: row('unlinked'), task: null, role: 'worker' }],
    sum: { blocked: 0, working: 0, ready: 3, total: 3 }, state: 'ready' }],
  others: [row('agent'), row('terminal', null)],
}

describe('home grouping', () => {
  it('preserves Machine as the default for missing and invalid stored values', () => {
    for (const v of [null, undefined, '', 'unknown', 'machine', 1]) expect(readHomeGrouping(v)).toBe('machine')
    expect(readHomeGrouping('state')).toBe('state')
  })
  it('flattens all coordinator levels, tasks and ordinary agents without losing task metadata', () => {
    const entries = stateEntries(sections, false)
    expect(entries.map(e => e.row.key)).toEqual(['machine-coordinator', 'coordinator', 'task', 'unlinked', 'agent'])
    expect(entries[0]?.level).toBe('machine')
    expect(entries[1]).toMatchObject({ repo: 'demo', level: 'project' })
    expect(entries[2]?.member).toBe(task)
    expect(entries[3]?.repo).toBe('demo')
  })
  it('includes repository shells and ordinary terminals only when enabled', () => {
    expect(stateEntries(sections, true).map(e => e.row.key)).toEqual(['machine-coordinator', 'coordinator', 'shell', 'task', 'unlinked', 'agent', 'terminal'])
  })
  it('does not invent a row when the project coordinator and checkout are elsewhere', () => {
    const project = { ...sections.projects[0]!, coordinator: null, space: null }
    expect(stateEntries({ coordinators: [], projects: [project], others: [] }, false).map(e => e.row.key)).toEqual(['task', 'unlinked'])
  })
})

describe('mobile conversation order', () => {
  it('sorts across machines by the latest pane activity, leaving unknown times last and stable', () => {
    const older = row('older')
    const latest = row('latest')
    if (older.kind !== 'pane' || latest.kind !== 'pane') throw new Error('expected panes')
    older.pane.activityAt = 100
    latest.pane.activityAt = 300
    const space = { kind: 'space', key: 'space', panes: [older.pane, latest.pane], lead: older.pane } as Row
    const entries = [row('unknown'), older, space, row('unknown2')].map(row => ({ row }))
    expect(sortMobileRows(entries, 'recent', r => r.key).map(e => e.row.key)).toEqual(['space', 'older', 'unknown', 'unknown2'])
    expect(sortMobileRows(entries, 'name', r => r.key).map(e => e.row.key)).toEqual(['older', 'space', 'unknown', 'unknown2'])
  })
  it('prioritizes working agents, then orders each tier by observed activity', () => {
    const finished = row('finished')
    const first = row('first')
    const second = row('second')
    if (finished.kind !== 'pane' || first.kind !== 'pane' || second.kind !== 'pane') throw new Error('expected panes')
    Object.assign(finished.pane, { status: 'done', activityAt: 500 })
    Object.assign(first.pane, { status: 'working', activityAt: 100 })
    Object.assign(second.pane, { status: 'working', activityAt: 200 })
    const space = { kind: 'space', key: 'space', panes: [finished.pane, first.pane], lead: finished.pane } as Row
    const entries = [finished, first, second].map(row => ({ row }))
    const ordered = () => sortMobileRows(entries, 'recent', r => r.key).map(e => e.row.key)
    expect(ordered()).toEqual(['second', 'first', 'finished'])
    first.pane.activityAt = 600
    expect(ordered()).toEqual(['first', 'second', 'finished'])
    expect(sortMobileRows([{ row: second }, { row: space }], 'recent', r => r.key).map(e => e.row.key)).toEqual(['space', 'second'])
    expect(sortMobileRows(entries, 'name', r => r.key).map(e => e.row.key)).toEqual(['finished', 'first', 'second'])
  })
})

describe('stateMachines', () => {
  const list = [
    { key: '', status: 'online' as const },
    { key: 'laptop', status: 'connecting' as const },
    { key: 'laptop#work', baseKey: 'laptop', status: 'online' as const },
    { key: 'nas', status: 'offline' as const },
  ]

  it('splits online machines from offline and reconnecting ones', () => {
    const { online, away } = stateMachines(list, null)
    expect(online.map(m => m.key)).toEqual(['', 'laptop#work'])
    expect(away.map(m => m.key)).toEqual(['laptop', 'nas'])
  })

  it('follows the bar selection by base key, in its order', () => {
    const { online, away } = stateMachines(list, ['nas', 'laptop'])
    expect(online.map(m => m.key)).toEqual(['laptop#work'])
    expect(away.map(m => m.key)).toEqual(['nas', 'laptop'])
    expect(stateMachines(list, [])).toEqual({ online: [], away: [] })
  })
})
