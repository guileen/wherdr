import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ query: { pane: 'w1:p1' } as Record<string, string>, pane: null as unknown, machine: null as unknown }))
vi.mock('h3', () => ({ getQuery: () => mocks.query }))
vi.mock('../server/utils/http', () => ({ defineApi: (fn: unknown) => fn }))
vi.mock('../server/utils/state', () => ({ findPane: () => mocks.pane }))
vi.mock('../server/utils/machines', () => ({ machineOfPane: () => mocks.machine }))
import handler from '../server/api/context.get'

const run = () => (handler as unknown as (event: object) => Promise<unknown>)({})
afterEach(() => { mocks.pane = null; mocks.machine = null })

const entry = (value: object) => JSON.stringify(value) + '\n'

function session() {
  return [
    entry({ type: 'message', id: 'u1', parentId: null, message: { role: 'user', content: [{ type: 'text', text: 'Question' }] } }),
    entry({ type: 'message', id: 'a1', parentId: 'u1', message: { role: 'assistant', content: [{ type: 'text', text: 'Answer' }] } }),
    entry({ type: 'message', id: 'x1', parentId: 'u1', message: { role: 'assistant', content: [{ type: 'text', text: 'Rewound' }] } }),
    entry({ type: 'message', id: 'a2', parentId: 'a1', message: { role: 'assistant', content: [{ type: 'text', text: 'Kept' }] } }),
  ].join('')
}

function machine(content: Buffer, after: { size?: number, ino?: number } = {}) {
  const stat = { size: content.length, mtimeMs: 1, ino: 42, isFile: true }
  return {
    local: false,
    status: 'online',
    transcripts: { locate: vi.fn(async () => ({ file: '/home/user/.omp/agent/sessions/test.jsonl' })) },
    fs: {
      // The first read sizes the scan; the second fences it.
      stat: vi.fn().mockResolvedValueOnce(stat).mockResolvedValue({ ...stat, ...after }),
      read: vi.fn(async (_file: string, start: number, length: number) => content.subarray(start, start + length)),
    },
  }
}

it('returns the branch the next turn loads, without the rewound one', async () => {
  const content = Buffer.from(session())
  const m = machine(content)
  mocks.pane = { id: 'host-a~w1:p1', agent: 'omp', status: 'idle' }
  mocks.machine = m
  const result = await run() as { items: { text: string }[], entries: number }
  expect(result.items.map(item => item.text)).toEqual(['Question', 'Answer', 'Kept'])
  expect(result.entries).toBe(3)
  expect(m.fs.read.mock.calls.every(([, , length]) => length <= 1024 * 1024)).toBe(true)
})

it('accepts a file still growing but refuses a truncated or replaced one', async () => {
  const content = Buffer.from(session())
  mocks.pane = { id: 'host-a~w1:p1', agent: 'omp', status: 'working' }
  mocks.machine = machine(content, { size: content.length + 40 })
  expect((await run() as { entries: number }).entries).toBe(3)
  mocks.machine = machine(content, { size: content.length - 1 })
  await expect(run()).rejects.toMatchObject({ code: 'unavailable' })
  mocks.machine = machine(content, { ino: 43 })
  await expect(run()).rejects.toMatchObject({ code: 'unavailable' })
})

it('refuses another agent, an offline machine and an empty read', async () => {
  mocks.pane = { id: 'w1:p1', agent: 'codex', status: 'idle' }
  mocks.machine = machine(Buffer.from(session()))
  await expect(run()).rejects.toMatchObject({ code: 'unavailable' })
  mocks.pane = { id: 'host-a~w1:p1', agent: 'omp', status: 'idle' }
  mocks.machine = { local: false, status: 'offline' }
  await expect(run()).rejects.toMatchObject({ code: 'unreachable' })
  mocks.machine = machine(Buffer.from(session()))
  mocks.machine.fs.read = vi.fn(async () => Buffer.alloc(0))
  await expect(run()).rejects.toMatchObject({ code: 'unavailable' })
})
