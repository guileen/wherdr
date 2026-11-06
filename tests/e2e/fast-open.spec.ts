import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Page, type Route } from './test'
import { CLAUDE_PANE, CLAUDE_SUGGEST_PANE, OMP_CHAT_PANE, SOCK_FILE } from './scenario.mjs'

// Opening the Board and a conversation fast: what this device kept shows at once
// (with "Read at" while the network catches up), the shapes of what loads after
// 300 ms when nothing is kept, and a long conversation from its bottom first.
const shot = (page: Page, name: string, project: string) => page.screenshot({ path: `.shots/fast-open-${name}-${project}.png` })
// What this device keeps (app/utils/offlineCache.ts): the keys of one store.
const keptKeys = (page: Page, store: 'kv' | 'chats') => page.evaluate(async (store) => {
  if (!(await indexedDB.databases()).some(d => d.name === 'wherdr-offline')) return []
  return new Promise<string[]>((resolve, reject) => {
    const r = indexedDB.open('wherdr-offline')
    r.onerror = () => reject(r.error)
    r.onsuccess = () => {
      if (!r.result.objectStoreNames.contains(store)) { r.result.close(); return resolve([]) }
      const keys = r.result.transaction(store).objectStore(store).getAllKeys()
      keys.onsuccess = () => { resolve(keys.result.map(String)); r.result.close() }
    }
  })
}, store)
// Written within WRITE_MS (2 s): the fake clock (page.clock.install, before the
// page opens) moves past it, then the record is waited for, not a fixed time.
async function kept(page: Page, store: 'kv' | 'chats', key: string) {
  await page.clock.fastForward(2500)
  await expect.poll(() => keptKeys(page, store)).toContain(key)
}

// ------------------------------------------------------------ the Board
const row = (id: string, group: string) => ({
  id, repo: id.split('/')[0], n: Number(id.split('/')[1]), state: group === 'working' ? 'working' : 'idle', kind: '', stage: group, title: `Task ${id}`, msg: '',
  app: 'claude', progress: null, eta: null, pr: '', review: null, reviewRound: 0, research: false, archived: false, queue: null, group,
})
const board = { version: 'v-fast', machines: [{ machine: '', status: 'ready', version: '1.2.1', at: Date.now(), tasks: [row('demo/1', 'working'), row('demo/2', 'todo')] }] }
const tasksAfter = (ms: number) => (route: Route) => setTimeout(() => route.fulfill({ json: board }).catch(() => {}), ms)
// A read held until the test has looked at what shows meanwhile (not a fixed delay).
function held(answer: (route: Route) => Promise<unknown>) {
  let release!: () => void
  const open = new Promise<void>((resolve) => { release = resolve })
  return { release, route: async (route: Route) => { await open; await answer(route).catch(() => {}) } }
}

test('the Board: its shapes while nothing is kept, then the last board at once with when it was read', async ({ page }, testInfo) => {
  const first = held(route => route.fulfill({ json: board }))
  await page.route('**/api/tasks*', first.route)
  await page.clock.install()
  await page.goto('/#/board')
  // Nothing kept: the column heads and empty cards, no "Loading…".
  const skel = page.locator('.board-skel')
  await expect(skel).toBeVisible()
  await expect(skel.locator('.skel-card').first()).toBeVisible()
  await expect(page.getByText('Loading…')).toHaveCount(0)
  await shot(page, 'board-skeleton', testInfo.project.name)
  first.release()
  // (On a phone, one column at a time: the cards are there, not all in view.)
  await expect(page.locator('.task-card', { hasText: 'Task demo/1' })).toHaveCount(1)
  await expect(skel).toHaveCount(0)
  // Kept on this device: shown at once after a reload, "Read at" until the read answers.
  await kept(page, 'kv', 'board')
  await page.unroute('**/api/tasks*')
  const second = held(route => route.fulfill({ json: board }))
  await page.route('**/api/tasks*', second.route)
  await page.reload()
  await expect(page.locator('.board-cached-tag')).toContainText(/Read at \d/)
  await expect(page.locator('.task-card')).toHaveCount(2)
  await expect(page.locator('.board-skel')).toHaveCount(0)
  await shot(page, 'board-cached', testInfo.project.name)
  second.release()
  await expect(page.locator('.board-cached-tag')).toHaveCount(0)
})

