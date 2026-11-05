import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import BotQuestionForm from '~/components/bots/BotQuestionForm.vue'
import { createSampleWorkspace } from '~/utils/bots/sample'
import { decodeBotDetail } from '~/utils/bots/workspace'

const sample = createSampleWorkspace()
const question = decodeBotDetail(sample.detail(sample.snapshot.bots[1]!.jobs[0]!, 'inspect', 'sample-question')).question!
describe('Bot typed question form', () => {
  it('shows distinct single, multiple and text inputs and never submits a partial answer', async () => {
    const wrapper = await mountSuspended(BotQuestionForm, { props: { question, answers: {}, disabled: false } })
    expect(wrapper.findAll('input[type=radio]')).toHaveLength(2)
    expect(wrapper.findAll('input[type=checkbox]')).toHaveLength(3)
    expect(wrapper.findAll('textarea')).toHaveLength(1)
    expect(wrapper.get('button[type=submit]').attributes('disabled')).toBeDefined()
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('submit')).toBeUndefined()
    await wrapper.get('input[type=radio]').setValue(true)
    expect(wrapper.emitted('update:answers')?.at(-1)).toEqual([{ audience: 'newcomers' }])
    await wrapper.setProps({ answers: { audience: 'newcomers', checks: ['clarity'], note: 'Keep it practical' } })
    expect(wrapper.get('button[type=submit]').attributes('disabled')).toBeUndefined()
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('submit')).toHaveLength(1)
    wrapper.unmount()
  })
  it('allows an explicit select-none answer without confusing it with an unanswered field', async () => {
    const wrapper = await mountSuspended(BotQuestionForm, { props: { question, answers: { audience: 'newcomers', note: 'Keep it practical' }, disabled: false } })
    expect(wrapper.get('button[type=submit]').attributes('disabled')).toBeDefined()
    await wrapper.get('.select-none').trigger('click')
    const next = wrapper.emitted('update:answers')!.at(-1)![0] as Record<string, string | string[]>
    expect(next.checks).toEqual([])
    await wrapper.setProps({ answers: next })
    expect(wrapper.get('button[type=submit]').attributes('disabled')).toBeUndefined()
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('submit')).toHaveLength(1)
    wrapper.unmount()
  })
  it('disables every answer field when the source becomes unready without dropping the draft', async () => {
    const answers = { audience: 'newcomers', checks: ['clarity'], note: 'A retained draft' }
    const wrapper = await mountSuspended(BotQuestionForm, { props: { question, answers, disabled: false } })
    await wrapper.setProps({ disabled: true })
    expect(wrapper.findAll('fieldset').every(field => field.attributes('disabled') !== undefined)).toBe(true)
    expect(wrapper.get('button[type=submit]').attributes('disabled')).toBeDefined()
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('A retained draft')
    wrapper.unmount()
  })
})
