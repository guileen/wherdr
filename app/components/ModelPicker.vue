<script setup lang="ts">
// Session model and effort selectors. Omp places these in the title bar;
// other agents keep them in the composer. Changes affect this session only.
// Unavailable when the agent is working or waiting for an answer.
// `launch` (the Board's Start): no session yet; the models and levels a program
// takes on a machine (`herdr-projects models`), picked for this start only
// (v-model:model, v-model:effort). None picked: the program alone, as before.
import type { EffortList, ModelInfo, ModelList, ModelOption, Pane } from '#shared/types'
import { type StartModels, effortsFor } from '#shared/projectsTasks'
import { currentModelOption, usageModelRoutes, usageOrderedModelOptions } from '~/utils/modelSelection'
import { useModelDashboard } from '~/composables/useModelDashboard'
import { providerIcons, providerImages } from '~/utils/providerIcons'

const props = defineProps<{ pane?: Pane, launch?: { machine: string, program: string }, header?: boolean, effortOnly?: boolean }>()
const launchModel = defineModel<string | null>('model', { default: null })
const launchEffort = defineModel<string | null>('effort', { default: null })

const modelOpen = ref(false)
const effortOpen = ref(false)
const modelsLoading = ref(false)
const effortsLoading = ref(false)
const switching = ref(false)
const list = ref<ModelList | null>(null)
const modelsFailed = ref(false)
let modelsSeq = 0
const paneKey = computed(() => JSON.stringify([props.pane?.id, props.pane?.machine, props.pane?.agent]))
const efforts = ref<EffortList | null>(null)
const { snapshot: dashboard, cards: dashboardCards, load: loadDashboard, updateRanking } = useModelDashboard(() => props.pane?.machine)
const rankingNow = ref(Date.now())
const displayNow = ref(rankingNow.value)
watch(modelOpen, (open, _, onCleanup) => {
  if (!open || props.pane?.agent !== 'omp' || props.launch) return
  displayNow.value = Date.now()
  const timer = setInterval(() => { displayNow.value = Date.now(); updateRanking(displayNow.value) }, 1000)
  onCleanup(() => clearInterval(timer))
})
// Choice just made: shown until the server state has picked it up.
const chosen = ref<{ info: ModelInfo, at: number } | null>(null)

const baseName = (s: string | null | undefined) => String(s || '').trim().toLowerCase()
const same = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b) && baseName(a) === baseName(b)
const sameModel = (a: ModelInfo | null | undefined, b: ModelInfo) =>
  Boolean(a && same(a.label, b.label) && a.effort === b.effort && (!a.id || !b.id || a.id === b.id))

const model = computed<ModelInfo | null>(() => {
  if (!props.pane) return null
  const c = chosen.value
  if (c && Date.now() - c.at < 20000 && !sameModel(props.pane.model, c.info)) return c.info
  const info = props.pane!.model
  return info ? { ...info, effort: info.effort || efforts.value?.current || null } : null
})
watch(() => [props.pane?.model?.id, props.pane?.model?.label, props.pane?.model?.effort], () => {
  if (chosen.value && sameModel(props.pane?.model, chosen.value.info)) chosen.value = null
})

const why = computed(() => {
  if (props.launch) return null
  if (!eventsOpen.value || offlineView.value || paneStale(props.pane)) return t('Changes unavailable offline')
  const s = props.pane!.status
  if (s === 'working') return t('The agent is working — change the model once it’s done.')
  if (s === 'blocked') return t('The agent is waiting for an answer — reply first.')
  return null
})
const locked = computed(() => Boolean(why.value) || switching.value)

