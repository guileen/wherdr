import { expect, test, type Locator, type Page, type WebSocketRoute } from './test'
import type { HerdrState } from '../../shared/types'
import { OMP_CHAT_PANE } from './scenario.mjs'
import { scrollConversation } from './conversationScroll'

// The launcher supplies the pane, not its conversation: every reply below is a
// controlled, neutral fixture. No message is sent to an agent.
const SOURCE = '/viewport.jsonl'
const START = 4096
const initialUsers = 32
interface Item { id: string, offset: number, role: string, text: string, ts: null }
interface VisibleMessage { message: Locator, y: number }
const user = (index: number, text = `Message ${index}: ${'Stable conversation content. '.repeat(12)}`): Item => ({
  id: `${START * (index + 1)}:0:user`, offset: START * (index + 1), role: 'user', text, ts: null,
})

async function painted(page: Page) {
  await page.evaluate(() => {
    const { promise, resolve } = Promise.withResolvers<void>()
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    return promise
  })
}

async function fixture(page: Page) {
  await expect.poll(async () => (await (await page.request.get('/api/state')).json()).ok).toBe(true)
  const state = await (await page.request.get('/api/state')).json() as HerdrState
  let events: WebSocketRoute | undefined
  await page.route('**/api/state', route => route.fulfill({ json: state }))
  await page.routeWebSocket('**/ws/events', socket => { events = socket; socket.send(JSON.stringify(state)) })
  await page.addInitScript(() => {
    localStorage.setItem('typewriterSpeed', 'off')
    localStorage.setItem('herdrLanguage', 'en')
  })
  await page.clock.install()

  let items: Item[] = Array.from({ length: initialUsers }, (_, index) => user(index))
  let version = 0
  let windowStart = START
  let restoreFailure = false
  let historyRequested = false
  const { promise: history, resolve: releaseHistory } = Promise.withResolvers<void>()
  const older = Array.from({ length: 6 }, (_, index) => ({
    ...user(index, `Earlier message ${index}: ${'Historical conversation content. '.repeat(12)}`),
    id: `${index * 512}:0:user`, offset: index * 512,
  }))
  const end = () => items.at(-1)!.offset + items.at(-1)!.text.length + 1
  const token = () => `viewport-${version}`
  await page.route('**/api/chat?*', async route => {
    const params = new URL(route.request().url()).searchParams
    if (params.get('pane') !== OMP_CHAT_PANE) return route.continue()
    if (params.has('after')) {
      const after = Number(params.get('after'))
      const before = Number(params.get('before'))
      const missing = items.filter(item => item.offset >= after && item.offset < before)
      return route.fulfill({ json: {
        available: true, file: SOURCE, older: true, start: after,
        end: missing[6]?.offset ?? before, items: missing.slice(0, 6),
      } })
    }
    if (params.has('before')) {
      historyRequested = true
      await history
      return route.fulfill({ json: { available: true, file: SOURCE, older: true, start: 0, end: START, items: older } }).catch(() => {})
    }
    if (params.has('around')) {
      if (restoreFailure) return route.abort('failed')
      const index = items.findIndex(item => item.id === params.get('around'))
      const page = index < 0 ? [] : items.slice(index, index + 6)
      return route.fulfill({ json: {
        available: true, file: SOURCE, older: true, position: index >= 0 ? 'found' : 'not-found',
        start: page[0]?.offset ?? 0, end: items[index + 6]?.offset ?? end(), items: page,
      } })
    }
    return route.fulfill({ json: {
      available: true, file: SOURCE, token: token(), start: windowStart, end: end(),
      ...(params.get('since') === token() ? { unchanged: true } : { items: items.filter(item => item.offset >= windowStart) }),
    } })
  })

  return {
    releaseHistory,
    historyRequested: () => historyRequested,
    moveTail(index: number) { windowStart = items[index]!.offset; version++ },
    failRestore(value: boolean) { restoreFailure = value },
    shell(lines: string[]) {
      state.panes.find(pane => pane.id === OMP_CHAT_PANE)!.ompShell = { command: 'Sample command', lines, hidden: 0, since: null }
      events!.send(JSON.stringify(state))
    },
    append(text: string, role = 'user') {
      const index = items.length
      const item = { ...user(index, text), id: `${START * (index + 1)}:0:${role}`, role }
      items = [...items, item]
      version++
      return item
    },
    stream(text: string) {
      items = [...items.slice(0, -1), { ...items.at(-1)!, text }]
      version++
    },
    async poll() {
      // Advancing the app's real polling interval also exercises repeated
      // unchanged replies. Await the response and DOM commit, never a sleep.
      const expected = token()
      const response = page.waitForResponse(async response => {
        const url = new URL(response.url())
        return url.pathname === '/api/chat' && url.searchParams.get('pane') === OMP_CHAT_PANE
          && !url.searchParams.has('before') && !url.searchParams.has('around')
          && (await response.json()).token === expected
      })
      await page.clock.fastForward(1600)
      const answered = await response
      await answered.finished()
      await painted(page)
      return answered.json()
    },
  }
}