test('a short Board read shows no skeleton at all', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { skel: boolean }).skel = false
    new MutationObserver(() => { if (document.querySelector('.board-skel')) (window as unknown as { skel: boolean }).skel = true })
      .observe(document.documentElement, { subtree: true, childList: true })
  })
  await page.route('**/api/tasks*', tasksAfter(100))
  await page.goto('/#/board')
  await expect(page.locator('.task-card')).toHaveCount(2)
  await page.waitForTimeout(500)
  expect(await page.evaluate(() => (window as unknown as { skel: boolean }).skel)).toBe(false)
})

// ------------------------------------------------------------ a conversation
// A longer conversation in place of the nightly one, put back afterwards.
const home = path.join(path.dirname(fs.readFileSync(SOCK_FILE, 'utf8').trim()), 'home')
const cwd = path.join(home, 'projects/nightly')
const sid = '00000000-0000-4000-8000-000000000019'
const file = path.join(home, '.claude/projects', cwd.replace(/[/.]/g, '-'), `${sid}.jsonl`)
let original = ''
const TURNS = 12
test.beforeAll(() => {
  original = fs.readFileSync(file, 'utf8')
  const base = { isSidechain: false, cwd, sessionId: sid }
  const start = Date.now() - 3600_000
  const lines: unknown[] = []
  let t = start
  for (let i = 1; i <= TURNS; i++) {
    lines.push({ ...base, type: 'user', timestamp: new Date(t += 5000).toISOString(), message: { role: 'user', content: `Question ${i}: check step ${i}.` } })
    for (let k = 0; k < 2; k++) {
      const id = `toolu_${i}_${k}`
      lines.push({ ...base, type: 'assistant', timestamp: new Date(t += 1000).toISOString(), message: { model: 'claude-opus-4-1', role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command: `npm test -- step-${i}` } }] } })
      lines.push({ ...base, type: 'user', timestamp: new Date(t += 1000).toISOString(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } })
    }
    lines.push({ ...base, type: 'assistant', timestamp: new Date(t += 1000).toISOString(), message: { model: 'claude-opus-4-1', role: 'assistant', content: [{ type: 'text', text: `Step ${i} passes.${i === TURNS ? ' All steps done.' : ''}` }] } })
  }
  fs.writeFileSync(file, lines.map(l => JSON.stringify(l)).join('\n') + '\n')
})
test.afterAll(() => { if (original) fs.writeFileSync(file, original) })

async function open(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('typewriterSpeed', 'off')
    // How many user messages were on the page when the last reply first showed.
    const w = window as unknown as { firstUsers: number | null }
    w.firstUsers = null
    // Observe the first DOM commit before idle callbacks can add more blocks.
    const observer = new MutationObserver(() => {
      if (!document.querySelector('.chat-list')?.textContent?.includes('All steps done.')) return
      w.firstUsers = document.querySelectorAll('.chat-list .msg-user-wrap').length
      observer.disconnect()
    })
    observer.observe(document, { childList: true, subtree: true })
  })
  await page.goto(`/#/a/${CLAUDE_SUGGEST_PANE}`)
}

test('a long conversation shows its end first, then the rest above without moving the bottom', async ({ page }) => {
  let release!: () => void
  const responseReady = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/chat?*', async route => {
    await responseReady
    await route.continue().catch(() => {})
  })
  try {
    await open(page)
    await expect(page.locator('.chat-skel')).toBeVisible()
  } finally { release() }
  const list = page.locator('.chat-list')
  await expect(list).toContainText('All steps done.', { timeout: 15000 })
  const first = await page.evaluate(() => (window as unknown as { firstUsers: number }).firstUsers)
  expect(first).toBeGreaterThan(0)
  expect(first).toBeLessThan(TURNS)
  // The rest follows above while the page is idle; the bottom stays where it is.
  await expect(list.locator('.msg-user-wrap')).toHaveCount(TURNS, { timeout: 10000 })
  await expect(list).toContainText('Question 1: check step 1.')
  const gap = await page.locator('.chat').evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)
  expect(gap).toBeLessThan(160)
})

