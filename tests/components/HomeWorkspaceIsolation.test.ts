import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { useRouter } from '#imports'
import { expect, it } from 'vitest'
import HomeView from '~/components/HomeView.vue'
import { desk, eventsOpen, slim } from '~/composables/useHerdr'

registerEndpoint('/api/quotas', () => ({ claude: null, codex: null }))
registerEndpoint('/api/machine/order', () => ({ order: [] }))
registerEndpoint('/api/machine/awake', () => ({ supported: false }))

it('removes the teleported sidebar resize hitbox while Graph occupies the desktop and restores it on home', async () => {
  const previous = { desk: desk.value, slim: slim.value, events: eventsOpen.value }
  const router = useRouter()
  desk.value = true; slim.value = false; eventsOpen.value = true
  const wrapper = await mountSuspended(HomeView, { route: '/graphs', global: { stubs: { UContextMenu: true, UTooltip: true } } })
  try {
    expect(wrapper.attributes('inert')).toBeDefined()
    expect(document.querySelector('.list-handle')).toBeNull()
    await router.push('/')
    await wrapper.vm.$nextTick()
    expect(wrapper.attributes('inert')).toBeUndefined()
    expect(document.querySelector('.list-handle')).not.toBeNull()
    await router.push('/bots')
    await wrapper.vm.$nextTick()
    expect(wrapper.attributes('inert')).toBeDefined()
    expect(document.querySelector('.list-handle')).toBeNull()
  } finally {
    wrapper.unmount()
    desk.value = previous.desk; slim.value = previous.slim; eventsOpen.value = previous.events
    await router.push('/')
  }
})
