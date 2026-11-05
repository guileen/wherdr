import { expect, test } from './test'
import { OMP_CHAT_PANE } from './scenario.mjs'

const svg = '<svg viewBox="0 0 240 80"><rect x="1" y="1" width="238" height="78" fill="var(--surface)" stroke="currentColor"/><text x="20" y="45" fill="var(--fg)">SVG diagram</text></svg>'
const mermaid = 'graph TD\n  A[Start] --> B[Finish]'
const unsafeSvg = '<svg viewBox="0 0 40 40"><rect width="40" height="40" onload="alert(1)"/></svg>'

test('conversation diagrams render, switch to source, and follow the theme', { tag: '@webkit-phone' }, async ({ page, context, browserName }) => {
  if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.route('**/api/chat?**', route => route.fulfill({ json: {
    available: true, token: 'diagrams', file: '/home/user/chat.jsonl', items: [{
      role: 'assistant', ts: null,
      text: `Diagrams\n\n\`\`\`svg\n${svg}\n\`\`\`\n\n\`\`\`mermaid\n${mermaid}\n\`\`\`\n\n\`\`\`mermaid\ninvalid syntax %%%\n\`\`\`\n\n\`\`\`svg\n${unsafeSvg}\n\`\`\`\n\n<svg><circle r="10"/></svg>`,
    }],
  } }))
  await page.goto(`/#/a/${OMP_CHAT_PANE}`)
  const svgCard = page.locator('.svg-block').first()
  const diagram = page.locator('.mermaid-block').first()
  const svgImage = svgCard.locator('img.svg-preview')
  const mermaidImage = diagram.locator('img.mermaid-image')
  await expect.poll(() => svgImage.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0)
  await expect.poll(() => mermaidImage.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0)
  await expect(page.locator('.mermaid-block').last().locator('.mermaid-source')).toBeVisible()
  await expect(page.locator('.svg-block').last().locator('.svg-source')).toBeVisible()
  await expect(page.locator('.md-body svg')).toHaveCount(0)
  const darkSrc = await mermaidImage.getAttribute('src')
  await page.evaluate(() => { document.documentElement.style.colorScheme = 'light' })
  await expect.poll(() => mermaidImage.getAttribute('src')).not.toBe(darkSrc)
  await expect.poll(() => mermaidImage.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0)

  for (const [card, source] of [[svgCard, svg], [diagram, mermaid]] as const) {
    if (browserName === 'chromium') {
      await card.getByRole('button', { name: 'Copy' }).click()
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(source)
    }
    await card.getByRole('button', { name: 'Source' }).click()
    await expect(card.locator('pre')).toHaveText(source)
    await expect(card.locator('.code-copy')).toBeVisible()
    await card.getByRole('button', { name: 'Preview' }).click()
  }
  await mermaidImage.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Image' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Image' })).toBeHidden()
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
})