async function loadModels(refresh = false) {
  if (modelsLoading.value || !props.pane) return
  const key = paneKey.value
  const id = ++modelsSeq
  const pane = props.pane.id
  modelsLoading.value = true
  modelsFailed.value = false
  try {
    const result = await api<ModelList>(`/api/models?pane=${encodeURIComponent(pane)}${refresh ? '&refresh=1' : ''}`)
    if (id === modelsSeq && key === paneKey.value) list.value = result
  } catch {
    if (id === modelsSeq && key === paneKey.value) modelsFailed.value = true
  } finally {
    if (id === modelsSeq && key === paneKey.value) modelsLoading.value = false
  }
}
async function loadEfforts() {
  if (effortsLoading.value) return
  effortsLoading.value = true
  try {
    efforts.value = await api<EffortList>(`/api/efforts?pane=${encodeURIComponent(props.pane!.id)}`)
  } catch (err) {
    effortOpen.value = false
    toast((err as Error).message, true)
  } finally { effortsLoading.value = false }
}
watch(() => [modelOpen.value, paneKey.value] as const, ([open]) => {
  if (open && !props.launch && (!list.value || list.value.agent !== props.pane?.agent)) void loadModels()
})
watch(() => [modelOpen.value, props.pane?.agent, props.pane?.machine] as const, ([open, agent]) => {
  if (open && agent === 'omp' && !props.launch) {
    rankingNow.value = Date.now()
    void loadDashboard()
  }
})
watch(effortOpen, (o) => { if (o && !efforts.value && !props.launch) loadEfforts() })
watch(() => [eventsOpen.value, props.pane?.status, props.pane?.model?.label, props.pane?.model?.effort], () => {
  if (!props.header && props.pane && ['claude', 'codex', 'omp'].includes(props.pane!.agent || '') && ['idle', 'done'].includes(props.pane!.status || '') &&
      !props.pane!.model?.effort && props.pane!.model && !efforts.value && !why.value) loadEfforts()
}, { immediate: true })
watch(paneKey, () => {
  modelsSeq++
  modelsLoading.value = false
  modelsFailed.value = false
  list.value = null
  efforts.value = null
  chosen.value = null
}, { flush: 'sync' })

const modelOptions = computed<ModelOption[]>(() => {
  const options = list.value?.options || []
  if (props.launch || props.pane?.agent !== 'omp') return options
  const seen = new Set(options.map(option => option.label))
  const cached: ModelOption[] = []
  for (const entry of dashboard.value?.models || []) {
    if (!seen.has(entry.selector)) {
      seen.add(entry.selector)
      cached.push({ label: entry.selector, hint: null })
    }
  }
  return [...options, ...cached]
})
const selectedModelIndex = computed(() => currentModelOption(modelOptions.value, model.value))
const isCurrent = (o: ModelOption) => modelOptions.value.indexOf(o) === selectedModelIndex.value
const displayModelOption = (o: ModelOption) => /^default \(recommended\)$/i.test(o.label) ? t('Default (recommended)') : o.label

async function choose(o: ModelOption) {
  if (isCurrent(o) || locked.value) return
  const key = paneKey.value
  switching.value = true
  haptic()
  try {
    const r = await api<{ model: ModelInfo }>('/api/model', { pane_id: props.pane!.id, label: o.label })
    if (key !== paneKey.value) return
    chosen.value = { info: r.model, at: Date.now() }
    efforts.value = null
    toast(tl(`Model: ${r.model.label} (this session)`, `Modèle : ${r.model.label} (cette session)`))
  } catch (err) {
    if (key === paneKey.value) toast((err as Error).message, true)
  } finally {
    switching.value = false
  }
  if (!props.header && !why.value) await loadEfforts()
}

async function chooseEffort(level: string) {
  if (locked.value || model.value?.effort === level) return
  switching.value = true
  haptic()
  try {
    const r = await api<{ model: ModelInfo }>('/api/effort', { pane_id: props.pane!.id, level })
    chosen.value = { info: r.model, at: Date.now() }
    if (efforts.value) efforts.value.current = level
    toast(tl(`Effort: ${level} (this session)`, `Effort : ${level} (cette session)`))
  } catch (err) { toast((err as Error).message, true) }
  finally { switching.value = false }
  // omp: each ⇧⇥ press shows more of the model's real levels.
  if (props.pane!.agent === 'omp' && !why.value) await loadEfforts()
}

