import { beforeAll, describe, expect, it } from 'vitest'
import { getMermaid } from '~/utils/mermaid'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { marked } from 'marked'
import ChatMarkdown from '~/components/ChatMarkdown.vue'
import { md } from '~/utils/markdown'

// Install the app's code renderers
md('')

const mermaidSource = 'graph TD\n  A[Start] --> B[Process]\n  B --> C[End]'

function render(text: string) {
  return marked.parse(text, { breaks: true, gfm: true, async: false }) as string
}

describe('Mermaid fenced previews', () => {
  beforeAll(async () => {
    await getMermaid()
  })
  it('renders mermaid diagram and switches between preview and source', async () => {
    const w = await mountSuspended(ChatMarkdown, { props: { html: render(`\`\`\`mermaid\n${mermaidSource}\n\`\`\``), typing: null } })
    await (w.vm as unknown as { syncMermaidTheme: (force?: boolean) => Promise<void> }).syncMermaidTheme(true)

    expect(w.find('.mermaid-block').exists()).toBe(true)
    expect(w.find('.mermaid-stage').exists()).toBe(true)
    expect(w.find('.mermaid-preview svg').exists()).toBe(true)
    expect((w.find('.mermaid-source').element as HTMLElement).hidden).toBe(true)
    expect(w.find('.code-head .mermaid-toggle').exists()).toBe(true)
    expect(w.find('.code-head .code-copy').exists()).toBe(true)

    // Toggle to source
    await w.find('.mermaid-toggle').trigger('click')
    expect((w.find('.mermaid-source').element as HTMLElement).hidden).toBe(false)
    expect((w.find('.mermaid-stage').element as HTMLElement).hidden).toBe(true)
    expect(w.find('.mermaid-toggle').attributes('aria-pressed')).toBe('true')
    expect(w.find('pre code').element.textContent).toBe(mermaidSource)

    // Toggle back to preview
    await w.find('.mermaid-toggle').trigger('click')
    expect((w.find('.mermaid-source').element as HTMLElement).hidden).toBe(true)
    expect((w.find('.mermaid-stage').element as HTMLElement).hidden).toBe(false)
    expect(w.find('.mermaid-toggle').attributes('aria-pressed')).toBe('false')
    w.unmount()
  })

  it('shows source with note when mermaid syntax is invalid', async () => {
    const invalidSource = 'this is broken mermaid syntax %%%'
    const w = await mountSuspended(ChatMarkdown, { props: { html: render(`\`\`\`mermaid\n${invalidSource}\n\`\`\``), typing: null } })
    await (w.vm as unknown as { syncMermaidTheme: (force?: boolean) => Promise<void> }).syncMermaidTheme(true)

    expect((w.find('.mermaid-source').element as HTMLElement).hidden).toBe(false)
    expect(w.find('.mermaid-note').exists()).toBe(true)
    expect((w.find('.mermaid-toggle').element as HTMLButtonElement).disabled).toBe(true)
    expect(w.find('pre code').element.textContent).toBe(invalidSource)
    expect(w.find('.code-copy').exists()).toBe(true)
    w.unmount()
  })

  it('keeps source and controls intact throughout typewriter reveal', async () => {
    const html = render(`${'Prose before the diagram. '.repeat(10)}\n\n\`\`\`mermaid\n${mermaidSource}\n\`\`\``)
    const w = await mountSuspended(ChatMarkdown, { props: { html, typing: null, cipher: true, speed: 'slow' } })
    await w.setProps({ typing: Date.now() })
    expect(w.find('pre code').element.textContent).toBe(mermaidSource)
    await w.find('.md-body').trigger('click')
    expect(w.find('pre code').element.textContent).toBe(mermaidSource)
    expect((w.find('.mermaid-source').element as HTMLElement).hidden).toBe(true)
    expect(w.emitted('done')).toHaveLength(1)
    w.unmount()
  })
})
