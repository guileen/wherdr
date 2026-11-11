import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import ChatView from '~/components/ChatView.vue'
import { lightboxSet, lightboxSrc } from '~/composables/useUi'
import { herdrState } from '~/composables/useHerdr'
import type { ChatItem, Pane } from '#shared/types'
import { parseLines } from '../../server/utils/transcripts'
import ompErrors from '../fixtures/omp-errors.jsonl?raw'

const pane: Pane = { id: 'w1:p1', workspace: 'w1', tab: 'w1:t1', tabLabel: null, agent: 'omp', name: null, label: null, status: 'blocked', title: null, cwd: '/tmp/demo', agentSession: null }
let items: ChatItem[] = []
let liveThinking: string | null = null
registerEndpoint('/api/chat', () => ({ available: true, token: 'rendering', file: '/tmp/demo/transcript.jsonl', items, liveThinking }))

describe('conversation rendering', () => {
  afterEach(() => { liveThinking = null; lightboxSrc.value = null; lightboxSet.value = []; herdrState.value = { ok: false, workspaces: [], panes: [] } })

  it('shows compaction while omp reports an idle pane, then clears it', async () => {
    items = []
    const compacting = { ...pane, status: 'idle' as const, ompActivity: { step: 'Compacting context... (⎋ to cancel)', since: null } }
    herdrState.value = { ok: true, workspaces: [], panes: [compacting] }
    const w = await mountSuspended(ChatView, { props: { pane: compacting, localQueued: [] } })
    try {
      expect(w.find('.chat-status').text()).toContain('Compacting context')
      await w.setProps({ pane: { ...compacting, ompActivity: undefined } })
      expect(w.find('.chat-status').exists()).toBe(false)
    } finally { w.unmount() }
  })

  it('attributes both wake formats to Autopilot and keeps their complete text and labelled copy action together', async () => {
    const wakes = ['Autopilot: Check ready work.\nBoard context: no pending replies.  ', 'Autopilot woke: Check older work.']
    const human = 'Please explain Autopilot: and Autopilot woke:.'
    items = [
      ...wakes.map((text): ChatItem => ({ role: 'user', text, ts: null })),
      { role: 'user', text: human, ts: null },
      { role: 'user', text: '> Autopilot: a quotation', ts: null },
      { role: 'assistant', text: 'Autopilot: an assistant reply', ts: null },
    ]
    const original = structuredClone(items)
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    herdrState.value = { ok: true, workspaces: [], panes: [pane] }
    const w = await mountSuspended(ChatView, { props: { pane, localQueued: [] } })
    try {
      await expect.poll(() => w.findAll('.msg-autopilot').length).toBe(2)
      for (const [i, block] of w.findAll('.msg-autopilot').entries()) {
        expect(block.find('.msg-system').text()).toBe('Autopilot')
        expect(block.find('.msg-fold').element.textContent).toBe(wakes[i])
        expect(block.find('.msg-user').exists()).toBe(false)
        const copy = block.find('.msg-autopilot-body button')
        expect(copy.exists()).toBe(true)
        expect(copy.attributes('aria-label')).toBe('Copy message')
        await copy.trigger('click')
        expect(writeText).toHaveBeenLastCalledWith(wakes[i])
      }
      expect(w.findAll('.msg-user')).toHaveLength(2)
      expect(w.find('.msg-user .msg-fold').element.textContent).toBe(human)
      expect(w.find('.msg-ai').text()).toContain('Autopilot: an assistant reply')
      expect(items).toEqual(original)
    } finally { w.unmount(); vi.unstubAllGlobals() }
  })

  it('copies a user message and every agent reply, including the last one', async () => {
    const idle = { ...pane, status: 'idle' as const }
    herdrState.value = { ok: true, workspaces: [], panes: [idle] }
    items = [
      { role: 'user', text: 'Clean the build folder.', ts: '2026-01-01T00:00:00Z' },
      { role: 'assistant', text: '**Removed** `build`.', ts: '2026-01-01T00:00:01Z' },
      { role: 'tool', name: 'Read', text: 'package.json', ts: '2026-01-01T00:00:02Z' },
      { role: 'assistant', text: 'Done.', ts: '2026-01-01T00:00:03Z' },
    ]
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    const w = await mountSuspended(ChatView, {
      props: { pane: idle, localQueued: [] },
      global: { stubs: { UTooltip: { template: '<slot />' } } },
    })
    try {
      await expect.poll(() => w.findAll('.msg-ai').length).toBe(2)
      const userCopy = w.get('.msg-user-wrap .msg-copy')
      expect(userCopy.attributes('aria-label')).toBe('Copy message')
      await userCopy.trigger('click')
      expect(writeText).toHaveBeenLastCalledWith('Clean the build folder.')
      const replyCopies = w.findAll('.msg-actions button[aria-label="Copy reply"]')
      expect(replyCopies).toHaveLength(2)
      await replyCopies[1]!.trigger('click')
      expect(writeText).toHaveBeenLastCalledWith('Done.')
      expect(w.find('.turn-copy').exists()).toBe(false)
    } finally { w.unmount(); vi.unstubAllGlobals() }
  })

  it('keeps an action awaiting approval live without a finished-turn line', async () => {
    herdrState.value = { ok: true, workspaces: [], panes: [pane] }
    items = [
      { role: 'user', text: 'Clean the build folder.', ts: '2026-01-01T00:00:00Z' },
      // Pending omp calls already carry their console view before any tool result.
      { role: 'tool', text: 'rm -rf build', name: 'Bash', ts: '2026-01-01T00:00:01Z', omp: { title: 'Bash', target: 'rm -rf build', intent: 'Removing the build folder' } },
    ]
    const w = await mountSuspended(ChatView, { props: { pane, localQueued: [] } })
    try {
      await expect.poll(() => w.find('.chat').text()).toContain('Clean the build folder.')
      const message = w.find('.msg-user .msg-fold')
      expect(message.element.textContent).toBe('Clean the build folder.')
      expect(message.isVisible()).toBe(true)
      const summary = w.get('.process-summary-button')
      expect(summary.attributes('aria-expanded')).toBe('false')
      expect(summary.text()).toContain('Removing the build folder')
      expect(summary.get('.process-summary-count').text()).toBe('1 action')
      expect(w.find('.omp-tool').exists()).toBe(false)
      await w.setProps({ pane: { ...pane, ompActivity: { step: 'Reading first file', since: null } } })
      expect(summary.text()).toContain('Reading first file')
      await w.setProps({ pane: { ...pane, ompActivity: { step: 'Reading second file', since: null } } })
      expect(w.findAll('.process-summary-button')).toHaveLength(1)
      expect(summary.text()).toContain('Reading second file')
      await summary.trigger('click')
      expect(w.find('.tools.omp-console.live').isVisible()).toBe(true)
      expect(w.find('.omp-console .omp-tool-cmd').text()).toBe('rm -rf build')
      expect(w.findAll('.turn-end')).toHaveLength(0)
    } finally { w.unmount() }
  })

  it('shows live activity in the process row only while the agent is working', async () => {
    items = [{ role: 'tool', name: 'Read', text: 'file.txt', ts: null }]
    const active = { ...pane, status: 'working' as const, ompActivity: { step: 'Reading file', since: null } }
    herdrState.value = { ok: true, workspaces: [], panes: [active] }
    const w = await mountSuspended(ChatView, { props: { pane: active, localQueued: [] } })
    try {
      await expect.poll(() => w.find('.process-summary-button').exists()).toBe(true)
      expect(w.find('.process-thinking').exists()).toBe(true)
      await w.setProps({ pane: { ...active, status: 'idle' } })
      expect(w.find('.process-thinking').exists()).toBe(false)
    } finally { w.unmount() }
  })

  it('shows streamed thinking and the active action together without moving the reply', async () => {
    items = [
      { role: 'assistant', text: 'I will inspect the source.', ts: null },
      { role: 'thinking', text: 'Earlier thought.', ts: null },
      { role: 'tool', name: 'Read', text: 'first.ts', ts: null },
    ]
    liveThinking = 'Compare the new results.'
    const active = { ...pane, status: 'working' as const, ompActivity: { step: 'Reading first.ts', since: null } }
    herdrState.value = { ok: true, workspaces: [], panes: [active] }
    const w = await mountSuspended(ChatView, { props: { pane: active, localQueued: [] } })
    try {
      await expect.poll(() => w.find('.process-live-thought').exists()).toBe(true)
      expect(w.get('.process-live-thought').text()).toContain('Compare the new results.')
      expect(w.get('.process-summary-button').text()).toContain('Reading first.ts')
      expect(w.get('.msg-ai').text()).toContain('I will inspect the source.')
      await w.get('.process-summary-button').trigger('click')
      expect(w.findAll('.process-live-thought')).toHaveLength(1)
      expect(w.get('.process-summary-end').text()).toContain('Reading first.ts')
      await w.setProps({ pane: { ...active, status: 'idle', ompActivity: undefined } })
      expect(w.find('.process-live-thought').exists()).toBe(false)
    } finally { w.unmount() }
  })

  it('keeps current activity and a collapse control after expanded actions', async () => {
    items = [
      { role: 'tool', name: 'Read', text: 'first.ts', ts: null },
      { role: 'tool', name: 'Read', text: 'second.ts', ts: null },
    ]
    const active = { ...pane, status: 'working' as const, ompActivity: { step: 'Reading second.ts', since: null } }
    herdrState.value = { ok: true, workspaces: [], panes: [active] }
    const w = await mountSuspended(ChatView, { props: { pane: active, localQueued: [] } })
    try {
      await expect.poll(() => w.find('.process-summary-button').exists()).toBe(true)
      await w.get('.process-summary-button').trigger('click')
      const footer = w.get('.process-summary-end')
      expect(footer.text()).toContain('Reading second.ts')
      expect(footer.find('.process-thinking').exists()).toBe(true)
      await w.setProps({ pane: { ...active, ompActivity: { step: 'Editing result.ts', since: null } } })
      expect(footer.text()).toContain('Editing result.ts')
      await footer.get('button').trigger('click')
      expect(w.find('.process-summary-end').exists()).toBe(false)
      expect(w.get('.process-summary-button').attributes('aria-expanded')).toBe('false')
      expect(w.get('.process-summary-button').text()).toContain('Editing result.ts')
    } finally { w.unmount() }
  })

  it('does not present a completed omp transcript item as current activity when the screen has no step', async () => {
    items = [
      { role: 'tool', name: 'Read', text: 'old.ts', ts: null, out: 'done' },
      { role: 'thinking', text: 'An earlier thought.', ts: null },
    ]
    const active = { ...pane, status: 'working' as const, ompActivity: { step: null, since: null } }
    herdrState.value = { ok: true, workspaces: [], panes: [active] }
    const w = await mountSuspended(ChatView, { props: { pane: active, localQueued: [] } })
    try {
      await expect.poll(() => w.find('.process-summary-button').exists()).toBe(true)
      const summary = w.get('.process-summary-button')
      expect(summary.text()).toContain('omp is working')
      expect(summary.text()).not.toContain('An earlier thought.')
      await w.setProps({ pane: { ...active, ompActivity: { step: 'Reading new.ts', since: null } } })
      expect(summary.text()).toContain('Reading new.ts')
      await w.setProps({ pane: active })
      expect(summary.text()).toContain('omp is working')
    } finally { w.unmount() }
  })

  it('counts the actions a folded process hides, live and finished', async () => {
    items = [
      { role: 'tool', name: 'Read', text: 'first.ts', ts: null },
      { role: 'thinking', text: 'One more pass.', ts: null },
      { role: 'tool', name: 'Read', text: 'second.ts', ts: null },
      { role: 'tool', name: 'Bash', text: 'npm test', ts: null },
    ]
    const active = { ...pane, status: 'working' as const, ompActivity: { step: 'Reading second.ts', since: null } }
    herdrState.value = { ok: true, workspaces: [], panes: [active] }
    const w = await mountSuspended(ChatView, { props: { pane: active, localQueued: [] } })
    try {
      await expect.poll(() => w.find('.process-summary-count').exists()).toBe(true)
      const row = w.get('.process-summary-button')
      expect(row.text()).toContain('Reading second.ts')
      // Thinking is not an action: three tool calls, one folded row.
      expect(row.get('.process-summary-count').text()).toBe('3 actions')
      await w.setProps({ pane: { ...active, status: 'idle', ompActivity: undefined } })
      expect(w.get('.process-summary-count').text()).toBe('3 actions')
      await w.get('.process-summary-button').trigger('click')
      expect(w.get('.process-summary-end').text()).toContain('Collapse')
      expect(w.get('.process-summary-end .process-summary-text').text()).toBe('Collapse')
      expect(w.get('.process-summary-end .process-summary-count').text()).toBe('3 actions')
      await w.get('.process-summary-end button').trigger('click')
      expect(w.findAll('.process-summary-button')).toHaveLength(1)
      expect(w.get('.process-summary-count').text()).toBe('3 actions')
    } finally { w.unmount() }
  })

  it('shows recorded thinking in the folded live process, then folds it when work finishes', async () => {
    items = [
      { role: 'tool', name: 'Read', text: 'first.ts', ts: null },
      { role: 'thinking', text: 'Check the result before continuing.', ts: null },
    ]
    const active = { ...pane, agent: 'codex' as const, status: 'working' as const }
    herdrState.value = { ok: true, workspaces: [], panes: [active] }
    const w = await mountSuspended(ChatView, { props: { pane: active, localQueued: [] } })
    try {
      await expect.poll(() => w.find('.process-summary-button').exists()).toBe(true)
      const summary = w.get('.process-summary-button')
      expect(summary.attributes('aria-expanded')).toBe('false')
      expect(w.get('.process-live-thought').text()).toContain('Check the result before continuing.')
      expect(summary.text()).toContain('Agent working')
      await w.setProps({ pane: { ...active, status: 'idle' } })
      expect(summary.text()).not.toContain('Check the result before continuing.')
      await summary.trigger('click')
      expect(w.text()).toContain('Check the result before continuing.')
    } finally { w.unmount() }
  })

  it('pins the latest task snapshot below the conversation and can collapse it', async () => {
    const idle = { ...pane, status: 'idle' as const }
    herdrState.value = { ok: true, workspaces: [], panes: [idle] }
    items = [
      { role: 'tool', name: 'TodoWrite', text: 'Tasks', ts: null, todos: [{ text: 'Old task', status: 'pending' }] },
      { role: 'assistant', text: 'Continuing work.', ts: null },
      { role: 'tool', name: 'TodoWrite', text: 'Tasks', ts: null, todos: [
        { text: 'Inspect output', status: 'completed' },
        { text: 'Implement changes', status: 'in_progress' },
        { text: 'Verify behavior', status: 'pending' },
        { text: 'Await input', status: 'blocked' },
      ] },
    ]
    const w = await mountSuspended(ChatView, { props: { pane: idle, localQueued: [] } })
    try {
      await expect.poll(() => w.find('.process-todos').exists()).toBe(true)
      expect(w.findAll('.process-todos')).toHaveLength(1)
      expect(w.find('.process-todos').text()).not.toContain('Old task')
      expect(w.findAll('.process-todo').map(row => [row.get('.process-todo-text').text(), row.get('.process-todo-status').text()])).toEqual([
        ['Implement changes', 'Working'], ['Verify behavior', 'To do'], ['Await input', 'Blocked'],
      ])
      expect(w.get('.process-todos-completed').attributes('aria-expanded')).toBe('false')
      expect(w.get('.process-todos-completed').text()).toContain('1 completed')
      await w.get('.process-todos-completed').trigger('click')
      expect(w.get('.process-todos-completed').attributes('aria-expanded')).toBe('true')
      expect(w.findAll('.process-todo-text').map(row => row.text())).toContain('Inspect output')
      expect(w.findAll('.process-summary-button').every(button => button.attributes('aria-expanded') === 'false')).toBe(true)
      expect(w.find('.chat .process-todos').exists()).toBe(false)
      await w.get('.process-todos-title').trigger('click')
      expect(w.get('.process-todos-title').attributes('aria-expanded')).toBe('false')
      expect(w.find('.process-todo').exists()).toBe(false)
    } finally { w.unmount() }
  })

  it('keeps punctuation-only check-ins inside a single expandable process', async () => {
    const idle = { ...pane, status: 'idle' as const }
    herdrState.value = { ok: true, workspaces: [], panes: [idle] }
    items = [
      { role: 'tool', text: 'first', ts: null, omp: { title: 'Read', target: 'first' } },
      { role: 'assistant', text: '.', ts: null },
      { role: 'tool', text: 'second', ts: null, omp: { title: 'Edit', target: 'second' } },
      { role: 'assistant', text: '…', ts: null },
      { role: 'tool', text: 'third', ts: null, omp: { title: 'Read', target: 'third' } },
      { role: 'assistant', text: 'Finished.', ts: null },
      { role: 'tool', text: 'fourth', ts: null, omp: { title: 'Read', target: 'fourth' } },
    ]
    const w = await mountSuspended(ChatView, { props: { pane: idle, localQueued: [] } })
    try {
      await expect.poll(() => w.find('.chat').text()).toContain('Finished.')
      const groups = w.findAll('.process-summary-button')
      expect(groups).toHaveLength(2)
      expect(w.findAll('.msg-ai')).toHaveLength(1)
      expect(w.find('.msg-ai').text()).toContain('Finished.')
      await groups[0]!.trigger('click')
      expect(w.findAll('.omp-tool-cmd').map(x => x.text())).toEqual(['read first', 'edit second', 'read third'])
      expect(w.findAll('.msg-ai').map(x => x.text())).toEqual(['.', '…', 'Finished.'])
    } finally { w.unmount() }
  })

  it('keeps a folded omp tool image outside the hidden calls and opens its viewer', async () => {
    const idle = { ...pane, status: 'idle' as const }
    herdrState.value = { ok: true, workspaces: [], panes: [idle] }
    items = [
      { role: 'tool', text: '', ts: '2026-01-01T00:00:00Z', ref: 'image-line', images: 1, omp: { title: 'Read', target: 'login.png' } },
      ...['ls', 'git status', 'npm test'].map((target, i): ChatItem => ({ role: 'tool', text: '', ts: `2026-01-01T00:00:0${i + 1}Z`, omp: { title: 'Bash', target, out: 'ok' } })),
      { role: 'assistant', text: 'The login button is clipped.', ts: '2026-01-01T00:00:04Z' },
    ]
    const w = await mountSuspended(ChatView, { props: { pane: idle, localQueued: [] } })
    try {
      await expect.poll(() => w.find('.chat').text()).toContain('The login button is clipped.')
      const summaries = w.findAll('.process-summary-button')
      expect(summaries).toHaveLength(2)
      expect(summaries.every(s => s.attributes('aria-expanded') === 'false')).toBe(true)
      expect(w.find('.omp-tool').exists()).toBe(false)
      const thumbs = w.findAll('.process-images .msg-img')
      expect(thumbs).toHaveLength(1)
      const src = thumbs[0]!.attributes('src')!
      await summaries[0]!.trigger('click')
      expect(w.find('.omp-tool-cmd').text()).toBe('read login.png')
      expect(w.findAll('.process-images .msg-img')).toHaveLength(1)
      expect(src).toMatch(/^\/api\/chat\/image\?pane=/)
      await thumbs[0]!.trigger('click')
      expect(lightboxSrc.value).toBe(src)
      expect(lightboxSet.value).toEqual([src])
    } finally { w.unmount() }
  })
  it('keeps a scheduled prompt folded while rendering its Markdown on demand', async () => {
    const idle = { ...pane, status: 'idle' as const }
    herdrState.value = { ok: true, workspaces: [], panes: [idle] }
    items = [
      { role: 'notice', name: 'scheduled', text: '**Check deployment**', ts: '2026-01-01T00:00:00Z' },
      { role: 'assistant', text: 'Deployment is green.', ts: '2026-01-01T00:00:01Z' },
    ]
    const w = await mountSuspended(ChatView, {
      props: { pane: idle, localQueued: [] },
      global: { stubs: { UTooltip: { template: '<slot />' } } },
    })
    try {
      await expect.poll(() => w.find('.chat').text()).toContain('Deployment is green.')
      const notice = w.find('.msg-notice.scheduled')
      expect(notice.classes()).toContain('long')
      expect(notice.classes()).not.toContain('open')
      expect(notice.find('.msg-notice-body strong').text()).toBe('Check deployment')
      expect(w.findAll('.msg-user-wrap')).toHaveLength(0)
      const toggle = notice.find('button.msg-shell-more')
      expect(toggle.attributes('aria-expanded')).toBe('false')
      await toggle.trigger('click')
      expect(toggle.attributes('aria-expanded')).toBe('true')
      expect(notice.classes()).toContain('open')
    } finally { w.unmount() }
  })

  it('shows omp errors between the check-ins and actions, each once, in plain text', async () => {
    const idle = { ...pane, status: 'idle' as const }
    herdrState.value = { ok: true, workspaces: [], panes: [idle] }
    // The conversation as the server reads it from omp's session file.
    items = parseLines(ompErrors, 'omp', 0, '/home/user')
    const w = await mountSuspended(ChatView, {
      props: { pane: idle, localQueued: [] },
      global: { stubs: { UTooltip: { template: '<slot />' } } },
    })
    try {
      await expect.poll(() => w.findAll('.msg-error').length).toBe(4)
      const errors = w.findAll('.msg-error')
      expect(errors.map(e => e.find('.msg-notice-head').text())).toEqual(['Error', 'Error', 'Error', 'Error'])
      const texts = errors.map(e => e.find('.msg-error-text').text())
      expect(texts[0]).toContain('You have reached your specified API usage limits.')
      expect(texts[1]).toContain('rate_limit_error')
      expect(texts[2]).toBe('Retry budget exhausted after 2 retries: Anthropic stream stalled while waiting for the next event')
      expect(texts[3]).toContain('Your credit balance is too low to access the Anthropic API.')
      // Raw provider JSON stays as written (no Markdown).
      expect(errors[0]!.find('.msg-error-text').element.textContent).toMatch(/^400 \{"type":"error"/)
      // Check-ins and actions are still there, around the errors.
      expect(w.findAll('.msg-autopilot')).toHaveLength(5)
      await w.findAll('.process-summary-button')[0]!.trigger('click')
      expect(w.find('.omp-console .omp-tool-cmd').text()).toBe('tools/tasks.sh list')
      expect(w.find('.msg-ai').text()).toContain('Checking the board.')
      expect(w.findAll('.msg-system').map(s => s.text())).toEqual(expect.arrayContaining(['Retried after an error', 'Interrupted']))
      // Order: each error right after the check-in that hit it.
      const order = [...w.find('.chat').element.querySelectorAll('.msg-autopilot, .msg-error')].map(el => el.classList.contains('msg-error') ? 'E' : 'A')
      expect(order.join('')).toBe('AEAEAEAAE')
    } finally { w.unmount() }
  })

  it('opens a preview sheet when clicking a full path markdown link in an assistant reply', async () => {
    const idle = { ...pane, status: 'idle' as const }
    herdrState.value = { ok: true, workspaces: [], panes: [idle] }
    items = [
      { role: 'assistant', text: 'See [the document](/Users/gl/llmwork/xxx.md#sec-1) for details.', ts: '2026-01-01T00:00:00Z' },
    ]
    const w = await mountSuspended(ChatView, { props: { pane: idle, localQueued: [] } })
    try {
      await expect.poll(() => w.find('.msg-ai .md-body a[href="/Users/gl/llmwork/xxx.md#sec-1"]').exists()).toBe(true)
      const link = w.find('.msg-ai .md-body a[href="/Users/gl/llmwork/xxx.md#sec-1"]')
      await link.trigger('click')
      expect(w.findComponent({ name: 'FilesView' }).exists()).toBe(true)
      const fv = w.findComponent({ name: 'FilesView' })
      expect(fv.props('file')).toBe('/Users/gl/llmwork/xxx.md')
      expect(fv.props('anchor')).toBe('sec-1')
    } finally { w.unmount() }
  })
})
