<script setup lang="ts">
import { api } from '~/composables/useHerdr'

const props = defineProps<{ pane: string | null, identity?: string | null }>()
const emit = defineEmits<{ state: [state: 'active' | 'paused' | 'inactive' | null] }>()
type LoopState = 'active' | 'paused' | 'inactive'
const state = ref<LoopState | null>(null)
const session = ref<string | null>(null)
const stopping = ref(false)
const error = ref('')
let generation = 0
let request = 0
let timer: ReturnType<typeof setTimeout> | undefined
let expiry: ReturnType<typeof setTimeout> | undefined

function setState(value: LoopState | null, id: string | null) {
  clearTimeout(expiry)
  state.value = value
  session.value = id
  emit('state', value)
}
async function refresh(g: number) {
  const pane = props.pane
  if (!pane || g !== generation) return
  const n = ++request
  // Keep a recent observation during a fast poll, but never indefinitely.
  try {
    const result = await api<{ state: LoopState | null, session: string | null }>(`/api/omp-loop?${new URLSearchParams({ pane })}`, undefined, AbortSignal.timeout(5000))
    if (g !== generation || n !== request) return
    const valid = (result.state === 'active' || result.state === 'paused' || result.state === 'inactive')
      && (!props.identity || result.session === props.identity)
    setState(valid ? result.state : null, valid && typeof result.session === 'string' && result.session ? result.session : null)
    if (valid) expiry = setTimeout(() => setState(null, null), 5000)
  } catch {
    if (g === generation && n === request) setState(null, null)
  } finally {
    if (g === generation && n === request) timer = setTimeout(() => refresh(g), 3000)
  }
}
async function stop() {
  const pane = props.pane
  const id = session.value
  if (!pane || !id || stopping.value || (state.value !== 'active' && state.value !== 'paused')) return
  const g = generation
  clearTimeout(timer)
  request++
  stopping.value = true
  error.value = ''
  try {
    await api('/api/omp-loop', { pane, session: id }, AbortSignal.timeout(15000))
  } catch {
    if (g === generation) error.value = tl('Could not stop loop', 'Impossible d’arrêter la boucle')
  } finally {
    if (g === generation) {
      stopping.value = false
      setState(null, null)
      refresh(g)
    }
  }
}
watch(() => [props.pane, props.identity], () => {
  generation++
  request++
  clearTimeout(timer)
  stopping.value = false
  error.value = ''
  setState(null, null)
  if (props.pane) refresh(generation)
}, { immediate: true })
onBeforeUnmount(() => { generation++; request++; clearTimeout(timer); clearTimeout(expiry) })
</script>

<template>
  <div class="omp-loop" role="status">
    <span>{{ state === 'active' ? tl('Loop active', 'Boucle active') : state === 'paused' ? tl('Loop paused', 'Boucle en pause') : state === 'inactive' ? tl('Loop inactive', 'Boucle inactive') : tl('Loop unavailable', 'Boucle indisponible') }}</span>
    <button v-if="state === 'active' || state === 'paused'" type="button" class="mono-btn" :disabled="stopping || !session" @click="stop">{{ stopping ? tl('Stopping…', 'Arrêt…') : tl('Stop Loop', 'Arrêter la boucle') }}</button>
    <span v-if="error" role="alert">{{ error }}</span>
  </div>
</template>

<style scoped>
.omp-loop { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 6px 12px; font-size: 12px; }
</style>
