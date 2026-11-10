import { constants, copyFileSync, lstatSync, mkdirSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CliError, ROOT, say } from './core.mjs'

// No configuration files or existing extensions are changed.
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
    const info = lstatSync(target)
    if (!info.isFile() || info.isSymbolicLink() || !readFileSync(target).equals(readFileSync(source))) {
      throw new CliError(`refusing to overwrite existing extension: ${target}`)
    }
  }
  say(`OMP extension installed: ${target}`)
  say('New sessions discover it automatically. For an existing session, wait until idle and use /reload (or restart it).')
}
