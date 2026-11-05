import { expect, test } from './test'
import { fakeHerdr, OMP_QUESTIONS_PANE, SPLIT_CHAT_PANE, SPLIT_TAB } from './scenario.mjs'

const footer = (pct: number) => [
  `──────────────── ◫ ${pct}%/200K ────────────────`,
  '❯ ',
  '──────────────────────────────────────────────',
  '◒ Test model · 📁 ~/project',
].join('\n')

// Screens, snapshots and UI all use the real server polling path.
test('OMP context retains stale gauges, updates unviewed workers and isolates replacement sessions', { tag: ['@chromium-desktop', '@webkit-phone'] }, async ({ page, request }, info) => {
  const pane = SPLIT_CHAT_PANE
  const original = await fakeHerdr('e2e.pane_field', { pane_id: pane, field: 'session' })
  const interrupts: string[] = []
  page.on('request', r => { if (new URL(r.url()).pathname === '/api/interrupt') interrupts.push(r.url()) })
  const reading = async () => {
    const state = await (await request.get('/api/state')).json()
    return state.panes.find((p: { id: string }) => p.id === pane)?.ompStatus ?? null
  }
  try {
    await fakeHerdr('e2e.interaction_screen', { pane_id: pane, agent: 'omp', status: 'working', text: footer(68) })
    // This OMP is not the selected conversation, but working cards still update.
    await page.goto(`/#/a/${OMP_QUESTIONS_PANE}`)
    await expect.poll(reading).toMatchObject({ metersFresh: true, meters: expect.stringContaining('68%/200K') })
    await page.goto(`/#/a/${pane}`)
    const phone = await page.evaluate(() => matchMedia('(pointer: coarse)').matches)
    const header = page.locator('.agent-top')
    const indicator = header.locator(phone ? '.omp-context-tokens' : '.omp-context')
    const progress = header.getByRole('progressbar')
    await expect(indicator).toHaveText(phone ? '·136K' : '136K')
    await expect(progress).toHaveAttribute('aria-valuenow', '68')
    await expect(page.locator('.composer .omp-context')).toHaveCount(0)
    if (phone) {
      expect((await page.locator('.prompt').boundingBox())!.height).toBeLessThanOrEqual(60)
      expect((await header.boundingBox())!.height).toBe(44)
      const viewport = page.viewportSize()!
      await page.setViewportSize({ width: 320, height: viewport.height })
      await page.evaluate(() => { document.documentElement.style.fontSize = '20.8px' })
      const geometry = await indicator.evaluate(el => {
        const r = el.getBoundingClientRect(), copy = el.closest('.phone-identity-copy')!.getBoundingClientRect()
        return { width: el.clientWidth, content: el.scrollWidth, left: r.left, right: r.right, copyLeft: copy.left, copyRight: copy.right }
      })
      expect(geometry.content).toBeLessThanOrEqual(geometry.width)
      expect(geometry.left).toBeGreaterThanOrEqual(geometry.copyLeft)
      expect(geometry.right).toBeLessThanOrEqual(geometry.copyRight)
      await page.evaluate(() => { document.documentElement.style.fontSize = '' })
      await page.setViewportSize(viewport)
    }
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${info.project.name}-context-rest.png` })
    await page.locator('.prompt').locator('textarea, [contenteditable="true"]').first().focus()
    await expect(indicator).toBeVisible()
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${info.project.name}-context.png` })
    await (phone ? page.locator('.phone-identity') : indicator).click()
    await expect(page.locator('.omp-context-detail')).toContainText('estimated')
    if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${info.project.name}-context-details.png` })
    const detail = await page.locator('.omp-context-detail').boundingBox()
    expect(detail).not.toBeNull()
    expect(detail!.x).toBeGreaterThanOrEqual(0)
    expect(detail!.y).toBeGreaterThanOrEqual(0)
    expect(detail!.x + detail!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
    expect(detail!.y + detail!.height).toBeLessThanOrEqual(page.viewportSize()!.height)
    await page.keyboard.press('Escape')
    await expect(page.locator('.omp-context-detail')).toHaveCount(0)
    expect(interrupts).toEqual([])

    // A successful read without gauges must not renew an old reading.
    await fakeHerdr('e2e.interaction_screen', { pane_id: pane, text: 'Full-screen panel' })
    await expect.poll(reading).toMatchObject({ metersFresh: false, meters: expect.stringContaining('68%/200K') })
    await expect(progress).toHaveAttribute('aria-label', /Last reading; not live/)

    // Compaction may lower usage: no high-water mark or accumulated-token proxy.
    await fakeHerdr('e2e.interaction_screen', { pane_id: pane, text: footer(8) })
    await expect.poll(reading).toMatchObject({ metersFresh: true, meters: expect.stringContaining('8%/200K') })
    await expect(indicator).toHaveText(phone ? '·16K' : '16K')
    await expect(progress).toHaveAttribute('aria-valuenow', '8')
    await expect(progress).not.toHaveAttribute('aria-label', /Last reading/)

    await fakeHerdr('e2e.read_failure', { pane_id: pane, fail: true })
    await expect.poll(reading).toMatchObject({ metersFresh: false, meters: expect.stringContaining('8%/200K') })
    await expect(progress).toHaveAttribute('aria-label', /Last reading; not live/)
    await fakeHerdr('e2e.read_failure', { pane_id: pane, fail: false })

    // Unviewed resting panes keep their reading without ongoing gauge polls.
    await fakeHerdr('e2e.interaction_screen', { pane_id: pane, status: 'idle', text: footer(8) })
    await page.goto(`/#/a/${OMP_QUESTIONS_PANE}`)
    const reads = async () => (await fakeHerdr('e2e.terminal_screen', { pane_id: pane })).detectionReads
    // Poll the published resting state before measuring subsequent server cycles.
    await expect.poll(async () => {
      const state = await (await request.get('/api/state')).json()
      return state.panes.find((p: { id: string }) => p.id === pane)?.status
    }).toMatch(/idle|done/)
    const count = await reads()
    for (let i = 0; i < 3; i++) {
      await page.waitForResponse(r => new URL(r.url()).pathname === '/api/chat')
      expect(await reads()).toBe(count)
    }
    await expect.poll(reading).toMatchObject({ meters: expect.stringContaining('8%/200K') })
    // A new turn must not present the prior turn's retained gauges as live.
    await fakeHerdr('e2e.interaction_screen', { pane_id: pane, status: 'working', text: footer(32), readDelayMs: 3000 })
    await expect.poll(reading).toMatchObject({ metersFresh: false, meters: expect.stringContaining('8%/200K') })
    await expect.poll(reading).toMatchObject({ metersFresh: true, meters: expect.stringContaining('32%/200K') })

    // A new session cannot inherit the former session's window or percentage.
    await fakeHerdr('e2e.interaction_screen', { pane_id: pane, status: 'working', text: 'Starting new session' })
    await fakeHerdr('e2e.update_session', { pane_id: pane, session: 'replacement-context-session' })
    await expect.poll(reading).toBeNull()
    await expect(indicator).toHaveCount(0)
    await expect(progress).toHaveCount(0)
    expect(interrupts).toEqual([])
  } finally {
    await fakeHerdr('e2e.read_failure', { pane_id: pane, fail: false })
    await fakeHerdr('e2e.update_session', { pane_id: pane, session: original.value })
    await fakeHerdr('e2e.interaction_screen', { pane_id: pane, agent: 'omp', status: 'idle', text: null })
  }
})

