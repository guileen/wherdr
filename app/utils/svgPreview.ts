// Only explicitly tagged `svg` fences are previews. Raw SVG is not promoted,
// and SVG nested in another language's fence remains ordinary copyable code.
// Static SVG is serialized into an image, never inserted in the app DOM. Reject
// unsupported/active content instead of showing a deceptively incomplete image.
// A `<style>` sheet is matched onto the elements it selects and then dropped, so
// the image carries only the allowlisted inline declarations.
import { DEFAULT_THEME, themeById } from './themes'

export const SVG_THEME_VARS = {
  fg: 'text', text: 'text',
  muted: 'muted', dim: 'dim',
  border: 'line', line: 'line',
  surface: 'surface', bg: 'bg',
  accent: 'accent', mauve: 'accent',
  success: 'done', done: 'done',
  warning: 'blocked', blocked: 'blocked',
  error: 'danger', danger: 'danger',
  blue: 'blue', teal: 'teal', green: 'green', ochre: 'ochre', lav: 'lav', rose: 'rose', coral: 'coral',
  c1: 'blue', c2: 'teal', c3: 'green', c4: 'ochre', c5: 'lav', c6: 'rose',
  // The app's own custom properties, so a diagram can use main.css names.
  'bg-2': 'bg2', 'surface-2': 'surface2', 'surface-3': 'surface2',
  'line-soft': 'line', 'text-2': 'text', 'text-3': 'muted',
} as const
export type SvgColors = Partial<Record<keyof typeof SVG_THEME_VARS, string>>
const base = themeById(DEFAULT_THEME)!.c
const defaults: Required<SvgColors> = {
  fg: base.text, text: base.text,
  muted: base.muted, dim: base.dim,
  border: base.line, line: base.line,
  surface: base.surface, bg: base.bg,
  accent: base.accent, mauve: base.accent,
  success: base.done || base.green, done: base.done || base.green,
  warning: base.blocked || base.ochre, blocked: base.blocked || base.ochre,
  error: base.rose, danger: base.rose,
  blue: base.blue, teal: base.teal, green: base.green, ochre: base.ochre,
  lav: base.lav || base.accent, rose: base.rose, coral: base.coral,
  c1: base.blue, c2: base.teal, c3: base.green, c4: base.ochre, c5: base.lav || base.accent, c6: base.rose,
  'bg-2': base.bg2,
  'surface-2': base.surface2 || base.surface,
  'surface-3': base.surface2 || base.surface,
  'line-soft': base.line,
  'text-2': base.text,
  'text-3': base.muted,
}
const NS = 'http://www.w3.org/2000/svg'
const tags: Record<string, true> = { svg: true, g: true, defs: true, symbol: true, title: true, desc: true, path: true, rect: true, circle: true, ellipse: true, line: true, polyline: true, polygon: true, text: true, tspan: true, textPath: true, use: true, marker: true, linearGradient: true, radialGradient: true, stop: true, clipPath: true, mask: true, pattern: true }
const attributes: Record<string, true> = Object.fromEntries('id class x y x1 y1 x2 y2 cx cy r rx ry width height viewBox preserveAspectRatio d points transform dx dy rotate textLength lengthAdjust offset gradientUnits gradientTransform spreadMethod fx fy fr markerWidth markerHeight markerUnits refX refY orient patternUnits patternContentUnits patternTransform clipPathUnits maskUnits maskContentUnits'.split(' ').map(name => [name, true as const]))
const properties: Record<string, true> = Object.fromEntries('fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset opacity color font-family font-size font-weight font-style text-anchor dominant-baseline alignment-baseline letter-spacing word-spacing text-decoration paint-order vector-effect marker-start marker-mid marker-end clip-path clip-rule mask stop-color stop-opacity display visibility'.split(' ').map(name => [name, true as const]))
const reference = /^#([a-zA-Z_][\w.:-]*)$/
const color = /^(?:#[\da-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([\d\s.,%+/-]+\)|[a-z]+)$/i

// A `<style>` sheet is resolved onto elements instead of being kept: selectors
// are limited to what a small matcher handles (type, .class, #id, descendant,
// child, comma), so at-rules, attribute/state selectors and escapes refuse the
// image rather than half-applying a sheet.
type Rule = { parts: Compound[], body: string, order: number }
type Compound = { type: string, id: string, classes: string[], combinator: '' | ' ' | '>' }
const MAX_RULES = 256
const MAX_CSS_CHARS = 60_000
const selectorToken = /^(\*|[A-Za-z][\w-]*)?((?:[.#][A-Za-z_][\w-]*)*)$/

const compoundMatches = (el: Element, part: Compound): boolean => {
  if (part.type && el.localName !== part.type) return false
  if (part.id && el.getAttribute('id') !== part.id) return false
  if (!part.classes.length) return true
  const have = (el.getAttribute('class') || '').split(/\s+/)
  return part.classes.every(name => have.includes(name))
}

const selectorMatches = (el: Element, parts: Compound[]): boolean => {
  let index = parts.length - 1
  let node: Element | null = el
  if (!compoundMatches(node, parts[index]!)) return false
  while (index > 0) {
    const combinator = parts[index]!.combinator
    index--
    node = node.parentElement
    if (combinator === '>') {
      if (!node || !compoundMatches(node, parts[index]!)) return false
    } else {
      while (node && !compoundMatches(node, parts[index]!)) node = node.parentElement
      if (!node) return false
    }
  }
  return true
}

const parseSelector = (text: string): Compound[] | null => {
  const parts: Compound[] = []
  let combinator: Compound['combinator'] = ''
  for (const token of text.trim().split(/(\s*>\s*|\s+)/)) {
    if (!token) continue
    if (!token.trim()) { if (parts.length) combinator = ' '; continue }
    if (token.trim() === '>') { if (!parts.length) return null; combinator = '>'; continue }
    const head = selectorToken.exec(token.trim())
    if (!head) return null
    const part: Compound = { type: head[1] === '*' ? '' : head[1] ?? '', id: '', classes: [], combinator }
    for (const [, sigil, name] of token.trim().slice(head[1]?.length ?? 0).matchAll(/([.#])([\w-]+)/g)) {
      if (sigil === '.') part.classes.push(name!)
      else if (part.id) return null
      else part.id = name!
    }
    parts.push(part)
    combinator = ' '
  }
  return parts.length && combinator !== '>' ? parts : null
}

const specificity = (parts: Compound[]): [number, number, number] => {
  let ids = 0, classes = 0, types = 0
  for (const part of parts) {
    if (part.id) ids++
    classes += part.classes.length
    if (part.type) types++
  }
  return [ids, classes, types]
}

const parseSheet = (css: string): Rule[] | null => {
  if (css.length > MAX_CSS_CHARS) return null
  const text = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  if (/[@\\]/.test(text)) return null
  const rules: Rule[] = []
  const chunks = text.split('}')
  for (const [index, chunk] of chunks.entries()) {
    if (!chunk.trim()) continue
    // Anything after the last `}` is an unclosed rule, not an empty tail.
    if (index === chunks.length - 1) return null
    const open = chunk.indexOf('{')
    if (open < 0 || chunk.indexOf('{', open + 1) >= 0) return null
    const body = chunk.slice(open + 1).trim()
    if (!body) continue
    for (const item of chunk.slice(0, open).split(',')) {
      const parts = parseSelector(item)
      if (!parts) return null
      if (rules.length >= MAX_RULES) return null
      rules.push({ parts, body, order: rules.length })
    }
  }
  return rules
}

export function svgPreview(source: string, colors: SvgColors = {}): string | null {
  // XML declarations/DTDs/entities, processing instructions and incomplete
  // streamed roots are not part of the supported static subset.
  const text = source.trim()
  if (text.length > 150_000 || !/^<svg(?:\s|>)/.test(text) || !/<\/svg>\s*$/.test(text) || /<!DOCTYPE|<!ENTITY|<\?/i.test(text)) return null
  try {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
    const root = doc.documentElement
    if (doc.querySelector('parsererror') || root.localName !== 'svg') return null
    const sheet: Rule[] = []
    for (const el of [...root.querySelectorAll('style')]) {
      if (el.prefix || (el.namespaceURI && el.namespaceURI !== NS)) return null
      const rules = parseSheet(el.textContent || '')
      if (!rules) return null
      sheet.push(...rules)
      el.remove()
    }
    const nodes = [root, ...root.querySelectorAll('*')]
    if (nodes.length > 2000) return null
    const palette = Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => {
      const value = colors[key as keyof SvgColors]?.trim() || fallback
      return [key, color.test(value) && !/^(?:inherit|initial|unset|revert|currentcolor)$/i.test(value) ? value : fallback]
    }))
    const ids = new Map<string, Element>()
    const refs = new Map<Element, string[]>()
    let visual = false
    const valueOf = (value: string, el: Element): string | null => {
      const resolved = value.replace(/var\(\s*--([a-z][\w-]*)\s*(?:,\s*([^()]*))?\)/gi, (_, key: string, fallback?: string) => palette[key] || fallback?.trim() || '')
      // No CSS escapes, comments, at-rules, unknown functions or resource URLs.
      // The sole resource form is an ID in this standalone image.
      const local = /^url\(\s*['"]?(#[a-zA-Z_][\w.:-]*)['"]?\s*\)$/i.exec(resolved.trim())
      if (local) {
        refs.set(el, [...(refs.get(el) || []), local[1]!.slice(1)])
        return `url(${local[1]})`
      }
      if (!resolved.trim() || /[\\@{};<>]|\/\*|url|var\s*\(|(?:https?|data|javascript):/i.test(resolved)) return null
      if (/[()]/.test(resolved) && !/^(?:rgb|rgba|hsl|hsla|translate|scale|rotate|skewX|skewY|matrix)\([\d\s.,%+eE/-]+\)(?:\s+(?:translate|scale|rotate|skewX|skewY|matrix)\([\d\s.,%+eE/-]+\))*$/i.test(resolved)) return null
      return resolved
    }
    const declarations = (css: string, el: Element): [string, string][] | null => {
      const result: [string, string][] = []
      for (const declaration of css.split(';')) {
        if (!declaration.trim()) continue
        const colon = declaration.indexOf(':')
        if (colon < 0) return null
        const name = declaration.slice(0, colon).trim().toLowerCase()
        if (!Object.hasOwn(properties, name)) return null
        const value = valueOf(declaration.slice(colon + 1).trim().replace(/\s*!\s*important$/i, ''), el)
        if (value === null) return null
        result.push([name, value])
      }
      return result
    }
    for (const el of nodes) {
      if (!Object.hasOwn(tags, el.localName) || (el.namespaceURI && el.namespaceURI !== NS) || el.prefix) return null
      const id = el.getAttribute('id')
      if (id) {
        if (!reference.test(`#${id}`) || ids.has(id)) return null
        ids.set(id, el)
      }
      let inline: [string, string][] | null = null
      for (const attr of [...el.attributes]) {
        const name = attr.name
        if (name === 'xmlns' && el === root && attr.value === NS) continue
        if (name === 'xmlns:xlink' && attr.value === 'http://www.w3.org/1999/xlink') continue
        if (/^on/i.test(name) || name === 'src') return null
        if ((attr.localName === 'href' || name.endsWith(':href')) && name !== 'href' && name !== 'xlink:href') return null
        if (name === 'xlink:href' && attr.namespaceURI !== 'http://www.w3.org/1999/xlink') return null
        if (name === 'href' || name === 'xlink:href') {
          const ref = reference.exec(attr.value)
          if (!ref || !['use', 'textPath', 'linearGradient', 'radialGradient', 'pattern'].includes(el.localName)) return null
          refs.set(el, [...(refs.get(el) || []), ref[1]!])
          continue
        }
        if (name === 'style') {
          inline = declarations(attr.value, el)
          if (inline === null) return null
        } else if (Object.hasOwn(attributes, name) || Object.hasOwn(properties, name)) {
          const safe = valueOf(attr.value, el)
          if (safe === null) return null
          el.setAttribute(name, safe)
        } else el.removeAttribute(name)
      }
      // A sheet applies above presentation attributes and below the element's
      // own inline declarations, in specificity then source order, as in CSS.
      const cascade = new Map<string, string>()
      if (sheet.length) {
        const matched = sheet
          .filter(rule => selectorMatches(el, rule.parts))
          .map(rule => ({ rule, spec: specificity(rule.parts) }))
          .sort((left, right) => left.spec[0] - right.spec[0] || left.spec[1] - right.spec[1] || left.spec[2] - right.spec[2] || left.rule.order - right.rule.order)
        for (const { rule } of matched) {
          const pairs = declarations(rule.body, el)
          if (pairs === null) return null
          for (const [name, value] of pairs) cascade.set(name, value)
        }
      }
      for (const [name, value] of inline || []) cascade.set(name, value)
      if (inline || cascade.size) el.setAttribute('style', [...cascade].map(([name, value]) => `${name}:${value}`).join(';'))
      if (!el.closest('defs, symbol, marker, clipPath, mask, pattern')) {
        if (el.localName === 'text' && el.textContent?.trim()) visual = true
        if (el.localName === 'use' && (el.hasAttribute('href') || el.hasAttribute('xlink:href'))) visual = true
        if (el.localName === 'path' && el.getAttribute('d')?.trim()) visual = true
        if (['line', 'polyline', 'polygon'].includes(el.localName) && el.attributes.length) visual = true
        if (el.localName === 'rect' && parseFloat(el.getAttribute('width') || '') > 0 && parseFloat(el.getAttribute('height') || '') > 0) visual = true
        if (el.localName === 'circle' && parseFloat(el.getAttribute('r') || '') > 0) visual = true
        if (el.localName === 'ellipse' && parseFloat(el.getAttribute('rx') || '') > 0 && parseFloat(el.getAttribute('ry') || '') > 0) visual = true
      }
    }
    if (!visual) return null
    // Bound expanded instances as well as source nodes: a small acyclic
    // <use>/paint DAG can otherwise multiply into an enormous render tree.
    const visiting = new Set<Element>()
    const expanded = new Map<Element, number>()
    const visit = (el: Element): boolean => {
      if (visiting.has(el)) return false
      if (expanded.has(el)) return true
      visiting.add(el)
      let size = 1
      for (const child of el.children) {
        if (!visit(child)) return false
        size += expanded.get(child)!
        if (size > 10_000) return false
      }
      for (const id of refs.get(el) || []) {
        const target = ids.get(id)
        if (!target || !visit(target)) return false
        size += expanded.get(target)!
        if (size > 10_000) return false
      }
      visiting.delete(el)
      expanded.set(el, size)
      return true
    }
    if (!visit(root)) return null
    const viewBox = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number)
    if (viewBox && (viewBox.length !== 4 || viewBox.some(n => !Number.isFinite(n)) || viewBox[2]! <= 0 || viewBox[3]! <= 0)) return null
    for (const dimension of ['width', 'height']) {
      const value = root.getAttribute(dimension)
      if (value !== null && !(parseFloat(value) > 0)) return null
    }
    root.setAttribute('xmlns', NS)
    // SVG's implicit black fill is invisible on dark themes. Explicit colors
    // stay intact; only its default fill and currentColor follow wherdr.
    if (!root.hasAttribute('fill')) root.setAttribute('fill', 'currentColor')
    root.setAttribute('style', `color:${palette.fg};${root.getAttribute('style') || ''}`)
    return `data:image/svg+xml,${encodeURIComponent(new XMLSerializer().serializeToString(root))}`
  } catch { return null }
}
