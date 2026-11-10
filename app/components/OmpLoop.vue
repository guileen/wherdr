<script setup lang="ts">
import { api } from '~/composables/useHerdr'

const props = defineProps<{ pane: string | null, identity?: string | null }>()
const emit = defineEmits<{ state: [state: 'active' | 'paused' | 'inactive' | null] }>()
type LoopState = 'active' | 'paused' | 'inactive'
const state = ref<LoopState | null>(null)
const session = ref<string | null>(null)
const command = ref<string | null>(null)
const expanded = ref(false)
const stopping = ref(false)
const error = ref('')
let generation = 0
let request = 0
let timer: ReturnType<typeof setTimeout> | undefined
let expiry: ReturnType<typeof setTimeout> | undefined

function setState(value: LoopState | null, id: string | null, text: string | null = null) {
  clearTimeout(expiry)
  state.value = value
  session.value = id
  if (command.value !== text) expanded.value = false
  command.value = text
  emit('state', value)
}
async function refresh(g: number) {
  const pane = props.pane
  if (!pane || g !== generation) return
  const n = ++request
  // Keep a recent observation during a fast poll, but never indefinitely.
  try {
    const result = await api<{ state: LoopState | null, session: string | null, command?: string | null }>(`/api/omp-loop?${new URLSearchParams({ pane })}`, undefined, AbortSignal.timeout(5000))
    if (g !== generation || n !== request) return
    const valid = (result.state === 'active' || result.state === 'paused' || result.state === 'inactive')
      && (!props.identity || result.session === props.identity)
    setState(valid ? result.state : null, valid && typeof result.session === 'string' && result.session ? result.session : null, valid && typeof result.command === 'string' ? result.command : null)
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
async function copyCommand() {
  if (!command.value) return
  try { await navigator.clipboard.writeText(command.value); toast(t('Copied')) }
  catch { toast(t('Copy failed'), true) }
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
  <section v-if="state === 'active' || state === 'paused'" class="omp-loop" :class="state" aria-label="OMP Loop">
    <div class="loop-header">
      <div class="loop-info" role="status">
        <span class="loop-title"><UIcon name="i-lucide-repeat-2" aria-hidden="true" /> {{ tl('OMP LOOP', 'BOUCLE OMP') }}</span>
        <span class="loop-state"><i aria-hidden="true" />{{ state === 'active' ? tl('Loop active', 'Boucle active') : tl('Loop paused', 'Boucle en pause') }}</span>
        <span v-if="error" class="loop-error" role="alert">{{ error }}</span>
      </div>
      <button type="button" class="mono-btn loop-stop" :disabled="stopping || !session" @click="stop">
        <UIcon name="i-lucide-square" aria-hidden="true" /> {{ stopping ? tl('Stopping…', 'Arrêt…') : tl('Stop Loop', 'Arrêter la boucle') }}
      </button>
    </div>
    <template v-if="command">
      <button type="button" class="loop-command" :class="{ expanded }" :aria-expanded="expanded" @click="expanded = !expanded">{{ command }}</button>
      <div class="loop-actions">
        <button type="button" class="mono-btn" @click="expanded = !expanded">{{ expanded ? t('Show less') : t('Show full command') }}</button>
        <button type="button" class="mono-btn" @click="copyCommand"><UIcon name="i-lucide-copy" aria-hidden="true" /> {{ t('Copy') }}</button>
      </div>
    </template>
    <span v-else class="loop-missing">{{ t('Loop command unavailable') }}</span>
  </section>
</template>

<style scoped>
.omp-loop { min-height: 72px; padding: 10px 16px; border-bottom: 1px solid var(--line); border-left: 3px solid var(--dim); background: var(--surface); }
.loop-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
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
.loop-command { display: block; width: 100%; max-height: 4.5em; overflow: hidden; margin-top: 10px; padding: 8px; border: 1px solid var(--line); background: var(--bg); color: var(--text); text-align: left; white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.5 var(--mono); cursor: pointer; }
.loop-command.expanded { max-height: min(50vh, 28rem); overflow: auto; }
.loop-actions { display: flex; gap: 8px; }
.loop-actions button { min-height: 44px; }
.loop-missing { display: block; margin-top: 8px; color: var(--muted); font-size: 12px; }
</style>
