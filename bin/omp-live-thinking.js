// wherdr's local omp thinking bridge. This module never changes session history.
import { createHash, randomBytes } from 'node:crypto'
import { constants, promises as fs } from 'node:fs'
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
  const loopDirectory = path.join(os.homedir(), '.cache', 'herdr-web', 'omp-loop')
  let loopTimer = null
  let loopContext = null
  let loopGeneration = 0
  let loopBusy = false
  const handled = new Set()
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

  async function loopPrivateDirectory() {
    for (const part of [path.join(os.homedir(), '.cache'), path.join(os.homedir(), '.cache', 'herdr-web'), loopDirectory]) {
      await fs.mkdir(part, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error })
      const info = await fs.lstat(part)
      if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & (part === loopDirectory ? 0o077 : 0o022)) !== 0
        || (typeof process.getuid === 'function' && info.uid !== process.getuid())) throw new Error('unsafe loop directory')
    }
    return fs.lstat(loopDirectory)
  }

  async function loopWrite(name, value) {
    const before = await loopPrivateDirectory()
    const temp = path.join(loopDirectory, `.loop-${process.pid}-${randomBytes(12).toString('hex')}`)
    try {
      await fs.writeFile(temp, JSON.stringify(value), { mode: 0o600, flag: 'wx' })
      const after = await loopPrivateDirectory()
      if (before.dev !== after.dev || before.ino !== after.ino) throw new Error('loop directory changed')
      await fs.rename(temp, path.join(loopDirectory, name))
    } finally { await fs.unlink(temp).catch(() => {}) }
  }

  async function loopRead(name) {
    const before = await loopPrivateDirectory()
    const file = await fs.open(path.join(loopDirectory, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const info = await file.stat()
      if (!info.isFile() || (info.mode & 0o077) !== 0 || info.size > 16384
        || (typeof process.getuid === 'function' && info.uid !== process.getuid())) throw new Error('unsafe loop request')
      const bytes = Buffer.allocUnsafe(info.size + 1)
      let length = 0
      while (length < bytes.length) {
        const result = await file.read(bytes, length, bytes.length - length, length)
        if (!result.bytesRead) break
        length += result.bytesRead
      }
      const after = await loopPrivateDirectory()
      const current = await fs.lstat(path.join(loopDirectory, name))
      if (length > info.size || before.dev !== after.dev || before.ino !== after.ino
        || !current.isFile() || current.isSymbolicLink() || current.dev !== info.dev || current.ino !== info.ino) throw new Error('loop request changed')
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)))
    } finally { await file.close() }
  }

  async function loopTick() {
    if (loopBusy || !loopContext) return
    loopBusy = true
    const ctx = loopContext
    const generation = loopGeneration
    const file = current(ctx)
    const valid = () => loopGeneration === generation && loopContext === ctx && file && current(ctx) === file
    try {
      if (!file || !ctx.sessionModes || Buffer.byteLength(file) > 4096) return
      const hash = createHash('sha256').update(file).digest('hex')
      const loop = ctx.sessionModes.getState()?.loop
      const state = loop?.status
      if (!['active', 'paused', 'inactive'].includes(state) || !valid()) return
      const command = typeof loop.command === 'string' && Buffer.byteLength(loop.command) <= 4 * 1024 * 1024 ? loop.command : null
      await loopWrite(`${hash}.state.json`, { session: file, updated: Date.now(), state, command })
      if (!valid()) return
      const names = await fs.readdir(loopDirectory)
      for (const name of names) {
        const match = name.match(new RegExp(`^${hash}\\.([a-f0-9]{32})\\.request\\.json$`))
        if (!match || handled.has(match[1]) || !valid()) continue
        let request
        try { request = await loopRead(name) } catch { continue }
        const age = Date.now() - request.updated
        if (request.session !== file || request.id !== match[1] || typeof request.updated !== 'number'
          || !Number.isFinite(request.updated) || age < 0 || age > 5000 || !valid()) continue
        handled.add(match[1])
        let result
        try {
          result = await ctx.sessionModes.set({ mode: 'loop', action: 'exit' })
        } catch (error) {
          result = { ok: false, message: error instanceof Error ? error.message : 'Loop exit failed' }
        }
        if (!valid()) continue
        await loopWrite(`${hash}.${match[1]}.response.json`, {
          session: file, id: match[1], ok: result?.ok === true,
          ...(result?.ok === true ? {} : { error: String(result?.message || result?.code || 'Loop exit rejected').slice(0, 512) }),
        })
      }
      // Requests are random and short-lived; retain only the currently visible IDs.
      for (const id of handled) if (!names.includes(`${hash}.${id}.request.json`)) handled.delete(id)
    } catch {
      // A missing or unsafe bridge is reported as unavailable by the server.
    } finally { loopBusy = false }
  }

  function startLoop(ctx) {
    loopGeneration++
    loopContext = ctx?.sessionModes ? ctx : null
    handled.clear()
    clearInterval(loopTimer)
    loopTimer = null
    if (loopContext) {
      void loopTick()
      loopTimer = setInterval(() => { void loopTick() }, 300)
      loopTimer.unref?.()
    }
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
    return typeof file === 'string' && path.isAbsolute(file) ? file : null
  }

  pi.on('session_start', (_event, ctx) => { session = current(ctx); clear(); startLoop(ctx) })
  pi.on('session_before_switch', () => { clear(); startLoop(null) })
  pi.on('session_switch', (_event, ctx) => { clear(); session = current(ctx); clear(); startLoop(ctx) })
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
  pi.on('mode_changed', () => { void loopTick() })
  pi.on('session_shutdown', async () => {
    startLoop(null)
    for (const file of pending.keys()) pending.set(file, null)
    clear()
    // Shutdown may await cleanup; streaming handlers never wait for filesystem I/O.
    while (running || pending.size) {
      if (timer) { clearTimeout(timer); timer = null; pump() }
      await settled
    }
  })
}
