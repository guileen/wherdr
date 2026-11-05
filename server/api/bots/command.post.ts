import { botWorkspace, defineBotApi } from '../../utils/bots/api'
import { commandBody } from '../../utils/bots/validation'

export default defineBotApi(async (_event, body) => botWorkspace.command(commandBody(body)))