const usageRoutes = computed(() => usageModelRoutes(dashboard.value, rankingNow.value, dashboardCards.value))
const optionProvider = (label: string) => usageRoutes.value.get(label)?.model.provider || (label.includes('/') ? label.split('/')[0]! : '')

const modelItems = computed(() => {
  const head = [{ type: 'label' as const, label: t('For this session only') }]
  const options = props.pane?.agent === 'omp'
    ? usageOrderedModelOptions(modelOptions.value, dashboard.value, rankingNow.value, dashboardCards.value)
    : modelOptions.value
  const opts = options.map(o => ({
    type: 'checkbox' as const,
    label: props.pane?.agent === 'omp' ? o.label : displayModelOption(o),
    description: o.hint || undefined,
    checked: isCurrent(o),
    onSelect: () => choose(o),
    ...(props.pane?.agent === 'omp' ? { class: 'omp-model-item' } : {}),
  }))
  const status = modelsLoading.value
    ? [{ label: t('Reading models…'), icon: 'i-lucide-loader-circle', disabled: true, class: 'model-loading' }]
    : modelsFailed.value ? [{ label: t('Models could not be read'), disabled: true }] : []
  const tail = [{
    label: modelsFailed.value ? t('Retry') : t('Reload list'), icon: 'i-lucide-refresh-cw',
    disabled: modelsLoading.value,
    onSelect: (e: Event) => { e.preventDefault(); loadModels(true) },
  }]
  return [head, opts, status, tail]
})
const effortItems = computed(() => {
  const head = [{ type: 'label' as const, label: t('For this session only') }]
  if (effortsLoading.value || !efforts.value) return [head, [{ label: t('Reading effort levels…'), icon: 'i-lucide-loader-circle', disabled: true }]]
  return [head, efforts.value.levels.map(level => ({
    type: 'checkbox' as const, label: level, checked: model.value?.effort === level,
    // omp "auto": the level it picked for this turn, else what it does.
    description: level !== 'auto' ? undefined
      : model.value?.effort === 'auto' && model.value.effortResolved ? tl(`This turn: ${model.value.effortResolved}`, `Ce tour : ${model.value.effortResolved}`)
        : props.pane!.agent === 'omp' ? t('Picks the level each turn') : undefined,
    onSelect: () => chooseEffort(level),
  }))]
})
// "auto · low": omp's auto level and what it resolved to this turn.
const effortText = computed(() => {
  const m = model.value
  if (!m?.effort) return null
  return m.effort === 'auto' && m.effortResolved ? `auto · ${m.effortResolved}` : m.effort
})
const showEffort = computed(() => ['claude', 'codex', 'omp'].includes(props.pane?.agent || '') &&
  Boolean(efforts.value?.levels.length || (model.value?.effort && !efforts.value)))

