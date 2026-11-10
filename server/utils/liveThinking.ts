import { createHash } from 'node:crypto'
import { constants, promises as fs } from 'node:fs'
import path from 'node:path'

const MAX_TEXT = 16 * 1024
// JSON escaping can expand each text byte sixfold; leave room for the session.
const MAX_FILE = 128 * 1024
const MAX_SESSION = 4096
const MAX_AGE = 5000

/** Read only a private, local snapshot for the exact active omp session. */
export async function readLiveThinking(home: string, pane: { agent: string | null, agentSession: string | null, status: string | null }, local: boolean, now = Date.now): Promise<string | null> {
  const session = pane.agentSession
  if (!local || pane.agent !== 'omp' || pane.status !== 'working' || !session
    || !path.isAbsolute(session) || Buffer.byteLength(session) > MAX_SESSION) return null
  const dir = path.join(home, '.cache', 'herdr-web', 'live-thinking')
  const filename = path.join(dir, `${createHash('sha256').update(session).digest('hex')}.json`)
  const uid = typeof process.getuid === 'function' ? process.getuid() : null
  try {
    // Do not follow a substituted bridge directory, including its cache parents.
    for (const part of [path.join(home, '.cache'), path.join(home, '.cache', 'herdr-web'), dir]) {
      const stat = await fs.lstat(part)
      if (!stat.isDirectory() || stat.isSymbolicLink() || (uid !== null && stat.uid !== uid)) return null
      if (part === dir && (stat.mode & 0o077) !== 0) return null
    }
    const before = await fs.lstat(dir)
    const file = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const stat = await file.stat()
      if (!stat.isFile() || (stat.mode & 0o077) !== 0 || (uid !== null && stat.uid !== uid) || stat.size > MAX_FILE) return null
      const bytes = Buffer.allocUnsafe(stat.size + 1)
      let length = 0
      while (length < bytes.length) {
        const { bytesRead } = await file.read(bytes, length, bytes.length - length, length)
        if (!bytesRead) break
        length += bytesRead
      }
      if (length > stat.size) return null
      const after = await fs.lstat(dir)
      if (!after.isDirectory() || after.isSymbolicLink() || (after.mode & 0o077) !== 0
        || (uid !== null && after.uid !== uid) || before.dev !== after.dev || before.ino !== after.ino) return null
      const current = await fs.lstat(filename)
      if (!current.isFile() || current.isSymbolicLink() || current.dev !== stat.dev || current.ino !== stat.ino) return null
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)))
      const age = now() - value.updated
      if (value.session !== session || typeof value.updated !== 'number' || !Number.isFinite(value.updated)
        || age < 0 || age > MAX_AGE || typeof value.text !== 'string' || Buffer.byteLength(value.text) > MAX_TEXT) return null
      return value.text || null
    } finally {
      await file.close()
    }
  } catch { return null }
}
