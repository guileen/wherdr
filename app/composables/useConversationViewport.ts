import { computed, nextTick, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import { captureReadingAnchor, readingAnchorTop } from '../utils/readingAnchor'
import type { ReadingAnchor } from '../utils/readingPosition'

// Only this owner writes the conversation scroll position. Scroll events report
// geometry; wheel/touch/key/thumb input supplies intent, never bottom proximity.
export function useConversationViewport(box: Ref<HTMLElement | null>, list: Ref<HTMLElement | null>) {
  const mode = ref<'following' | 'reading'>('following')
  const hasNewBelow = ref(false)
  const reading = computed(() => mode.value === 'reading')
  let anchor: ReadingAnchor | null = null
  let version = 0
  let disposed = false
  let frame = 0
  let captureFrame = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let pressed = false
  let active = false
  let direction = 0
  let previousTop = 0
  let ownTop: number | null = null
  let touchY = 0
  const idleWaiters = new Set<() => void>()
  const atBottom = () => !box.value || box.value.scrollHeight - box.value.clientHeight - box.value.scrollTop <= 2
  const capture = () => box.value && list.value ? captureReadingAnchor(box.value, list.value) : null
  function write(top: number) {
    const b = box.value
    if (!b || disposed) return
    b.scrollTop = top
    ownTop = b.scrollTop
    previousTop = b.scrollTop
  }
  function cancel() {
    version++
    cancelAnimationFrame(frame)
    cancelAnimationFrame(captureFrame)
    frame = captureFrame = 0
  }
  function hold() {
    cancel()
    mode.value = 'reading'
    anchor = capture()
  }
  function follow() {
    cancel()
    active = false
    mode.value = 'following'
    anchor = null
    maintain()
  }
  function reconcile() {
    const b = box.value
    if (!b || disposed || active) return
    if (mode.value === 'following') {
      write(b.scrollHeight)
      if (atBottom()) hasNewBelow.value = false
    } else if (anchor && list.value) {
      const top = readingAnchorTop(list.value, anchor)
      if (top !== null) {
        const delta = top - b.getBoundingClientRect().top - anchor.viewportOffset
        if (Math.abs(delta) > 2) {
          const requested = b.scrollTop + delta
          write(requested)
          // A larger viewport/shorter list can make the old offset impossible.
          // Rebase now; do not replay that debt when later output adds space.
          if (Math.abs(b.scrollTop - requested) > 2) anchor = capture() || anchor
        }
      }
    }
  }
  function maintain() {
    if (frame || disposed) return
    const v = version
    frame = requestAnimationFrame(() => {
      frame = 0
      if (v === version) reconcile()
    })
  }
  function settle() {
    if (pressed || disposed) return
    clearTimeout(timer)
    const wasActive = active
    active = false
    if (wasActive && direction > 0 && atBottom()) {
      mode.value = 'following'
      hasNewBelow.value = false
      anchor = null
    } else if (mode.value === 'reading') anchor = capture()
    direction = 0
    for (const resolve of idleWaiters) resolve()
    idleWaiters.clear()
    if (mode.value === 'following') maintain()
  }
  function quiet() {
    clearTimeout(timer)
    timer = setTimeout(settle, 160)
  }
  function input(d: number) {
    cancel()
    active = true
    direction = d
    if (d < 0) mode.value = 'reading'
    quiet()
  }
  function onWheel(event: WheelEvent) {
    if (event.deltaY) input(Math.sign(event.deltaY))
  }
  function onTouchStart(event: TouchEvent) {
    pressed = true
    touchY = event.touches[0]?.clientY || 0
    cancel()
    active = true
  }
  function onTouchMove(event: TouchEvent) {
    const y = event.touches[0]?.clientY ?? touchY
    if (y !== touchY) input(Math.sign(touchY - y))
    touchY = y
  }
  function onTouchEnd() { pressed = false; quiet() }
  function onPointerDown(event: PointerEvent) {
    // Touch has its own direction tracking. Mouse/pen can drag the scrollbar.
    if (event.pointerType === 'touch') return
    pressed = true
    cancel()
    active = true
  }
  function onPointerUp() { if (pressed) { pressed = false; quiet() } }
  function onKeydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || target?.closest('input, textarea, select, [contenteditable="true"]')) return
    if (event.key === ' ' && target?.closest('button, [role="button"]')) return
    const up = event.key === 'ArrowUp' || event.key === 'PageUp' || event.key === 'Home' || (event.key === ' ' && event.shiftKey)
    const down = event.key === 'ArrowDown' || event.key === 'PageDown' || event.key === 'End' || (event.key === ' ' && !event.shiftKey)
    if (up || down) input(up ? -1 : 1)
  }
  function onScroll() {
    const b = box.value
    if (!b) return
    const top = b.scrollTop
    const self = ownTop !== null && Math.abs(top - ownTop) <= 2
    ownTop = null
    const delta = top - previousTop
    previousTop = top
    if (active && !self) {
      if (delta < -2) { direction = -1; mode.value = 'reading' }
      else if (delta > 2 && !direction) direction = 1
      quiet()
      if (!captureFrame) captureFrame = requestAnimationFrame(() => {
        captureFrame = 0
        if (mode.value === 'reading') anchor = capture()
      })
    }
  }
  async function idle() {
    if (active && !disposed) await new Promise<void>(resolve => idleWaiters.add(resolve))
  }
  async function change(update: () => void, newBelow: boolean | (() => boolean) = false) {
    await idle()
    if (disposed) return
    if (mode.value === 'reading') anchor = capture() || anchor
    const v = version
    if (mode.value === 'reading' && (typeof newBelow === 'function' ? newBelow() : newBelow)) hasNewBelow.value = true
    update()
    await nextTick()
    // Complete this geometry transaction before another reveal can snapshot it.
    if (v === version) reconcile()
  }
  function restore(saved: ReadingAnchor, newBelow: boolean) {
    hold()
    active = false
    direction = 0
    anchor = saved
    hasNewBelow.value = newBelow
    if (!list.value || readingAnchorTop(list.value, saved) === null) return false
    reconcile()
    return true
  }
  function locate(rect: DOMRect, align: 'center' | 'start' = 'center') {
    hold()
    active = false
    const b = box.value
    if (!b) return
    write(b.scrollTop + rect.top - b.getBoundingClientRect().top - (align === 'center' ? b.clientHeight / 2 : 0))
    anchor = capture()
  }
  function noteNewBelow() {
    if (mode.value === 'reading') hasNewBelow.value = true
    else maintain()
  }
  let observer: ResizeObserver | undefined
  let mutations: MutationObserver | undefined
  onMounted(() => {
    observer = new ResizeObserver(maintain)
    if (box.value) observer.observe(box.value)
    if (list.value) observer.observe(list.value)
    if (list.value) {
      mutations = new MutationObserver(maintain)
      mutations.observe(list.value, { subtree: true, childList: true, characterData: true })
    }
    document.fonts?.addEventListener('loadingdone', maintain)
    window.addEventListener('pointerup', onPointerUp, true)
    box.value?.addEventListener('scrollend', settle)
  })
  onBeforeUnmount(() => {
    disposed = true
    cancel()
    cancelAnimationFrame(captureFrame)
    clearTimeout(timer)
    observer?.disconnect()
    mutations?.disconnect()
    document.fonts?.removeEventListener('loadingdone', maintain)
    window.removeEventListener('pointerup', onPointerUp, true)
    box.value?.removeEventListener('scrollend', settle)
    for (const resolve of idleWaiters) resolve()
    idleWaiters.clear()
  })
  return {
    mode, reading, hasNewBelow, atBottom, hold, follow, maintain, change, idle, restore, locate, noteNewBelow,
    snapshot: () => anchor || capture(), intentVersion: () => version,
    onWheel, onTouchStart, onTouchMove, onTouchEnd, onPointerDown, onKeydown, onScroll,
  }
}
