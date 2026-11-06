import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatResponse } from '../shared/types'

const delta = vi.hoisted(() => ({ sinceOf: vi.fn(() => 'cached'), reply: vi.fn() }))
vi.mock('../server/utils/chatDelta', () => ({ chatDelta: delta }))
vi.mock('../server/utils/integrations', () => ({ integrationStatus: vi.fn() }))
vi.mock('../server/utils/machines', () => ({ multiMachine: () => false }))
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

async function route(query: Record<string, string>, response: ChatResponse) {
  const pane = { id: 'w1:p1', agent: 'claude', agentSession: 'session' }
  const chat = vi.fn(async () => response)
  vi.stubGlobal('defineApi', (handler: unknown) => handler)
  vi.stubGlobal('getQuery', () => ({ pane: pane.id, since: 'live-token', n: '30', ...query }))
  vi.stubGlobal('findPane', () => pane)
  vi.stubGlobal('machineOfPane', () => null)
  vi.stubGlobal('takenBackOf', () => ({ hidden: [], seq: 0 }))
  vi.stubGlobal('transcripts', { chat })
  vi.stubGlobal('withoutTakenBack', (items: unknown) => items)
  vi.stubGlobal('chatPasted', (items: unknown) => items)
  vi.stubGlobal('addUploadHashes', vi.fn(async () => {}))
  vi.stubGlobal('currentModel', vi.fn(async () => null))
  // defineApi is a Nitro auto-import: install its test boundary before loading the endpoint.
  const { default: handler } = await import('../server/api/chat.get')
  return { result: await handler({} as never), chat, pane }
}

describe('/api/chat position range routing', () => {
  it('passes an exact anchor and basename without consulting or populating delta state', async () => {
    const id = 'v1:42:content%2F0:0123456789abcdef'
    const response: ChatResponse = { available: true, file: 'session.jsonl', older: true, position: 'found', start: 42, end: 120,
      items: [{ id, offset: 42, role: 'assistant', text: 'answer', ts: null }] }
    const { result, chat, pane } = await route({ around: id, file: 'session.jsonl' }, response)
    expect(chat).toHaveBeenCalledWith(pane, expect.objectContaining({ around: id, file: 'session.jsonl', since: '', after: null }))
    expect(result).toMatchObject(response)
    expect(delta.sinceOf).not.toHaveBeenCalled()
    expect(delta.reply).not.toHaveBeenCalled()
  })

  it('passes a bounded forward interval and preserves its complete-line endpoint', async () => {
    const response: ChatResponse = { available: true, older: true, start: 120, end: 250, items: [] }
    const { result, chat, pane } = await route({ after: '120', before: '900' }, response)
    expect(chat).toHaveBeenCalledWith(pane, expect.objectContaining({ after: 120, before: 900, since: '' }))
    expect(result).toMatchObject({ older: true, start: 120, end: 250, items: [] })
    expect(delta.sinceOf).not.toHaveBeenCalled()
    expect(delta.reply).not.toHaveBeenCalled()
  })

  it.each(['not-found', 'source-changed'] as const)('keeps %s explicit rather than returning live output', async position => {
    const response: ChatResponse = { available: true, older: true, position, start: 0, end: 0, items: [] }
    const { result } = await route({ around: 'unknown', file: 'session.jsonl' }, response)
    expect(result).toMatchObject(response)
    expect(delta.reply).not.toHaveBeenCalled()
  })
})
