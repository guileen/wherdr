import katex from 'katex'
import type { Tokens, TokenizerAndRendererExtension } from 'marked'

// KaTeX turns TeX into markup; it never executes anything. `trust` stays off,
// so `\href` and friends render inert, and a malformed formula shows KaTeX's
// own error instead of breaking the message.
const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]!))

const render = (tex: string, display: boolean) => {
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: 'ignore', output: 'htmlAndMathml', trust: false })
  } catch {
    return `<code class="md-math-error">${escape(tex)}</code>`
  }
}

// A memory file shown plain forbids the `style` attribute, and KaTeX positions
// every glyph with inline styles: there, `$…$` stays literal text.
let enabled = true
export const setMathEnabled = (on: boolean) => { enabled = on }

export const mathExtensions: TokenizerAndRendererExtension[] = [
  {
    name: 'mathBlock',
    level: 'block',
    start(src: string) {
      const at = src.search(/^\$\$/m)
      return at < 0 ? undefined : at
    },
    tokenizer(src: string) {
      if (!enabled) return
      const match = /^\$\$([\s\S]+?)\$\$[ \t]*(?:\n+|$)/.exec(src) || /^\\\[([\s\S]+?)\\\][ \t]*(?:\n+|$)/.exec(src)
      if (!match) return
      const text = match[1]!.trim()
      if (!text) return
      return { type: 'mathBlock', raw: match[0], text }
    },
    renderer(token: Tokens.Generic) {
      return `<div class="md-math md-math-block">${render(token.text as string, true)}</div>`
    },
  },
  {
    name: 'mathInline',
    level: 'inline',
    start(src: string) {
      const at = src.search(/\$|\\\(/)
      return at < 0 ? undefined : at
    },
    tokenizer(src: string) {
      if (!enabled) return
      const paren = /^\\\(([\s\S]+?)\\\)/.exec(src)
      if (paren) {
        const text = paren[1]!.trim()
        return text ? { type: 'mathInline', raw: paren[0], text } : undefined
      }
      // No space right after the opener or before the closer, no newline, and
      // no digit right after the closer: "$5 and $10" stays a price.
      const dollar = /^\$(?![\s$])([^$\n]*?[^\s$])\$(?!\d)/.exec(src)
      if (!dollar) return
      return { type: 'mathInline', raw: dollar[0], text: dollar[1]! }
    },
    renderer(token: Tokens.Generic) {
      return `<span class="md-math">${render(token.text as string, false)}</span>`
    },
  },
]
