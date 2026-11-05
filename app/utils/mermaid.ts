// Render untrusted diagrams in strict mode; display the result as an inert image.
import type { Mermaid } from 'mermaid'
import { createRenderCache } from './renderCache'

let mermaidPromise: Promise<Mermaid> | null = null
let queue: Promise<unknown> = Promise.resolve()
const cache = createRenderCache<string>(100, 4_000_000)

function getMermaid(): Promise<Mermaid> {
  return mermaidPromise ||= import('mermaid').then(m => m.default || m)
}

export async function renderMermaid(source: string, isDark: boolean): Promise<string | null> {
  const text = source.trim()
  if (!text || text.length > 50_000) return null
  const key = `${isDark ? 'd' : 'l'}:${text}`
  const cached = cache.get(key)
  if (cached !== undefined) return cached

  // Mermaid's configuration is global: serialize initialization and rendering
  // so concurrent light and dark requests cannot change each other's theme.
  const result = queue.then(async () => {
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    try {
      const mermaid = await getMermaid()
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'suppressErrorRendering', 'maxEdges', 'themeCSS', 'fontFamily', 'htmlLabels', 'theme'],
        theme: isDark ? 'dark' : 'default',
        fontFamily: 'monospace',
        htmlLabels: false,
        suppressErrorRendering: true,
      })
      const id = `mermaid-${Math.random().toString(36).slice(2, 10)}`
      const { svg } = await mermaid.render(id, text)
      if (!svg) return null
      const image = `data:image/svg+xml,${encodeURIComponent(svg)}`
      cache.set(key, image, key.length + image.length)
      return image
    } catch {
      return null
    }
  })
  queue = result.then(() => undefined, () => undefined)
  return result
}
