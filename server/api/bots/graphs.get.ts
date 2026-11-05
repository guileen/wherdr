import { DATA_DIR } from '../../utils/env'
import { defineBotApi } from '../../utils/bots/api'
import { createGraphWorkspace } from '../../utils/bots/graph'

const graphs = createGraphWorkspace({ dataDir: DATA_DIR })
export default defineBotApi(async () => graphs.sources())
