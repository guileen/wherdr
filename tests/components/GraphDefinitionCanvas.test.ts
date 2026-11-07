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

  it('creates a program task using a registered executor, never a browser-supplied command', async () => {
    const wrapper = await mountSuspended(GraphDefinitionCanvas, { props: { content: markdown, disabled: false } })
    const field = (label: string) => wrapper.findAll('label').find(item => item.text().trim().startsWith(label))!
    try {
      await button(wrapper, 'Add node').trigger('click')
      await field('Node ID').find('input').setValue('render')
      await field('Kind').find('select').setValue('program')
      await field('Task heading').find('input').setValue('review-task')
      await wrapper.find('form').trigger('submit')
      expect(wrapper.emitted('update:content')).toBeUndefined()
      await field('Registered executor').find('input').setValue('video-renderer')
      await wrapper.find('form').trigger('submit')
      const updated = wrapper.emitted('update:content')![0]![0] as string
      expect(parse(updated.split('---')[1]!).nodes.render).toEqual({ kind: 'program', executor: 'video-renderer', task: '#review-task' })
    } finally { wrapper.unmount() }
  })

  it('edits an imported queue task without losing its parameters, outputs or extensions', async () => {
    const source = markdown.replace('edges: []', "  video: {kind: queue, executor: video, task: '#review-task', parameters: {quality: high}, outputs: {clip: {media_type: video/mp4, required: true}}, extensions: {x-label: Clip}}\nedges: []")
    const wrapper = await mountSuspended(GraphDefinitionCanvas, { props: { content: source, disabled: false } })
    const field = (label: string) => wrapper.findAll('label').find(item => item.text().trim().startsWith(label))!
    try {
      await button(wrapper, 'videoqueue').trigger('click')
      await button(wrapper, 'Edit node').trigger('click')
      await field('Registered executor').find('input').setValue('video-v2')
      await field('Task heading').find('input').setValue('consult')
      await wrapper.find('form').trigger('submit')
      const updated = wrapper.emitted('update:content')![0]![0] as string
      expect(parse(updated.split('---')[1]!).nodes.video).toEqual({
        kind: 'queue', executor: 'video-v2', task: '#consult', parameters: { quality: 'high' },
        outputs: { clip: { media_type: 'video/mp4', required: true } }, extensions: { 'x-label': 'Clip' },
      })
      expect(updated.slice(updated.indexOf('\n## author-role'))).toBe(source.slice(source.indexOf('\n## author-role')))
    } finally { wrapper.unmount() }
  })

  it('requires bounded child policy and a member when creating a subgraph task', async () => {
    const wrapper = await mountSuspended(GraphDefinitionCanvas, { props: { content: markdown, disabled: false } })
    const field = (label: string) => wrapper.findAll('label').find(item => item.text().trim().startsWith(label))!
    try {
      await button(wrapper, 'Add node').trigger('click')
      await field('Node ID').find('input').setValue('implementation')
      await field('Kind').find('select').setValue('subgraph')
      await field('Member').find('select').setValue('author')
      await field('Task heading').find('input').setValue('review-task')
      await field('Allowed child kinds').find('select').setValue(['bot', 'program'])
      await field('Maximum child nodes').find('input').setValue('0')
      await wrapper.find('form').trigger('submit')
      expect(wrapper.emitted('update:content')).toBeUndefined()
      await field('Maximum child nodes').find('input').setValue('3')
      await field('Maximum parallel children').find('input').setValue('2')
      await wrapper.find('form').trigger('submit')
      const updated = wrapper.emitted('update:content')![0]![0] as string
      expect(parse(updated.split('---')[1]!).nodes.implementation).toEqual({
        kind: 'subgraph', member: 'author', task: '#review-task',
        child_policy: { kinds: ['bot', 'program'], max_nodes: 3, max_parallel: 2 },
      })
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

  it.each(['review', 'copy'])('edits %s without changing the other aliased node', async (id) => {
    const source = markdown.replace("  review: {kind: human, task: '#review-task', outcomes: [hold]}", "  review: &review {kind: human, task: '#review-task', outcomes: [hold]}\n  copy: *review")
    const wrapper = await mountSuspended(GraphDefinitionCanvas, { props: { content: source, disabled: false } })
    try {
      await button(wrapper, `${id}human`).trigger('click')
      await button(wrapper, 'Edit node').trigger('click')
      await wrapper.findAll('input')[1]!.setValue('consult')
      await wrapper.find('form').trigger('submit')
      const changed = wrapper.emitted('update:content')?.[0]?.[0] as string | undefined
      expect(changed).toBeDefined()
      const graph = parse(changed!.split('---')[1]!)
      expect(graph.nodes[id]).toEqual({ kind: 'human', task: '#consult', outcomes: ['hold'] })
      expect(graph.nodes[id === 'review' ? 'copy' : 'review']).toEqual({ kind: 'human', task: '#review-task', outcomes: ['hold'] })
      expect(changed!.slice(changed!.indexOf('\n##'))).toBe(source.slice(source.indexOf('\n##')))
    } finally { wrapper.unmount() }
  })

  it('changes nested member permissions without granting them to another member', async () => {
    const source = markdown.replace('permissions: {read: [], write: [], execute: []}', 'permissions: &permissions {read: [], write: [], execute: []}')
      .replace('nodes:', "  reviewer: {role: '#author-role', model: model, base: isolated, duty: general, permissions: *permissions}\nnodes:")
    const wrapper = await mountSuspended(GraphDefinitionCanvas, { props: { content: source, disabled: false } })
    try {
      await button(wrapper, 'Edit member').trigger('click')
      const field = wrapper.findAll('label').find(item => item.text().startsWith('Write permissions'))!
      await field.find('textarea').setValue('workspace')
      await wrapper.find('form').trigger('submit')
      const graph = parse((wrapper.emitted('update:content')![0]![0] as string).split('---')[1]!)
      expect(graph.members.author.permissions.write).toEqual(['workspace'])
      expect(graph.members.reviewer.permissions).toEqual({ read: [], write: [], execute: [] })
    } finally { wrapper.unmount() }
  })

  it('edits aliased member permissions instead of rejecting the valid draft', async () => {
    const source = markdown.replace('permissions: {read: [], write: [], execute: []}', 'permissions: &permissions {read: [], write: [], execute: []}')
      .replace('nodes:', "  reviewer: {role: '#author-role', model: model, base: isolated, duty: general, permissions: *permissions}\nnodes:")
    const wrapper = await mountSuspended(GraphDefinitionCanvas, { props: { content: source, disabled: false } })
    try {
      await wrapper.findAll('button').filter(item => item.text() === 'Edit member')[1]!.trigger('click')
      await wrapper.findAll('label').find(item => item.text().startsWith('Read permissions'))!.find('textarea').setValue('artifacts')
      await wrapper.find('form').trigger('submit')
      const changed = wrapper.emitted('update:content')?.[0]?.[0] as string | undefined
      expect(changed).toBeDefined()
      const graph = parse(changed!.split('---')[1]!)
      expect(graph.members.reviewer.permissions.read).toEqual(['artifacts'])
      expect(graph.members.author.permissions.read).toEqual([])
    } finally { wrapper.unmount() }
  })

  it('edits an aliased edge without changing its extension template', async () => {
    const source = markdown.replace('edges: []', 'x-route: &route {id: route, from: review, to: review, bind: {input: output}}\nedges:\n  - *route')
    const wrapper = await mountSuspended(GraphDefinitionCanvas, { props: { content: source, disabled: false } })
    try {
      await button(wrapper, 'Edit edge').trigger('click')
      await wrapper.findAll('label').find(item => item.text().startsWith('Edge ID'))!.find('input').setValue('copy')
      await wrapper.findAll('label').find(item => item.text().startsWith('Source outcomes'))!.find('textarea').setValue('hold')
      await wrapper.find('form').trigger('submit')
      const changed = wrapper.emitted('update:content')?.[0]?.[0] as string | undefined
      expect(changed).toBeDefined()
      const graph = parse(changed!.split('---')[1]!)
      expect(graph.edges).toEqual([{ id: 'copy', from: 'review', to: 'review', bind: { input: 'output' }, on: ['hold'] }])
      expect(graph['x-route']).toEqual({ id: 'route', from: 'review', to: 'review', bind: { input: 'output' } })
    } finally { wrapper.unmount() }
  })

  it('removes an anchor owner without invalidating the preserved member alias', async () => {
    const source = markdown.replace("  author: {", "  author: &author {")
      .replace('nodes:', '  reviewer: *author\nnodes:')
    const wrapper = await mountSuspended(GraphDefinitionCanvas, { props: { content: source, disabled: false } })
    try {
      await button(wrapper, 'Remove member').trigger('click')
      const changed = wrapper.emitted('update:content')?.[0]?.[0] as string | undefined
      expect(changed).toBeDefined()
      const graph = parse(changed!.split('---')[1]!)
      expect(graph.members.author).toBeUndefined()
      expect(graph.members.reviewer).toEqual(parse(source.split('---')[1]!).members.reviewer)
      expect(graph.communications).toEqual([{ from: 'author', to: 'author', when: '#consult' }])
    } finally { wrapper.unmount() }
  })

  it('rejects recursive aliases without emitting a partly edited draft', async () => {
    const source = markdown.replace('nodes:', 'x-cycle: &cycle [*cycle]\nnodes:')
    const wrapper = await mountSuspended(GraphDefinitionCanvas, { props: { content: source, disabled: false } })
    try {
      await button(wrapper, 'reviewhuman').trigger('click')
      await button(wrapper, 'Edit node').trigger('click')
      await wrapper.findAll('input')[1]!.setValue('consult')
      await wrapper.find('form').trigger('submit')
      expect(wrapper.text()).toContain('Recursive Graph aliases cannot be edited on the canvas.')
      expect(wrapper.emitted('update:content')).toBeUndefined()
    } finally { wrapper.unmount() }
  })
})
