import { botWorkspace, defineBotApi } from '../../utils/bots/api'

export default defineBotApi(async () => botWorkspace.snapshot())
