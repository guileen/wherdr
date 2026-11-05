<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { marked } from 'marked'
import { isMap, parseDocument } from 'yaml'
import GraphRelationsEditor from './GraphRelationsEditor.vue'
import { t } from '~/utils/i18n'

const props = defineProps<{ content: string, disabled: boolean }>()
const emit = defineEmits<{ 'update:content': [value: string] }>()
type NodeView = { id: string, kind: string, member?: string, task?: string }
type Relation = { id?: string, from: string, to: string }
const selected = ref(''), editing = ref(false), key = ref(''), kind = ref('bot'), member = ref(''), task = ref(''), body = ref(''), error = ref('')
const identifier = /^[a-z][a-z0-9-]*$/

function parse(content: string) {
  const match = /^(---[ \t]*\r?\n)([\s\S]*?)(^---[ \t]*(?:\r?\n|$))/m.exec(content)
  if (!match || match.index !== 0) throw new Error('Graph Markdown must have frontmatter.')
  const doc = parseDocument(match[2]!, { uniqueKeys: true })
  if (doc.errors.length || !isMap(doc.contents)) throw new Error('Graph frontmatter cannot be displayed on the canvas.')
  const value = doc.toJS({ maxAliasCount: 100 }) as Record<string, unknown>
  if (!value || value.format !== 'omp.graph/v1' || !value.nodes || typeof value.nodes !== 'object' || Array.isArray(value.nodes) || !value.members || typeof value.members !== 'object' || Array.isArray(value.members)) throw new Error('Graph frontmatter cannot be displayed on the canvas.')
  return { doc, value, opening: match[1]!, closing: match[3]!, body: content.slice(match[0].length) }
}
const definition = computed(() => {
  try {
    const parsed = parse(props.content)
    const nodes = Object.entries(parsed.value.nodes as Record<string, unknown>).map(([id, raw]) => ({ id, ...(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) } as NodeView))
    const relations = (value: unknown): Relation[] => Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && typeof item.from === 'string' && typeof item.to === 'string') : []
    return { nodes, members: Object.keys(parsed.value.members as object), edges: relations(parsed.value.edges), communications: relations(parsed.value.communications) }
  } catch { return null }
})
watch(() => props.content, () => { if (selected.value && !definition.value?.nodes.some(node => node.id === selected.value)) { selected.value = ''; editing.value = false } })
function addNode() { selected.value = ''; editing.value = true; key.value = ''; kind.value = 'bot'; member.value = ''; task.value = ''; body.value = ''; error.value = '' }
function selectNode(node: NodeView) { selected.value = node.id; editing.value = false; error.value = '' }
function editNode() {
  const node = definition.value?.nodes.find(item => item.id === selected.value)
  if (!node || !['bot', 'human'].includes(node.kind)) return
  key.value = node.id; kind.value = node.kind; member.value = node.member || ''; task.value = node.task?.replace(/^#/, '') || ''; body.value = ''; editing.value = true; error.value = ''
}
function apply() {
  error.value = ''
  if (!identifier.test(key.value) || !identifier.test(task.value) || (kind.value === 'bot' && !definition.value?.members.includes(member.value))) { error.value = 'Choose a valid node ID, task heading, and member.'; return }
  try {
    const parsed = parse(props.content)
    const nodes = parsed.doc.get('nodes', true)
    if (!isMap(nodes)) throw new Error('Nodes must be a map.')
    if (!selected.value && nodes.has(key.value)) throw new Error('This node ID already exists.')
    const headings = marked.lexer(parsed.body).flatMap(token => token.type === 'heading' && token.depth === 2 && /^ {0,3}##[ \t]+/.test(token.raw) ? [token.text.trim()] : [])
    const exists = headings.includes(task.value)
    if (!exists && !body.value.trim()) throw new Error('Provide task text for the new heading.')
    if (exists && body.value.trim()) throw new Error('That task heading already exists; leave new task text empty to reuse it.')
    if (selected.value) {
      const node = nodes.get(selected.value, true)
      if (!isMap(node)) throw new Error('This node cannot be edited on the canvas.')
      node.set('task', `#${task.value}`)
      if (kind.value === 'bot') node.set('member', member.value)
    } else nodes.set(key.value, parsed.doc.createNode({ kind: kind.value, ...(kind.value === 'bot' ? { member: member.value } : {}), task: `#${task.value}` }))
    const newline = parsed.opening.includes('\r\n') ? '\r\n' : '\n'
    let rest = parsed.body
    if (!exists) rest += `${rest && !/[\r\n]$/.test(rest) ? newline : ''}${newline}## ${task.value}${newline}${body.value}${newline}`
    emit('update:content', parsed.opening + parsed.doc.toString().replace(/\n/g, newline) + parsed.closing + rest)
    selected.value = key.value; editing.value = false
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Cannot update this definition.' }
}
</script>

<template>
  <section class="definition-canvas" :aria-label="t('Graph definition canvas')">
    <h2>{{ t('Definition canvas') }}</h2>
    <p>{{ t('Definition only — changes are drafts until saved at the loaded revision. No Run is started.') }}</p>
    <p v-if="!definition" role="alert">{{ t('This Markdown cannot be displayed on the canvas. Use the Markdown editor to correct it.') }}</p>
    <template v-else>
      <div class="canvas" :aria-label="t('Orchestration nodes')">
        <button v-for="node in definition.nodes" :key="node.id" type="button" class="node" :aria-pressed="selected === node.id" @click="selectNode(node)"><strong>{{ node.id }}</strong><span>{{ node.kind }}<template v-if="node.member"> · {{ node.member }}</template></span></button>
        <p v-if="!definition.nodes.length">{{ t('This definition has no nodes.') }}</p>
      </div>
      <h3>{{ t('Orchestration edges') }}</h3><ul><li v-for="(edge, index) in definition.edges" :key="index">{{ edge.from }} → {{ edge.to }}<template v-if="edge.id"> · {{ edge.id }}</template></li></ul><p v-if="!definition.edges.length">{{ t('No orchestration edges.') }}</p>
      <h3>{{ t('Communication permissions (members)') }}</h3><ul><li v-for="(edge, index) in definition.communications" :key="index">{{ edge.from }} ⇢ {{ edge.to }}</li></ul><p v-if="!definition.communications.length">{{ t('No communication permissions.') }}</p>
      <template v-if="selected && !editing"><h3>{{ selected }}</h3><p>{{ t('Task') }}: {{ definition.nodes.find(node => node.id === selected)?.task }}</p><button type="button" :disabled="disabled || !['bot', 'human'].includes(definition.nodes.find(node => node.id === selected)?.kind || '')" @click="editNode">{{ t('Edit node') }}</button> <button type="button" @click="selected = ''">{{ t('Back to overview') }}</button></template>
      <button v-if="!editing" type="button" :disabled="disabled" @click="addNode">{{ t('Add node') }}</button>
      <form v-if="editing" @submit.prevent="apply">
        <h3>{{ selected ? t('Edit node') : t('Add node') }}</h3>
        <label>{{ t('Node ID') }} <input v-model.trim="key" :disabled="disabled || !!selected" required pattern="[a-z][a-z0-9-]*"></label>
        <label>{{ t('Kind') }} <select v-model="kind" :disabled="disabled || !!selected"><option value="bot">Bot</option><option value="human">Human</option></select></label>
        <label v-if="kind === 'bot'">{{ t('Member') }} <select v-model="member" :disabled="disabled" required><option value="">{{ t('Choose a member') }}</option><option v-for="id in definition.members" :key="id" :value="id">{{ id }}</option></select></label>
        <label>{{ t('Task heading') }} <input v-model.trim="task" :disabled="disabled" required pattern="[a-z][a-z0-9-]*"></label>
        <label>{{ t('New task text (leave empty to reuse an existing heading)') }} <textarea v-model="body" :disabled="disabled" rows="4" /></label>
        <p v-if="error" role="alert">{{ t(error) }}</p><button type="submit" :disabled="disabled">{{ t('Apply to draft') }}</button> <button type="button" @click="editing = false">{{ t('Cancel') }}</button>
      </form>
      <GraphRelationsEditor :content="content" :disabled="disabled" @update:content="emit('update:content', $event)" />
    </template>
  </section>
</template>

<style scoped>
.definition-canvas { border: 1px solid var(--line); padding: 16px; margin: 24px 0; }
h2 { font: 22px var(--display); } h3 { font: 12px var(--mono); } p, li { color: var(--text-2); font-size: 12px; }
.canvas { display: flex; gap: 10px; overflow-x: auto; padding: 12px 0; }.node { flex: 0 0 160px; min-height: 90px; text-align: left; display: flex; flex-direction: column; gap: 8px; }.node[aria-pressed=true] { border-color: var(--accent); }.node strong { font: 16px var(--display); }
label { display: grid; gap: 6px; margin: 12px 0; font: 11px var(--mono); } input, select, textarea, button { min-height: 44px; padding: 8px 12px; border: 1px solid var(--line); border-radius: 0; color: var(--text); background: var(--surface); } button { cursor: pointer; } button:disabled { opacity: .5; cursor: not-allowed; } button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
