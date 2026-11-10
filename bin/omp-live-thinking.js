// wherdr's local omp thinking bridge. This module never changes session history.
import { createHash, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const LIMIT = 16 * 1024
const INTERVAL = 200

function bounded(text) {
  const bytes = Buffer.from(text, 'utf8')
  if (bytes.length <= LIMIT) return text
  let start = bytes.length - LIMIT
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++
  return bytes.subarray(start).toString('utf8')
}

export default function liveThinking(pi) {
  if (process.env.HERDR_ENV !== '1') return
  const directory = path.join(os.homedir(), '.cache', 'herdr-web', 'live-thinking')
  let session = null
  let text = ''
  let lastWrite = 0
  let timer = null
  let running = false
  const pending = new Map()
  let settled = Promise.resolve()

  function filename(file) {
    return path.join(directory, `${createHash('sha256').update(file).digest('hex')}.json`)
  }

  async function privateDirectory() {
    for (const part of [path.join(os.homedir(), '.cache'), path.join(os.homedir(), '.cache', 'herdr-web'), directory]) {
      await fs.mkdir(part, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error })
      const info = await fs.lstat(part)
      if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o022) !== 0 || (typeof process.getuid === 'function' && info.uid !== process.getuid())) throw new Error('unsafe live-thinking directory')
    }
    await fs.chmod(directory, 0o700)
  }

  async function writeSnapshot(file, value) {
    if (value === null) {
      await privateDirectory()
      await fs.unlink(filename(file)).catch(error => { if (error.code !== 'ENOENT') throw error })
      return
    }
    await privateDirectory()
    const temp = path.join(directory, `.snapshot-${process.pid}-${randomBytes(12).toString('hex')}`)
    try {
      await fs.writeFile(temp, JSON.stringify({ session: file, updated: Date.now(), text: value }), { mode: 0o600, flag: 'wx' })
      await fs.rename(temp, filename(file))
    } finally {
      await fs.unlink(temp).catch(() => {})
    }
  }

  function pump() {
    if (running || timer || pending.size === 0) return
    // Clears are never throttled; a later snapshot waits for the write budget.
    const clear = [...pending].find(([, value]) => value === null)
    const next = clear || pending.entries().next().value
    const delay = next[1] === null ? 0 : Math.max(0, INTERVAL - (Date.now() - lastWrite))
    if (delay) {
      timer = setTimeout(() => { timer = null; pump() }, delay)
      timer.unref?.()
      return
    }
    const [file, value] = next
    pending.delete(file)
    running = true
    if (value !== null) lastWrite = Date.now()
    settled = writeSnapshot(file, value).catch(() => {}).then(() => {
      running = false
      pump()
    })
  }

  function schedule(file, value) {
    if (!file) return
    pending.set(file, value)
    if (value === null && timer) { clearTimeout(timer); timer = null }
    pump()
  }

  function clear() {
    schedule(session, null)
    text = ''
  }

  function current(ctx) {
    const file = ctx.sessionManager.getSessionFile()
    return typeof file === 'string' && path.isAbsolute(file) ? path.resolve(file) : null
  }

  pi.on('session_start', (_event, ctx) => { session = current(ctx); clear() })
  pi.on('session_before_switch', () => { clear() })
  pi.on('session_switch', (_event, ctx) => { clear(); session = current(ctx); clear() })
  pi.on('turn_start', (_event, ctx) => {
    const next = current(ctx)
    if (session !== next) { clear(); session = next }
    clear()
  })
  pi.on('message_update', (event, ctx) => {
    const delta = event.assistantMessageEvent
    if (event.message?.role !== 'assistant') return
    if (delta?.type === 'thinking_start') { text = ''; schedule(session, null); return }
    if (delta?.type !== 'thinking_delta' || typeof delta.delta !== 'string' || !delta.delta) return
    const next = current(ctx)
    if (session !== next) { clear(); session = next }
    if (!session) return
    text = bounded(text + delta.delta)
    schedule(session, text)
  })
  pi.on('turn_end', clear)
  pi.on('agent_end', clear)
  pi.on('session_shutdown', async () => {
    for (const file of pending.keys()) pending.set(file, null)
    clear()
    // Shutdown may await cleanup; streaming handlers never wait for filesystem I/O.
    while (running || pending.size) {
      if (timer) { clearTimeout(timer); timer = null; pump() }
      await settled
    }
  })
}
