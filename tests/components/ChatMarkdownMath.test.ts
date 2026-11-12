import { expect, it } from 'vitest'
import { md } from '~/utils/markdown'

it('renders inline and block math through KaTeX', () => {
  const html = md('Energy $E=mc^2$ holds.\n\n$$\n\\int_0^1 x\\,dx\n$$')
  expect(html).toContain('class="md-math"')
  expect(html).toContain('katex')
  expect(html).toContain('katex-display')
  // The sanitizer keeps KaTeX's MathML twin, so the formula stays readable.
  expect(html).toContain('<math')
})

it('keeps prices, code spans, escapes and unfinished delimiters literal', () => {
  expect(md('costs $5 and $10 today')).not.toContain('katex')
  expect(md('inline `$x$` code')).not.toContain('katex')
  expect(md('escaped \\$x\\$ here')).not.toContain('katex')
  expect(md('streaming $x')).not.toContain('katex')
})

it('leaves memory text alone where inline styles are forbidden', () => {
  expect(md('$x$', { plain: true })).not.toContain('katex')
})
