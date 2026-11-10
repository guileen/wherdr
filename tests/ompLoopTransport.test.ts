import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readdir, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import liveThinking from '../bin/omp-live-thinking.js'
import { readOmpLoop, stopOmpLoop } from '../server/utils/ompLoop'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function setup() {
  const home = await mkdtemp(join(os.tmpdir(), 'omp-loop-'))
  roots.push(home)
  const dir = join(home, '.cache/herdr-web/omp-loop')
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const session = join(home, 'session.jsonl')
  const file = join(dir, `${createHash('sha256').update(session).digest('hex')}.state.json`)
  return { home, dir, session, file }
}

it('rejects mismatched, future, oversized and unsafe records', async () => {
  const s = await setup()
  const put = (value: unknown) => writeFile(s.file, JSON.stringify(value), { mode: 0o600 })
  const record = { session: s.session, updated: 10000, state: 'active' }
  await put(record)
  expect(await readOmpLoop(s.home, s.session, () => 15000)).toBe('active')
  expect(await readOmpLoop(s.home, s.session, () => 9999)).toBeNull()
  await put({ ...record, session: '/different' })
  expect(await readOmpLoop(s.home, s.session, () => 10000)).toBeNull()
  await put({ ...record, state: 'unknown' })
  expect(await readOmpLoop(s.home, s.session, () => 10000)).toBeNull()
  await put(record)
  await rename(s.file, join(s.home, 'outside'))
  await symlink(join(s.home, 'outside'), s.file)
  expect(await readOmpLoop(s.home, s.session, () => 10000)).toBeNull()
  await unlink(s.file)
  await writeFile(s.file, Buffer.alloc(16385), { mode: 0o600 })
  expect(await readOmpLoop(s.home, s.session, () => 10000)).toBeNull()
  await chmod(s.dir, 0o755)
  expect(await readOmpLoop(s.home, s.session, () => 10000)).toBeNull()
})

it('acknowledges only after mode exit resolves', async () => {
  const s = await setup()
  vi.stubEnv('HERDR_ENV', '1')
  vi.spyOn(os, 'homedir').mockReturnValue(s.home)
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  liveThinking({ on: (name: string, handler: (...args: unknown[]) => unknown) => handlers.set(name, handler) })
  let finish: (result: unknown) => void = () => {}
  const set = vi.fn(() => new Promise(resolve => { finish = resolve }))
  const ctx = { sessionManager: { getSessionFile: () => s.session }, sessionModes: { getState: () => ({ loop: { status: 'active' } }), set } }
  handlers.get('session_start')!({}, ctx)
  try {
    await vi.waitFor(async () => expect(await readOmpLoop(s.home, s.session)).toBe('active'))
    let completed = false
    const stop = stopOmpLoop(s.home, s.session, () => true).then(() => { completed = true })
    await vi.waitFor(() => expect(set).toHaveBeenCalledWith({ mode: 'loop', action: 'exit' }))
    expect(completed).toBe(false)
    finish({ ok: true })
    await stop
    expect(completed).toBe(true)
    expect(set).toHaveBeenCalledTimes(1)
    const rejected = expect(stopOmpLoop(s.home, s.session, () => true)).rejects.toThrow('Session is busy')
    await vi.waitFor(() => expect(set).toHaveBeenCalledTimes(2))
    finish({ ok: false, code: 'busy', message: 'Session is busy' })
    await rejected
  } finally { await handlers.get('session_shutdown')!({}, ctx) }
})

it('cancels the pending request when the pane session changes', async () => {
  const s = await setup()
  await writeFile(s.file, JSON.stringify({ session: s.session, updated: Date.now(), state: 'paused' }), { mode: 0o600 })
  let current = true
  const result = expect(stopOmpLoop(s.home, s.session, () => current)).rejects.toThrow('changed')
  await vi.waitFor(async () => expect((await readdir(s.dir)).some(name => name.endsWith('.request.json'))).toBe(true))
  current = false
  await result
  expect((await readdir(s.dir)).some(name => name.endsWith('.request.json'))).toBe(false)
})
