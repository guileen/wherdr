import { nextTick } from 'vue'
import type { VueWrapper } from '@vue/test-utils'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GRAPH_WIRE_EXECUTION_EXTENSION, GRAPH_WIRE_PROTOCOL } from '@oh-my-pi/pi-wire/graph'
import GraphLiveRun from '~/components/bots/GraphLiveRun.vue'
import { locked } from '~/composables/useHerdr'
import { graphWireFixture, type GraphWireFixture } from '../fixtures/graphWire'

const contentRef = 'consultation-message:protected-content'
const messageRef = 'consultation-message:protected-message'

class ObservationSocket {
  static instances: ObservationSocket[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  sent: Record<string, unknown>[] = []
  closed = false
  constructor(_url: string) { ObservationSocket.instances.push(this) }
  send(text: string) { this.sent.push(JSON.parse(text)) }
  close() { this.closed = true }
  receive(frame: unknown) { this.onmessage?.({ data: JSON.stringify(frame) }) }
}

beforeEach(() => {
  locked.value = false
  ObservationSocket.instances = []
  vi.stubGlobal('WebSocket', ObservationSocket)
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
})
afterEach(() => { locked.value = false; vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function observe(execution = true, adjust?: (fixture: GraphWireFixture) => void) {
  const wrapper = await mountSuspended(GraphLiveRun, { props: { source: { id: 'local', token: 'authorized-token' }, runId: 'run1' } })
  await wrapper.get('button').trigger('click')
  const socket = ObservationSocket.instances.at(-1)!
  socket.onopen?.()
  const hello = socket.sent.find(frame => frame.type === 'hello')!
  expect(hello.extensions).toEqual([GRAPH_WIRE_EXECUTION_EXTENSION])
  const fixture = graphWireFixture(execution)
  for (const record of fixture.records) {
    if (record.kind === 'execution_conversation') {
      record.value.content_ref = contentRef
      record.value.message_refs = [messageRef]
    }
  }
  adjust?.(fixture)
  socket.receive({ protocol: GRAPH_WIRE_PROTOCOL, type: 'hello', in_reply_to: hello.message_id, sources: [fixture.source], capabilities: fixture.source.capabilities, extensions: execution ? [GRAPH_WIRE_EXECUTION_EXTENSION] : [] })
  const subscription = socket.sent.find(frame => frame.type === 'subscribe')!
  expect(subscription.scope).toEqual({ source_ids: ['local'], graph_run_id: 'run1' })
  for (const frame of fixture.frames) socket.receive({ ...frame, subscription_id: subscription.subscription_id })
  await nextTick()
  return { wrapper, socket, fixture, subscription }
}

interface Observation { wrapper: VueWrapper, socket: ObservationSocket }
async function readConsultation({ wrapper, socket }: Observation, ref = contentRef) {
  await wrapper.findAll('button').find(button => button.text() === `Read consultation text: ${ref}`)!.trigger('click')
  return socket.sent.filter(frame => frame.type === 'graph.artifact.get').at(-1)!
}
function artifactReply(request: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return { protocol: GRAPH_WIRE_PROTOCOL, type: 'graph.artifact', in_reply_to: request.message_id, source_id: 'local', graph_run_id: 'run1', ref: request.ref, availability: 'available', media_type: 'text/plain', content: 'Private consultation text', next_page_token: null, ...overrides }
}

describe('Read-only negotiated live Graph observation', () => {
  it('renders authoritative execution summaries including non-Bot work with read-only consultation actions', async () => {
    const { wrapper, socket } = await observe()
    try {
      expect(wrapper.text()).toContain('Connection: live')
      expect(wrapper.text()).toContain('Run run1 · running · revision 1')
      expect(wrapper.text()).toContain('Reviewer')
      expect(wrapper.text()).toContain('Researcher')
      expect(wrapper.text()).toContain('invocation · program · program · running · executed')
      expect(wrapper.text()).toContain('Non-Bot work (no Bot Job)')
      expect(wrapper.text()).toContain('requester → responder · active')
      expect(wrapper.text()).toContain('2 rounds remaining')
      expect(wrapper.text()).toContain('3 / 10 consumed')
      expect(wrapper.find('pre').exists()).toBe(false)
      expect(socket.sent.map(frame => frame.type)).toEqual(['open', 'hello', 'subscribe'])
    } finally { wrapper.unmount() }
  })
  it('accepts the legacy empty intersection without claiming execution state', async () => {
    const { wrapper } = await observe(false)
    try {
      expect(wrapper.text()).toContain('Connection: live')
      expect(wrapper.text()).toContain('Build assets')
      expect(wrapper.text()).not.toContain('Execution Run')
      expect(wrapper.findAll('button').some(button => button.text().startsWith('Read consultation text:'))).toBe(false)
    } finally { wrapper.unmount() }
  })
  it('updates the displayed execution Run from a validated live replacement', async () => {
    const { wrapper, socket, fixture, subscription } = await observe()
    try {
      const replacement = structuredClone(fixture.records.find(record => record.kind === 'execution_run')!)
      if (replacement.kind !== 'execution_run') throw new Error('Missing execution fixture')
      replacement.value.revision = '2'; replacement.value.state = 'held'; replacement.value.reason = 'Budget review'
      const envelope = { protocol: GRAPH_WIRE_PROTOCOL, in_reply_to: null, subscription_id: subscription.subscription_id, source_id: 'local' }
      const cursor = { journal_id: 'journal', seq: '2' }
      socket.receive({ ...envelope, type: 'graph.event', event_id: 'update', cursor, occurred_at: new Date().toISOString(), replay: false, records: [replacement] })
      socket.receive({ ...envelope, type: 'source.ready', cursor })
      await nextTick()
      expect(wrapper.text()).toContain('Run run1 · held · revision 2')
      expect(wrapper.text()).toContain('Budget review')
      expect(wrapper.text()).toContain('Committed cursor journal:2')
    } finally { wrapper.unmount() }
  })
  it('keeps stale execution summaries visibly unconfirmed rather than inventing fresh state', async () => {
    const { wrapper, socket, subscription } = await observe()
    try {
      socket.receive({ protocol: GRAPH_WIRE_PROTOCOL, type: 'source.state', in_reply_to: null, subscription_id: subscription.subscription_id, source_id: 'local', state: 'stale', reason: 'unreachable' })
      await nextTick()
      expect(wrapper.text()).toContain('Connection: stale')
      expect(wrapper.text()).toContain('Displayed records are not confirmed current.')
      expect(wrapper.text()).toContain('Run run1 · running')
      const button = wrapper.findAll('button').find(button => button.text() === `Read consultation text: ${contentRef}`)!
      expect(button.attributes('disabled')).toBeDefined()
      await button.trigger('click')
      expect(socket.sent.some(frame => frame.type === 'graph.artifact.get')).toBe(false)
    } finally { wrapper.unmount() }
  })
  it.each(['lock', 'hide', 'disconnect', 'socket-close', 'scope-invalidated', 'selection-change'])('clears execution observations on %s', async reason => {
    const { wrapper, socket } = await observe()
    try {
      if (reason === 'lock') locked.value = true
      else if (reason === 'hide') {
        vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
        document.dispatchEvent(new Event('visibilitychange'))
      } else if (reason === 'disconnect') await wrapper.findAll('button')[1]!.trigger('click')
      else if (reason === 'socket-close') socket.onclose?.()
      else if (reason === 'scope-invalidated') socket.receive({ protocol: GRAPH_WIRE_PROTOCOL, type: 'scope.invalidated', in_reply_to: null, subscription_id: socket.sent.find(frame => frame.type === 'subscribe')!.subscription_id, scope_id: 'scope', reason: 'revoked' })
      else await wrapper.setProps({ runId: 'other-run' })
      await nextTick()
      expect(wrapper.text()).not.toContain('Reviewer')
      expect(wrapper.text()).not.toContain('Execution Run')
      expect(socket.closed).toBe(true)
    } finally { wrapper.unmount() }
  })
  it.each(['foreign-run', 'unnegotiated', 'malformed'])('clears observations when the shared consumer denies %s execution records', async reason => {
    const { wrapper, socket, fixture, subscription } = await observe(reason !== 'unnegotiated')
    try {
      const incoming = graphWireFixture(true).records.find(record => record.kind === 'execution_run')!
      if (incoming.kind !== 'execution_run') throw new Error('Missing execution fixture')
      incoming.value.revision = '2'
      if (reason === 'foreign-run') incoming.value.graph_run_id = 'run2'
      const record = reason === 'malformed' ? { ...incoming, value: { ...incoming.value, budget_refs: [42] } } : incoming
      socket.receive({ protocol: GRAPH_WIRE_PROTOCOL, type: 'graph.event', in_reply_to: null, subscription_id: subscription.subscription_id, source_id: fixture.source.source_id, event_id: 'invalid-event', cursor: { journal_id: 'journal', seq: '2' }, occurred_at: new Date().toISOString(), records: [record], replay: false })
      await nextTick()
      expect(wrapper.text()).toContain('Connection: unavailable')
      expect(wrapper.text()).not.toContain('Build assets')
      expect(wrapper.text()).not.toContain('Execution Run')
      expect(socket.closed).toBe(true)
    } finally { wrapper.unmount() }
  })
  it.each(['unsupported-source', 'unknown-extension'])('denies a hello claiming %s support', async reason => {
    const wrapper = await mountSuspended(GraphLiveRun, { props: { source: { id: 'local', token: 'token' }, runId: 'run1' } })
    try {
      await wrapper.get('button').trigger('click')
      const socket = ObservationSocket.instances.at(-1)!
      socket.onopen?.()
      const fixture = graphWireFixture(reason !== 'unsupported-source')
      socket.receive({ protocol: GRAPH_WIRE_PROTOCOL, type: 'hello', in_reply_to: socket.sent.find(frame => frame.type === 'hello')!.message_id, sources: [fixture.source], extensions: [reason === 'unknown-extension' ? 'graph.author.v1' : GRAPH_WIRE_EXECUTION_EXTENSION] })
      await nextTick()
      expect(wrapper.text()).toContain('Connection: unavailable')
      expect(socket.sent.map(frame => frame.type)).toEqual(['open', 'hello'])
    } finally { wrapper.unmount() }
  })
  it('deduplicates consultation refs, binds one read to this source and Run, and displays text without parsing HTML', async () => {
    const observation = await observe(true, fixture => {
      const conversation = fixture.records.find(record => record.kind === 'execution_conversation')!
      if (conversation.kind === 'execution_conversation') conversation.value.message_refs.push(contentRef, messageRef, 'file:unrelated-artifact')
    })
    const { wrapper, socket } = observation
    try {
      expect(wrapper.findAll('button').filter(button => button.text().startsWith('Read consultation text:'))).toHaveLength(2)
      const request = await readConsultation(observation)
      expect(request).toEqual({ protocol: GRAPH_WIRE_PROTOCOL, type: 'graph.artifact.get', message_id: expect.any(String), source_id: 'local', graph_run_id: 'run1', ref: contentRef, page_token: null, limit: 1 })
      expect(socket.sent.filter(frame => frame.message_id === request.message_id)).toHaveLength(1)
      expect(wrapper.findAll('button').filter(button => button.text().startsWith('Read consultation text:')).every(button => button.attributes('disabled') !== undefined)).toBe(true)
      const text = '<img data-protected src=x onerror="alert(1)">\n<script>alert(2)</script>\n**not Markdown**'
      socket.receive(artifactReply(request, { content: text }))
      await nextTick()
      expect(wrapper.get('pre').text()).toBe(text)
      expect(wrapper.find('[data-protected]').exists()).toBe(false)
      expect(wrapper.find('pre script').exists()).toBe(false)
      expect(wrapper.find('pre strong').exists()).toBe(false)
      expect(wrapper.text()).toContain('Connection: live')
      await wrapper.findAll('button').find(button => button.text() === 'Close consultation text')!.trigger('click')
      expect(wrapper.find('pre').exists()).toBe(false)
      const nextRequest = await readConsultation(observation, messageRef)
      expect(nextRequest.message_id).not.toBe(request.message_id)
      expect(nextRequest.ref).toBe(messageRef)
    } finally { wrapper.unmount() }
  })
  it.each(['expired', 'missing', 'unknown'])('displays %s consultation availability without content', async availability => {
    const observation = await observe()
    try {
      const request = await readConsultation(observation)
      observation.socket.receive(artifactReply(request, { availability, media_type: null, content: null }))
      await nextTick()
      expect(observation.wrapper.text()).toContain(availability === 'unknown' ? 'Availability of this consultation text is unknown.' : `This consultation text ${availability === 'expired' ? 'has expired' : 'is missing'}.`)
      expect(observation.wrapper.find('pre').exists()).toBe(false)
      expect(observation.wrapper.text()).toContain('Connection: live')
    } finally { observation.wrapper.unmount() }
  })
  it.each(['reply', 'source', 'run', 'ref', 'unsolicited', 'duplicate', 'malformed', 'non-text'])('fails closed on a %s artifact response', async reason => {
    const observation = await observe()
    const { wrapper, socket } = observation
    try {
      const request = reason === 'unsolicited' ? { message_id: 'unsolicited', ref: contentRef } : await readConsultation(observation)
      const overrides = reason === 'reply' ? { in_reply_to: 'wrong-message' }
        : reason === 'source' ? { source_id: 'foreign-source' }
        : reason === 'run' ? { graph_run_id: 'other-run' }
        : reason === 'ref' ? { ref: 'unobserved-ref' }
        : reason === 'malformed' ? { unexpected: true }
        : reason === 'non-text' ? { media_type: 'application/javascript' }
        : {}
      if (reason === 'duplicate') socket.receive(artifactReply(request))
      socket.receive(artifactReply(request, overrides))
      await nextTick()
      expect(wrapper.text()).toContain('Connection: unavailable')
      expect(wrapper.find('pre').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('Private consultation text')
      expect(socket.closed).toBe(true)
    } finally { wrapper.unmount() }
  })
  it.each(['lock', 'hide', 'disconnect', 'socket-close', 'socket-error', 'scope-invalidated', 'source-change', 'token-change', 'run-change', 'stale'])('clears protected content and pending reads on %s', async reason => {
    for (const pending of [false, true]) {
      const observation = await observe()
      const { wrapper, socket, subscription } = observation
      try {
        const request = await readConsultation(observation)
        if (!pending) {
          socket.receive(artifactReply(request))
          await nextTick()
          expect(wrapper.get('pre').text()).toBe('Private consultation text')
        }
        if (reason === 'lock') locked.value = true
        else if (reason === 'hide') {
          vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
          document.dispatchEvent(new Event('visibilitychange'))
        } else if (reason === 'disconnect') await wrapper.findAll('button')[1]!.trigger('click')
        else if (reason === 'socket-close') socket.onclose?.()
        else if (reason === 'socket-error') socket.onerror?.()
        else if (reason === 'scope-invalidated') socket.receive({ protocol: GRAPH_WIRE_PROTOCOL, type: 'scope.invalidated', in_reply_to: null, subscription_id: subscription.subscription_id, scope_id: 'scope', reason: 'revoked' })
        else if (reason === 'stale') socket.receive({ protocol: GRAPH_WIRE_PROTOCOL, type: 'source.state', in_reply_to: null, subscription_id: subscription.subscription_id, source_id: 'local', state: 'stale', reason: 'unreachable' })
        else if (reason === 'source-change') await wrapper.setProps({ source: { id: 'other-source', token: 'authorized-token' } })
        else if (reason === 'token-change') await wrapper.setProps({ source: { id: 'local', token: 'new-token' } })
        else await wrapper.setProps({ runId: 'other-run' })
        await nextTick()
        expect(wrapper.find('pre').exists()).toBe(false)
        expect(wrapper.text()).not.toContain('Private consultation text')
        expect(wrapper.text()).not.toContain('Reading protected consultation text…')
        expect(wrapper.findAll('button').some(button => button.text() === 'Close consultation text')).toBe(false)
      } finally {
        wrapper.unmount()
        locked.value = false
        vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
      }
    }
  })
  it.each(['ref-removed', 'conversation-removed', 'notready'])('clears protected content when the observed conversation becomes %s', async reason => {
    const observation = await observe()
    const { wrapper, socket, fixture, subscription } = observation
    try {
      const request = await readConsultation(observation)
      socket.receive(artifactReply(request))
      await nextTick()
      expect(wrapper.find('pre').exists()).toBe(true)
      const records = structuredClone(fixture.records)
      const conversation = records.find(record => record.kind === 'execution_conversation')!
      if (conversation.kind !== 'execution_conversation') throw new Error('Missing conversation fixture')
      conversation.value.revision = '2'; conversation.value.content_ref = null
      const envelope = { protocol: GRAPH_WIRE_PROTOCOL, in_reply_to: null, subscription_id: subscription.subscription_id, source_id: 'local' }
      const cursor = { journal_id: 'journal', seq: '2' }
      if (reason === 'ref-removed') socket.receive({ ...envelope, type: 'graph.event', event_id: 'remove-ref', cursor, occurred_at: new Date().toISOString(), replay: false, records: [conversation] })
      else {
        socket.receive({ ...envelope, type: 'snapshot.begin', snapshot_id: 'replacement', cursor, page_count: 1 })
        if (reason === 'conversation-removed') {
          socket.receive({ ...envelope, type: 'snapshot.page', snapshot_id: 'replacement', cursor, page: 1, records: records.filter(record => record.kind !== 'execution_conversation') })
          socket.receive({ ...envelope, type: 'snapshot.end', snapshot_id: 'replacement', cursor })
          socket.receive({ ...envelope, type: 'source.ready', cursor })
        }
      }
      await nextTick()
      expect(wrapper.find('pre').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('Private consultation text')
      expect(wrapper.findAll('button').some(button => button.text() === 'Close consultation text')).toBe(false)
    } finally { wrapper.unmount() }
  })
  it('bounds pending reads and rejects a late reply after timeout', async () => {
    const observation = await observe()
    try {
      vi.useFakeTimers()
      const request = await readConsultation(observation)
      await vi.advanceTimersByTimeAsync(10000)
      expect(observation.wrapper.text()).toContain('The consultation text request timed out.')
      expect(observation.wrapper.text()).not.toContain('Reading protected consultation text…')
      observation.socket.receive(artifactReply(request))
      await nextTick()
      expect(observation.wrapper.text()).toContain('Connection: unavailable')
      expect(observation.wrapper.find('pre').exists()).toBe(false)
    } finally { observation.wrapper.unmount() }
  })
})
