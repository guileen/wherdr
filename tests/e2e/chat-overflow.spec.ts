import { expect, test } from './test'
import { OMP_CHAT_PANE } from './scenario.mjs'

test('long conversation content stays within the phone while code and tables scroll locally', { tag: '@webkit-phone' }, async ({ page }) => {
  const number = '1234567890'.repeat(20)
  const language = 'examplelanguage'.repeat(12)
  const line = 'wide_code_content_'.repeat(40)
  const cell = 'wide_table_content_'.repeat(20)
  const system = 'system_notice_'.repeat(30)
  await page.route('**/api/chat?**', route => route.fulfill({ json: {
    available: true, token: 'overflow-fixture', file: '/home/user/chat.jsonl', items: [
      { role: 'system', text: system, ts: null },
      { role: 'job', text: '', ts: null, job: { id: 'job'.repeat(100), tool: 'task', out: 'Finished.' } },
      { role: 'assistant', text: `A long number: \`${number}\`\n\n\`\`\`${language}\n${line}\n\`\`\`\n\n| Name | Value |\n| --- | --- |\n| Example | ${cell} |`, ts: null },
    ],
  } }))
  await page.goto(`/#/a/${OMP_CHAT_PANE}`)
  const chat = page.locator('.chat')
  const code = chat.locator('.md-body .code-block pre')
  const table = chat.locator('.md-body table')
  await expect(code).toBeVisible()
  await expect(table).toBeVisible()
  await expect(chat.locator('.omp-job-head code')).toBeVisible()
  await expect(chat.locator('.msg-system')).toContainText(system)
  await expect(chat.locator('.md-body code[data-k="num"]')).toHaveText(number)

  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
    await expect.poll(() => chat.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)
    for (const scroller of [code, table]) {
      expect(await scroller.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true)
      expect(await scroller.evaluate(el => { el.scrollLeft = el.scrollWidth; return el.scrollLeft })).toBeGreaterThan(0)
    }
    const header = chat.locator('.code-head')
    expect(await header.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)
    await expect(header.getByRole('button', { name: 'Copy' })).toBeVisible()
  }
})

test('long pasted preview stays inside the message card', { tag: '@webkit-phone' }, async ({ page }) => {
  const paste = `${'长文本预览内容 '.repeat(80)}\n${'second preview line '.repeat(80)}\n${'more text\n'.repeat(20)}`.trim()
  await page.route('**/api/chat?**', route => route.fulfill({ json: {
    available: true, token: 'paste-fixture', file: '/home/user/chat.jsonl',
    items: [{ role: 'user', text: `Please review:\n\n${paste}`, pasted: [paste], ts: null }],
  } }))
  await page.goto(`/#/a/${OMP_CHAT_PANE}`)
  const card = page.locator('.chat .pasted-card')
  await expect(card.locator('.pasted-line')).toHaveCount(2)
  expect(await card.evaluate(el => {
    const right = el.getBoundingClientRect().right
    return Math.max(...Array.from(el.querySelectorAll('.pasted-line'), line => line.getBoundingClientRect().right - right))
  })).toBeLessThanOrEqual(1)
  expect(await page.locator('.chat').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)
  await card.getByRole('button', { name: 'Open pasted text' }).click()
  await expect(page.locator('.hw-sheet .pasted-full')).toHaveText(paste.trim())
})
