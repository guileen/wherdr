import { afterEach, describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ModelQuotaGauge from '~/components/ModelQuotaGauge.vue'

const now = Date.UTC(2026, 0, 1)
const mounted: { unmount: () => void }[] = []
afterEach(() => { for (const wrapper of mounted.splice(0)) wrapper.unmount() })

async function gauge(seconds: number | null, minutes = 300, used: number | null = 25, at = now) {
  const wrapper = await mountSuspended(ModelQuotaGauge, { props: { now, at, window: { used, minutes, resetsAt: seconds == null ? null : now + seconds * 1000 } } })
  mounted.push(wrapper)
  return wrapper
}

describe('ModelQuotaGauge countdowns', () => {
  it.each([
    [5 * 86400, 10080, '5d/7d'],
    [34 * 3600, 10080, '1d10h/7d'],
    [7500, 300, '2h05m/5h'],
    [7200, 300, '2h/5h'],
    [320, 300, '5m20s/5h'],
    [300, 300, '5m/5h'],
    [59, 300, '59s/5h'],
    [0.1, 300, '1s/5h'],
    [0, 300, 'reset/5h'],
    [null, 300, '—/5h'],
  ])('formats %s seconds without losing the reset boundary', async (seconds, minutes, expected) => {
    const wrapper = await gauge(seconds, minutes)
    expect(wrapper.get('.gauge-reset').text()).toBe(expected)
  })

  it.each([
    [5 * 86400 + 1, '6d'],
    [86400, '1d'],
    [86400 - 1, '24h'],
    [3601, '2h'],
    [3600, '1h'],
    [3599, '<1h'],
    [0, 'reset'],
    [null, '—'],
  ])('rounds summary reset time up at %s seconds', async (seconds, expected) => {
    const wrapper = await gauge(seconds, 10080)
    await wrapper.setProps({ summary: true, compact: true })
    expect(wrapper.get('.gauge-reset').text()).toBe(expected)
    expect(wrapper.find('.gauge-period').exists()).toBe(false)
  })

  it('changes to an unknown balance at reset instead of claiming a full new bucket', async () => {
    const wrapper = await gauge(1)
    expect(wrapper.attributes('aria-label')).toContain('25% used')
    await wrapper.setProps({ now: now + 1000 })
    expect(wrapper.attributes('aria-label')).toContain('unknown used quota')
    expect(wrapper.attributes('aria-label')).toContain('awaiting update')
    expect(wrapper.find('.gauge-fill').exists()).toBe(false)
    expect(wrapper.get('.gauge-reset').text()).toBe('reset/5h')
  })

  it('does not draw a known balance for a stale or unobserved reading', async () => {
    const stale = await gauge(3600, 300, 25, now - 7200000)
    expect(stale.attributes('aria-label')).toContain('stale reading')
    expect(stale.find('.gauge-fill').exists()).toBe(false)
    const unknown = await gauge(3600, 300, null)
    expect(unknown.attributes('aria-label')).toContain('unknown used quota')
    expect(unknown.find('.gauge-fill').exists()).toBe(false)
  })

  it('uses the same accessible unknown state for a compact stale gauge', async () => {
    const wrapper = await gauge(3600, 300, 25, now - 7200000)
    await wrapper.setProps({ compact: true })
    expect(wrapper.classes()).toContain('compact')
    expect(wrapper.get('.gauge-value').text()).toBe('—')
    expect(wrapper.attributes('aria-label')).toContain('unknown used quota')
    expect(wrapper.find('.gauge-fill').exists()).toBe(false)
  })

  it('splits used, unused elapsed, and excess quota at the elapsed-time boundary', async () => {
    const within = await gauge(9000, 300, 25)
    expect(Number(within.get('.gauge-fill').attributes('width'))).toBeCloseTo(57 * 0.25)
    expect(Number(within.get('.gauge-under').attributes('x'))).toBeCloseTo(1.5 + 57 * 0.25)
    expect(Number(within.get('.gauge-under').attributes('width'))).toBeCloseTo(57 * 0.25)
    expect(within.find('.gauge-over').exists()).toBe(false)
    const even = await gauge(9000, 300, 50)
    expect(even.find('.gauge-under').exists()).toBe(false)
    expect(even.find('.gauge-over').exists()).toBe(false)
    const over = await gauge(9000, 300, 75)
    expect(Number(over.get('.gauge-fill').attributes('width'))).toBeCloseTo(57 * 0.5)
    expect(over.find('.gauge-under').exists()).toBe(false)
    expect(Number(over.get('.gauge-over').attributes('x'))).toBeCloseTo(1.5 + 57 * 0.5)
    expect(Number(over.get('.gauge-over').attributes('width'))).toBeCloseTo(57 * 0.25)
    expect(over.attributes('aria-label')).toContain('50% of period elapsed')
  })

  it('shows unrated usage when the elapsed time is unknown', async () => {
    const wrapper = await gauge(null, 300, 25)
    expect(Number(wrapper.get('.gauge-unrated').attributes('width'))).toBeCloseTo(57 * 0.25)
    expect(wrapper.find('.gauge-under').exists()).toBe(false)
    expect(wrapper.find('.gauge-over').exists()).toBe(false)
    expect(wrapper.attributes('aria-label')).toContain('elapsed time unknown')
  })
})