test('opening a short tail does not automatically load earlier pages', { tag: '@webkit-phone' }, async ({ page }) => {
  let olderRequests = 0
  await page.route('**/api/chat?*', async route => {
    const params = new URL(route.request().url()).searchParams
    if (params.has('before')) {
      olderRequests++
      return route.fulfill({ json: { available: true, file: '/chat.jsonl', start: 0, items: [] } })
    }
    return route.fulfill({ json: {
      available: true, file: '/chat.jsonl', token: 'short-tail', start: 100,
      items: Array.from({ length: 5 }, (_, i) => ({ role: 'user', text: `Short tail message ${i} ${'content '.repeat(16)}`, ts: null })),
    } })
  })
  await page.goto(`/#/a/${OMP_CHAT_PANE}`)
  const chat = page.locator('.chat')
  await expect(chat).toContainText('Short tail message 4')
  await expect.poll(() => chat.evaluate(el => el.scrollTop)).toBeGreaterThan(0)
  expect(await chat.evaluate(el => el.scrollTop)).toBeLessThan(400)
  // Wait for the browser's initial programmatic scroll event to be processed.
  await chat.evaluate(() => {
    const { promise, resolve } = Promise.withResolvers<void>()
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    return promise
  })
  expect(olderRequests).toBe(0)
  await chat.hover()
  await page.mouse.wheel(0, -600)
  await expect.poll(() => olderRequests).toBe(1)
})

test('a shorter refreshed tail does not load history on its own', { tag: '@webkit-phone' }, async ({ page }) => {
  let olderRequests = 0
  let release!: () => void
  const refresh = new Promise<void>(resolve => { release = resolve })
  let refreshRequested!: () => void
  const requested = new Promise<void>(resolve => { refreshRequested = resolve })
  await page.route('**/api/chat?*', async route => {
    const params = new URL(route.request().url()).searchParams
    if (params.has('before')) {
      olderRequests++
      return route.fulfill({ json: { available: true, file: '/chat.jsonl', start: 0, items: [] } })
    }
    const refreshed = params.has('from')
    if (refreshed) {
      refreshRequested()
      await refresh
    }
    return route.fulfill({ json: {
      available: true, file: '/chat.jsonl', token: refreshed ? 'short' : 'long', start: 100,
      items: Array.from({ length: refreshed ? 5 : 12 }, (_, i) => ({ role: 'user', text: `Tail message ${i} ${'content '.repeat(16)}`, ts: null })),
    } }).catch(() => {})
  })
  try {
    await page.goto(`/#/a/${OMP_CHAT_PANE}`)
    const chat = page.locator('.chat')
    await expect(chat).toContainText('Tail message 11')
    await expect.poll(() => chat.evaluate(el => el.scrollTop)).toBeGreaterThan(400)
    await requested
    release()
    await expect(chat).not.toContainText('Tail message 11')
    await chat.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    expect(olderRequests).toBe(0)
  } finally { release() }
})

