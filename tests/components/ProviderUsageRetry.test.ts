import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { createError } from 'h3'
import ProviderUsage from '~/components/ProviderUsage.vue'
import { quotaNow } from '~/composables/useQuotas'
import { cachedAt, eventsOpen, herdrState, homeQuotas, showQuotas } from '~/composables/useHerdr'
import { modelDashboard, quotas } from '~/demo/scenario'

const now = Date.now()
let refuse = true
let gets = 0
let wrapper: VueWrapper | null = null

registerEndpoint('/api/model-dashboard', () => {
  gets++
  if (refuse) throw createError({ statusCode: 503, statusMessage: 'OMP could not complete the model operation' })
  return structuredClone(modelDashboard(now))
})

beforeEach(() => {
  refuse = true
  gets = 0
  quotaNow.value = now
  homeQuotas.value = quotas(now)
  showQuotas.value = true
  cachedAt.value = null
  eventsOpen.value = true
  herdrState.value = { ok: true, workspaces: [], panes: [] }
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  eventsOpen.value = false
  homeQuotas.value = null
  cachedAt.value = null
})

it('retries a failed dashboard read on its own and clears the error once it succeeds', async () => {
  wrapper = await mountSuspended(ProviderUsage, { props: {} })
  await flushPromises()
  await vi.waitFor(() => expect(gets).toBe(1))
  expect(wrapper!.find('.usage-error').exists()).toBe(true)

  refuse = false
  await vi.waitFor(() => expect(gets).toBe(2), { timeout: 8_000, interval: 250 })
  await flushPromises()
  await vi.waitFor(() => expect(wrapper!.find('.usage-error').exists()).toBe(false))
}, 15_000)