const gap = (chat: Locator) => chat.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)
async function atBottom(chat: Locator) {
  await expect.poll(() => gap(chat)).toBeLessThanOrEqual(2)
}
async function wheel(page: Page, chat: Locator, delta: number) {
  const before = await chat.evaluate(el => el.scrollTop)
  await scrollConversation(page, chat, delta)
  await expect.poll(() => chat.evaluate(el => el.scrollTop)).toBeLessThan(before)
  await painted(page)
}
async function visibleMessage(chat: Locator) {
  const text = await chat.locator('.msg-user-wrap').evaluateAll(nodes => {
    const bounds = document.querySelector('.chat')!.getBoundingClientRect()
    const node = nodes.find(node => {
      const rect = node.getBoundingClientRect()
      return rect.top >= bounds.top + 2 && rect.bottom <= bounds.bottom - 2
    })
    if (!node?.textContent) throw new Error('Expected a fully visible user message')
    return node.textContent
  })
  const message = chat.locator('.msg-user-wrap').filter({ hasText: text })
  await expect(message).toHaveCount(1)
  return { message, y: await message.evaluate(el => el.getBoundingClientRect().top) }
}
async function inPlace(anchor: VisibleMessage) {
  await expect.poll(async () => Math.abs(await anchor.message.evaluate(el => el.getBoundingClientRect().top) - anchor.y)).toBeLessThanOrEqual(2)
}
async function open(page: Page) {
  await page.goto(`/#/a/${OMP_CHAT_PANE}`)
  const chat = page.locator('.chat')
  await expect(chat.locator('.msg-user-wrap')).toHaveCount(initialUsers)
  await atBottom(chat)
  return chat
}

