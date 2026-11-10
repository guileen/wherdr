import { stopOmpLoop } from '../utils/ompLoop'

export default defineApi(async (_event, body) => {
  if (typeof body?.pane !== 'string' || typeof body?.session !== 'string' || !body.session) throw new HerdrError('bad_request', 'pane and session are required')
  const pane = findPane(body.pane)
  const machine = pane && machineOfPane(pane.id)
  const session = body.session
  const stillCurrent = () => {
    const latest = pane && findPane(pane.id)
    return !!pane && !!machine?.local && machine.status === 'online' && machineOfPane(pane.id) === machine
      && latest?.agent === 'omp' && latest.agentSession === session
  }
  if (!machine || !stillCurrent()) throw new HerdrError('stale', 'Loop session is unavailable or changed')
  try { await stopOmpLoop(machine.home, session, stillCurrent) } catch (error) {
    throw new HerdrError('unavailable', error instanceof Error ? error.message : 'Loop exit failed')
  }
  return { ok: true }
})
