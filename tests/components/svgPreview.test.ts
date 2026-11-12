import { describe, expect, it } from 'vitest'
import { svgPreview } from '~/utils/svgPreview'

const drawing = '<svg viewBox="0 0 240 80"><defs><linearGradient id="paint"><stop stop-color="var(--accent)"/><stop offset="1" stop-color="var(--c2)"/></linearGradient><marker id="arrow" markerWidth="5" markerHeight="5" refX="3" refY="2"><path d="M0 0L4 2L0 4Z" fill="currentColor"/></marker></defs><rect width="240" height="80" fill="url(#paint)"/><path d="M10 40H200" stroke="var(--fg)" marker-end="url(#arrow)"/><text x="20" y="45">Ready &amp; safe</text></svg>'
const decoded = (src: string) => new DOMParser().parseFromString(decodeURIComponent(src.split(',')[1]!), 'image/svg+xml')

describe('isolated SVG images', () => {
  it('preserves static geometry, text and local paint/marker references in an image', () => {
    const src = svgPreview(drawing, { fg: '#eeeeee', accent: '#ff8800', c2: '#00ff00' })!
    expect(src).toMatch(/^data:image\/svg\+xml,/)
    const svg = decoded(src)
    expect(svg.querySelector('rect')?.getAttribute('fill')).toBe('url(#paint)')
    expect(svg.querySelector('path[marker-end]')?.getAttribute('marker-end')).toBe('url(#arrow)')
    expect(svg.querySelector('text')?.textContent).toBe('Ready & safe')
    expect(svg.documentElement.getAttribute('style')).toContain('color:#eeeeee')
    expect(svg.querySelector('stop')?.getAttribute('stop-color')).toBe('#ff8800')
    expect(svg.documentElement.getAttribute('fill')).toBe('currentColor')
    expect(svg.documentElement.getAttribute('style')).not.toContain('background')
  })

  it('keeps allowlisted inline styles, resolving theme variables', () => {
    const src = svgPreview('<svg viewBox="0 0 100 40"><rect width="100" height="40" style="fill:var(--surface);stroke:var(--border)"/><text x="2" y="20" style="fill:var(--fg);font-weight:600">Ready</text></svg>', { fg: '#abcdef' })!
    expect(decoded(src).querySelector('text')?.getAttribute('style')).toBe('fill:#abcdef;font-weight:600')
  })

  it('resolves every supported diagram token without inheriting implicit black', () => {
    const names = ['fg', 'muted', 'border', 'surface', 'accent', 'success', 'warning', 'error', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6'] as const
    const colors = Object.fromEntries(names.map((name, i) => [name, `#${String(i + 1).padStart(6, '0')}`]))
    const shapes = names.map((name, i) => `<rect x="${i * 2}" width="2" height="10" fill="var(--${name})"/>`).join('')
    const svg = decoded(svgPreview(`<svg viewBox="0 0 40 10">${shapes}</svg>`, colors)!)
    expect([...svg.querySelectorAll('rect')].map(el => el.getAttribute('fill'))).toEqual(names.map(name => colors[name]))
    expect(svg.documentElement.getAttribute('fill')).toBe('currentColor')
  })

  it('resolves the app custom properties that carry a hyphen', () => {
    const svg = decoded(svgPreview('<svg viewBox="0 0 60 10"><rect width="20" height="10" fill="var(--bg-2)"/><rect x="20" width="20" height="10" fill="var(--line-soft)"/><rect x="40" width="20" height="10" fill="var(--text-2)"/></svg>')!)!
    const fills = [...svg.querySelectorAll('rect')].map(el => el.getAttribute('fill'))
    expect(fills).toHaveLength(3)
    for (const fill of fills) {
      expect(fill).toBeTruthy()
      expect(fill).not.toContain('var(')
    }
  })

  it('resolves direct palette color names and variable fallbacks', () => {
    const src = svgPreview('<svg viewBox="0 0 100 40"><rect width="50" height="40" fill="var(--ochre)"/><rect x="50" width="50" height="40" fill="var(--unknown, #aabbcc)"/></svg>')!
    expect(src).not.toBeNull()
    const svg = decoded(src)
    const rects = svg.querySelectorAll('rect')
    expect(rects[0]?.getAttribute('fill')).toMatch(/^(?:#[\da-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([\d\s.,%+/-]+\)|[a-z]+)$/i)
    expect(rects[1]?.getAttribute('fill')).toBe('#aabbcc')
  })

  it('resolves a <style> sheet onto its elements and drops the sheet', () => {
    const src = svgPreview(`<svg viewBox="0 0 100 40"><style>
      /* diagram tokens */
      .card { fill: var(--surface); stroke: var(--border) }
      #hot { fill: var(--accent) }
      g > text { fill: var(--fg); font-weight: 600 }
      rect { stroke-width: 2 }
      svg .card { opacity: .5 }
    </style><rect class="card" width="40" height="20"/><g><text y="10">A</text></g><rect id="hot" width="10" height="10"/></svg>`, { fg: '#eeeeee', accent: '#ff8800' })!
    const svg = decoded(src)
    const style = (el: Element | null) => Object.fromEntries((el?.getAttribute('style') || '').split(';').map(pair => pair.split(':')))
    expect(svg.querySelector('style')).toBeNull()
    const [card, hot] = [...svg.querySelectorAll('rect')]
    expect(style(card!)).toEqual({ fill: expect.stringMatching(/^#[\da-f]{6}$/), stroke: expect.stringMatching(/^#[\da-f]{6}$/), 'stroke-width': '2', opacity: '.5' })
    expect(style(hot!)).toEqual({ fill: '#ff8800', 'stroke-width': '2' })
    expect(style(svg.querySelector('text'))).toEqual({ fill: '#eeeeee', 'font-weight': '600' })
  })

  it('keeps inline declarations above a sheet and presentation attributes', () => {
    const src = svgPreview('<svg viewBox="0 0 20 20"><style>rect { fill: red; stroke: var(--fg) }</style><rect width="10" height="10" fill="blue" style="fill:var(--accent)"/></svg>', { accent: '#00ff00', fg: '#eeeeee' })!
    const style = Object.fromEntries(decoded(src).querySelector('rect')!.getAttribute('style')!.split(';').map(pair => pair.split(':')))
    expect(style).toEqual({ fill: '#00ff00', stroke: '#eeeeee' })
  })

  it.each([
    '<style>[data-x] { fill: red }</style>',
    '<style>rect:hover { fill: red }</style>',
    '<style>rect + rect { fill: red }</style>',
    '<style>@media all { rect { fill: red } }</style>',
    '<style>rect { fill: red } rect { fill: blue</style>',
  ])('refuses a sheet it cannot apply faithfully: %s', (payload) => {
    expect(svgPreview(`<svg viewBox="0 0 40 40"><rect width="20" height="20"/>${payload}</svg>`)).toBeNull()
  })

  it.each([
    '<svg viewBox="0 0 100 40"><rect width="100"',
    '<svg viewBox="0 0 100 40"></svg>',
    '<svg><defs><path id="only-definition" d="M0 0L20 20"/></defs></svg>',
    '<svg width="0" height="40"><rect width="20" height="20"/></svg>',
    'not SVG',
  ])('leaves incomplete or nonvisual content as readable source: %s', (source) => {
    expect(svgPreview(source)).toBeNull()
  })

  it.each([
    '<script>alert(1)</script>',
    '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">Active HTML</div></foreignObject>',
    '<rect width="20" height="20" onload="alert(1)"/>',
    '<a href="https://example.com"><text y="20">Go</text></a>',
    '<image href="https://example.com/pixel.svg"/>',
    '<use href="https://example.com/pixel.svg#shape"/>',
    '<use href="data:image/svg+xml,evil"/>',
    '<use xmlns:x="http://www.w3.org/1999/xlink" x:href="https://example.com/pixel.svg#shape"/>',
    '<set attributeName="href" to="https://example.com/pixel.svg"/>',
    '<rect width="20" height="20" fill="url(https://example.com/paint)"/>',
    '<rect width="20" height="20" style="fill:u\\72l(https://example.com/paint)"/>',
    '<style>@import "https://example.com/style.css";</style>',
    '<style>rect { fill: url(//example.com/paint) }</style>',
    '<animate attributeName="href" to="https://example.com"/>',
  ])('refuses active content and external resources: %s', (payload) => {
    expect(svgPreview(`<svg viewBox="0 0 40 40"><rect width="20" height="20"/>${payload}</svg>`)).toBeNull()
  })

  it('accepts only references contained in the same image, without recursive use', () => {
    expect(svgPreview('<svg viewBox="0 0 40 40"><defs><path id="shape" d="M0 0L20 20"/></defs><use href="#shape" stroke="currentColor"/></svg>')).not.toBeNull()
    expect(svgPreview('<svg xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 40 40"><defs><path id="shape" d="M0 0L20 20"/></defs><use xlink:href="#shape" stroke="currentColor"/></svg>')).not.toBeNull()
    expect(svgPreview('<svg><rect width="20" height="20" fill="url(#parent-dom-id)"/></svg>')).toBeNull()
    expect(svgPreview('<svg><use href="#missing"/></svg>')).toBeNull()
    expect(svgPreview('<svg><g id="cycle"><use href="#cycle"/></g></svg>')).toBeNull()
    expect(svgPreview('<!DOCTYPE svg [<!ENTITY x "external">]><svg><text>&x;</text></svg>')).toBeNull()
    expect(svgPreview('<?xml-stylesheet href="https://example.com/style.css"?><svg><text y="20">Unsafe</text></svg>')).toBeNull()
  })

  it('bounds acyclic reference expansion before the image renderer can multiply it', () => {
    const definitions = ['<g id="item0"><rect width="10" height="10"/></g>']
    for (let index = 1; index < 20; index++) definitions.push(`<g id="item${index}"><use href="#item${index - 1}"/><use href="#item${index - 1}"/></g>`)
    const source = `<svg viewBox="0 0 40 40"><defs>${definitions.join('')}</defs><use href="#item19"/></svg>`
    expect(svgPreview(source)).toBeNull()
  })
})
