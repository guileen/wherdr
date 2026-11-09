import { describe, expect, it } from 'vitest'
import { modelFamily, modelProvider, namedModel } from '../app/utils/modelProvider'
import { providerLabel, routeProviderName } from '../app/utils/modelDashboard'

describe('modelProvider', () => {
  it('reads the provider of an omp model id', () => {
    expect(modelProvider('omp', { id: 'openai-codex/gpt-6.1-sol', label: 'GPT 6.1 Sol' })).toBe('openai-codex')
    expect(modelProvider('omp', { id: 'deepseek/deepseek-flash', label: 'DeepSeek V4 Flash' })).toBe('deepseek')
    expect(modelProvider('omp', { id: 'demo/aurora', label: 'Aurora' })).toBe('demo')
  })

  it('reads the provider of another agent’s model id or label', () => {
    expect(modelProvider('claude', { id: 'claude-sonnet-4-5', label: 'Sonnet 4.5' })).toBe('anthropic')
    expect(modelProvider('claude', { id: null, label: 'Opus 5.5' })).toBe('anthropic')
    expect(modelProvider('codex', { id: 'gpt-5-codex', label: 'GPT-5 Codex' })).toBe('openai-codex')
    expect(modelProvider('gemini', { id: null, label: 'Gemini 3.8 Flash' })).toBe('google-antigravity')
    expect(modelProvider('omp', { id: null, label: 'Grok 5' })).toBe('xai-oauth')
  })

  it('falls back to the agent while its model is unknown, and says nothing for a terminal', () => {
    expect(modelProvider('claude', null)).toBe('anthropic')
    expect(modelProvider('codex', undefined)).toBe('openai-codex')
    expect(modelProvider('omp', null)).toBe('')
    expect(modelProvider(null, null)).toBe('')
  })
})

describe('namedModel', () => {
  it('names the experts and GPT 6.1 Sol', () => {
    expect(namedModel('omp', { id: 'openai-codex/gpt-6.1-sol', label: 'GPT 6.1 Sol' })).toBe(true)
    expect(namedModel('omp', { id: 'openai-codex/gpt-6-astra', label: 'GPT 6 Astra' })).toBe(true)
    expect(namedModel('omp', { id: 'google-antigravity/gemini-4-argon', label: 'Gemini 4 Argon' })).toBe(true)
    expect(namedModel('omp', { id: 'anthropic/claude-opus-5-5', label: 'Opus 5.5' })).toBe(true)
    expect(namedModel('claude', { id: 'claude-opus-5-5', label: 'Opus 5.5' })).toBe(true)
  })

  it('keeps the other models unnamed', () => {
    expect(namedModel('omp', { id: 'deepseek/deepseek-flash', label: 'DeepSeek V4 Flash' })).toBe(false)
    expect(namedModel('omp', { id: 'openai-codex/gpt-6.1-terra', label: 'GPT 6.1 Terra' })).toBe(false)
    expect(namedModel('claude', { id: 'claude-sonnet-4-5', label: 'Sonnet 4.5' })).toBe(false)
    expect(namedModel('codex', { id: 'gpt-5-codex', label: 'GPT-5 Codex' })).toBe(false)
    expect(namedModel('omp', null)).toBe(false)
  })

  it('falls back to the label when the id says nothing', () => {
    expect(modelFamily('omp', { id: null, label: 'Opus 5.5' })).toBe('opus')
    expect(modelFamily('claude', { id: null, label: 'Opus 5.5 (1M)' })).toBe('opus')
    expect(namedModel('omp', { id: null, label: 'GPT 6.1 Sol' })).toBe(true)
    expect(modelFamily('omp', { id: null, label: 'Grok 5' })).toBeNull()
  })
})

describe('providerLabel', () => {
  it('names the providers the dashboards show by brand', () => {
    expect(providerLabel('google-antigravity')).toBe('Google Antigravity')
    expect(providerLabel('xai-oauth')).toBe('xAI')
    expect(providerLabel('openai-codex')).toBe(routeProviderName('openai-codex'))
    expect(providerLabel('')).toBe('')
  })
})
