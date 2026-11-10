import { describe, expect, it } from 'vitest'
import { estimateTokens } from '../app/utils/tokenEstimate'

describe('estimateTokens', () => {
  it('counts word characters four per token', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('a'.repeat(400))).toBe(100)
    expect(estimateTokens('a'.repeat(401))).toBe(101)
  })

  it('counts dense paths and symbols above a flat four characters per token', () => {
    const path = '/_nuxt/entry.DhwkaLfh.css\n/_nuxt/error-404.Bb87HomL.css\n'
    expect(estimateTokens(path)).toBe(17)
    expect(estimateTokens(path)).toBeGreaterThan(Math.ceil(path.length / 4))
  })

  it('counts one token per non-ASCII character', () => {
    expect(estimateTokens('会话输出面板默认折叠')).toBe(10)
  })
})