test('context details remain accessible when a split pane is narrowed', { tag: '@chromium-desktop' }, async ({ page, isMobile }) => {
  test.skip(isMobile, 'Desktop split panes')
  await fakeHerdr('e2e.interaction_screen', { pane_id: SPLIT_CHAT_PANE, agent: 'omp', status: 'working', text: footer(68) })
  await page.setViewportSize({ width: 1000, height: 800 })
  await page.goto(`/#/t/${SPLIT_TAB}`)
  const cell = page.locator('.cell-view').first()
  const tokens = cell.locator('.omp-context')
  await expect(tokens).toHaveText('136K')
  const divider = page.locator('.divider.right').first()
  const box = (await divider.boundingBox())!
  const x = box.x + box.width / 2, y = box.y + box.height / 2
  try {
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x - 190, y, { steps: 12 })
    await page.mouse.up()
    const meta = (await cell.locator('.agent-meta').boundingBox())!
    const token = (await tokens.boundingBox())!
    expect(token.y).toBeGreaterThanOrEqual(meta.y)
    expect(token.y + token.height).toBeLessThanOrEqual(meta.y + meta.height + 1)
    expect(token.x + token.width).toBeLessThanOrEqual(meta.x + meta.width + 1)
    await tokens.click()
    await expect(page.locator('.omp-context-detail')).toContainText('200,000')
  } finally {
    if (await page.locator('.omp-context-detail').isVisible()) await page.keyboard.press('Escape')
    const current = await divider.boundingBox()
    if (current) {
      await page.mouse.move(current.x + current.width / 2, y)
      await page.mouse.down()
      await page.mouse.move(x, y, { steps: 12 })
      await page.mouse.up()
    }
    await fakeHerdr('e2e.interaction_screen', { pane_id: SPLIT_CHAT_PANE, agent: 'omp', status: 'idle', text: null })
  }
})
