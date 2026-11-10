import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os, { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import liveThinking from '../bin/omp-live-thinking.js'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('omp live thinking producer', () => {
  it('publishes structured thinking only and clears at turn end', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wherdr-thinking-'))
    roots.push(root)
    vi.stubEnv('HERDR_ENV', '1')
    vi.spyOn(os, 'homedir').mockReturnValue(root)
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    liveThinking({ on: (name: string, handler: (...args: unknown[]) => unknown) => handlers.set(name, handler) })
    let session = join(root, 'session.jsonl')
    const ctx = { sessionManager: { getSessionFile: () => session } }
    const send = (name: string, event = {}) => handlers.get(name)!(event, ctx)
    const snapshot = (file: string) => join(root, '.cache/herdr-web/live-thinking', `${createHash('sha256').update(file).digest('hex')}.json`)
    send('session_start')
    send('turn_start')
    send('message_update', { message: { role: 'assistant' }, assistantMessageEvent: { type: 'text_delta', delta: 'not thinking' } })
    send('message_update', { message: { role: 'assistant' }, assistantMessageEvent: { type: 'thinking_delta', delta: 'real 🧠' } })
    await vi.waitFor(async () => expect(JSON.parse(await readFile(snapshot(session), 'utf8')).text).toBe('real 🧠'))
    const parsed = JSON.parse(await readFile(snapshot(session), 'utf8'))
    expect(parsed.session).toBe(session)
    expect(typeof parsed.updated).toBe('number')
    expect((await stat(snapshot(session))).mode & 0o777).toBe(0o600)
    expect((await stat(join(root, '.cache/herdr-web/live-thinking'))).mode & 0o777).toBe(0o700)
    send('message_update', { message: { role: 'assistant' }, assistantMessageEvent: { type: 'thinking_delta', delta: '🧠'.repeat(5000) } })
    await vi.waitFor(async () => {
      const text = JSON.parse(await readFile(snapshot(session), 'utf8')).text
      expect(text).toBe('🧠'.repeat(4096))
      expect(Buffer.byteLength(text)).toBeLessThanOrEqual(16384)
    })
    send('message_update', { message: { role: 'assistant' }, assistantMessageEvent: { type: 'thinking_start' } })
    send('message_update', { message: { role: 'assistant' }, assistantMessageEvent: { type: 'thinking_delta', delta: 'new thought' } })
    await vi.waitFor(async () => expect(JSON.parse(await readFile(snapshot(session), 'utf8')).text).toBe('new thought'))
    send('turn_end')
    await vi.waitFor(async () => expect(await stat(snapshot(session)).then(() => true, () => false)).toBe(false))
    session = join(root, 'other.jsonl')
    send('session_switch')
    send('message_update', { message: { role: 'assistant' }, assistantMessageEvent: { type: 'thinking_delta', delta: 'next' } })
    await vi.waitFor(async () => expect(JSON.parse(await readFile(snapshot(session), 'utf8')).text).toBe('next'))
    await handlers.get('session_shutdown')!({}, ctx)
    expect(await stat(snapshot(session)).then(() => true, () => false)).toBe(false)
  })
})
