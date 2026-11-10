import { readOmpLoop } from '../utils/ompLoop'

export default defineApi(async (event) => {
  const pane = findPane(String(getQuery(event).pane || ''))
  const machine = pane && machineOfPane(pane.id)
  const session = pane?.agentSession
  if (!pane || pane.agent !== 'omp' || !session || !machine?.local || machine.status !== 'online') return { state: null, session: null }
  const state = await readOmpLoop(machine.home, session)
  const latest = findPane(pane.id)
  if (state === null || latest?.agent !== 'omp' || latest.agentSession !== session
    || machineOfPane(pane.id) !== machine || machine.status !== 'online') return { state: null, session: null }
  return { state, session }
})
