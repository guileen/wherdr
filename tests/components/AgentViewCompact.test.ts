import { afterEach, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent } from 'vue'
import AgentView from '~/components/AgentView.vue'
import { useDraft } from '~/composables/useDraft'
import { cachedAt, eventsOpen, herdrState, netDown } from '~/composables/useHerdr'
import type { Pane } from '#shared/types'

const pane: Pane = { id: 'compact-relay-test', workspace: 'w1', tab: 'w1:t1', tabLabel: null, agent: 'omp', name: null, label: null, status: 'idle', title: null, cwd: '/home/user/demo', agentSession: null }
const focusEnd = vi.fn()
const composer = defineComponent({ setup(_, { expose }) { expose({ focusEnd }); return () => null } })
const chat = defineComponent({ emits: ['relay'], template: '<button class="relay" @click="$emit(\'relay\')">Relay</button>' })

afterEach(() => { eventsOpen.value = false; herdrState.value = { ok: false, workspaces: [], panes: [] }; focusEnd.mockReset() })

it('prepends Relay to the existing draft once without disturbing attachments or sending', async () => {
  eventsOpen.value = true
  netDown.value = false
  cachedAt.value = null
  herdrState.value = { ok: true, workspaces: [], panes: [pane] }
  const draft = useDraft(pane.id)
  draft.text = 'Focus on the cache'
  draft.atts = [{ url: '', path: '/home/user/demo/note.txt', name: 'note.txt' }]
  const w = await mountSuspended(AgentView, { props: { paneId: pane.id, embedded: true, selectedMode: 'chat' }, global: { stubs: { ChatView: chat, Composer: composer, Keybar: true } } })
  try {
    await w.get('.relay').trigger('click')
    expect(draft.text).toBe('/compact relay Focus on the cache')
    expect(draft.atts).toEqual([{ url: '', path: '/home/user/demo/note.txt', name: 'note.txt' }])
    expect(focusEnd).toHaveBeenCalledOnce()
    await w.get('.relay').trigger('click')
    expect(draft.text).toBe('/compact relay Focus on the cache')
    expect(focusEnd).toHaveBeenCalledTimes(2)
  } finally {
    w.unmount()
    draft.text = ''
    draft.atts = []
  }
})
