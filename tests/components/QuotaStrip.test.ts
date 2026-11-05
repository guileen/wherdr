// Home quota strip: one row per provider. The compact layout (main.css) puts
// each window's label and percentage together, then a thin bar, then the
// reset time; every piece must still be there, with the urgency and
// old-reading states.
import { afterEach, describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import QuotaStrip from '~/components/QuotaStrip.vue'
import { quotaNow } from '~/composables/useQuotas'
import { quotaDisplay } from '~/composables/useHerdr'
import { resetText, type QuotaRow } from '~/utils/quotas'

const now = Date.now()
const win = (used: number, inMin: number, minutes: number) => ({ used, resetsAt: now + inMin * 60000, minutes })

function rows(): QuotaRow[] {
  return [
    { key: 'claude', agent: 'claude', q: { five: win(16, 132, 300), week: win(49, 3 * 1440, 10080), at: now - 20000 } },
    // Read two hours ago: its week has reset since.
    { key: 'codex', agent: 'codex', q: { five: win(90, 47, 300), week: win(62, -60, 10080), at: now - 2 * 3600000 } },
  ]
}

afterEach(() => { quotaDisplay.value = 'left' })

describe('QuotaStrip', () => {
  it('keeps icon, reading age, both windows with percentage, bar and reset time per provider', async () => {
    quotaNow.value = now
    const w = await mountSuspended(QuotaStrip, { props: { rows: rows() } })
    const lines = w.findAll('.quota-row')
    expect(lines).toHaveLength(2)

    const claude = lines[0]!
    expect(claude.find('.quota-who .avatar').exists()).toBe(true)
    expect(claude.find('.quota-who small').text()).toBe('< 1 min')
    const [five, week] = claude.findAll('.quota')
    // Label and percentage share one group, followed by the bar, then the reset.
    expect(five!.element.children[0]!.className).toBe('quota-top')
    expect(five!.element.children[1]!.className).toBe('quota-bar')
    expect(five!.element.children[2]!.className).toBe('quota-reset')
    expect(five!.find('.quota-label').text()).toBe('5 h')
    expect(five!.find('.quota-top b').text()).toBe('84%')
    expect(five!.find('.quota-bar i').attributes('style')).toContain('width: 84%')
    expect(five!.find('.quota-reset').text()).toBe(resetText(rows()[0]!.q.five!, now, 'en'))
    expect(week!.find('.quota-top b').text()).toBe('51%')
    // Beyond 24 h the reset carries the day.
    expect(week!.find('.quota-reset').text()).toMatch(/^\S+ \S/)
    expect(claude.classes()).not.toContain('stale')
  })

  it('shows the urgency, the old reading and the reset since the reading', async () => {
    quotaNow.value = now
    const w = await mountSuspended(QuotaStrip, { props: { rows: rows() } })
    const codex = w.findAll('.quota-row')[1]!
    expect(codex.classes()).toContain('stale')
    expect(codex.find('.quota-who small').text()).toBe('2 h')
    const [five, week] = codex.findAll('.quota')
    expect(five!.classes()).toContain('hi')
    expect(five!.find('.quota-top b').text()).toBe('10%')
    expect(week!.classes()).toContain('guessed')
    expect(week!.find('.quota-top b').text()).toBe('100%')
    expect(week!.find('.quota-reset').text().toLowerCase()).toBe('reset')
  })

  it('a missing window keeps its empty cell so the columns stay aligned', async () => {
    quotaNow.value = now
    const w = await mountSuspended(QuotaStrip, { props: { rows: [{ key: 'claude', agent: 'claude', q: { five: win(10, 30, 300), week: null, at: now } }] } })
    expect(w.findAll('.quota')).toHaveLength(2)
    expect(w.find('.quota.empty').exists()).toBe(true)
  })

  it('shows used percentages, reset countdowns and missing windows on phone', async () => {
    quotaNow.value = now
    const w = await mountSuspended(QuotaStrip, { props: { rows: [rows()[0]!, { key: 'missing', agent: 'codex', q: { five: null, week: win(20, 48, 10080), at: now } }] } })
    const cards = w.findAll('.quota-mobile-card')
    expect(cards[0]!.attributes('aria-label')).toContain('Claude')
    expect(cards[0]!.findAll('.quota-mobile-line b').map(n => n.text())).toEqual(['16%', '49%'])
    expect(cards[0]!.findAll('.quota-mobile-reset').map(n => n.text())).toEqual(['2h12m', '3d'])
    expect(cards[0]!.find('.quota-mobile-bar i').attributes('style')).toContain('width: 16%')
    expect(cards[1]!.find('.quota-mobile-window.missing').text()).toBe('—')
  })

  it('renders omp row with provider label, credits and custom windows on desktop and mobile', async () => {
    quotaNow.value = now
    const ompRow: QuotaRow = {
      key: 'omp:openai-codex',
      agent: 'omp',
      label: 'OpenAI Codex',
      provider: 'openai-codex',
      q: {
        five: null,
        week: win(89, 5 * 1440, 10080),
        at: now,
        credits: 3,
        windows: [
          { used: 89, resetsAt: now + 5 * 1440 * 60000, minutes: 10080, label: '7 days' },
        ],
      },
    }
    const w = await mountSuspended(QuotaStrip, { props: { rows: [ompRow] } })
    const line = w.find('.quota-row')
    expect(line.find('.quota-who-label').text()).toBe('OpenAI Codex')
    expect(line.find('.quota-who-credits').text()).toBe('✦ 3')
    expect(line.find('.quota-label').text()).toBe('7 days')
    expect(line.find('.quota-top b').text()).toBe('11%')

    const card = w.find('.quota-mobile-card')
    expect(card.find('.quota-mobile-provider-tag').text()).toContain('OpenAI Codex')
    expect(card.find('.quota-mobile-credits').text()).toContain('✦3')
    expect(card.find('.quota-mobile-line span').text()).toBe('7 days')
    expect(card.find('.quota-mobile-line b').text()).toBe('89%')
  })

  it('renders multiple windows in .quota-windows on desktop and mobile', async () => {
    quotaNow.value = now
    const ompRow: QuotaRow = {
      key: 'omp:google-antigravity',
      agent: 'omp',
      label: 'Google Antigravity',
      provider: 'google-antigravity',
      q: {
        five: null,
        week: null,
        at: now,
        windows: [
          { used: 80, resetsAt: now + 86400000, minutes: 10080, label: 'Weekly' },
          { used: 30, resetsAt: now + 18000000, minutes: 300, label: '5 Hour' },
        ],
      },
    }
    const w = await mountSuspended(QuotaStrip, { props: { rows: [ompRow] } })
    expect(w.find('.quota-windows').exists()).toBe(true)
    expect(w.findAll('.quota-windows .quota')).toHaveLength(2)
    expect(w.findAll('.quota-windows .quota-label').map(e => e.text())).toEqual(['Weekly', '5 Hour'])
    expect(w.findAll('.quota-mobile-window')).toHaveLength(2)
  })
})

describe('QuotaStrip on API billing', () => {
  it('shows a muted label instead of gauges, with no warning colour', async () => {
    quotaNow.value = now
    const w = await mountSuspended(QuotaStrip, { props: { rows: [], api: true } })
    const row = w.find('[data-testid="quota-claude-api"]')
    expect(row.exists()).toBe(true)
    expect(row.find('.quota-api-label').text()).toBe('Claude · API usage, no quota')
    expect(row.find('.quota-who .avatar').exists()).toBe(true)
    expect(w.findAll('.quota')).toHaveLength(0)
    expect(w.find('.hi, .mid, .stale').exists()).toBe(false)
  })

  it('sits before the other rows and is absent without API billing', async () => {
    quotaNow.value = now
    const both = await mountSuspended(QuotaStrip, { props: { rows: rows().slice(1), api: true } })
    expect(both.findAll('.quota-row').map(r => r.classes().includes('quota-api'))).toEqual([true, false])
    const none = await mountSuspended(QuotaStrip, { props: { rows: [] } })
    expect(none.find('.quotas').exists()).toBe(false)
  })
})
