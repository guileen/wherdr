import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createTranscripts, parseLines } from '../server/utils/transcripts'
import { localFs, type MachineFs } from '../server/utils/fsx'

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const json = (value: object) => JSON.stringify(value) + '\n'
const reply = (text: string, uuid = 'answer') => json({ type: 'assistant', uuid, timestamp: '2026-01-01T00:00:00Z', message: { role: 'assistant', content: [{ type: 'text', text }] } })
const homes: string[] = []
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }) })

function source(text: string) {
  const home = mkdtempSync(path.join(tmpdir(), 'wherdr-positions-'))
  homes.push(home)
  const dir = path.join(home, '.claude/projects/-home-x')
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'positions.jsonl')
  writeFileSync(file, text)
  const reads: { start: number, length: number }[] = []
  const fs: MachineFs = { ...localFs, async read(file, start, length) {
    reads.push({ start, length })
    return localFs.read(file, start, length)
  } }
  const transcripts = createTranscripts({ home, fs, herdr: async () => { throw new Error('No agent calls in position tests') } })
  const pane = { id: 'w1:p1', agent: 'claude', cwd: '/home/x', agentSession: 'positions' }
  return { transcripts, pane, file, reads }
}

describe('transcript item source identities', () => {
  it.each([
    ['claude', 'claude-session.jsonl'], ['codex', 'codex-rollout.jsonl'], ['omp', 'omp-tools.jsonl'], ['omp', 'omp-errors.jsonl'], ['omp', 'omp-user-shell.jsonl'],
  ])('assigns every emitted %s fixture item a source identity (%s)', (kind, name) => {
    const items = parseLines(fixture(name), kind)
    expect(items.length).toBeGreaterThan(0)
    expect(new Set(items.map(item => item.id)).size).toBe(items.length)
    for (const item of items) {
      expect(item.id).toMatch(/^v1:\d+:[^:]+:[0-9a-f]{16}$/)
      expect(item.offset).toEqual(expect.any(Number))
    }
  })

  it('keeps identity across window movement and prepending older parsed items', () => {
    const prefix = json({ type: 'user', uuid: 'user', message: { content: 'A UTF-8 question: café' } })
    const line = reply('answer')
    const whole = parseLines(prefix + line, 'claude')
    const window = parseLines(line, 'claude', Buffer.byteLength(prefix))
    expect(window[0]!.id).toBe(whole[1]!.id)
    expect(window[0]!.offset).toBe(Buffer.byteLength(prefix))
    expect([...parseLines(prefix, 'claude'), ...window].map(item => item.id)).toEqual(whole.map(item => item.id))
  })

  it.each(['claude', 'omp'])('uses source block slots, including initially invisible blocks, for %s streams', kind => {
    const line = (text: string, first: string) => json({ type: kind === 'omp' ? 'message' : 'assistant', id: 'record', timestamp: 't', message: { role: 'assistant', content: [
      { type: 'text', text: first }, { type: 'text', text },
      kind === 'omp' ? { type: 'toolCall', id: 'tool', name: 'read', arguments: { path: '/x' } } : { type: 'tool_use', id: 'tool', name: 'Read', input: { file_path: '/x' } },
    ] } })
    const initial = parseLines(line('short', ''), kind)
    const grown = parseLines(line('short, now longer', 'new first block'), kind)
    expect(initial.map(item => item.id)).toEqual(grown.slice(1).map(item => item.id))
    expect(new Set(grown.map(item => item.id)).size).toBe(3)
  })

  it.each(['claude', 'codex', 'omp'])('keeps %s tool identity when results mutate error/image/output fields', kind => {
    const [call, result] = kind === 'claude' ? [
      { type: 'assistant', uuid: 'a', message: { content: [{ type: 'tool_use', id: 'tool', name: 'Read', input: { file_path: '/x.png' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool', is_error: true, content: [{ type: 'image', source: { media_type: 'image/png', data: 'eA==' } }] }] } },
    ] : kind === 'codex' ? [
      { type: 'response_item', payload: { type: 'function_call', name: 'view_image', call_id: 'tool', arguments: '{}' } },
      { type: 'response_item', payload: { type: 'function_call_output', call_id: 'tool', output: [{ type: 'input_image', image_url: 'data:image/png;base64,eA==' }] } },
    ] : [
      { type: 'message', id: 'a', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'tool', name: 'read', arguments: { path: '/x.png' } }] } },
      { type: 'message', message: { role: 'toolResult', toolCallId: 'tool', isError: true, content: [{ type: 'image', mimeType: 'image/png', data: 'eA==' }] } },
    ]
    const initial = parseLines(json(call), kind)[0]!
    const completed = parseLines(json(call) + json(result), kind)[0]!
    expect(completed.id).toBe(initial.id)
    expect(completed.offset).toBe(initial.offset)
    expect(completed.images).toBe(1)
    expect(completed.ref).not.toBe(initial.ref)
  })
})

describe('bounded transcript position pages', () => {
  it('restores an anchor outside the live tail, then fills the interval with progressing complete-line pages', async () => {
    const text = Array.from({ length: 3500 }, (_, index) => reply(`${index}: ${'x'.repeat(1000)}`, `record-${index}`)).join('')
    const s = source(text)
    const anchor = parseLines(text.slice(0, text.indexOf('\n') + 1), 'claude')[0]!
    const tail = await s.transcripts.chat(s.pane)
    expect(tail.start).toBeGreaterThan(0)
    expect(tail.end).toBe(Buffer.byteLength(text))
    expect(tail.items!.some(item => item.id === anchor.id)).toBe(false)
    const restored = await s.transcripts.chat(s.pane, { around: anchor.id, file: 'positions.jsonl', since: tail.token })
    expect(restored).toMatchObject({ older: true, position: 'found', start: 0 })
    expect(restored.items![0]!.id).toBe(anchor.id)
    expect(restored.token).toBeUndefined()
    let cursor = restored.end!
    const ids = new Set(restored.items!.map(item => item.id))
    while (cursor < tail.start!) {
      const page = await s.transcripts.chat(s.pane, { after: cursor, before: tail.start, since: tail.token })
      expect(page).toMatchObject({ older: true, start: cursor })
      expect(page.end).toBeGreaterThan(cursor)
      expect(page.end).toBeLessThanOrEqual(tail.start!)
      expect(text[page.end! - 1]).toBe('\n')
      expect(page.token).toBeUndefined()
      for (const item of page.items!) { expect(ids.has(item.id)).toBe(false); ids.add(item.id) }
      cursor = page.end!
    }
    expect(cursor).toBe(tail.start)
    expect(s.reads.every(read => read.length <= 24 * 1024 * 1024 + 4096)).toBe(true)
  })

  it('returns explicit missing/changed positions without substituting a tail', async () => {
    const s = source(reply('original'))
    const anchor = (await s.transcripts.chat(s.pane)).items![0]!
    const lookup = (around: string, file = 'positions.jsonl') => s.transcripts.chat(s.pane, { around, file })
    expect(await lookup('unknown')).toMatchObject({ older: true, position: 'not-found', items: [], start: 0, end: 0 })
    expect(await lookup(anchor.id!.replace('content%2F0', 'content%2F99'))).toMatchObject({ position: 'not-found', items: [] })
    expect(await lookup(anchor.id!, 'other.jsonl')).toMatchObject({ position: 'source-changed', items: [] })
    writeFileSync(s.file, reply('replacement', 'another-source-record'))
    expect(await lookup(anchor.id!)).toMatchObject({ position: 'source-changed', items: [] })
  })

  it('widens a forward page for an oversized complete line under the cap', async () => {
    const large = reply('x'.repeat(3 * 1024 * 1024))
    const s = source(large + reply('after the large line', 'next'))
    const page = await s.transcripts.chat(s.pane, { after: 0, before: Buffer.byteLength(large) })
    expect(page).toMatchObject({ older: true, start: 0, end: Buffer.byteLength(large) })
    expect(page.items).toHaveLength(1)
    expect(page.items![0]!.text.length).toBeLessThan(30000)
    expect(s.reads.some(read => read.length > 2 * 1024 * 1024)).toBe(true)
    expect(s.reads.every(read => read.length <= 24 * 1024 * 1024 + 1)).toBe(true)
  })

  it('does not consume a partial final record or a before boundary inside a line', async () => {
    const first = reply('complete')
    const second = reply('second', 'second')
    const s = source(first + second.slice(0, -5))
    const page = await s.transcripts.chat(s.pane, { after: 0, before: Buffer.byteLength(first) + 8 })
    expect(page.end).toBe(Buffer.byteLength(first))
    expect(page.items).toHaveLength(1)
    expect((await s.transcripts.chat(s.pane)).end).toBe(Buffer.byteLength(first))
    expect((await s.transcripts.chat(s.pane, { before: Buffer.byteLength(first) + 8 })).end).toBe(Buffer.byteLength(first))
  })
})
