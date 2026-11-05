import { DATA_DIR } from '../../utils/env'
import { defineBotApi } from '../../utils/bots/api'
import { createGraphObservation } from '../../utils/bots/graphObservation'
import { auth, reqOf } from '../../utils/http'
import { requireBotSession } from '../../utils/bots/workspace'

const observation = createGraphObservation({ dataDir: DATA_DIR })
export default defineBotApi(async (event, body) => {
  const result = body && typeof body === 'object' && Object.hasOwn(body, 'extensions')
    ? await observation.negotiate(body)
    : body && typeof body === 'object' && Object.hasOwn(body, 'history')
      ? await observation.history(body)
      : await observation.snapshot(body)
  requireBotSession(auth.status(reqOf(event)))
  return result
})
