<script setup lang="ts">
import type { BotQuestionDetail, BotQuestionField } from '#shared/botWorkspace'
import { answersReady } from '~/utils/bots/workspace'
import type { BotAnswers } from '~/utils/bots/workspace'
import { t } from '~/utils/i18n'
const props = defineProps<{ question: BotQuestionDetail, answers: BotAnswers, disabled: boolean }>()
const emit = defineEmits<{ 'update:answers': [answers: BotAnswers], submit: [] }>()
function setAnswer(id: string, value: string) { emit('update:answers', { ...props.answers, [id]: value }) }
function toggle(id: string, value: string, checked: boolean) {
  const current = props.answers[id]
  const values = Array.isArray(current) ? current : []
  emit('update:answers', { ...props.answers, [id]: checked ? [...values, value] : values.filter(item => item !== value) })
}
function customValue(field: BotQuestionField): string {
  const answer = props.answers[field.id]
  if (Array.isArray(answer)) return answer.filter(value => !field.options.some(option => option.value === value)).join(', ')
  return typeof answer === 'string' && !field.options.some(option => option.value === answer) ? answer : ''
}
function setCustom(field: BotQuestionField, value: string) {
  if (field.mode !== 'multi') { setAnswer(field.id, value); return }
  const current = props.answers[field.id]
  const offered = Array.isArray(current) ? current.filter(item => field.options.some(option => option.value === item)) : []
  emit('update:answers', { ...props.answers, [field.id]: [...new Set([...offered, ...value.split(',').map(item => item.trim()).filter(Boolean)])] })
}
function submitQuestion() {
  if (!props.disabled && answersReady(props.question, props.answers)) emit('submit')
}
</script>

<template>
  <form class="bot-question" @submit.prevent="submitQuestion">
    <p class="question-kicker">{{ t('Needs your answer') }}</p>
    <h3>{{ question.title || t('Question') }}</h3>
    <p v-if="question.body" class="question-body">{{ question.body }}</p>
    <fieldset v-for="field in question.fields" :key="field.id" :disabled="disabled">
      <legend>{{ field.label }}<span v-if="field.required"> {{ t('(required)') }}</span></legend>
      <textarea v-if="field.mode === 'text'" :aria-label="field.label" :required="field.required" :value="answers[field.id] || ''" rows="3" @input="setAnswer(field.id, ($event.target as HTMLTextAreaElement).value)" />
      <template v-else>
        <label v-for="option in field.options" :key="option.value" class="question-option">
          <input v-if="field.mode === 'multi'" type="checkbox" :checked="Array.isArray(answers[field.id]) && answers[field.id]!.includes(option.value)" @change="toggle(field.id, option.value, ($event.target as HTMLInputElement).checked)">
          <input v-else type="radio" :name="`${question.input_request_id}-${field.id}`" :value="option.value" :checked="answers[field.id] === option.value" @change="setAnswer(field.id, option.value)">
          <span>{{ option.label }}<small v-if="option.description">{{ option.description }}</small></span>
        </label>
        <button v-if="field.mode === 'multi'" type="button" class="mono-btn select-none" :aria-pressed="Array.isArray(answers[field.id]) && answers[field.id]!.length === 0" @click="emit('update:answers', { ...answers, [field.id]: [] })">{{ t('Select none') }}</button>
        <label v-if="field.allow_custom" class="custom-answer">
          <span>{{ t('Custom answer') }}</span>
          <input type="text" :value="customValue(field)" @input="setCustom(field, ($event.target as HTMLInputElement).value)">
          <small v-if="field.mode === 'multi'">{{ t('Separate custom choices with commas.') }}</small>
        </label>
      </template>
    </fieldset>
    <button type="submit" class="mono-btn question-submit" :disabled="disabled || !answersReady(question, answers)">{{ t('Submit answer') }}</button>
    <p class="question-note">{{ t('Answers this question only. A receipt means admitted, not completed.') }}</p>
  </form>
</template>

<style scoped>
.bot-question { border: 1px solid var(--blocked); padding: 16px; }
.question-kicker { color: var(--blocked); font: 11px var(--mono); text-transform: uppercase; letter-spacing: .08em; margin: 0 0 12px; }
h3 { font: 20px var(--display); margin: 0 0 10px; }
.question-body { font-size: 13px; line-height: 1.6; white-space: pre-wrap; }
fieldset { border: 0; padding: 0; margin: 20px 0; min-width: 0; }
legend { font-size: 13px; font-weight: 600; margin-bottom: 8px; }
legend span, small, .question-note { color: var(--muted); font-size: 11px; font-weight: 400; }
textarea, input[type=text] { width: 100%; border: 1px solid var(--line); background: var(--bg); color: var(--text); padding: 10px; font: 14px var(--sans); border-radius: 0; min-height: 44px; }
textarea { resize: vertical; }
.question-option { display: flex; align-items: center; gap: 10px; min-height: 44px; cursor: pointer; font-size: 13px; }
.question-option input { accent-color: var(--accent); width: 18px; height: 18px; flex-shrink: 0; }
.question-option small { display: block; margin-top: 3px; }
.custom-answer { display: grid; gap: 8px; margin-top: 8px; font-size: 12px; }
.question-submit { width: 100%; min-height: 44px; justify-content: center; }
.select-none { min-height: 44px; margin-top: 8px; }
.question-note { line-height: 1.6; margin-bottom: 0; }
:disabled { opacity: .5; cursor: not-allowed; }
</style>
