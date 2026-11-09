import { describe, expect, it } from 'vitest'
import { beijingClock, deepseekPricing } from '../app/utils/deepseekPricing'

const at = (iso: string) => Date.parse(iso)

describe('DeepSeek peak pricing', () => {
  it('halves the catalog peak price outside the two weekday UTC windows', () => {
    expect(deepseekPricing(at('2026-11-02T00:30:00Z'))).toMatchObject({ peak: false, factor: 0.5, holiday: false, until: at('2026-11-02T01:00:00Z') })
    expect(deepseekPricing(at('2026-11-02T01:00:00Z'))).toMatchObject({ peak: true, factor: 1, until: at('2026-11-02T04:00:00Z') })
    expect(deepseekPricing(at('2026-11-02T03:59:59Z'))).toMatchObject({ peak: true, until: at('2026-11-02T04:00:00Z') })
    expect(deepseekPricing(at('2026-11-02T04:00:00Z'))).toMatchObject({ peak: false, until: at('2026-11-02T06:00:00Z') })
    expect(deepseekPricing(at('2026-11-02T08:00:00Z'))).toMatchObject({ peak: true, until: at('2026-11-02T10:00:00Z') })
    expect(deepseekPricing(at('2026-11-02T10:00:00Z'))).toMatchObject({ peak: false, until: at('2026-11-03T01:00:00Z') })
  })

  it('stays off-peak through weekends and Chinese public holidays', () => {
    expect(deepseekPricing(at('2026-11-07T08:00:00Z'))).toMatchObject({ peak: false, until: at('2026-11-09T01:00:00Z') })
    expect(deepseekPricing(at('2026-10-01T08:00:00Z'))).toMatchObject({ peak: false, holiday: true, until: at('2026-10-08T01:00:00Z') })
    expect(deepseekPricing(at('2027-02-09T08:00:00Z'))).toMatchObject({ peak: false, holiday: true, until: at('2027-02-15T01:00:00Z') })
  })

  it('keys Chinese holidays to the Beijing calendar day, not the viewer or UTC day', () => {
    // 2026-10-01 00:00 Beijing is 2026-09-30 16:00 UTC.
    expect(deepseekPricing(at('2026-09-30T15:59:00Z'))).toMatchObject({ peak: false, holiday: false, until: at('2026-10-08T01:00:00Z') })
    expect(deepseekPricing(at('2026-09-30T16:00:00Z'))).toMatchObject({ peak: false, holiday: true, until: at('2026-10-08T01:00:00Z') })
    expect(deepseekPricing(at('2026-10-07T15:59:00Z'))).toMatchObject({ peak: false, holiday: true, until: at('2026-10-08T01:00:00Z') })
    expect(deepseekPricing(at('2026-10-08T00:59:00Z'))).toMatchObject({ peak: false, holiday: false, until: at('2026-10-08T01:00:00Z') })
    expect(deepseekPricing(at('2026-10-08T01:00:00Z'))).toMatchObject({ peak: true, holiday: false, until: at('2026-10-08T04:00:00Z') })
    // The next change reads in Beijing time whatever the viewer's zone.
    expect(beijingClock(at('2026-10-08T01:00:00Z'))).toBe('8 Oct, 09:00')
  })

  it('uses the catalog schedule and multiplier when the provider supplies them', () => {
    const schedule = { offPeakMultiplier: 0.25, peakWindows: [{ weekdays: [1], startMinute: 300, endMinute: 360 }] }
    expect(deepseekPricing(at('2026-11-02T05:00:00Z'), schedule)).toMatchObject({ peak: true, factor: 1, until: at('2026-11-02T06:00:00Z') })
    expect(deepseekPricing(at('2026-11-02T06:00:00Z'), schedule)).toMatchObject({ peak: false, factor: 0.25, until: at('2026-11-09T05:00:00Z') })
  })
})
