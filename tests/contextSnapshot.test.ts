import { describe, expect, it } from 'vitest'
import { parseContextSnapshot } from '../server/utils/transcripts'

const line = (message: Record<string, unknown>, top: Record<string, unknown> = {}) => JSON.stringify({ type: 'message', ...top, message })

describe('omp context snapshot', () => {
  it('reads the fixed load of an assistant message', () => {
    expect(parseContextSnapshot(line({ role: 'assistant', contextSnapshot: { promptTokens: 4780, nonMessageTokens: 2175, toolSchemaTokens: 1260, compactionEpoch: 0 } })))
      .toEqual({ nonMessage: 2175, tools: 1260 })
  })
  it('ignores entries that are not assistant messages and clamps incoherent snapshots', () => {
    expect(parseContextSnapshot(JSON.stringify({ type: 'session' }))).toBeNull()
    expect(parseContextSnapshot(line({ role: 'assistant', contextSnapshot: { nonMessageTokens: 1, toolSchemaTokens: 1 } }, { type: 'other' }))).toBeNull()
    expect(parseContextSnapshot(line({ role: 'user', contextSnapshot: { nonMessageTokens: 1, toolSchemaTokens: 1 } }))).toBeNull()
    expect(parseContextSnapshot(line({ role: 'assistant', contextSnapshot: { nonMessageTokens: 10, toolSchemaTokens: 20 } }))).toEqual({ nonMessage: 10, tools: 10 })
    expect(parseContextSnapshot(line({ role: 'assistant', contextSnapshot: { nonMessageTokens: -1, toolSchemaTokens: 1 } }))).toBeNull()
    expect(parseContextSnapshot('not json')).toBeNull()
  })
})
