import { getQuery } from 'h3'
import { MACHINE_KEY_RE } from '../../shared/ids'
import { defineApi } from '../utils/http'
import { HerdrError } from '../utils/herdr'
import { getMachine } from '../utils/machines'
import { modelDashboard } from '../utils/modelDashboard'

// Authentication/network checks are enforced by the shared API middleware.
export default defineApi(event => {
  const key = getQuery(event).machine
  if (key === undefined || key === '') return modelDashboard.get()
  if (typeof key !== 'string' || !MACHINE_KEY_RE.test(key)) throw new HerdrError('bad_machine', 'unknown machine')
  const machine = getMachine(key)
  if (!machine) throw new HerdrError('bad_machine', 'unknown machine')
  return machine.local ? modelDashboard.get() : modelDashboard.getRemote(machine)
})
