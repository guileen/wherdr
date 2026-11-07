import { getQuery } from 'h3'
import { defineApi } from '../utils/http'
import { HerdrError } from '../utils/herdr'
import { findPane } from '../utils/state'
import { machineOfPane } from '../utils/machines'
import { createQaCompactionEstimator } from '../utils/compactEstimate'

const MAX_TRANSCRIPT_BYTES = 128 * 1024 * 1024
const READ_BYTES = 1024 * 1024

export default defineApi(async event => {
  const pane = findPane(String(getQuery(event).pane || ''))
  if (!pane) throw new HerdrError('bad_pane', 'Pane not found')
  const machine = machineOfPane(pane.id)
  if (!machine || (!machine.local && machine.status !== 'online')) throw new HerdrError('unreachable', 'Machine is unreachable')
  const unavailable = () => new HerdrError('unavailable', 'Compact estimate unavailable')
  if (pane.agent !== 'omp' || pane.status === 'working' || !pane.ompStatus?.metersFresh || !pane.ompStatus.meters) throw unavailable()
  try {
    const loc = await machine.transcripts.locate(pane, true)
    if (!loc) throw unavailable()
    const stat = await machine.fs.stat(loc.file, true)
    // Bound both the total scan and each local/remote read. A record may span
    // blocks (including a multi-byte UTF-8 character), so decode only once the
    // complete line's bytes are available.
    if (!stat.isFile || !Number.isSafeInteger(stat.size) || stat.size <= 0 || stat.size > MAX_TRANSCRIPT_BYTES) throw unavailable()
    // A whole-second mtime cannot fence same-size rewrites. In that case use
    // the machine's digest on both sides of the scan or decline the estimate.
    const coarseMtime = stat.mtimeMs % 1000 === 0
    if (coarseMtime && !machine.fs.digest) throw unavailable()
    const digest = coarseMtime ? await machine.fs.digest!(loc.file, stat.size) : null
    const estimator = createQaCompactionEstimator(pane.ompStatus.meters)
    let parts: Buffer[] = []
    let partBytes = 0
    const consume = (part: Buffer) => {
      if (parts.length === 0) estimator.push(part.toString('utf8'))
      else {
        parts.push(part)
        estimator.push(Buffer.concat(parts, partBytes + part.length).toString('utf8'))
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
      if (start < bytes.length) {
        const part = bytes.subarray(start)
        parts.push(part)
        partBytes += part.length
      }
    }
    if (parts.length) consume(Buffer.alloc(0))
    const after = await machine.fs.stat(loc.file, true)
    if (!after.isFile || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || (stat.ino && after.ino !== stat.ino)) throw unavailable()
    if (coarseMtime && await machine.fs.digest!(loc.file, stat.size) !== digest) throw unavailable()
    const estimate = estimator.finish()
    if (!estimate) throw unavailable()
    return estimate
  } catch (error) {
    if (error instanceof HerdrError) throw error
    throw unavailable()
  }
})
