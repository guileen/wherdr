import { afterEach, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import AgentCard from '~/components/AgentCard.vue'
import { providerImages } from '~/utils/providerIcons'
import { compactList, herdrState } from '~/composables/useHerdr'
import type { Pane } from '#shared/types'
import type { BoardCard } from '#shared/boardLinks'

const pane: Pane = { id: 'w1:p1', workspace: 'w1', tab: 'w1:t1', tabLabel: null, agent: 'omp', name: null, label: null, status: 'idle', title: 'Fix the flaky export', cwd: '/tmp/demo', agentSession: null, model: { id: 'deepseek/deepseek-flash', label: 'DeepSeek V4 Flash' } }
const workspace = { id: 'w1', label: 'Shared space', number: 1, status: null, worktree: false }
afterEach(() => {
  compactList.value = false
  herdrState.value = { ok: false, panes: [], workspaces: [] }
})
async function mount(p: Pane, board?: BoardCard) {
  herdrState.value = { ok: true, panes: [p], workspaces: [workspace] }
  return mountSuspended(AgentCard, { props: { pane: p, board } })
}

it('leads with the model provider and keeps the agent inline with the space title', async () => {
  const w = await mount(pane)
  try {
    const avatar = w.get('.card > .avatar.provider-avatar')
    expect(avatar.classes()).toEqual(expect.arrayContaining(['deepseek', 'omp']))
    expect(avatar.find('img').attributes('src')).toBe(providerImages.deepseek)
    const agent = w.get('.card > .card-agent')
    expect(agent.classes()).toContain('omp')
    // Provider mark, then the inline agent, then the title, all on one line.
    expect(avatar.element.nextElementSibling?.className).toContain('card-agent')
    expect(w.find('.card-model').exists()).toBe(false)
    expect(w.get('.card-title').text()).toBe('Shared space')
  } finally { w.unmount() }
})

it('names GPT 6.1 Sol before the title, after the inline agent', async () => {
  const sol = { ...pane, model: { id: 'openai-codex/gpt-6.1-sol', label: 'GPT 6.1 Sol' } }
  const w = await mount(sol)
  try {
    expect(w.get('.card > .avatar.provider-avatar').classes()).toContain('openai-codex')
    const chip = w.get('.card-model')
    expect(chip.text()).toBe('Sol')
    expect(w.get('.card-agent').element.nextElementSibling?.className).toContain('card-model')
    expect(chip.element.nextElementSibling?.className).toContain('card-title')
  } finally { w.unmount() }
})

it('names an expert model and keeps both identities', async () => {
  const opus = { ...pane, model: { id: 'anthropic/claude-opus-5-5', label: 'Opus 5.5' } }
  const w = await mount(opus)
  try {
    expect(w.get('.card > .avatar.provider-avatar').classes()).toContain('anthropic')
    expect(w.get('.card-agent.omp').exists()).toBe(true)
    expect(w.get('.card-model').text()).toBe('Opus')
  } finally { w.unmount() }
})

it.each([
  ['openai-codex/gpt-6-astra', 'GPT 6 Astra', 'Astra'],
  ['google-antigravity/gemini-4-argon', 'Gemini 4 Argon', 'Argon'],
])('uses the short name for %s', async (id, label, name) => {
  const w = await mount({ ...pane, model: { id, label } })
  try {
    expect(w.get('.card-model').text()).toBe(name)
    expect(w.get('.card-model').attributes('title')).toBe(label)
  } finally { w.unmount() }
})

it('does not double an agent logo that is also the provider logo', async () => {
  const sonnet = await mount({ ...pane, agent: 'claude', model: { id: 'claude-sonnet-4-5', label: 'Sonnet 4.5' } })
  try {
    const avatar = sonnet.get('.card > .avatar.provider-avatar')
    expect(avatar.classes()).toEqual(expect.arrayContaining(['anthropic', 'claude']))
    expect(sonnet.find('.card-agent').exists()).toBe(false)
    expect(sonnet.find('.card-model').exists()).toBe(false)
  } finally { sonnet.unmount() }
  const expert = await mount({ ...pane, agent: 'claude', model: { id: 'claude-opus-5-5', label: 'Opus 5.5' } })
  try {
    expect(expert.get('.card > .avatar.provider-avatar').classes()).toContain('anthropic')
    expect(expert.get('.card-model').text()).toBe('Opus')
  } finally { expert.unmount() }
})

it('keeps Board task rows to their tag and title', async () => {
  const board = { name: 'Board task', tag: 'SHOP-1', group: 'working' } as BoardCard
  const w = await mount(pane, board)
  try {
    expect(w.get('.card > .avatar.provider-avatar').classes()).toContain('deepseek')
    expect(w.find('.card-agent').exists()).toBe(false)
    expect(w.find('.card-model').exists()).toBe(false)
    expect(w.get('.card-title').text()).toBe('Board task')
  } finally { w.unmount() }
})

it('keeps a coordinator’s role mark and leaves a terminal without a provider', async () => {
  const coord = await mount(pane, { tag: '', coordinator: true } as BoardCard)
  try {
    expect(coord.find('.card > .avatar.provider-avatar').exists()).toBe(false)
    expect(coord.get('.card > .avatar').classes()).toContain('coord')
    expect(coord.find('.card-agent').exists()).toBe(false)
  } finally { coord.unmount() }
  const terminal = await mount({ ...pane, agent: null, model: undefined, title: null })
  try {
    expect(terminal.find('.avatar.provider-avatar').exists()).toBe(false)
    expect(terminal.find('.card-agent').exists()).toBe(false)
    expect(terminal.find('.card-model').exists()).toBe(false)
  } finally { terminal.unmount() }
})
