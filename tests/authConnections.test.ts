import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createAuth, type ReqLike } from '../server/utils/auth'

const dirs: string[] = []
const request = (cookie = ''): ReqLike => ({ headers: { cookie, origin: 'http://localhost:7684' } })
async function setup() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'graph-auth-connections-')); dirs.push(dir)
  const auth = createAuth({ dataDir: dir })
  auth._db().credentials.push({ id: 'key', publicKey: 'unused', counter: 0, transports: [], name: 'test', createdAt: new Date().toISOString() })
  const now = Date.now()
  const mine = request(auth._sessionCookie(request(), now - 1000).split(';')[0])
  const other = request(auth._sessionCookie(request(), now - 2000).split(';')[0])
  const active = new Set([mine, other])
  const remove = auth.onConnectionInvalidated(matches => { for (const req of active) if (matches(req)) active.delete(req) })
  return { auth, active, mine, other, remove }
}
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))) })

describe('authenticated connection lifetime', () => {
  it('locking one session closes its connections without closing another device', async () => {
    const { auth, active, mine, other } = await setup()
    auth.lock(mine)
    expect([...active]).toEqual([other])
    expect(auth.isUnlocked(other)).toBe(true)
    auth.lockAll(other)
    expect([...active]).toEqual([])
    expect(auth.isUnlocked(other)).toBe(false)
  })
  it('disabling the lock closes protected streams even though ordinary app access becomes open', async () => {
    const { auth, active, mine } = await setup()
    auth.disable(mine)
    expect([...active]).toEqual([])
    expect(auth.status(request())).toMatchObject({ enabled: false, unlocked: true })
  })
  it('expired foreground resume closes that session and preserves a newer one', async () => {
    const { auth, active, mine, other } = await setup()
    const now = Date.now()
    const older = request(auth._sessionCookie(request(), now - 8 * 24 * 3600000).split(';')[0])
    // Still within the existing background grace, but past the seven-day foreground deadline.
    const foreground = request(auth._sessionCookie(request(), now - 7 * 24 * 3600000 - 1000).split(';')[0])
    active.add(foreground)
    expect(auth.status(foreground, { resume: true, now }).unlocked).toBe(false)
    expect([...active]).toEqual([mine, other])
    expect(auth.status(older, { now }).unlocked).toBe(false)
  })
  it('unsubscribes a disposed connection without changing other authorization', async () => {
    const { auth, active, mine, remove } = await setup()
    remove()
    auth.lockAll(mine)
    expect(active.size).toBe(2)
    expect(auth.isUnlocked(mine)).toBe(false)
  })
})
