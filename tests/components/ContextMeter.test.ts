import { expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ContextMeter from '~/components/ContextMeter.vue'

const parts = { system: 30, tools: 20, memory: 0, daynotes: 0, work: 50, free: 900 }
const context = { pct: 10, total: 1_000, estimated: 100 }
const segments = [
  { key: 'system', tone: 'system' as const, tokens: 30 },
  { key: 'tools', tone: 'tools' as const, tokens: 20 },
  { key: 'i0', tone: 'work' as const, tokens: 50 },
]

it('opens the detail from a tap on any segment of the sheet bar', async () => {
  const w = await mountSuspended(ContextMeter, { props: { context, parts, segments } })
  // The segments used to swallow the tap (click.stop with a no-op handler),
  // so only the hairline gaps opened the page.
  await w.get('.cm-bar > button').trigger('click')
  expect(w.emitted('open')).toHaveLength(1)
  expect(w.find('.cm-rows').exists()).toBe(false)
  // The sheet keeps the free tail so the bar spans the window.
  expect(w.findAll('.cm-bar > button')).toHaveLength(4)
  expect(w.get('.cm-head').text()).toContain('free 900')
})

it('keeps the rows on the page and routes a row tap to its layer', async () => {
  const w = await mountSuspended(ContextMeter, { props: { variant: 'page', context, parts, segments } })
  expect(w.find('.cm-rows').exists()).toBe(true)
  // The Loaded context page is about the request: no free tail, no free label.
  expect(w.findAll('.cm-bar > button')).toHaveLength(3)
  expect(w.get('.cm-head').text()).not.toContain('free')
  await w.get('.cm-rows .cm-row').trigger('click')
  expect(w.emitted('pick')?.[0]).toEqual(['system'])
})
