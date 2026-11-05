import { DATA_DIR } from '../../utils/env'
import { defineBotApi } from '../../utils/bots/api'
import { createGraphObservation } from '../../utils/bots/graphObservation'

const observation = createGraphObservation({ dataDir: DATA_DIR })
export default defineBotApi(async () => observation.sources())
