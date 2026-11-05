// Lazy mermaid loader and renderer for session conversation diagrams.
// Keeps the initial bundle small and renders on-demand with theme support.
import type { Mermaid } from 'mermaid'

let mermaidPromise: Promise<Mermaid> | null = null
let currentTheme: 'dark' | 'default' | null = null

interface GlobalWithCssStyleSheet {
  CSSStyleSheet?: unknown
}

export async function getMermaid(): Promise<Mermaid> {
  if (typeof window !== 'undefined') {
    const win = window as unknown as GlobalWithCssStyleSheet
    const glob = globalThis as Record<string, unknown>
    if (typeof glob.CSSStyleSheet === 'undefined' && win.CSSStyleSheet) {
      glob.CSSStyleSheet = win.CSSStyleSheet
    }
    const svgProto = window.SVGElement?.prototype as unknown as { getBBox?: () => DOMRect }
    if (svgProto && !svgProto.getBBox) {
      svgProto.getBBox = () => ({
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        top: 0,
        right: 100,
        bottom: 100,
        left: 0,
        toJSON: () => {},
      })
    }
  }

  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(m => m.default || m)
  }
  return mermaidPromise
}

export function sanitizeMermaidSvg(svg: string): string {
  return svg
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, '')
    .replace(/(?:href|src)\s*=\s*['"]\s*javascript:[^'"]*['"]/gi, '')
}

const renderCache = new Map<string, string>()

export function clearMermaidCache() {
  renderCache.clear()
}

export async function renderMermaid(source: string, isDark: boolean): Promise<string | null> {
  const text = source.trim()
  if (!text) return null
  const cacheKey = `${isDark ? 'd' : 'l'}:${text}`
  const cached = renderCache.get(cacheKey)
  if (cached !== undefined) return cached

  try {
    const mermaid = await getMermaid()
    const theme = isDark ? 'dark' : 'default'
    if (currentTheme !== theme) {
      currentTheme = theme
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'loose',
        theme,
        fontFamily: 'var(--mono)',
        suppressErrorRendering: true,
      })
    }
    const id = `mermaid-${Math.random().toString(36).slice(2, 10)}`
    const { svg } = await mermaid.render(id, text)
    if (!svg) return null
    const sanitized = sanitizeMermaidSvg(svg)
    renderCache.set(cacheKey, sanitized)
    return sanitized
  } catch {
    return null
  }
}
