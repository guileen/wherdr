import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readLiveThinking } from '../server/utils/liveThinking'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function setup() {
  const home = mkdtempSync(path.join(tmpdir(), 'live-thinking-'))
  roots.push(home)
  const dir = path.join(home, '.cache', 'herdr-web', 'live-thinking')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const pane = { agent: 'omp', agentSession: '/home/me/.omp/agent/sessions/s.jsonl', status: 'working' }
  const file = path.join(dir, createHash('sha256').update(pane.agentSession).digest('hex') + '.json')
  const put = (value: unknown) => writeFileSync(file, JSON.stringify(value), { mode: 0o600 })
  const snapshot = { session: pane.agentSession, updated: 10000, text: 'thinking 💭' }
  const read = (p = pane, local = true, now = 10000) => readLiveThinking(home, p, local, () => now)
  return { home, dir, file, pane, put, snapshot, read }
}

describe('private live thinking', () => {
  it('reads only the exact working local omp session and expires it', async () => {
    const s = setup()
    expect(await s.read()).toBeNull()
    s.put(s.snapshot)
    expect(await s.read()).toBe('thinking 💭')
    expect(await s.read(s.pane, true, 15000)).toBe('thinking 💭')
    expect(await s.read(s.pane, true, 15001)).toBeNull()
    expect(await s.read(s.pane, true, 9999)).toBeNull()
    expect(await s.read({ ...s.pane, status: 'done' })).toBeNull()
    expect(await s.read({ ...s.pane, agent: 'codex' })).toBeNull()
    expect(await s.read(s.pane, false)).toBeNull()
    expect(await s.read({ ...s.pane, agentSession: '/another/session.jsonl' })).toBeNull()
    s.put({ ...s.snapshot, session: '/another/session.jsonl' })
    expect(await s.read()).toBeNull()
    unlinkSync(s.file)
    expect(await s.read()).toBeNull()
  })

  it('rejects malformed, oversized and publicly readable snapshots', async () => {
    const s = setup()
    s.put({ ...s.snapshot, text: '💭'.repeat(4096) })
    expect(await s.read()).toBe('💭'.repeat(4096))
    s.put({ ...s.snapshot, text: '💭'.repeat(4097) })
    expect(await s.read()).toBeNull()
    s.put({ ...s.snapshot, updated: '10000' })
    expect(await s.read()).toBeNull()
    writeFileSync(s.file, '{', { mode: 0o600 })
    expect(await s.read()).toBeNull()
    writeFileSync(s.file, Buffer.alloc(128 * 1024 + 1), { mode: 0o600 })
    expect(await s.read()).toBeNull()
    s.put(s.snapshot)
    chmodSync(s.file, 0o644)
    expect(await s.read()).toBeNull()
    chmodSync(s.file, 0o600)
    chmodSync(s.dir, 0o755)
    expect(await s.read()).toBeNull()
  })

  it('does not follow snapshot or bridge-directory symlinks', async () => {
    const s = setup()
    s.put(s.snapshot)
    const outside = path.join(s.home, 'outside.json')
    renameSync(s.file, outside)
    symlinkSync(outside, s.file)
    expect(await s.read()).toBeNull()
    unlinkSync(s.file)
    const moved = path.join(s.home, 'moved')
    renameSync(s.dir, moved)
    symlinkSync(moved, s.dir)
    expect(await s.read()).toBeNull()
  })
})
