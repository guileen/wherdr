import type { H3Event } from 'h3'
import { setResponseHeader } from 'h3'
import { DATA_DIR } from '../env'
import { auth, defineApi, reqOf, sendError } from '../http'
import { BotWorkspaceError } from './validation'
import { createBotWorkspace, requireBotSession } from './workspace'

export const botWorkspace = createBotWorkspace({ dataDir: DATA_DIR })
export function defineBotApi<T>(handler: (event: H3Event, body: unknown) => Promise<T>) {
  // Existing global middleware enforces network, Host and cross-site read rules;
  // defineApi adds JSON/Origin/body bounds for writes. Bot auth is stricter.
  return defineApi(async (event, body: unknown) => {
    setResponseHeader(event, 'cache-control', 'no-store')
    try {
      requireBotSession(auth.status(reqOf(event)))
      return await handler(event, body)
    } catch (error) {
      if (error instanceof BotWorkspaceError) return sendError(event, error.status, { code: error.code, error: error.message })
      return sendError(event, 503, { code: 'bot_workspace_unavailable', error: 'Bot workspace could not complete the operation. If a command was submitted, retain and retry only its original request key.' })
    }
  })
}
