import { expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ConversationOutput from '~/components/ConversationOutput.vue'
import type { ChatItem } from '#shared/types'

it('shows recorded thoughts and an activity indication while reasoning text is unavailable', async () => {
  const thought: ChatItem = { role: 'thinking', text: 'Compare the two results.', ts: null }
  const w = await mountSuspended(ConversationOutput, { props: { items: [thought], stale: false, activity: 'working' } })
  try {
    expect(w.text()).toContain('Compare the two results.')
    expect(w.get('.conversation-output-thinking').text()).toBe('Thinking / working…')
    await w.setProps({ items: [] })
    expect(w.get('.conversation-output-thinking').text()).toBe('Thinking / working…')
    await w.setProps({ activityStep: 'Reading a file' })
    expect(w.get('.conversation-output-thinking').text()).toBe('Reading a file')
    await w.setProps({ activityStep: null, stale: true })
    expect(w.find('.conversation-output-thinking').exists()).toBe(false)
    await w.setProps({ stale: false, activity: 'idle' })
    expect(w.find('.conversation-output-thinking').exists()).toBe(false)
  } finally { w.unmount() }
})

it('updates process output and identifies truncated or stale results', async () => {
  const running: ChatItem = { id: 'read-1', role: 'tool', name: 'Read', text: 'src/a.ts', ts: null }
  const w = await mountSuspended(ConversationOutput, { props: { items: [running], stale: false } })
  try {
    expect(w.text()).toContain('src/a.ts')
    expect(w.text()).not.toContain('first result')
    await w.setProps({ items: [{ ...running, out: 'first result', outTruncated: true }], stale: true })
    expect(w.text()).toContain('first result')
    expect(w.text()).toContain('Output truncated')
    expect(w.text()).toContain('out of date')
    await w.setProps({ items: [{ ...running, out: 'new result' }], stale: false })
    expect(w.text()).toContain('new result')
    expect(w.text()).not.toContain('first result')
    expect(w.text()).not.toContain('out of date')
  } finally { w.unmount() }
})

it('folds tool output behind a compact summary and keeps it open on updates', async () => {
  const item: ChatItem = { id: 'read', role: 'tool', name: 'Read', text: 'src/a.ts:1-20', ts: null,
    omp: { title: 'Read', target: 'src/a.ts:1-20', intent: 'Inspecting source', ms: 10 }, out: 'first line' }
  const w = await mountSuspended(ConversationOutput, { props: { items: [item], stale: false } })
  try {
    const detail = w.get('details.conversation-output-tool')
    expect(detail.attributes('open')).toBeUndefined()
    expect(detail.get('summary').text()).toContain('Inspecting source')
    expect(detail.get('summary').text()).toContain('src/a.ts:1-20')
    expect(detail.get('summary').text()).toContain('0.01s')
    await detail.get('summary').trigger('click')
    expect(detail.attributes('open')).toBeDefined()
    expect(detail.get('.conversation-output-result').text()).toBe('first line')
    await w.setProps({ items: [{ ...item, out: 'updated line' }] })
    expect(w.get('details.conversation-output-tool').attributes('open')).toBeDefined()
    expect(w.get('.conversation-output-result').text()).toBe('updated line')
    await detail.get('summary').trigger('click')
    expect(detail.attributes('open')).toBeUndefined()
  } finally { w.unmount() }
})

it('keeps edit diff and distinct raw output available together', async () => {
  const item: ChatItem = { role: 'tool', name: 'Edit', text: 'src/a.ts', ts: null, out: 'Updated file',
    omp: { title: 'Edit', target: 'src/a.ts', diff: true, out: '-old\n+new', added: 1, removed: 1 } }
  const w = await mountSuspended(ConversationOutput, { props: { items: [item], stale: false } })
  try {
    expect(w.get('summary').text()).toContain('+1/-1')
    await w.get('summary').trigger('click')
    expect(w.get('.conversation-output-diff-del').text()).toBe('-old')
    expect(w.get('.conversation-output-diff-add').text()).toBe('+new')
    expect(w.text()).toContain('Updated file')
  } finally { w.unmount() }
})

it('highlights recorded code safely and only indicates current observed activity', async () => {
  const tool: ChatItem = { id: 'edit', role: 'tool', name: 'Edit', text: 'src/a.ts', ts: null, omp: { title: 'Edit', target: 'src/a.ts', diff: true } }
  const w = await mountSuspended(ConversationOutput, { props: { items: [tool], stale: false, activity: 'blocked' } })
  try {
    expect(w.text()).toContain('Awaiting input')
    await w.setProps({ activity: 'working' })
    expect(w.text()).toContain('Agent working')
    await w.setProps({ items: [{ ...tool, out: '-const x = 1\n+const x = "<img src=x onerror=alert(1)>"' }] })
    expect(w.text()).not.toContain('Agent working')
    expect(w.find('.hl-k').text()).toBe('const')
    expect(w.find('.conversation-output-diff-add').text()).toContain('<img src=x onerror=alert(1)>')
    expect(w.find('img').exists()).toBe(false)
    await w.setProps({ items: [tool], stale: true })
    expect(w.text()).not.toContain('Agent working')
    await w.setProps({ items: [tool, { role: 'assistant', text: 'Finished', ts: null }], stale: false })
    expect(w.text()).not.toContain('Agent working')
  } finally { w.unmount() }
})

it('keeps a background command and its wait output in one terminal', async () => {
  const items: ChatItem[] = [
    { role: 'tool', name: 'Bash', text: 'Build the app', ts: null,
      omp: { title: 'Bash', target: 'npm run build', intent: 'Build the app', job: 'bg_1', ms: 1200 } },
    { role: 'tool', name: 'Wait', text: 'bg_1', ts: null,
      omp: { title: 'Wait', target: 'bg_1', out: '[INFO] building\n[ERROR] <build failed>\nDone: see log', exit: 1 } },
  ]
  const w = await mountSuspended(ConversationOutput, { props: { items, stale: false, activity: 'working' } })
  try {
    const terminal = w.get('.conversation-output-terminal')
    expect(w.findAll('.conversation-output-terminal')).toHaveLength(1)
    expect(terminal.get('.conversation-output-terminal-command').text()).toContain('npm run build')
    expect(terminal.text()).toContain('bg_1')
    expect(w.text().match(/Build the app/g)).toHaveLength(1)
    expect(terminal.text()).toContain('Exit 1')
    expect(terminal.get('.conversation-output-terminal-result').element.textContent).toBe(items[1]!.omp!.out)
    expect(terminal.get('.conversation-output-log-error').text()).toBe('[ERROR] <build failed>')
    expect(terminal.get('.conversation-output-log-success').text()).toBe('Done: see log')
    expect(terminal.find('build').exists()).toBe(false)
    expect(w.text()).not.toContain('Agent working')
    await w.setProps({ items: [items[0]!] })
    expect(w.text()).not.toContain('Agent working')
  } finally { w.unmount() }
})

it('updates the matching terminal without absorbing another job', async () => {
  const bash: ChatItem = { id: 'start', role: 'tool', name: 'Bash', text: 'deploy', ts: null, omp: { title: 'Bash', target: 'bash deploy.sh', job: 'bg_40' } }
  const wait: ChatItem = { id: 'wait', role: 'tool', name: 'Wait', text: 'bg_40', ts: null, omp: { title: 'Wait', target: 'bg_40 bash deploy.sh' } }
  const other: ChatItem = { id: 'other', role: 'tool', name: 'Wait', text: 'bg_41', ts: null, out: 'other job output' }
  const w = await mountSuspended(ConversationOutput, { props: { items: [bash, wait, other], stale: false } })
  try {
    expect(w.get('.conversation-output-terminal').text()).not.toContain('other job output')
    await w.setProps({ items: [bash, { ...wait, out: 'Deployment successful' }, other] })
    expect(w.findAll('.conversation-output-terminal')).toHaveLength(1)
    expect(w.get('.conversation-output-terminal').text()).toContain('Deployment successful')
    expect(w.text()).toContain('other job output')
  } finally { w.unmount() }
})

it('highlights patch output without changing its text or interpreting markup', async () => {
  const patch = '*** Begin Patch\n*** Update File: src/a.ts\n@@ section\n-const a = 1\n+const a = "<img>"\n*** End Patch'
  const item: ChatItem = { role: 'tool', name: 'Wait', text: 'bg_1', ts: null, out: patch }
  const w = await mountSuspended(ConversationOutput, { props: { items: [item], stale: false } })
  try {
    expect(w.find('.conversation-output-result').element.textContent).toBe(patch)
    expect(w.findAll('.conversation-output-diff-hunk')).toHaveLength(4)
    expect(w.find('.conversation-output-diff-add').text()).toBe('+const a = "<img>"')
    expect(w.find('.conversation-output-diff-del').text()).toBe('-const a = 1')
    expect(w.find('img').exists()).toBe(false)
  } finally { w.unmount() }
})

it('preserves completed job output and leaves large output safely unhighlighted', async () => {
  const output = `${'x'.repeat(64 * 1024)}\n<img>`
  const item: ChatItem = { role: 'job', text: '', ts: null, job: { id: 'bg_1', tool: 'Bash', out: output } }
  const w = await mountSuspended(ConversationOutput, { props: { items: [item], stale: false, activity: 'working' } })
  try {
    expect(w.text()).toContain('Background job')
    expect(w.find('.conversation-output-name').text()).toContain('bg_1')
    expect(w.find('.conversation-output-result').element.textContent).toBe(output)
    expect(w.find('img').exists()).toBe(false)
    expect(w.text()).not.toContain('Agent working')
  } finally { w.unmount() }
})

it('distinguishes recorded job status, deployment results and notices', async () => {
  const output = [
    'Backgrounded as job bg_40 <pending>',
    'bg_40 [bash] — completed',
    'Deployment successful: <site>',
    'npm notice package update',
    '✓ checks passed',
    '✗ checks failed',
    'bg_41 [bash] — failed',
    'bg_42 [bash] — cancelled',
  ].join('\n')
  const item: ChatItem = { role: 'tool', name: 'Wait', text: 'bg_40', ts: null, out: output }
  const w = await mountSuspended(ConversationOutput, { props: { items: [item], stale: false } })
  try {
    expect(w.find('.conversation-output-result').element.textContent).toBe(output)
    expect(w.findAll('.conversation-output-log-info').map(el => el.text())).toEqual([
      'Backgrounded as job bg_40 <pending>', 'bg_40 [bash] — completed', 'npm notice package update',
    ])
    expect(w.findAll('.conversation-output-log-success').map(el => el.text())).toEqual([
      'Deployment successful: <site>', '✓ checks passed',
    ])
    expect(w.findAll('.conversation-output-log-error').map(el => el.text())).toEqual(['✗ checks failed', 'bg_41 [bash] — failed'])
    expect(w.find('.conversation-output-log-warning').text()).toBe('bg_42 [bash] — cancelled')
    expect(w.find('pending').exists()).toBe(false)
    expect(w.find('site').exists()).toBe(false)
  } finally { w.unmount() }
})