// Start: what the program takes on that machine, read when the program changes.
const startModels = ref<StartModels | null>(null)
const startFailed = ref(false)
let launchSeq = 0
async function loadStartModels(refresh = false) {
  const l = props.launch
  if (!l) return
  const id = ++launchSeq
  modelsLoading.value = true
  startFailed.value = false
  try {
    const r = await api<StartModels>(`/api/tasks/models?machine=${encodeURIComponent(l.machine)}&program=${encodeURIComponent(l.program)}${refresh ? '&refresh=1' : ''}`)
    if (id === launchSeq) { startModels.value = r; startFailed.value = !r.models.length }
  } catch {
    if (id === launchSeq) { startModels.value = null; startFailed.value = true }
  } finally { if (id === launchSeq) modelsLoading.value = false }
}
watch(() => props.launch && `${props.launch.machine}|${props.launch.program}`, (k) => {
  startModels.value = null
  launchModel.value = null
  launchEffort.value = null
  if (k) loadStartModels()
}, { immediate: true })
const launchLevels = computed(() => effortsFor(startModels.value, launchModel.value))
// A level the new model does not take is dropped, not kept for it.
watch(launchLevels, (lv) => { if (launchEffort.value && !lv.includes(launchEffort.value)) launchEffort.value = null })
const launchModelItems = computed(() => {
  const head = [{ type: 'label' as const, label: t('For this start only') }]
  if (modelsLoading.value || !startModels.value) return [head, [{ label: t('Reading models…'), icon: 'i-lucide-loader-circle', disabled: true, class: 'model-loading' }]]
  return [head, [
    { type: 'checkbox' as const, label: t('Program’s default'), checked: !launchModel.value, onSelect: () => { launchModel.value = null } },
    ...startModels.value.models.map(m => ({ type: 'checkbox' as const, label: m, checked: launchModel.value === m, onSelect: () => { launchModel.value = m } })),
  ], [{ label: t('Reload list'), icon: 'i-lucide-refresh-cw', onSelect: (e: Event) => { e.preventDefault(); loadStartModels(true) } }]]
})
const launchEffortItems = computed(() => [[{ type: 'label' as const, label: t('For this start only') }], [
  { type: 'checkbox' as const, label: t('Model’s default'), checked: !launchEffort.value, onSelect: () => { launchEffort.value = null } },
  ...launchLevels.value.map(level => ({ type: 'checkbox' as const, label: level, checked: launchEffort.value === level, onSelect: () => { launchEffort.value = level } })),
]])
const shownModelItems = computed(() => (props.launch ? launchModelItems.value : modelItems.value))
const shownEffortItems = computed(() => (props.launch ? launchEffortItems.value : effortItems.value))
const modelText = computed(() => (props.launch ? launchModel.value || t('Model') : model.value ? model.value.label : t('Model')))
const shownEffortText = computed(() => (props.launch ? launchEffort.value : effortText.value))
const effortShown = computed(() => (props.launch ? Boolean(launchLevels.value.length) : showEffort.value))
const modelShown = computed(() => !props.launch || !startFailed.value)
// Start has nothing to explain (never locked): no tooltip around its menus.
const UTooltip = resolveComponent('UTooltip')
const Tip = computed(() => (props.launch ? 'span' : UTooltip))
const modelTip = computed(() => (props.launch ? {} : { text: why.value || t('Change model'), disabled: !desk.value || (!why.value && modelOpen.value), content: { side: 'top' } }))
const effortTip = computed(() => (props.launch ? {} : { text: why.value || t('Change effort'), disabled: !desk.value || (!why.value && effortOpen.value), content: { side: 'top' } }))

// Selector unavailable: the menu does not open, we explain (on the phone,
// no tooltip). The button is not `disabled` so it receives the tap.
function setOpen(which: 'model' | 'effort', v: boolean) {
  if (v && locked.value) {
    if (why.value) toast(why.value, true)
    return
  }
  if (which === 'model') { modelOpen.value = v; if (v) effortOpen.value = false }
  else { effortOpen.value = v; if (v) modelOpen.value = false }
}
watch(locked, (l) => { if (l) { modelOpen.value = false; effortOpen.value = false } })
</script>

