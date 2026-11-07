<script setup lang="ts">
import { computed, ref } from 'vue'
import { marked } from 'marked'
import { isMap, isSeq, parseDocument } from 'yaml'
import { t } from '~/utils/i18n'
import { detachGraphAliases } from '~/utils/graph-yaml'

const props = defineProps<{ content: string, disabled: boolean }>()
const emit = defineEmits<{ 'update:content': [value: string] }>()
type Category = 'member' | 'edge' | 'communication'
type Item = {
  id?: string, from?: string, to?: string, when?: string, role?: string, model?: string, base?: string, duty?: string
  bot?: { id: string, digest: string }, permissions?: { read: string[], write: string[], execute: string[] }
  on?: string[], artifacts?: string[], max_rounds?: number, timeout_ms?: number
}
type Definition = { members: Record<string, Item>, nodes: Record<string, unknown>, edges: Item[], communications: Item[] }
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}
function memberView(value: unknown): value is Item {
  if (!record(value) || typeof value.model !== 'string' || !['isolated', 'omp-default'].includes(String(value.base)) || !['research', 'guide', 'spec', 'review', 'code-only', 'test-only', 'general'].includes(String(value.duty))) return false
  if (!record(value.permissions) || !strings(value.permissions.read) || !strings(value.permissions.write) || !strings(value.permissions.execute)) return false
  const role = typeof value.role === 'string' && value.bot === undefined
  const bot = record(value.bot) && typeof value.bot.id === 'string' && typeof value.bot.digest === 'string' && value.role === undefined
  return role || bot
}
function relationView(value: unknown, edge: boolean): value is Item {
  if (!record(value) || typeof value.from !== 'string' || typeof value.to !== 'string') return false
  if (edge) return typeof value.id === 'string' && (value.on === undefined || strings(value.on))
  return typeof value.when === 'string' && (value.artifacts === undefined || strings(value.artifacts))
    && (value.max_rounds === undefined || (Number.isSafeInteger(value.max_rounds) && typeof value.max_rounds === 'number' && value.max_rounds > 0))
    && (value.timeout_ms === undefined || (Number.isSafeInteger(value.timeout_ms) && typeof value.timeout_ms === 'number' && value.timeout_ms > 0))
}
const mode = ref<Category | null>(null), original = ref<string | number | null>(null), error = ref('')
const key = ref(''), from = ref(''), to = ref(''), heading = ref(''), body = ref('')
const model = ref(''), base = ref('isolated'), duty = ref('general'), identity = ref('role'), botId = ref(''), botDigest = ref('')
const read = ref(''), write = ref(''), execute = ref(''), outcomes = ref(''), artifacts = ref(''), rounds = ref(''), timeout = ref('')
const identifier = /^[a-z][a-z0-9-]*$/
const list = (value: string) => value.split('\n').map(item => item.trim()).filter(Boolean)
const textList = (value: unknown) => Array.isArray(value) ? value.join('\n') : ''

