import { createHash, randomBytes } from 'node:crypto'
import { constants, copyFileSync, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CliError, ROOT, say } from './core.mjs'

// Only exact previously shipped extensions are eligible for an automatic upgrade.
const LEGACY_DIGESTS = new Set(['c99e28eb769c51c5b3a265c2d3e16030e191c8988f19cce0d5f44a272f4fa595'])
export function installOmpThinking() {
  const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(process.env.PI_CONFIG_DIR || path.join(os.homedir(), '.omp'), 'agent')
  const directory = path.resolve(agentDir, 'extensions')
  const target = path.join(directory, 'wherdr-live-thinking.js')
  const source = path.join(ROOT, 'bin', 'omp-live-thinking.js')
  mkdirSync(directory, { recursive: true })
  try {
    copyFileSync(source, target, constants.COPYFILE_EXCL)
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    let fd
    try {
      fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      const info = fstatSync(fd)
      if (!info.isFile()) throw new Error('not a regular file')
      const installed = readFileSync(fd)
      const current = readFileSync(source)
      if (!installed.equals(current)) {
        if (!LEGACY_DIGESTS.has(createHash('sha256').update(installed).digest('hex'))) throw new Error('unrecognized extension')
        const temp = path.join(directory, `.wherdr-upgrade-${process.pid}-${randomBytes(12).toString('hex')}`)
        try {
          copyFileSync(source, temp, constants.COPYFILE_EXCL)
          const latest = lstatSync(target)
          if (!latest.isFile() || latest.isSymbolicLink() || latest.dev !== info.dev || latest.ino !== info.ino) throw new Error('extension changed')
          renameSync(temp, target)
        } finally { try { unlinkSync(temp) } catch {} }
      }
    } catch {
      throw new CliError(`refusing to overwrite existing extension: ${target}`)
    } finally {
      if (fd !== undefined) closeSync(fd)
    }
  }
  say(`OMP extension installed: ${target}`)
  say('New sessions discover it automatically. For an existing session, wait until idle and use /reload (or restart it).')
}