// One journey covers mode transitions; history is not new below-content.
test('conversation follows output until wheel intent, holds reading through streaming, and resumes at the bottom', { tag: '@webkit-phone' }, async ({ page }) => {
  const replies = await fixture(page)
  try {
    const chat = await open(page)
    const indicator = page.getByRole('button', { name: 'New messages', exact: true })
    replies.append('Following arrival: a new message at the end.')
    await replies.poll()
    await expect(chat).toContainText('Following arrival: a new message at the end.')
    await atBottom(chat)
    await expect(indicator).toHaveCount(0)

    // Sixty pixels is deliberate: reading starts on upward intent even inside
    // the old near-bottom tolerance. Wait for actual browser scroll first.
    await wheel(page, chat, -60)
    const anchor = await visibleMessage(chat)
    replies.append('A new response starts here.', 'assistant')
    await replies.poll()
    await expect(chat).toContainText('A new response starts here.')
    await inPlace(anchor)
    await expect(indicator).toBeVisible()
    const target = await indicator.boundingBox()
    expect(target!.width).toBeGreaterThanOrEqual(44)
    expect(target!.height).toBeGreaterThanOrEqual(44)
    const keybar = page.locator('.phone-keybar-toggle')
    if (await keybar.isVisible()) {
      const bounds = (await keybar.boundingBox())!
      // The existing keybar target extends 5px outside its visible button.
      expect(target!.x + target!.width + 8 <= bounds.x - 5 || target!.y + target!.height + 8 <= bounds.y - 5).toBe(true)
    }
    await page.screenshot({ path: `.shots/conversation-new-content-${test.info().project.name}.png` })

    const streamed = `A new response starts here.\n\n${'More neutral streamed output.\n\n'.repeat(24)}Stream complete.`
    replies.stream(streamed)
    await replies.poll()
    await expect(chat).toContainText('Stream complete.')
    await inPlace(anchor)
    await expect(indicator).toBeVisible()
    for (let repeat = 0; repeat < 2; repeat++) {
      expect(await replies.poll()).toMatchObject({ unchanged: true })
      await inPlace(anchor)
      await expect(indicator).toBeVisible()
    }

    await indicator.click()
    await atBottom(chat)
    await expect(indicator).toHaveCount(0)

    await wheel(page, chat, -60)
    replies.append('Another arrival while reading.')
    await replies.poll()
    await expect(chat).toContainText('Another arrival while reading.')
    await expect(indicator).toBeVisible()
    await scrollConversation(page, chat, await chat.evaluate(el => el.scrollHeight))
    await atBottom(chat)
    await expect(indicator).toHaveCount(0)
    replies.append('Manual arrival resumed following.')
    await replies.poll()
    await expect(chat).toContainText('Manual arrival resumed following.')
    await atBottom(chat)
    await expect(indicator).toHaveCount(0)

    await wheel(page, chat, -await chat.evaluate(el => el.scrollHeight))
    await expect.poll(replies.historyRequested).toBe(true)
    const historicalAnchor = await visibleMessage(chat)
    await expect(page.getByRole('button', { name: 'Jump to latest', exact: true })).toBeVisible()
    replies.releaseHistory()
    await expect(chat).toContainText('Earlier message 0:')
    await inPlace(historicalAnchor)
    await expect(indicator).toHaveCount(0)
    await replies.poll()
    await inPlace(historicalAnchor)
    await expect(indicator).toHaveCount(0)
  } finally { replies.releaseHistory() }
})

test('returning from settings with new content restores the message being read', { tag: '@webkit-phone' }, async ({ page }) => {
  const replies = await fixture(page)
  try {
    const chat = await open(page)
    await wheel(page, chat, -900)
    const anchor = await visibleMessage(chat)
    await page.goto('/#/settings?section=appearance')
    await expect(page.locator('.settings-section:visible')).toBeVisible()
    replies.append('New content arrived while settings were open.')

    await page.goto(`/#/a/${OMP_CHAT_PANE}`)
    await expect(chat).toContainText('New content arrived while settings were open.')
    await inPlace(anchor)
    const indicator = page.getByRole('button', { name: 'New messages', exact: true })
    await expect(indicator).toBeVisible()
    for (let repeat = 0; repeat < 2; repeat++) {
      expect(await replies.poll()).toMatchObject({ unchanged: true })
      await inPlace(anchor)
      await expect(indicator).toBeVisible()
    }
    await indicator.click()
    await atBottom(chat)
    await expect(indicator).toHaveCount(0)
  } finally { replies.releaseHistory() }
})