function parse() {
  const match = /^(---[ \t]*\r?\n)([\s\S]*?)(^---[ \t]*(?:\r?\n|$))/m.exec(props.content)
  if (!match || match.index !== 0) throw new Error('Graph Markdown must have frontmatter.')
  const doc = parseDocument(match[2]!, { uniqueKeys: true })
  if (doc.errors.length || !isMap(doc.contents)) throw new Error('Graph frontmatter cannot be displayed on the canvas.')
  const raw: unknown = doc.toJS({ maxAliasCount: 100 })
  if (!record(raw) || raw.format !== 'omp.graph/v1' || !record(raw.members) || !record(raw.nodes)
    || !Object.values(raw.members).every(memberView) || !Object.values(raw.nodes).every(record)
    || (raw.edges !== undefined && (!Array.isArray(raw.edges) || !raw.edges.every(item => relationView(item, true))))
    || (raw.communications !== undefined && (!Array.isArray(raw.communications) || !raw.communications.every(item => relationView(item, false))))) {
    throw new Error('Graph frontmatter cannot be displayed on the canvas.')
  }
  const value: Definition = {
    members: raw.members as Record<string, Item>, nodes: raw.nodes,
    edges: (raw.edges ?? []) as Item[], communications: (raw.communications ?? []) as Item[],
  }
  return { doc, value, opening: match[1]!, closing: match[3]!, body: props.content.slice(match[0].length) }
}
const definition = computed(() => { try { return parse().value } catch { return null } })
function start(category: Category, index: string | number | null = null) {
  if (props.disabled || !definition.value) return
  mode.value = category; original.value = index; error.value = ''
  const item: Item | undefined = index === null ? {} : category === 'member' ? definition.value.members[String(index)] : definition.value[category === 'edge' ? 'edges' : 'communications'][Number(index)]
  if (!item || typeof item !== 'object' || Array.isArray(item)) { mode.value = null; return }
  key.value = category === 'member' ? String(index ?? '') : item.id ?? ''
  from.value = item.from ?? ''; to.value = item.to ?? ''; heading.value = (category === 'member' ? item.role : item.when)?.replace(/^#/, '') ?? ''; body.value = ''
  model.value = item.model ?? ''; base.value = item.base ?? 'isolated'; duty.value = item.duty ?? 'general'
  identity.value = item.bot ? 'bot' : 'role'; botId.value = item.bot?.id ?? ''; botDigest.value = item.bot?.digest ?? ''
  read.value = textList(item.permissions?.read); write.value = textList(item.permissions?.write); execute.value = textList(item.permissions?.execute)
  outcomes.value = textList(item.on); artifacts.value = textList(item.artifacts); rounds.value = item.max_rounds?.toString() ?? ''; timeout.value = item.timeout_ms?.toString() ?? ''
}
function apply() {
  if (props.disabled || !mode.value) return
  error.value = ''
  try {
    const parsed = parse(), category = mode.value
    detachGraphAliases(parsed.doc)
    const members = parsed.doc.get('members', true)
    if (!isMap(members)) throw new Error('Members must be a map.')
    if (category === 'member') {
      if (!identifier.test(key.value) || !model.value.trim()) throw new Error('Enter a valid member ID and model binding.')
      if (original.value === null && members.has(key.value)) throw new Error('This member ID already exists.')
      if (identity.value === 'bot' && (!botId.value.trim() || !botDigest.value.trim())) throw new Error('Enter the Bot reference ID and digest.')
    } else {
      const available = category === 'edge' ? parsed.value.nodes : parsed.value.members
      if (!Object.hasOwn(available, from.value) || !Object.hasOwn(available, to.value)) throw new Error('Choose existing endpoints.')
      if (category === 'edge' && !identifier.test(key.value)) throw new Error('Enter a valid edge ID.')
    }
    const needsHeading = category === 'communication' || (category === 'member' && identity.value === 'role')
    let rest = parsed.body
    const newline = parsed.opening.includes('\r\n') ? '\r\n' : '\n'
    if (needsHeading) {
      if (!identifier.test(heading.value)) throw new Error('Enter a valid heading.')
      const headings = marked.lexer(rest).flatMap(token => token.type === 'heading' && token.depth === 2 && /^ {0,3}##[ \t]+/.test(token.raw) ? [token.text.trim()] : [])
      const exists = headings.includes(heading.value)
      if (!exists && !body.value.trim()) throw new Error('Provide text for the new heading.')
      if (exists && body.value.trim()) throw new Error('That heading already exists; leave new text empty to reuse it.')
      if (!exists) rest += `${rest && !/[\r\n]$/.test(rest) ? newline : ''}${newline}## ${heading.value}${newline}${body.value}${newline}`
    }
    if (category === 'member') {
      const existing = original.value === null ? parsed.doc.createNode<unknown>({}) : members.get(String(original.value), true)
      if (!isMap(existing)) throw new Error('This member cannot be edited on the canvas.')
      existing.set('model', model.value.trim()); existing.set('base', base.value); existing.set('duty', duty.value)
      if (identity.value === 'role') { existing.delete('bot'); existing.set('role', `#${heading.value}`) }
      else { existing.delete('role'); existing.set('bot', parsed.doc.createNode({ id: botId.value.trim(), digest: botDigest.value.trim() })) }
      const permissions = existing.get('permissions', true)
      if (permissions && !isMap(permissions)) throw new Error('Member permissions cannot be edited on the canvas.')
      const permissionMap = isMap(permissions) ? permissions : parsed.doc.createNode<unknown>({})
      if (!isMap(permissionMap)) throw new Error('Member permissions cannot be edited on the canvas.')
      permissionMap.set('read', parsed.doc.createNode(list(read.value))); permissionMap.set('write', parsed.doc.createNode(list(write.value))); permissionMap.set('execute', parsed.doc.createNode(list(execute.value)))
      existing.set('permissions', permissionMap); members.set(key.value, existing)
    } else {
      const field = category === 'edge' ? 'edges' : 'communications'
      let sequence = parsed.doc.get(field, true)
      if (!sequence) { sequence = parsed.doc.createNode<unknown>([]); parsed.doc.set(field, sequence) }
      if (!isSeq(sequence)) throw new Error('Relations must be a list.')
      if (category === 'edge' && sequence.items.some((item, i) => i !== original.value && isMap(item) && item.get('id') === key.value)) throw new Error('This edge ID already exists.')
      const existing = original.value === null ? parsed.doc.createNode<unknown>({}) : sequence.get(Number(original.value), true)
      if (!isMap(existing)) throw new Error('This relation cannot be edited on the canvas.')
      existing.set('from', from.value); existing.set('to', to.value)
      if (category === 'edge') {
        existing.set('id', key.value)
        if (outcomes.value.trim()) existing.set('on', parsed.doc.createNode(list(outcomes.value))); else existing.delete('on')
      } else {
        existing.set('when', `#${heading.value}`)
        if (artifacts.value.trim()) existing.set('artifacts', parsed.doc.createNode(list(artifacts.value))); else existing.delete('artifacts')
        for (const [name, value] of [['max_rounds', rounds.value], ['timeout_ms', timeout.value]] as const) {
          if (!value) existing.delete(name)
          else { if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Rounds and timeout must be positive integers.'); existing.set(name, Number(value)) }
        }
      }
      if (original.value === null) sequence.add(existing); else sequence.set(Number(original.value), existing)
    }
    emit('update:content', parsed.opening + parsed.doc.toString().replace(/\n/g, newline) + parsed.closing + rest)
    mode.value = null
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Cannot update this definition.' }
}
function remove(category: Category, index: string | number) {
  if (props.disabled) return
  error.value = ''
  try {
    const parsed = parse(), field = category === 'member' ? 'members' : category === 'edge' ? 'edges' : 'communications'
    detachGraphAliases(parsed.doc)
    const container = parsed.doc.get(field, true)
    if (category === 'member') {
      if (!isMap(container)) throw new Error('This item cannot be removed on the canvas.')
      container.delete(String(index))
    } else {
      if (!isSeq(container)) throw new Error('This item cannot be removed on the canvas.')
      container.delete(Number(index))
    }
    const newline = parsed.opening.includes('\r\n') ? '\r\n' : '\n'
    emit('update:content', parsed.opening + parsed.doc.toString().replace(/\n/g, newline) + parsed.closing + parsed.body)
    mode.value = null
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Cannot update this definition.' }
}
</script>

<template>
  <section v-if="definition" :aria-label="t('Members and relations')">
    <h3>{{ t('Members') }}</h3>
    <ul><li v-for="(_, id) in definition.members" :key="id">{{ id }} <button type="button" :disabled="disabled" @click="start('member', String(id))">{{ t('Edit member') }}</button> <button type="button" :disabled="disabled" @click="remove('member', String(id))">{{ t('Remove member') }}</button></li></ul>
    <p>{{ t('Removing referenced items does not remove their references; the authoring service validates the complete draft on save.') }}</p>
    <button type="button" :disabled="disabled" @click="start('member')">{{ t('Add member') }}</button>
    <h3>{{ t('Edit orchestration edges') }}</h3>
    <ul><li v-for="(edge, index) in definition.edges || []" :key="index">{{ edge.id }}: {{ edge.from }} → {{ edge.to }} <button type="button" :disabled="disabled" @click="start('edge', index)">{{ t('Edit edge') }}</button> <button type="button" :disabled="disabled" @click="remove('edge', index)">{{ t('Remove edge') }}</button></li></ul>
    <button type="button" :disabled="disabled" @click="start('edge')">{{ t('Add edge') }}</button>
    <h3>{{ t('Edit communication permissions') }}</h3>
    <ul><li v-for="(relation, index) in definition.communications || []" :key="index">{{ relation.from }} ⇢ {{ relation.to }} <button type="button" :disabled="disabled" @click="start('communication', index)">{{ t('Edit permission') }}</button> <button type="button" :disabled="disabled" @click="remove('communication', index)">{{ t('Remove permission') }}</button></li></ul>
    <button type="button" :disabled="disabled" @click="start('communication')">{{ t('Add permission') }}</button>
    <form v-if="mode" @submit.prevent="apply">
      <h3>{{ mode === 'member' ? t('Member') : mode === 'edge' ? t('Orchestration edge') : t('Communication permission') }}</h3>
      <label v-if="mode !== 'communication'">{{ mode === 'member' ? t('Member ID') : t('Edge ID') }} <input v-model.trim="key" :disabled="disabled || (mode === 'member' && original !== null)" required pattern="[a-z][a-z0-9-]*"></label>
      <template v-if="mode === 'member'">
        <label>{{ t('Identity') }} <select v-model="identity" :disabled="disabled"><option value="role">{{ t('Role heading') }}</option><option value="bot">{{ t('Bot reference') }}</option></select></label>
        <template v-if="identity === 'bot'"><label>{{ t('Bot reference ID') }} <input v-model.trim="botId" :disabled="disabled" required></label><label>{{ t('Bot reference digest') }} <input v-model.trim="botDigest" :disabled="disabled" required></label></template>
        <label>{{ t('Model binding') }} <input v-model.trim="model" :disabled="disabled" required></label>
        <label>{{ t('Base') }} <select v-model="base" :disabled="disabled"><option value="isolated">isolated</option><option value="omp-default">omp-default</option></select></label>
        <label>{{ t('Duty') }} <select v-model="duty" :disabled="disabled"><option v-for="value in ['research', 'guide', 'spec', 'review', 'code-only', 'test-only', 'general']" :key="value" :value="value">{{ value }}</option></select></label>
        <label>{{ t('Read permissions (one per line)') }} <textarea v-model="read" :disabled="disabled" /></label><label>{{ t('Write permissions (one per line)') }} <textarea v-model="write" :disabled="disabled" /></label><label>{{ t('Execute permissions (one per line)') }} <textarea v-model="execute" :disabled="disabled" /></label>
      </template>
      <template v-else>
        <label>{{ t('From') }} <select v-model="from" :disabled="disabled" required><option value="">{{ t('Choose an endpoint') }}</option><option v-for="id in Object.keys(mode === 'edge' ? definition.nodes : definition.members)" :key="id" :value="id">{{ id }}</option></select></label>
        <label>{{ t('To') }} <select v-model="to" :disabled="disabled" required><option value="">{{ t('Choose an endpoint') }}</option><option v-for="id in Object.keys(mode === 'edge' ? definition.nodes : definition.members)" :key="id" :value="id">{{ id }}</option></select></label>
        <label v-if="mode === 'edge'">{{ t('Source outcomes (one per line; empty defaults to done)') }} <textarea v-model="outcomes" :disabled="disabled" /></label>
        <template v-else><label>{{ t('Shareable artifact scopes (one per line)') }} <textarea v-model="artifacts" :disabled="disabled" /></label><label>{{ t('Maximum rounds (optional)') }} <input v-model.trim="rounds" :disabled="disabled" inputmode="numeric"></label><label>{{ t('Timeout in milliseconds (optional)') }} <input v-model.trim="timeout" :disabled="disabled" inputmode="numeric"></label></template>
      </template>
      <template v-if="mode === 'communication' || (mode === 'member' && identity === 'role')"><label>{{ mode === 'member' ? t('Role heading') : t('When heading') }} <input v-model.trim="heading" :disabled="disabled" required pattern="[a-z][a-z0-9-]*"></label><label>{{ t('New heading text (leave empty to reuse an existing heading)') }} <textarea v-model="body" :disabled="disabled" rows="4" /></label></template>
      <button type="submit" :disabled="disabled">{{ t('Apply relation to draft') }}</button> <button type="button" @click="mode = null">{{ t('Cancel') }}</button>
    </form>
    <p v-if="error" role="alert">{{ t(error) }}</p>
  </section>
  <p v-else role="alert">{{ t('Members or relations cannot be edited on the canvas. Correct the Markdown first.') }}</p>
</template>

<style scoped>
h3 { font: 12px var(--mono); } p, li { color: var(--text-2); font-size: 12px; } label { display: grid; gap: 6px; margin: 12px 0; font: 11px var(--mono); } input, select, textarea, button { min-height: 44px; padding: 8px 12px; border: 1px solid var(--line); border-radius: 0; color: var(--text); background: var(--surface); } button { cursor: pointer; } button:disabled { opacity: .5; cursor: not-allowed; } button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