test('revealing earlier blocks keeps the visible message in place', { tag: '@webkit-phone' }, async ({ page }) => {
  // Keep idle reveals pending so the scroll itself exposes the earlier blocks.
  await page.addInitScript(() => {
    window.requestIdleCallback = () => 1
  })
  await open(page)
  const list = page.locator('.chat-list')
  await expect(list).toContainText('All steps done.', { timeout: 15000 })
  await expect(page.locator('.chat-skel')).toHaveCount(0)
  await page.evaluate(() => {
    const { promise, resolve } = Promise.withResolvers<void>()
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    return promise
  })
  const before = await list.locator('.msg-user-wrap').count()
  expect(before).toBeLessThan(TURNS)
  const position = await page.locator('.chat').evaluate((box) => {
    box.scrollTop = 0
    const list = box.querySelector('.chat-list')!
    const top = box.getBoundingClientRect().top
    const anchor = Array.from(list.children).find(el => el.getBoundingClientRect().bottom > top)!
    const state = window as unknown as { readingAnchor: Element }
    state.readingAnchor = anchor
    const y = anchor.getBoundingClientRect().top
    box.dispatchEvent(new Event('scroll'))
    return y
  })
  await expect.poll(() => list.locator('.msg-user-wrap').count()).toBeGreaterThan(before)
  const after = await page.evaluate(() => {
    const state = window as unknown as { readingAnchor: Element }
    return state.readingAnchor.getBoundingClientRect().top
  })
  expect(Math.abs(after - position)).toBeLessThan(2)
})

test('loading an older page keeps the message being read in place', { tag: '@webkit-phone' }, async ({ page }) => {
  const { promise: older, resolve: release } = Promise.withResolvers<void>()
  const { promise: requested, resolve: requestOlder } = Promise.withResolvers<void>()
  await page.route('**/api/chat?*', async route => {
    const params = new URL(route.request().url()).searchParams
    if (params.has('before')) {
      requestOlder()
      await older
      return route.fulfill({ json: { available: true, file: '/chat.jsonl', start: 0, items: Array.from({ length: 12 }, (_, i) => ({ role: 'user', text: `Older message ${i} ${'content '.repeat(20)}`, ts: null })) } }).catch(() => {})
    }
    return route.fulfill({ json: { available: true, file: '/chat.jsonl', token: 'tail', start: 100, items: Array.from({ length: 12 }, (_, i) => ({ role: 'user', text: `Current message ${i} ${'content '.repeat(20)}`, ts: null })) } }).catch(() => {})
  })
  try {
    await page.goto(`/#/a/${OMP_CHAT_PANE}`)
    const chat = page.locator('.chat')
    const message = chat.locator('.msg-user-wrap', { hasText: /Current message 1 content/ })
    await expect(message).toBeVisible()
    await expect.poll(() => chat.evaluate(el => el.scrollTop)).toBeGreaterThan(400)
    await chat.evaluate(el => { el.scrollTop = 100 })
    await expect.poll(() => chat.evaluate(el => el.scrollTop)).toBe(100)
    await requested
    const y = await message.evaluate(el => el.getBoundingClientRect().top)
    release()
    await expect(chat).toContainText('Older message 0')
    expect(Math.abs(await message.evaluate(el => el.getBoundingClientRect().top) - y)).toBeLessThan(2)
  } finally { release() }
})

test('a conversation: its shapes while nothing is kept, then the end kept at once with when it was read', async ({ page }, testInfo) => {
  const chat = held(route => route.continue())
  await page.route('**/api/chat?*', (route) => {
    if (new URL(route.request().url()).searchParams.get('pane') === CLAUDE_SUGGEST_PANE) return chat.route(route)
    return route.continue()
  })
  await page.clock.install()
  await open(page)
  const skel = page.locator('.chat-skel')
  await expect(skel).toBeVisible()
  // The field is real and usable meanwhile.
  await expect(page.locator('.prompt textarea').first()).toBeEditable()
  await shot(page, 'chat-skeleton', testInfo.project.name)
  chat.release()
  await expect(page.locator('.chat-list')).toContainText('All steps done.', { timeout: 15000 })
  await expect(skel).toHaveCount(0)
  // Kept on this device (written within a few seconds): at once after a reload,
  // "Read at" while the network is slow, gone once it answers.
  await kept(page, 'chats', CLAUDE_SUGGEST_PANE)
  await page.unroute('**/api/chat?*')
  // Hold the re-read until the cache is observed. A fixed delay also times
  // app startup, which can take longer than the delay on a busy CI runner.
  let release!: () => void
  const reread = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/chat?*', async route => {
    await reread
    await route.continue().catch(() => {})
  })
  try {
    await page.reload()
    await expect(page.locator('.chat-list')).toContainText('All steps done.')
    await expect(page.locator('.chat-skel')).toHaveCount(0)
    await expect(page.locator('.chat-cached')).toContainText(/Read at \d/)
    await shot(page, 'chat-cached', testInfo.project.name)
  } finally { release() }
  await expect(page.locator('.chat-cached')).toHaveCount(0, { timeout: 6000 })
})

