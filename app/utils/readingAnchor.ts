import type { ReadingAnchor } from './readingPosition'

function textNodes(el: Element) {
  return document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: node => node.textContent?.trim() && !node.parentElement?.closest('button, script, style, [aria-hidden="true"]')
      ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  })
}
function charRect(node: Node, offset: number) {
  const range = document.createRange()
  range.setStart(node, offset)
  range.setEnd(node, Math.min(offset + 1, node.textContent?.length || 0))
  return range.getBoundingClientRect()
}
export function anchorElement(list: HTMLElement, key: string): HTMLElement | null {
  // CSS.escape handles source IDs as well as cached, older block keys.
  return list.querySelector<HTMLElement>(`[data-hit-key="${CSS.escape(key)}"]`)
}
export function captureReadingAnchor(box: HTMLElement, list: HTMLElement): ReadingAnchor | null {
  const bounds = box.getBoundingClientRect()
  const candidate = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + 8)?.closest<HTMLElement>('[data-hit-key]')
  const el = candidate && list.contains(candidate) ? candidate : Array.from(list.querySelectorAll<HTMLElement>('[data-hit-key]')).find(el => {
    const r = el.getBoundingClientRect()
    return r.bottom > bounds.top + 2 && r.top < bounds.bottom
  })
  if (!el?.dataset.hitKey) return null
  const walker = textNodes(el)
  let offset = 0
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent || ''
    const range = document.createRange()
    range.selectNodeContents(node)
    const rect = range.getBoundingClientRect()
    if (rect.height && rect.bottom > bounds.top + 2 && rect.top < bounds.bottom) {
      let lo = 0, hi = text.length - 1
      while (lo < hi) {
        const mid = (lo + hi) >>> 1
        if (charRect(node, mid).bottom <= bounds.top + 2) lo = mid + 1
        else hi = mid
      }
      return {
        key: el.dataset.hitKey, textOffset: offset + lo, text: text.slice(lo, lo + 48),
        viewportOffset: charRect(node, lo).top - bounds.top,
      }
    }
    offset += text.length
  }
  return { key: el.dataset.hitKey, textOffset: 0, text: '', viewportOffset: el.getBoundingClientRect().top - bounds.top }
}
export function readingAnchorTop(list: HTMLElement, anchor: ReadingAnchor): number | null {
  const el = anchorElement(list, anchor.key)
  if (!el) return null
  if (!anchor.text) return el.getBoundingClientRect().top
  const walker = textNodes(el)
  let offset = anchor.textOffset
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent || ''
    if (offset < text.length) {
      // A changed passage must not silently become a different text position.
      if (!text.slice(offset).startsWith(anchor.text)) return null
      return charRect(node, offset).top
    }
    offset -= text.length
  }
  return null
}