test('restores an out-of-tail reading anchor after a failed read and fills the explicit gap', { tag: '@webkit-phone' }, async ({ page }) => {
  const replies = await fixture(page)
  try {
    const chat = await open(page)
    await wheel(page, chat, -(await chat.evaluate(el => el.scrollTop)) * 0.65)
    const anchor = await visibleMessage(chat)
    await page.goto('/#/settings?section=appearance')
    await expect(page.locator('.settings-section:visible')).toBeVisible()
    replies.moveTail(initialUsers - 3)
    replies.append('Latest content after the reading window moved.')
    replies.failRestore(true)
    await page.goto(`/#/a/${OMP_CHAT_PANE}`)
    await expect(page.getByText('Reading position unavailable', { exact: true })).toBeVisible()
    await expect(chat).toContainText('Latest content after the reading window moved.')
    const indicator = page.getByRole('button', { name: 'New messages', exact: true })
    await expect(indicator).toBeVisible()
    replies.failRestore(false)
    await page.locator('.chat-position-note').getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(page.locator('.chat-position-note')).toHaveCount(0)
    await inPlace(anchor)
    const loadGap = page.getByRole('button', { name: 'Load messages between this position and latest', exact: true })
    await expect(loadGap).toBeAttached()
    while (await loadGap.count()) {
      // The gap can be offscreen. Activating it must preserve the reading anchor.
      const response = page.waitForResponse(response => new URL(response.url()).searchParams.has('after'))
      await loadGap.evaluate(el => (el as HTMLButtonElement).click())
      await (await response).finished()
      await painted(page)
      await inPlace(anchor)
    }
    await expect(indicator).toBeVisible()
    await indicator.click()
    await atBottom(chat)
  } finally { replies.releaseHistory() }
})

test('keeps an internal passage through reply growth, resizing and search refresh', { tag: '@webkit-phone' }, async ({ page }) => {
  const replies = await fixture(page)
  try {
    const chat = await open(page)
    const reply = Array.from({ length: 24 }, (_, i) => `Passage ${i}: ${'A distinct part of a long response. '.repeat(5)}`).join('\n\n')
    replies.append(reply, 'assistant')
    await replies.poll()
    await atBottom(chat)
    await wheel(page, chat, -600)
    const passageText = await chat.locator('.msg-ai p').evaluateAll(nodes => {
      const top = document.querySelector('.chat')!.getBoundingClientRect().top
      return nodes.find(node => node.getBoundingClientRect().top > top + 4)?.textContent || ''
    })
    expect(passageText).toContain('Passage ')
    const passage = chat.locator('.msg-ai p').filter({ hasText: passageText })
    const y = await passage.evaluate(el => el.getBoundingClientRect().top)
    replies.stream(reply + '\n\nMore output after the visible passage.')
    await replies.poll()
    await inPlace({ message: passage, y })
    const size = page.viewportSize()!
    await page.setViewportSize({ width: size.width, height: size.height - 100 })
    await painted(page)
    await inPlace({ message: passage, y })
    await expect(page.getByRole('button', { name: 'New messages', exact: true })).toBeVisible()

    replies.releaseHistory()
    await page.getByRole('button', { name: 'Options', exact: true }).click()
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    const input = page.locator('.search-bar input')
    await expect(input).toBeVisible()
    await input.fill('Passage 4:')
    await page.clock.fastForward(300)
    await expect(page.locator('.search-count')).toHaveText('1/1')
    const target = chat.locator('.msg-ai p').filter({ hasText: 'Passage 4:' })
    await expect(target).toBeInViewport()
    await wheel(page, chat, -60)
    const searchY = await target.evaluate(el => el.getBoundingClientRect().top)
    replies.stream(reply + '\n\nAnother output while search is open.')
    await replies.poll()
    await inPlace({ message: target, y: searchY })
  } finally { replies.releaseHistory() }
})

test('a layout clamp does not resume following and live output still indicates new content', { tag: '@webkit-phone' }, async ({ page }) => {
  const replies = await fixture(page)
  try {
    const chat = await open(page)
    await wheel(page, chat, -60)
    const size = page.viewportSize()!
    await page.setViewportSize({ width: size.width, height: size.height + 120 })
    await atBottom(chat)
    await expect(page.getByRole('button', { name: 'Jump to latest', exact: true })).toBeVisible()
    const anchor = await visibleMessage(chat)
    replies.shell(Array.from({ length: 24 }, (_, i) => `Live output ${i}`))
    await expect(chat).toContainText('Live output 23')
    await inPlace(anchor)
    const indicator = page.getByRole('button', { name: 'New messages', exact: true })
    await expect(indicator).toBeVisible()
    await indicator.click()
    await atBottom(chat)
    replies.shell(['Final live output'])
    await expect(chat).toContainText('Final live output')
    await atBottom(chat)
    await expect(indicator).toHaveCount(0)
  } finally { replies.releaseHistory() }
})