<template>
  <span v-if="!effortOnly && !modelShown" class="model-pick-none" role="status">{{ t('Models could not be read: Start uses the program alone.') }}</span>
  <component :is="Tip" v-if="!effortOnly && modelShown" v-bind="modelTip">
    <span class="model-pick-wrap">
      <UDropdownMenu
        :open="modelOpen" :items="shownModelItems" :modal="false"
        :content="{ side: header ? 'bottom' : 'top', align: 'start', sideOffset: 6 }"
        :ui="{ content: `hw-dropdown model-menu${launch ? ' z-[30]' : ''}`, itemDescription: 'model-hint', label: 'model-menu-label' }"
        @update:open="setOpen('model', $event)"
      >
        <UButton
          color="neutral" variant="ghost" size="xs" class="model-pick" :class="{ off: locked }"
          :aria-disabled="locked" :aria-label="`${t('Model')} : ${launch ? launchModel || t('Program’s default') : model ? model.label : t('Unknown model')}`"
          :trailing-icon="switching ? 'i-lucide-loader-circle' : 'i-lucide-chevron-down'"
          :ui="{ trailingIcon: switching ? 'animate-spin model-caret' : 'model-caret' }"
        >
          <span class="model-name">{{ modelText }}</span>
        </UButton>
        <template #item-leading="{ item, active, ui }">
          <span v-if="'class' in item && item.class === 'omp-model-item' && (providerIcons[optionProvider(item.label)] || providerImages[optionProvider(item.label)])" class="model-option-provider" aria-hidden="true">
            <UIcon v-if="providerIcons[optionProvider(item.label)]" :name="providerIcons[optionProvider(item.label)]!" />
            <img v-else :src="providerImages[optionProvider(item.label)]" alt="">
          </span>
          <UIcon v-else-if="'icon' in item && item.icon" :name="item.icon" data-slot="itemLeadingIcon" :class="ui.itemLeadingIcon({ active })" />
        </template>
        <template #item-label="{ item }">
          <template v-if="'class' in item && item.class === 'omp-model-item' && (providerIcons[optionProvider(item.label)] || providerImages[optionProvider(item.label)])">
            <span class="sr-only">{{ optionProvider(item.label) }}/</span>{{ item.label.slice(optionProvider(item.label).length + 1) }}
          </template>
          <template v-else>{{ item.label }}</template>
        </template>
        <template #item-description="{ item }">
          <span v-if="'description' in item && item.description" class="model-option-hint">{{ item.description }}</span>
          <span v-if="'class' in item && item.class === 'omp-model-item'" class="model-option-windows">
            <ModelQuotaGauge v-for="(window, index) in usageRoutes.get(item.label)?.windows || []" :key="index" :window="window" :now="displayNow" :at="usageRoutes.get(item.label)?.row?.q.at" compact />
            <ModelQuotaGauge v-if="!usageRoutes.get(item.label)?.windows.length" :now="displayNow" compact />
          </span>
        </template>
      </UDropdownMenu>
    </span>
  </component>
  <component :is="Tip" v-if="!header && effortShown" v-bind="effortTip">
    <span class="model-pick-wrap effort-pick-wrap">
      <UDropdownMenu
        :open="effortOpen" :items="shownEffortItems" :modal="false"
        :content="{ side: header ? 'bottom' : 'top', align: 'start', sideOffset: 6 }"
        :ui="{ content: `hw-dropdown model-menu effort-menu${launch ? ' z-[30]' : ''}`, itemDescription: 'model-hint', label: 'model-menu-label' }"
        @update:open="setOpen('effort', $event)"
      >
        <UButton
          color="neutral" variant="ghost" size="xs" class="model-pick effort-pick" :class="{ off: locked }"
          :aria-disabled="locked" :aria-label="`${t('Effort')} : ${shownEffortText || (launch ? t('Model’s default') : t('Unknown effort'))}`"
          :trailing-icon="switching ? 'i-lucide-loader-circle' : 'i-lucide-chevron-down'"
          :ui="{ trailingIcon: switching ? 'animate-spin model-caret' : 'model-caret' }"
        ><span class="model-name">{{ shownEffortText || t('Effort') }}</span></UButton>
      </UDropdownMenu>
    </span>
  </component>
</template>

<style>
.model-menu .omp-model-item { min-height: 44px; align-items: flex-start; }
.model-menu .omp-model-item [data-slot="itemLabel"] { white-space: normal; overflow-wrap: anywhere; }
.model-menu .omp-model-item [data-slot="itemDescription"] { overflow: visible; white-space: normal; }
.model-option-provider { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 15px; width: 15px; height: 15px; margin-top: 2px; border: 1px solid var(--line-soft); background: var(--surface); color: var(--text-2); }
.model-option-provider > .iconify, .model-option-provider > img { width: 11px; height: 11px; object-fit: contain; }
.model-option-hint { display: block; }
.model-option-windows { display: flex; flex-direction: column; gap: 2px; width: 100%; margin-top: 3px; }
</style>
