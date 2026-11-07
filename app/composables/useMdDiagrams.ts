// Diagrams of a Markdown body (`svg` and `mermaid` fences, utils/markdown.ts):
// inert images in the page, switched to their source on demand, and rendered
// again when the theme changes. Shared by a conversation (ChatMarkdown.vue)
// and a Markdown file (FilesView.vue).
import type { Ref } from 'vue'
import { SVG_THEME_VARS, svgPreview } from '~/utils/svgPreview'
import type { SvgColors } from '~/utils/svgPreview'
import { renderMermaid } from '~/utils/mermaid'

export interface MdDiagramOptions {
  // An image that is not a diagram and cannot show: give it a fallback note.
  fallback?: (img: HTMLImageElement) => void
  // The host can enlarge images in a lightbox (a conversation; the file
  // explorer shows its document inside a modal sheet, above which the
  // lightbox cannot paint).
  zoom?: boolean
}
export function useMdDiagrams(el: Ref<HTMLElement | null>, options: MdDiagramOptions = {}) {
  const zoom = options.zoom !== false
  let themeObserver: MutationObserver | null = null
  let svgPalette = ''
  let mermaidTheme = ''
  let mermaidGeneration = 0

  function revealSvgSource(img: HTMLImageElement) {
    const block = img.closest('.svg-block')
    const source = block?.querySelector<HTMLElement>('.svg-source')
    if (!source) return false
    source.hidden = false
    const toggle = block?.querySelector<HTMLButtonElement>('.svg-toggle')
    if (toggle) { toggle.disabled = true; toggle.setAttribute('aria-pressed', 'true') }
    const note = document.createElement('p')
    note.className = 'svg-note'
    note.textContent = t('SVG preview unavailable. Source shown below.')
    img.replaceWith(note)
    return true
  }
  function revealMermaidSource(block: HTMLElement) {
    const source = block.querySelector<HTMLElement>('.mermaid-source')
    const stage = block.querySelector<HTMLElement>('.mermaid-stage')
    if (!source || !stage) return false
    source.hidden = false
    const toggle = block.querySelector<HTMLButtonElement>('.mermaid-toggle')
    if (toggle) { toggle.disabled = true; toggle.setAttribute('aria-pressed', 'true') }
    const note = document.createElement('p')
    note.className = 'mermaid-note'
    note.textContent = t('Mermaid preview unavailable. Source shown below.')
    stage.replaceWith(note)
    return true
  }
  function onPreviewToggle(event: MouseEvent) {
    const target = event.target as Element
    const svgButton = target.closest<HTMLButtonElement>('.svg-toggle')
    if (svgButton && !svgButton.disabled) {
      const block = svgButton.closest('.svg-block')
      const source = block?.querySelector<HTMLElement>('.svg-source')
      const image = block?.querySelector<HTMLImageElement>('img.svg-preview')
      if (!source || !image) return
      source.hidden = !source.hidden
      image.hidden = !source.hidden
      svgButton.setAttribute('aria-pressed', String(!source.hidden))
      svgButton.textContent = t(source.hidden ? 'Source' : 'Preview')
      return
    }
    const mermaidButton = target.closest<HTMLButtonElement>('.mermaid-toggle')
    if (mermaidButton && !mermaidButton.disabled) {
      const block = mermaidButton.closest('.mermaid-block')
      const source = block?.querySelector<HTMLElement>('.mermaid-source')
      const stage = block?.querySelector<HTMLElement>('.mermaid-stage')
      if (!source || !stage) return
      source.hidden = !source.hidden
      stage.hidden = !source.hidden
      mermaidButton.setAttribute('aria-pressed', String(!source.hidden))
      mermaidButton.textContent = t(source.hidden ? 'Source' : 'Preview')
    }
  }
  async function syncMermaidTheme(force = false) {
    const blocks = el.value?.querySelectorAll<HTMLElement>('.mermaid-block')
    if (!blocks?.length) return
    const isDark = getComputedStyle(document.documentElement).getPropertyValue('color-scheme').trim() !== 'light'
    const themeTag = isDark ? 'dark' : 'light'
    if (!force && mermaidTheme === themeTag) return
    mermaidTheme = themeTag
    const generation = ++mermaidGeneration
    for (const block of blocks) {
      const preview = block.querySelector<HTMLElement>('.mermaid-preview')
      const sourceEl = block.querySelector<HTMLElement>('.mermaid-source code')
      if (!preview || !sourceEl) continue
      const source = sourceEl.textContent || ''
      if (!source.trim()) continue
      const src = await renderMermaid(source, isDark)
      if (generation !== mermaidGeneration || !el.value?.contains(block)) return
      if (src) {
        const image = document.createElement('img')
        image.className = 'mermaid-image'
        image.alt = t('Mermaid diagram')
        if (zoom) {
          image.role = 'button'
          image.tabIndex = 0
          image.setAttribute('aria-label', t('Enlarge Mermaid diagram'))
        }
        image.src = src
        preview.replaceChildren(image)
      } else revealMermaidSource(block)
    }
  }
  function syncSvgTheme(force = false) {
    const blocks = el.value?.querySelectorAll<HTMLElement>('.svg-block')
    if (!blocks?.length) return
    const styles = getComputedStyle(document.documentElement)
    const colors: SvgColors = {}
    for (const [key, token] of Object.entries(SVG_THEME_VARS)) colors[key as keyof SvgColors] = styles.getPropertyValue(`--${token}`).trim()
    const palette = JSON.stringify(colors)
    if (!force && palette === svgPalette) return
    svgPalette = palette
    for (const block of blocks) {
      const img = block.querySelector<HTMLImageElement>('img.svg-preview')
      const source = block.querySelector('pre code')?.textContent
      const src = source == null ? null : svgPreview(source, colors)
      if (src) {
        if (img) {
          img.src = src
        } else {
          const note = block.querySelector('.svg-note')
          if (note) {
            const newImg = document.createElement('img')
            newImg.className = 'svg-preview'
            newImg.src = src
            newImg.alt = t('SVG preview')
            if (zoom) {
              newImg.role = 'button'
              newImg.tabIndex = 0
              newImg.setAttribute('aria-label', t('Enlarge SVG preview'))
            }
            note.replaceWith(newImg)
            const sourceEl = block.querySelector<HTMLElement>('.svg-source')
            if (sourceEl) sourceEl.hidden = true
            const toggle = block.querySelector<HTMLButtonElement>('.svg-toggle')
            if (toggle) {
              toggle.disabled = false
              toggle.setAttribute('aria-pressed', 'false')
              toggle.textContent = t('Source')
            }
          }
        }
      } else if (img) {
        revealSvgSource(img)
      }
    }
  }
  function observeThemes() {
    if (themeObserver || !el.value?.querySelector('.svg-block, .mermaid-block')) return
    themeObserver = new MutationObserver(() => {
      syncSvgTheme()
      void syncMermaidTheme()
    })
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] })
  }
  function syncAll(force = false) {
    syncSvgTheme(force)
    void syncMermaidTheme(force)
  }
  function onKey(e: KeyboardEvent) {
    if ((e.key !== 'Enter' && e.key !== ' ') || !(e.target instanceof HTMLImageElement) || !e.target.matches('.svg-preview, .mermaid-image')) return
    e.preventDefault()
    // Reuse ChatView's image click/lightbox delegation.
    e.target.click()
  }
  function onImageError(e: Event) {
    if (!(e.target instanceof HTMLImageElement)) return
    const mermaid = e.target.closest<HTMLElement>('.mermaid-block')
    if (mermaid) revealMermaidSource(mermaid)
    else if (!revealSvgSource(e.target)) options.fallback?.(e.target)
  }
  function teardown() {
    mermaidGeneration++
    themeObserver?.disconnect()
    themeObserver = null
  }
  return { onPreviewToggle, onKey, onImageError, observeThemes, syncSvgTheme, syncMermaidTheme, syncAll, teardown }
}
