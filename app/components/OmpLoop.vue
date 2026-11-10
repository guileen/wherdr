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
  <section class="omp-loop" :class="state || 'unavailable'" aria-label="OMP Loop">
    <div class="loop-info" role="status">
      <span class="loop-title"><UIcon name="i-lucide-repeat-2" aria-hidden="true" /> {{ tl('OMP LOOP', 'BOUCLE OMP') }}</span>
      <span class="loop-state"><i aria-hidden="true" />{{ state === 'active' ? tl('Loop active', 'Boucle active') : state === 'paused' ? tl('Loop paused', 'Boucle en pause') : state === 'inactive' ? tl('Loop inactive', 'Boucle inactive') : tl('Loop unavailable', 'Boucle indisponible') }}</span>
      <span v-if="error" class="loop-error" role="alert">{{ error }}</span>
    </div>
    <button v-if="state === 'active' || state === 'paused'" type="button" class="mono-btn loop-stop" :disabled="stopping || !session" @click="stop">
      <UIcon name="i-lucide-square" aria-hidden="true" /> {{ stopping ? tl('Stopping…', 'Arrêt…') : tl('Stop Loop', 'Arrêter la boucle') }}
    </button>
  </section>
</template>

<style scoped>
.omp-loop { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 72px; padding: 10px 16px; border-bottom: 1px solid var(--line); border-left: 3px solid var(--dim); background: var(--surface); }
.omp-loop.active { border-left-color: var(--working); }
.omp-loop.paused { border-left-color: var(--blocked); }
.loop-info { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; min-width: 0; }
.loop-title { display: inline-flex; align-items: center; gap: 7px; color: var(--text); font: 600 13px var(--mono); letter-spacing: .06em; }
.loop-state { display: inline-flex; align-items: center; gap: 7px; color: var(--text-2); font-size: 13px; }
.loop-state i { width: 7px; height: 7px; flex: none; background: var(--dim); }
.active .loop-state i { background: var(--working); }
.paused .loop-state i { background: var(--blocked); }
.inactive .loop-state i { background: transparent; box-shadow: inset 0 0 0 1px var(--muted); }
.loop-stop { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 44px; padding: 0 12px; flex: none; border: 1px solid var(--line); color: var(--text); }
.loop-error { color: var(--blocked); font-size: 12px; }
</style>
