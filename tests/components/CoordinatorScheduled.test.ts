import { expect, it, vi } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import CoordinatorScheduled from '~/components/CoordinatorScheduled.vue'
import type { Pane } from '#shared/types'

let reads = 0
let goal = ''
registerEndpoint('/api/tasks/scheduled', () => {
  reads++
  return { autopilot: goal ? { on: true, goal } : null, automations: [], timers: [], timezone: 'UTC', warnings: [] }
})
registerEndpoint('/api/omp-loop', { method: 'GET', handler: () => ({ state: 'active', session: 'loop-session' }) })

it('loads only on disclosure, displays the empty state and refreshes with the board', async () => {
  reads = 0
  const w = await mountSuspended(CoordinatorScheduled, { props: { machine: '', target: { kind: 'main' }, refreshKey: 0 } })
  expect(reads).toBe(0)
  const details = w.get('details')
  details.element.open = true
  await details.trigger('toggle')
  await vi.waitFor(() => expect(w.text()).toContain('Nothing scheduled'))
  expect(reads).toBe(1)
  await w.setProps({ refreshKey: 1 })
  await vi.waitFor(() => expect(reads).toBe(2))
  details.element.open = false
  await details.trigger('toggle')
  await w.setProps({ refreshKey: 2 })
  expect(reads).toBe(2)
  w.unmount()
})

it('rereads on reopening without waiting for a board refresh', async () => {
  reads = 0
  goal = 'Keep the build green'
  const w = await mountSuspended(CoordinatorScheduled, { props: { machine: '', target: { kind: 'main' } } })
  const details = w.get('details')
  details.element.open = true
  await details.trigger('toggle')
  await vi.waitFor(() => expect(w.text()).toContain(goal))
  const before = reads
  details.element.open = false
  await details.trigger('toggle')
  goal = ''
  details.element.open = true
  await details.trigger('toggle')
  await vi.waitFor(() => expect(w.text()).toContain('Nothing scheduled'))
  expect(reads).toBeGreaterThan(before)
  expect(w.text()).not.toContain('Keep the build green')
  w.unmount()
})

it('shows a resolved omp coordinator loop in Scheduled and removes it when the pane is lost', async () => {
  const pane: Pane = { id: 'coord:p1', workspace: 'w1', tab: 'w1:t1', tabLabel: null, agent: 'omp', name: null, label: null, status: 'idle', title: null, cwd: '/tmp', agentSession: 'loop-session' }
  const w = await mountSuspended(CoordinatorScheduled, { props: { machine: '', target: { kind: 'main' }, pane } })
  try {
    const details = w.get('details')
    details.element.open = true
    await details.trigger('toggle')
    await vi.waitFor(() => expect(w.text()).toContain('Loop active'))
    expect(w.text()).not.toContain('Nothing scheduled')
    await w.setProps({ pane: null })
    await vi.waitFor(() => expect(w.text()).toContain('Nothing scheduled'))
    expect(w.text()).not.toContain('Loop active')
  } finally { w.unmount() }
})
