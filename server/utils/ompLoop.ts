import { createHash, randomBytes } from 'node:crypto'
import { constants, promises as fs } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import path from 'node:path'

export type LoopState = 'active' | 'paused' | 'inactive'
const MAX_FILE = 16 * 1024
const MAX_SESSION = 4096
const MAX_AGE = 5000
function validSession(session: string) {
  return path.isAbsolute(session) && Buffer.byteLength(session) <= MAX_SESSION
}
function directory(home: string) { return path.join(home, '.cache', 'herdr-web', 'omp-loop') }
function prefix(session: string) { return createHash('sha256').update(session).digest('hex') }

async function checkDirectory(home: string) {
  const dir = directory(home)
  const uid = typeof process.getuid === 'function' ? process.getuid() : null
  for (const part of [path.join(home, '.cache'), path.join(home, '.cache', 'herdr-web'), dir]) {
    const stat = await fs.lstat(part)
    if (!stat.isDirectory() || stat.isSymbolicLink() || (uid !== null && stat.uid !== uid)
      || (stat.mode & (part === dir ? 0o077 : 0o022)) !== 0) throw new Error('Unsafe loop directory')
  }
  return fs.lstat(dir)
}

async function readRecord(home: string, name: string, maxFile = MAX_FILE): Promise<Record<string, unknown>> {
  const dir = directory(home)
  const before = await checkDirectory(home)
  const file = await fs.open(path.join(dir, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = await file.stat()
    const uid = typeof process.getuid === 'function' ? process.getuid() : null
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || (uid !== null && stat.uid !== uid) || stat.size > maxFile) throw new Error('Unsafe loop record')
    const bytes = Buffer.allocUnsafe(stat.size + 1)
    let length = 0
    while (length < bytes.length) {
      const result = await file.read(bytes, length, bytes.length - length, length)
      if (!result.bytesRead) break
      length += result.bytesRead
    }
    if (length > stat.size) throw new Error('Loop record changed')
    const after = await checkDirectory(home)
    const current = await fs.lstat(path.join(dir, name))
    if (before.dev !== after.dev || before.ino !== after.ino || !current.isFile() || current.isSymbolicLink()
      || current.dev !== stat.dev || current.ino !== stat.ino) throw new Error('Loop record changed')
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid loop record')
    return value as Record<string, unknown>
  } finally { await file.close() }
}

export async function readOmpLoopSnapshot(home: string, session: string, now = Date.now): Promise<{ state: LoopState, command: string | null } | null> {
  if (!validSession(session)) return null
  try {
    const value = await readRecord(home, `${prefix(session)}.state.json`, 25 * 1024 * 1024)
    if (value.session !== session || typeof value.updated !== 'number' || !Number.isFinite(value.updated)) return null
    const age = now() - value.updated
    if (age < 0 || age > MAX_AGE || (value.state !== 'active' && value.state !== 'paused' && value.state !== 'inactive')) return null
    const command = typeof value.command === 'string' && Buffer.byteLength(value.command) <= 4 * 1024 * 1024 ? value.command : null
    return { state: value.state, command }
  } catch { return null }
}

export async function readOmpLoop(home: string, session: string, now = Date.now): Promise<LoopState | null> {
  return (await readOmpLoopSnapshot(home, session, now))?.state ?? null
}

/** Request a loop exit and wait for the matching extension acknowledgement. */
export async function stopOmpLoop(home: string, session: string, stillCurrent: () => boolean): Promise<void> {
  if (!validSession(session) || !stillCurrent() || await readOmpLoop(home, session) === null) throw new Error('Loop session is unavailable or stale')
  const dir = directory(home)
  const id = randomBytes(16).toString('hex')
  const base = `${prefix(session)}.${id}`
  const request = path.join(dir, `${base}.request.json`)
  const response = path.join(dir, `${base}.response.json`)
  const before = await checkDirectory(home)
  try {
    if (!stillCurrent()) throw new Error('Loop session changed')
    const temp = path.join(dir, `.${base}.tmp`)
    try {
      await fs.writeFile(temp, JSON.stringify({ session, id, updated: Date.now() }), { mode: 0o600, flag: 'wx' })
      const checked = await checkDirectory(home)
      if (before.dev !== checked.dev || before.ino !== checked.ino || !stillCurrent()) throw new Error('Loop session or directory changed')
      await fs.rename(temp, request)
    } finally { await fs.unlink(temp).catch(() => {}) }
    const after = await checkDirectory(home)
    if (before.dev !== after.dev || before.ino !== after.ino) throw new Error('Loop directory changed')
    const deadline = Date.now() + 4000
    while (Date.now() < deadline) {
      if (!stillCurrent()) throw new Error('Loop session changed')
      try {
        const ack = await readRecord(home, `${base}.response.json`)
        if (ack.session !== session || ack.id !== id || typeof ack.ok !== 'boolean') throw new Error('Invalid loop acknowledgement')
        if (!stillCurrent()) throw new Error('Loop session changed')
        if (!ack.ok) throw new Error(typeof ack.error === 'string' ? ack.error.slice(0, 512) : 'Loop exit rejected')
        return
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      await sleep(100)
    }
    throw new Error('Loop extension did not acknowledge the request')
  } finally {
    // Never unlink through a substituted directory.
    const after = await checkDirectory(home).catch(() => null)
    if (after && before.dev === after.dev && before.ino === after.ino) {
      await fs.unlink(request).catch(() => {})
      await fs.unlink(response).catch(() => {})
    }
  }
}
