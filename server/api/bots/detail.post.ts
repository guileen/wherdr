import { botWorkspace, defineBotApi } from '../../utils/bots/api'
import { detailBody } from '../../utils/bots/validation'

export default defineBotApi(async (_event, body) => botWorkspace.detail(detailBody(body)))
