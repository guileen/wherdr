import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import GraphDefinitionCanvas from '~/components/bots/GraphDefinitionCanvas.vue'

const markdown = `---
format: omp.graph/v1
name: example
members:
  author: {role: '#author-role', model: model, base: isolated, duty: general, permissions: {read: [], write: [], execute: []}}
nodes:
  review: {kind: human, task: '#review-task', outcomes: [hold]}
edges: []
communications:
  - {from: author, to: author, when: '#consult'}
---

## author-role
Author.

## review-task
Review.

## consult
Consult.
`

const button = (wrapper: VueWrapper, label: string) => wrapper.findAll('button').find(item => item.text() === label)!

describe('Graph definition canvas', () => {
  it('adds a node to the draft without changing existing definition fields or conflating communication with edges', async () => {
    const wrapper = await mountSuspended(GraphDefinitionCanvas, { props: { content: markdown, disabled: false } })
    try {
      expect(wrapper.text()).toContain('author ⇢ author')
      expect(wrapper.text()).toContain('No orchestration edges.')
      await button(wrapper, 'Add node').trigger('click')
      const inputs = wrapper.findAll('input')
      await inputs[0]!.setValue('write')
      await wrapper.findAll('select')[1]!.setValue('author')
      await inputs[1]!.setValue('write-task')
      await wrapper.find('textarea').setValue('Write the draft.')
      await wrapper.find('form').trigger('submit')
      const updated = wrapper.emitted('update:content')![0]![0] as string
      const frontmatter = updated.split('---')[1]!
      const graph = parse(frontmatter)
      expect(graph.nodes.write).toEqual({ kind: 'bot', member: 'author', task: '#write-task' })
      expect(graph.nodes.review.outcomes).toEqual(['hold'])
      expect(graph.edges).toEqual([])
      expect(graph.communications[0].from).toBe('author')
      expect(updated).toContain('## write-task\nWrite the draft.')
    } finally { wrapper.unmount() }
  })

  it('edits a node without discarding other fields and returns to the overview', async () => {
    const wrapper = await mountSuspended(GraphDefinitionCanvas, { props: { content: markdown, disabled: false } })
    try {
      await button(wrapper, 'reviewhuman').trigger('click')
      await button(wrapper, 'Edit node').trigger('click')
      await wrapper.findAll('input')[1]!.setValue('consult')
      await wrapper.find('form').trigger('submit')
      const updated = wrapper.emitted('update:content')![0]![0] as string
      expect(parse(updated.split('---')[1]!).nodes.review).toEqual({ kind: 'human', task: '#consult', outcomes: ['hold'] })
      await wrapper.setProps({ content: updated })
      await button(wrapper, 'Back to overview').trigger('click')
      expect(wrapper.findAll('button').some(item => item.text() === 'Add node')).toBe(true)
      expect(wrapper.text()).toContain('author ⇢ author')
    } finally { wrapper.unmount() }
  })

  it('creates a heading even when the same text appears inside a code fence', async () => {
    const wrapper = await mountSuspended(GraphDefinitionCanvas, { props: { content: `${markdown}\n\`\`\`md\n## new-task\n\`\`\`\n`, disabled: false } })
    try {
      await button(wrapper, 'Add node').trigger('click')
      await wrapper.findAll('input')[0]!.setValue('draft')
      await wrapper.findAll('select')[0]!.setValue('human')
      await wrapper.findAll('input')[1]!.setValue('new-task')
      await wrapper.find('textarea').setValue('Write a draft.')
      await wrapper.find('form').trigger('submit')
      const updated = wrapper.emitted('update:content')![0]![0] as string
      expect(updated).toContain('## new-task\nWrite a draft.')
    } finally { wrapper.unmount() }
  })

  it('does not apply a new task without text and disables mutation while the source is busy', async () => {
    const wrapper = await mountSuspended(GraphDefinitionCanvas, { props: { content: markdown, disabled: false } })
    try {
      await button(wrapper, 'Add node').trigger('click')
      await wrapper.findAll('input')[0]!.setValue('human-task')
      await wrapper.findAll('select')[0]!.setValue('human')
      await wrapper.findAll('input')[1]!.setValue('new-task')
      await wrapper.find('form').trigger('submit')
      expect(wrapper.text()).toContain('Provide task text for the new heading.')
      expect(wrapper.emitted('update:content')).toBeUndefined()
      await wrapper.setProps({ disabled: true })
      expect(button(wrapper, 'Apply to draft').attributes('disabled')).toBeDefined()
    } finally { wrapper.unmount() }
  })
  it('authors members, orchestration and communication as separate draft edits', async () => {
    const source = markdown.replace("  review: {kind: human, task: '#review-task', outcomes: [hold]}", "  review: {kind: human, task: '#review-task', outcomes: [hold]}\n  next: {kind: human, task: '#review-task'}")
    const wrapper = await mountSuspended(GraphDefinitionCanvas, { props: { content: source, disabled: false } })
    const field = (label: string) => wrapper.findAll('label').find(item => item.text().trim().startsWith(label))!
    const updated = async () => {
      const events = wrapper.emitted('update:content')!
      const content = events[events.length - 1]![0] as string
      await wrapper.setProps({ content })
      return content
    }
    try {
      await button(wrapper, 'Add member').trigger('click')
      await field('Member ID').find('input').setValue('reviewer')
      await field('Model binding').find('input').setValue('review-model')
      await field('Role heading').find('input').setValue('reviewer-role')
      await field('New heading text').find('textarea').setValue('Review independently.')
      await field('Read permissions').find('textarea').setValue('artifacts')
      await wrapper.find('form').trigger('submit')
      let content = await updated()
      expect(parse(content.split('---')[1]!).members.reviewer).toEqual({ role: '#reviewer-role', model: 'review-model', base: 'isolated', duty: 'general', permissions: { read: ['artifacts'], write: [], execute: [] } })
      expect(content).toContain('## reviewer-role\nReview independently.')

      await button(wrapper, 'Add edge').trigger('click')
      await field('Edge ID').find('input').setValue('review-next')
      await field('From').find('select').setValue('review')
      await field('To').find('select').setValue('next')
      await field('Source outcomes').find('textarea').setValue('hold')
      await wrapper.find('form').trigger('submit')
      content = await updated()
      expect(parse(content.split('---')[1]!).edges).toEqual([{ id: 'review-next', from: 'review', to: 'next', on: ['hold'] }])

      await button(wrapper, 'Add permission').trigger('click')
      await field('From').find('select').setValue('author')
      await field('To').find('select').setValue('reviewer')
      await field('When heading').find('input').setValue('consult')
      await field('Shareable artifact').find('textarea').setValue('draft')
      await wrapper.find('form').trigger('submit')
      content = await updated()
      const graph = parse(content.split('---')[1]!)
      expect(graph.edges).toHaveLength(1)
      expect(graph.communications[1]).toEqual({ from: 'author', to: 'reviewer', when: '#consult', artifacts: ['draft'] })
      expect(wrapper.text()).toContain('author ⇢ reviewer')
    } finally { wrapper.unmount() }
  })

  it('preserves unedited fields, removes no references, and blocks mutations when disabled', async () => {
    const source = markdown.replace('edges: []', 'edges:\n  - {id: route, from: review, to: review, bind: {input: output}, branch_group: choice}')
    const wrapper = await mountSuspended(GraphDefinitionCanvas, { props: { content: source, disabled: false } })
    try {
      await button(wrapper, 'Edit edge').trigger('click')
      const outcome = wrapper.findAll('label').find(item => item.text().includes('Source outcomes'))!
      await outcome.find('textarea').setValue('hold')
      await wrapper.find('form').trigger('submit')
      const changed = wrapper.emitted('update:content')![0]![0] as string
      expect(parse(changed.split('---')[1]!).edges[0]).toEqual({ id: 'route', from: 'review', to: 'review', on: ['hold'], bind: { input: 'output' }, branch_group: 'choice' })
      await wrapper.setProps({ content: changed })
      await button(wrapper, 'Remove member').trigger('click')
      const removed = wrapper.emitted('update:content')![1]![0] as string
      const graph = parse(removed.split('---')[1]!)
      expect(graph.members).toEqual({})
      expect(graph.communications[0].from).toBe('author')
      await wrapper.setProps({ disabled: true })
      expect(button(wrapper, 'Add member').attributes('disabled')).toBeDefined()
      expect(button(wrapper, 'Add edge').attributes('disabled')).toBeDefined()
      expect(button(wrapper, 'Add permission').attributes('disabled')).toBeDefined()
    } finally { wrapper.unmount() }
  })
  it('disables relation editing for malformed member and relation fields', async () => {
    const source = markdown.replace("role: '#author-role'", 'role: {invalid: true}')
    const wrapper = await mountSuspended(GraphDefinitionCanvas, { props: { content: source, disabled: false } })
    try {
      expect(wrapper.text()).toContain('Members or relations cannot be edited on the canvas.')
      expect(wrapper.findAll('button').some(item => item.text() === 'Add member')).toBe(false)
      await wrapper.setProps({ content: markdown.replace("when: '#consult'", 'when: [invalid]') })
      expect(wrapper.text()).toContain('Members or relations cannot be edited on the canvas.')
      expect(wrapper.findAll('button').some(item => item.text() === 'Edit permission')).toBe(false)
    } finally { wrapper.unmount() }
  })
})
