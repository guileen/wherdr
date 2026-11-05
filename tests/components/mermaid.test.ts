import { describe, expect, it } from 'vitest'
import { clearMermaidCache, renderMermaid, sanitizeMermaidSvg } from '~/utils/mermaid'

describe('mermaid utils', () => {
  it('renders a valid flowchart to SVG with theme support', async () => {
    clearMermaidCache()
    const svgDark = await renderMermaid('graph TD\n  A --> B', true)
    expect(svgDark).not.toBeNull()
    expect(svgDark).toContain('<svg')
    expect(svgDark).toContain('id="mermaid-')

    // Second call should hit the cache
    const cached = await renderMermaid('graph TD\n  A --> B', true)
    expect(cached).toBe(svgDark)

    // Light theme should render with different cache key
    const svgLight = await renderMermaid('graph TD\n  A --> B', false)
    expect(svgLight).not.toBeNull()
    expect(svgLight).toContain('<svg')
  })

  it('returns null on invalid mermaid syntax', async () => {
    clearMermaidCache()
    const result = await renderMermaid('this is completely invalid syntax %%%', true)
    expect(result).toBeNull()
  })

  it('sanitizes script tags and dangerous attributes from SVG', () => {
    const malicious = '<svg><script>alert(1)</script><circle cx="50" cy="50" r="40" onload="alert(2)" /><a href="javascript:alert(3)">link</a></svg>'
    const sanitized = sanitizeMermaidSvg(malicious)
    expect(sanitized).not.toContain('<script')
    expect(sanitized).not.toContain('onload=')
    expect(sanitized).not.toContain('javascript:')
    expect(sanitized).toContain('<circle')
  })
})
