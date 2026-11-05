import { afterEach, describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import ProviderUsage from '~/components/ProviderUsage.vue'
import { quotaNow } from '~/composables/useQuotas'
import { quotaDisplay } from '~/composables/useHerdr'
import type { QuotaRow } from '~/utils/quotas'

const now = Date.now()
const win = (used: number, inMin: number, minutes: number, label?: string) => ({
  used,
  resetsAt: now + inMin * 60000,
  minutes,
  label,
})

afterEach(() => {
  quotaDisplay.value = 'left'
})

describe('ProviderUsage', () => {
  it('identifies providers natively and eliminates repeating omp icons', async () => {
    quotaNow.value = now
    const rows: QuotaRow[] = [
      {
        key: 'omp:openai-codex',
        agent: 'omp',
        label: 'OpenAI Codex',
        provider: 'openai-codex',
        q: {
          five: win(20, 60, 300),
          week: win(80, 2000, 10080),
          at: now,
          credits: 3,
          plan: 'Team',
        },
      },
      {
        key: 'omp:google-antigravity',
        agent: 'omp',
        label: 'Google Antigravity',
        provider: 'google-antigravity',
        q: {
          five: win(10, 120, 300),
          week: win(40, 4000, 10080),
          at: now,
        },
      },
      {
        key: 'omp:anthropic',
        agent: 'omp',
        label: 'Anthropic',
        provider: 'anthropic',
        q: {
          five: win(50, 30, 300),
          week: win(70, 1000, 10080),
          at: now,
          plan: 'Pro',
        },
      },
    ]

    const w = await mountSuspended(ProviderUsage, { props: { rows } })
    const desktopRows = w.findAll('.quota-desktop')
    expect(desktopRows).toHaveLength(3)

    // Check provider 1: OpenAI
    const openai = desktopRows[0]!
    expect(openai.find('.avatar.codex').exists()).toBe(true)
    expect(openai.find('.avatar.omp').exists()).toBe(false)
    expect(openai.find('.quota-who-credits').text()).toBe('✦ 3')
    expect(openai.find('.quota-who-plan').text()).toBe('Team')

    // Check provider 2: Google
    const google = desktopRows[1]!
    expect(google.find('.avatar.google').exists()).toBe(true)
    expect(google.find('.avatar.omp').exists()).toBe(false)

    // Check provider 3: Anthropic
    const anthropic = desktopRows[2]!
    expect(anthropic.find('.avatar.claude').exists()).toBe(true)
    expect(anthropic.find('.avatar.omp').exists()).toBe(false)
    expect(anthropic.find('.quota-who-plan').text()).toBe('Pro')

    // Verify absence of redundant rotate-cw sync icons on gauges
    expect(w.findAll('.quota-reset .i-lucide-rotate-cw')).toHaveLength(0)
  })

  it('renders high-density mobile cards with concise countdowns and no alert clutter', async () => {
    quotaNow.value = now
    const rows: QuotaRow[] = [
      {
        key: 'claude',
        agent: 'claude',
        q: {
          five: win(15, 74, 300),
          week: win(50, 2880, 10080),
          at: now,
        },
      },
      {
        key: 'codex',
        agent: 'codex',
        q: {
          five: win(92, 18, 300),
          week: win(30, 7200, 10080),
          at: now - 7200000, // 2h stale
          credits: 5,
        },
      },
    ]

    const w = await mountSuspended(ProviderUsage, { props: { rows } })
    const cards = w.findAll('.quota-mobile-card')
    expect(cards).toHaveLength(2)

    // Claude card
    expect(cards[0]!.find('.avatar.claude').exists()).toBe(true)
    const resets = cards[0]!.findAll('.quota-mobile-reset').map(el => el.text())
    expect(resets).toEqual(['1h14m', '2d'])

    // Codex card with credits and stale status
    expect(cards[1]!.classes()).toContain('stale')
    expect(cards[1]!.find('.quota-mobile-credits').text()).toBe('✦5')
    // No redundant clock icon in mobile card
    expect(cards[1]!.findAll('.i-lucide-clock-alert')).toHaveLength(0)
  })

  it('renders API billing mode without empty gauge bloat', async () => {
    quotaNow.value = now
    const w = await mountSuspended(ProviderUsage, { props: { rows: [], api: true } })
    const apiRow = w.find('[data-testid="quota-claude-api"]')
    expect(apiRow.exists()).toBe(true)
    expect(apiRow.find('.avatar.claude').exists()).toBe(true)
    expect(apiRow.find('.quota-api-label').text()).toContain('API usage, no quota')
  })
})
