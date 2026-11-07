import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ query: { pane: 'w1:p1' } as Record<string, string>, pane: null as unknown, machine: null as unknown }))
vi.mock('h3', () => ({ getQuery: () => mocks.query }))
vi.mock('../server/utils/http', () => ({ defineApi: (fn: unknown) => fn }))
vi.mock('../server/utils/state', () => ({ findPane: () => mocks.pane }))
vi.mock('../server/utils/machines', () => ({ machineOfPane: () => mocks.machine }))
import handler from '../server/api/compact-estimate.get'

const run = () => (handler as unknown as (event: object) => Promise<unknown>)({})
afterEach(() => { mocks.pane = null; mocks.machine = null })

it('reads the selected remote machine transcript without sending agent input', async () => {
  const content = Buffer.from(JSON.stringify({ type: 'message', id: 'u', parentId: null, message: { role: 'user', content: 'Question' } }))
  const stat = { size: content.length, mtimeMs: 1, isFile: true, isDir: false }
  const read = vi.fn(async () => content)
  mocks.pane = { id: 'host-a~w1:p1', agent: 'omp', status: 'idle', ompStatus: { metersFresh: true, meters: '◫ 50%/100K' } }
  const statFile = vi.fn(async () => stat)
  mocks.machine = { local: false, status: 'online', transcripts: { locate: vi.fn(async () => ({ file: '/home/user/.omp/agent/sessions/test.jsonl' })) }, fs: { stat: statFile, read } }
  expect(await run()).toEqual({ beforeTokens: 50_000, afterTokens: 50_000 })
  expect(read).toHaveBeenCalledOnce()
  expect(statFile).toHaveBeenCalledTimes(2)
  expect(statFile).toHaveBeenCalledWith('/home/user/.omp/agent/sessions/test.jsonl', true)
})

it('reads a transcript larger than 32 MiB in bounded remote chunks', async () => {
  // A single large JSONL record crosses many reads, and an entry ID's UTF-8
  // character straddles a block boundary before it is referenced by a parent.
  const block = 1024 * 1024
  const prefix = '{"type":"session","padding":"'
  const next = '"}\n{"type":"message","id":"'
  const padding = 'x'.repeat(33 * block - Buffer.byteLength(prefix + next) - 1)
  const content = Buffer.from(`${prefix}${padding}${next}é","parentId":null,"message":{"role":"user","content":"Question"}}\n${JSON.stringify({ type: 'message', id: 'a', parentId: 'é', message: { role: 'user', content: 'answer' } })}`)
  const stat = { size: content.length, mtimeMs: 1, ino: 42, isFile: true }
  const read = vi.fn(async (_file: string, start: number, length: number) => content.subarray(start, start + length))
  mocks.pane = { id: 'host-a~w1:p1', agent: 'omp', status: 'idle', ompStatus: { metersFresh: true, meters: '◫ 50%/100K' } }
  mocks.machine = { local: false, status: 'online', transcripts: { locate: async () => ({ file: '/session.jsonl' }) }, fs: { stat: async () => stat, read } }
  expect(await run()).toEqual({ beforeTokens: 50_000, afterTokens: 50_000 })
  expect(read.mock.calls.length).toBeGreaterThan(32)
  expect(read.mock.calls.every(([, , length]) => length <= block)).toBe(true)
})

it('rejects an incomplete read and a transcript above the bounded scan limit', async () => {
  mocks.pane = { id: 'w1:p1', agent: 'omp', status: 'idle', ompStatus: { metersFresh: true, meters: '◫ 50%/100K' } }
  const read = vi.fn(async () => Buffer.alloc(0))
  const stat = vi.fn(async () => ({ size: 10, mtimeMs: 1, isFile: true }))
  mocks.machine = { local: true, transcripts: { locate: async () => ({ file: '/session.jsonl' }) }, fs: { stat, read } }
  await expect(run()).rejects.toMatchObject({ code: 'unavailable' })
  stat.mockResolvedValueOnce({ size: 128 * 1024 * 1024 + 1, mtimeMs: 1, isFile: true })
  read.mockClear()
  await expect(run()).rejects.toMatchObject({ code: 'unavailable' })
  expect(read).not.toHaveBeenCalled()
})

it('fences coarse timestamps with remote digests and rejects changes or missing digests', async () => {
  const content = Buffer.from(JSON.stringify({ type: 'message', id: 'u', parentId: null, message: { role: 'user', content: 'Question' } }))
  const stat = { size: content.length, mtimeMs: 1000, isFile: true }
  const digest = vi.fn().mockResolvedValueOnce('same').mockResolvedValueOnce('same')
  const fs = { stat: vi.fn(async () => stat), read: vi.fn(async () => content), digest: digest as typeof digest | undefined }
  mocks.pane = { id: 'host-a~w1:p1', agent: 'omp', status: 'idle', ompStatus: { metersFresh: true, meters: '◫ 50%/100K' } }
  mocks.machine = { local: false, status: 'online', transcripts: { locate: async () => ({ file: '/session.jsonl' }) }, fs }
  expect(await run()).toEqual({ beforeTokens: 50_000, afterTokens: 50_000 })
  expect(digest).toHaveBeenCalledTimes(2)
  expect(digest).toHaveBeenCalledWith('/session.jsonl', content.length)
  digest.mockResolvedValueOnce('before').mockResolvedValueOnce('after')
  await expect(run()).rejects.toMatchObject({ code: 'unavailable' })
  fs.digest = undefined
  await expect(run()).rejects.toMatchObject({ code: 'unavailable' })
})

it('rejects an offline machine and an unavailable or stale meter', async () => {
  mocks.pane = { id: 'host-a~w1:p1', agent: 'omp', status: 'idle' }
  mocks.machine = { local: false, status: 'offline' }
  await expect(run()).rejects.toMatchObject({ code: 'unreachable' })
  mocks.machine = { local: false, status: 'online' }
  await expect(run()).rejects.toMatchObject({ code: 'unavailable' })
})

it('rejects a transcript changed during the read', async () => {
  const content = Buffer.from('x')
  const stat = vi.fn().mockResolvedValueOnce({ size: 1, mtimeMs: 1, isFile: true }).mockResolvedValueOnce({ size: 2, mtimeMs: 2, isFile: true })
  mocks.pane = { id: 'w1:p1', agent: 'omp', status: 'idle', ompStatus: { metersFresh: true, meters: '◫ 50%/100K' } }
  mocks.machine = { local: true, transcripts: { locate: async () => ({ file: '/session.jsonl' }) }, fs: { stat, read: async () => content } }
  await expect(run()).rejects.toMatchObject({ code: 'unavailable' })
})
