import { expect, it } from 'vitest'
import { createContextChain } from '../server/utils/contextChain'

const line = (entry: object) => JSON.stringify(entry) + '\n'

function feed(lines: string[], options?: Parameters<typeof createContextChain>[0]) {
  const chain = createContextChain(options)
  for (const l of lines) chain.push(l.trimEnd())
  return chain.finish()
}

it('walks the branch ending at the last entry and keeps the loaded items in order', () => {
  const chain = feed([
    line({ type: 'session', version: 3 }),
    line({ type: 'message', id: 'u1', parentId: null, message: { role: 'user', content: [{ type: 'text', text: 'First question' }] } }),
    line({ type: 'message', id: 'a1', parentId: 'u1', message: { role: 'assistant', content: [
      { type: 'thinking', thinking: 'pondering' },
      { type: 'text', text: 'Let me look.' },
      { type: 'toolCall', name: 'Read', arguments: {} },
    ] } }),
    line({ type: 'custom', id: 'd1', parentId: 'a1', customType: 'system-prompt-digest', data: 'abcdef0123456789' }),
    line({ type: 'message', id: 't1', parentId: 'd1', message: { role: 'toolResult', content: [{ type: 'text', text: 'file body' }] } }),
    line({ type: 'custom_message', id: 'i1', parentId: 't1', customType: 'rewind-report', content: 'Report text' }),
    // Another branch of the tree: the file keeps it, the next prompt does not.
    line({ type: 'message', id: 'x1', parentId: 'u1', message: { role: 'assistant', content: [{ type: 'text', text: 'Stale branch' }] } }),
    line({ type: 'message', id: 'a2', parentId: 'i1', message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'Answer' }],
      contextSnapshot: { promptTokens: 1000, nonMessageTokens: 400, toolSchemaTokens: 250 },
    } }),
  ])
  expect(chain?.items.map(item => [item.kind, item.role, item.text])).toEqual([
    ['message', 'user', 'First question'],
    ['message', 'assistant', 'Let me look.'],
    ['message', 'toolResult', 'file body'],
    ['inject', 'rewind-report', 'Report text'],
    ['message', 'assistant', 'Answer'],
  ])
  expect(chain?.items[1]?.thinking).toBe('pondering')
  expect(chain?.items[0]?.tokens).toBe(4)
  expect(chain?.tools).toEqual([{ name: 'Read', calls: 1 }])
  expect(chain?.digest).toBe('abcdef0123456789')
  expect(chain?.fixed).toEqual({ prompt: 1000, nonMessage: 400, tools: 250 })
  expect(chain?.entries).toBe(6)
  expect(chain?.dropped).toBe(0)
})

it('clips long items without losing their size, and ignores metadata without id', () => {
  const chain = feed([
    line({ type: 'message', id: 'u1', parentId: null, message: { role: 'user', content: 'abcdefghij' } }),
    line({ type: 'custom', id: 'm1', parentId: 'u1', customType: 'tool_execution_start', data: { toolName: 'Read' } }),
    line({ type: 'custom', id: 'r1', parentId: 'm1', customType: 'date-cwd-reminder', data: { reminder: '2026-01-01 · /repo' } }),
    line({ type: 'custom', id: 'e1', parentId: 'r1', customType: 'rewind-skill', data: {} }),
    line({ type: 'custom', id: 'n1', parentId: 'e1', customType: 'context-memory-day-note', data: { text: 'note' } }),
  ], { clip: 5 })
  expect(chain?.items.map(item => item.text)).toEqual(['abcde', '2026-', 'note'])
  expect(chain?.items[0]).toMatchObject({ chars: 10, tokens: 3, truncated: true })
  expect(chain?.entries).toBe(5)
  expect(chain?.digest).toBeNull()
})

it('keeps the tail of an over-long file and reports what it did not scan', () => {
  const chain = feed([
    line({ type: 'message', id: 'u1', parentId: null, message: { role: 'user', content: 'one' } }),
    line({ type: 'message', id: 'u2', parentId: 'u1', message: { role: 'user', content: 'two' } }),
    line({ type: 'message', id: 'u3', parentId: 'u2', message: { role: 'user', content: 'three' } }),
  ], { records: 2 })
  // The evicted first record breaks the branch at the second one.
  expect(chain?.items.map(item => item.text)).toEqual(['two', 'three'])
  expect(chain?.entries).toBe(2)
  expect(chain?.dropped).toBe(1)
  expect(createContextChain().finish()).toBeNull()
})
