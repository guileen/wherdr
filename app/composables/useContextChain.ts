import type { ContextChain } from '#shared/types'

// The pane sheet and the Loaded context page read the same chain: one cached
// request per pane keeps both bars on identical fragments without a second
// round trip, and a retry drops the cache entry so a failed read can recover.
const chains = new Map<string, Promise<ContextChain>>()

export function loadContextChain(paneId: string, options: { fresh?: boolean } = {}): Promise<ContextChain> {
  const cached = chains.get(paneId)
  if (cached && !options.fresh) return cached
  const request = api<ContextChain>(`/api/context?pane=${encodeURIComponent(paneId)}`)
    .then((chain) => {
      if (!chain || !Array.isArray(chain.items)) throw new Error('Invalid chain')
      return chain
    })
    .catch((error) => {
      chains.delete(paneId)
      throw error
    })
  chains.set(paneId, request)
  return request
}

/** The fixed load as its two fragments: system prompt text and tool schemas. */
export function chainFixed(chain: ContextChain | null): { system: number, tools: number } | null {
  const snapshot = chain?.fixed
  if (!snapshot) return null
  return { system: snapshot.nonMessage - snapshot.tools, tools: snapshot.tools }
}
