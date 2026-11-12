import { expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { Pane } from '../../shared/types'
import OmpContext from '~/components/OmpContext.vue'

it('keeps context details behind the text control, distinguishes retained readings and hides unknown usage', async () => {
  const pane = { id: 'context-test', agent: 'omp', status: 'working', ompStatus: { line: 'Test model · project', meters: '◫ 68%/200K · 7d 71%', metersFresh: true, breakdown: { nonMessage: 30_000, tools: 10_000 } } } as Pane
  const wrapper = await mountSuspended(OmpContext, { props: { pane }, attachTo: document.body })
  try {
    expect(wrapper.get('button').text()).toBe('136K')
    expect(document.querySelector('.omp-context-detail')).toBeNull()
    await wrapper.get('button').trigger('click')
    expect(document.querySelector('.omp-context-detail')?.textContent).toContain('Test model · project')
    expect(document.querySelector('.omp-context-detail')?.textContent).toContain('7d 71%')
    expect(document.querySelector('.omp-context-detail')?.textContent).toContain('System20K · 10%')
    expect(document.querySelector('.omp-context-detail')?.textContent).toContain('Tools10K · 5%')
    expect(document.querySelector('.omp-context-detail')?.textContent).toContain('Messages106K · 53%')
    expect(document.querySelector('.omp-context-detail')?.textContent).toContain('Free64K · 32%')
    expect(wrapper.get('button').attributes('aria-label')).not.toContain('Last reading')
    await wrapper.setProps({ pane: { ...pane, ompStatus: { ...pane.ompStatus!, metersFresh: false } } })
    expect(wrapper.get('button').attributes('aria-label')).toContain('Last reading; not live')
    await wrapper.setProps({ pane: { ...pane, status: 'idle' } })
    expect(wrapper.get('button').attributes('aria-label')).toContain('Last reading; not live')
    await wrapper.setProps({ pane: { ...pane, ompStatus: { line: 'Test model', meters: '◫ 51.7%/1M', metersFresh: true, breakdown: { nonMessage: 30_000, tools: 10_000 } } } })
    expect(wrapper.get('button').text()).toBe('517K')
    await wrapper.setProps({ variant: 'progress' })
    expect(wrapper.find('button').exists()).toBe(false)
    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('51.7')
    expect(wrapper.get('[role="progressbar"]').text()).toBe('')
    expect(wrapper.get('[role="progressbar"]').attributes('style')).toBeUndefined()
    const segments = wrapper.findAll('[role="progressbar"] > i')
    expect(segments.map(s => s.classes()[0])).toEqual(['seg-system', 'seg-tools', 'seg-messages'])
    expect(segments.map(s => s.attributes('style'))).toEqual(['flex-grow: 20000;', 'flex-grow: 10000;', 'flex-grow: 487000;'])
    await wrapper.setProps({ pane: { ...pane, ompStatus: { line: 'Test model', meters: '▶──200K─120%◀', metersFresh: true } } })
    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('100')
    expect(wrapper.get('[role="progressbar"]').attributes('aria-label')).toContain('120%')
    expect(wrapper.findAll('[role="progressbar"] > i').map(s => s.classes()[0])).toEqual(['seg-messages'])
    await wrapper.setProps({ variant: undefined })
    expect(wrapper.get('button').text()).toBe('240K')
    await wrapper.setProps({ variant: 'text' })
    expect(wrapper.text()).toBe('·240K')
    expect(wrapper.find('button').exists()).toBe(false)
    await wrapper.setProps({ variant: 'details' })
    expect(wrapper.get('[role="status"]').text()).toContain('120%')
    expect(wrapper.get('[role="status"]').text()).toContain('▶──200K─120%◀')
    await wrapper.setProps({ pane: { ...pane, ompStatus: undefined } })
    expect(wrapper.find('button').exists()).toBe(false)
    await wrapper.setProps({ variant: 'progress' })
    expect(wrapper.find('[role="progressbar"]').exists()).toBe(false)
  } finally { wrapper.unmount() }
})

it('animates only while working, including a retained context reading', async () => {
  const pane = { id: 'context-test', agent: 'omp', status: 'working', ompStatus: { meters: '◫ 68%/200K', metersFresh: false } } as Pane
  const wrapper = await mountSuspended(OmpContext, { props: { pane, variant: 'progress' } })
  try {
    expect(wrapper.get('[role="progressbar"]').classes()).toContain('working')
    await wrapper.setProps({ pane: { ...pane, status: 'idle' } })
    expect(wrapper.get('[role="progressbar"]').classes()).not.toContain('working')
  } finally { wrapper.unmount() }
})
