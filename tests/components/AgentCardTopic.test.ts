import { afterEach, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import AgentCard from '~/components/AgentCard.vue'
import { compactList, herdrState } from '~/composables/useHerdr'
import { spaceRows } from '#shared/spaces'
import type { Pane } from '#shared/types'
import type { BoardCard } from '#shared/boardLinks'

const pane: Pane = { id: 'w1:p1', workspace: 'w1', tab: 'w1:t1', tabLabel: null, agent: 'claude', name: null, label: null, status: 'working', title: 'Fix session reconnect', cwd: '/tmp/demo', agentSession: 'session-a', preview: 'Checking the reconnect path' }
const workspace = { id: 'w1', label: 'Shared space', number: 1, status: null, worktree: false }
function state(panes = [pane]) {
  herdrState.value = { ok: true, panes, workspaces: [workspace] }
}
afterEach(() => {
  compactList.value = false
  herdrState.value = { ok: false, panes: [], workspaces: [] }
})

for (const compact of [false, true]) {
  it(`keeps the space name and shows the task topic in ${compact ? 'compact' : 'normal'} mode`, async () => {
    state()
    compactList.value = compact
    const w = await mountSuspended(AgentCard, { props: { pane } })
    try {
      expect(w.get('.card-title').text()).toBe('Shared space')
      expect(w.get('.home-task-line').text()).toBe('Fix session reconnect')
      expect(w.text()).not.toContain(pane.preview)
      await w.setProps({ pane: { ...pane, preview: 'All checks passed' } })
      expect(w.get('.home-task-line').text()).toBe('Fix session reconnect')
    } finally { w.unmount() }
  })
}

it('retains the message preview when there is no meaningful topic', async () => {
  state()
  const w = await mountSuspended(AgentCard, { props: { pane: { ...pane, title: 'Claude Code' } } })
  try { expect(w.get('.home-task-line').text()).toBe(pane.preview) } finally { w.unmount() }
})

it('keeps a waiting question and its answers below the topic', async () => {
  state()
  const w = await mountSuspended(AgentCard, { props: { pane: { ...pane, status: 'blocked', prompt: { question: 'Apply these changes?', cursor: 0, options: [{ label: 'Approve', hint: null }, { label: 'Deny', hint: null }] } } } })
  try {
    expect(w.get('.home-task-line').text()).toBe('Fix session reconnect')
    expect(w.get('.card-preview').text()).toBe('Apply these changes?')
    expect(w.findAll('.card-choices button').map(b => b.text())).toEqual(['1Approve', '2Deny'])
  } finally { w.unmount() }
})

it('does not present one pane topic as the topic of a multi-pane space', async () => {
  state([pane, { ...pane, id: 'w1:p2', title: 'Add export filters' }])
  const row = spaceRows(herdrState.value)[0]!
  const w = await mountSuspended(AgentCard, { props: { pane, row } })
  try {
    expect(w.get('.card-title').text()).toBe('Shared space')
    expect(w.get('.home-task-line').text()).toBe(pane.preview)
  } finally { w.unmount() }
})

it('leaves Board task titles and activity unchanged', async () => {
  state()
  const board = { name: 'Board task', msg: 'Waiting for review', group: 'working' } as BoardCard
  const w = await mountSuspended(AgentCard, { props: { pane, board } })
  try {
    expect(w.get('.card-title').text()).toBe('Board task')
    expect(w.get('.home-task-line').text()).toBe('Waiting for review')
  } finally { w.unmount() }
})

it('leaves terminal previews unchanged', async () => {
  state()
  const w = await mountSuspended(AgentCard, { props: { pane: { ...pane, agent: null, status: null } } })
  try { expect(w.get('.home-task-line').text()).toBe(pane.preview) } finally { w.unmount() }
})
