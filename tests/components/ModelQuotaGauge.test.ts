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

  it('changes to an unknown balance at reset instead of claiming a full new bucket', async () => {
    const wrapper = await gauge(1)
    expect(wrapper.attributes('aria-label')).toContain('75% remaining')
    await wrapper.setProps({ now: now + 1000 })
    expect(wrapper.attributes('aria-label')).toContain('unknown remaining quota')
    expect(wrapper.attributes('aria-label')).toContain('awaiting update')
    expect(wrapper.find('.gauge-fill').exists()).toBe(false)
    expect(wrapper.get('.gauge-reset').text()).toBe('reset/5h')
  })

  it('does not draw a known balance for a stale or unobserved reading', async () => {
    const stale = await gauge(3600, 300, 25, now - 7200000)
    expect(stale.attributes('aria-label')).toContain('stale reading')
    expect(stale.find('.gauge-fill').exists()).toBe(false)
    const unknown = await gauge(3600, 300, null)
    expect(unknown.attributes('aria-label')).toContain('unknown remaining quota')
    expect(unknown.find('.gauge-fill').exists()).toBe(false)
  })
})
