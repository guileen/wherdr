import { test, type Locator, type Page } from './test'

export async function scrollConversation(page: Page, chat: Locator, delta: number) {
  if (test.info().project.name !== 'webkit-phone') {
    await chat.hover()
    await page.mouse.wheel(0, delta)
    return
  }
  // Playwright mobile WebKit has no wheel or swipe API. Exercise touch intent
  // and real WebKit layout; this does not prove physical-device inertia.
  await chat.evaluate((box, delta) => {
    const touch = (type: string, y: number) => {
      const event = new Event(type, { bubbles: true })
      Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : [{ identifier: 1, target: box, clientX: 100, clientY: y }] })
      box.dispatchEvent(event)
    }
    touch('touchstart', 300)
    touch('touchmove', 300 - delta)
    box.scrollTop += delta
    box.dispatchEvent(new Event('scroll'))
    touch('touchend', 300 - delta)
    box.dispatchEvent(new Event('scrollend'))
  }, delta)
}