test('a fresh empty conversation wins over an older cache that arrives later', async ({ page }) => {
  await page.clock.install()
  await open(page)
  await expect(page.locator('.chat-list')).toContainText('All steps done.')
  await kept(page, 'chats', CLAUDE_SUGGEST_PANE)
  await page.addInitScript(() => {
    const get = IDBObjectStore.prototype.get
    IDBObjectStore.prototype.get = function (key) {
      const request = get.call(this, key)
      if (this.name !== 'chats') return request
      // Delay only delivery of the cached conversation, not the network.
      return new Proxy(request, {
        get(target, name) { return Reflect.get(target, name, target) },
        set(target, name, value) {
          if (name === 'onsuccess') {
            target.onsuccess = event => setTimeout(() => value.call(target, event), 1200)
            return true
          }
          return Reflect.set(target, name, value, target)
        },
      })
    }
  })
  let answered = false
  await page.route('**/api/chat?*', async route => {
    if (new URL(route.request().url()).searchParams.get('pane') !== CLAUDE_SUGGEST_PANE) return route.continue()
    const response = await route.fetch()
    const body = await response.json()
    await route.fulfill({ json: { ...body, available: true, unchanged: false, items: [], start: 0 } })
    answered = true
  })
  await page.reload()
  await expect.poll(() => answered).toBe(true)
  // Past the cached record's late delivery (1.2 s, a page timer: on the fake clock).
  await page.clock.fastForward(1800)
  await expect(page.locator('.chat-list')).not.toContainText('All steps done.')
  await expect(page.locator('.chat-cached')).toHaveCount(0)
})

// Two tabs of the app (the installed app and a browser tab) share one cache:
// each conversation kept stays in the index that bounds it, whichever tab wrote last.
test('two tabs keep one index of the conversations kept', async ({ page, context }) => {
  const keep = (p: Page, pane: string, text: RegExp) => p.goto(`/#/a/${pane}`)
    .then(() => expect(p.locator('.chat-list .msg-user-wrap, .chat-list .msg-who').first()).toBeVisible({ timeout: 15000 }))
    .then(() => expect(p.locator('.chat-list')).toContainText(text))
    .then(() => kept(p, 'chats', pane))
  // One fake clock for the whole context: both tabs.
  await page.clock.install()
  await keep(page, CLAUDE_PANE, /\S/)
  const other = await context.newPage()
  await keep(other, OMP_CHAT_PANE, /\S/)
  // The first tab writes again, after the other one did.
  await keep(page, CLAUDE_SUGGEST_PANE, /All steps done\./)
  const stored = await page.evaluate(() => new Promise<{ index: string[], records: string[] }>((resolve, reject) => {
    const r = indexedDB.open('wherdr-offline')
    r.onerror = () => reject(r.error)
    r.onsuccess = () => {
      const tx = r.result.transaction(['kv', 'chats'])
      const index = tx.objectStore('kv').get('index')
      const records = tx.objectStore('chats').getAllKeys()
      tx.oncomplete = () => {
        resolve({ index: (index.result || []).map((e: { id: string }) => e.id).sort(), records: records.result.map(String).sort() })
        r.result.close()
      }
    }
  }))
  expect(stored.records).toEqual([CLAUDE_PANE, CLAUDE_SUGGEST_PANE, OMP_CHAT_PANE].sort())
  expect(stored.index).toEqual(stored.records)
  await other.close()
})
