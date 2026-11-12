import { getQuery } from 'h3'
import { defineApi } from '../utils/http'
import { HerdrError } from '../utils/herdr'
import { findPane } from '../utils/state'
import { machineOfPane } from '../utils/machines'
import { createContextChain } from '../utils/contextChain'

const MAX_TRANSCRIPT_BYTES = 128 * 1024 * 1024
const READ_BYTES = 1024 * 1024

// The branch of the omp session tree that ends at the last entry: what the
// next turn really loads. The file grows while omp works, so only a shorter or
// replaced file (truncation, rewrite) is refused.
export default defineApi(async event => {
  const pane = findPane(String(getQuery(event).pane || ''))
  if (!pane) throw new HerdrError('bad_pane', 'Pane not found')
  const machine = machineOfPane(pane.id)
  if (!machine || (!machine.local && machine.status !== 'online')) throw new HerdrError('unreachable', 'Machine is unreachable')
  const unavailable = () => new HerdrError('unavailable', 'Context chain unavailable')
  if (pane.agent !== 'omp') throw unavailable()
  try {
    const loc = await machine.transcripts.locate(pane, true)
    if (!loc) throw unavailable()
    const stat = await machine.fs.stat(loc.file, true)
    if (!stat.isFile || !Number.isSafeInteger(stat.size) || stat.size <= 0 || stat.size > MAX_TRANSCRIPT_BYTES) throw unavailable()
    const chain = createContextChain()
    let parts: Buffer[] = []
    let partBytes = 0
    const consume = (part: Buffer) => {
      if (parts.length === 0) chain.push(part.toString('utf8'))
      else {
        parts.push(part)
        chain.push(Buffer.concat(parts, partBytes + part.length).toString('utf8'))
        parts = []
        partBytes = 0
      }
    }
    for (let offset = 0; offset < stat.size;) {
      const bytes = await machine.fs.read(loc.file, offset, Math.min(READ_BYTES, stat.size - offset))
      if (!bytes.length || bytes.length > stat.size - offset) throw unavailable()
      offset += bytes.length
      let start = 0
      for (let end = bytes.indexOf(10, start); end !== -1; end = bytes.indexOf(10, start)) {
        consume(bytes.subarray(start, end))
        start = end + 1
      }
      // A line cut by the capture point is not part of the loaded context yet.
      if (start < bytes.length) {
        const part = bytes.subarray(start)
        parts.push(part)
        partBytes += part.length
      }
    }
    const after = await machine.fs.stat(loc.file, true)
    if (!after.isFile || after.size < stat.size || (stat.ino && after.ino !== stat.ino)) throw unavailable()
    const result = chain.finish()
    if (!result) throw unavailable()
    return result
  } catch (error) {
    if (error instanceof HerdrError) throw error
    throw unavailable()
  }
})
