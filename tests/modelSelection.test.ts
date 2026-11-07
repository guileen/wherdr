import { describe, expect, it } from 'vitest'
import { currentModelOption, modelOptionCurrent, usageModelRoutes, usageOrderedModelOptions } from '../app/utils/modelSelection'
import type { ModelDashboardSnapshot } from '../shared/modelDashboard'

describe('current model option', () => {
  it('recognizes Opus 5.5 (1M) from the Claude description and prefers the explicit row', () => {
    const options = [
      { label: 'Default (recommended)', hint: 'Opus 5.5 with 1M context · Best for everyday tasks' },
      { label: 'Opus (1M)', hint: 'Opus 5.5 with 1M context · Best for everyday tasks' },
      { label: 'Opus 5.5', hint: 'Most capable' },
    ]
    const model = { id: 'claude-opus-5-5[1m]', label: 'Opus 5.5 (1M)', effort: 'medium' }
    expect(modelOptionCurrent(options[1]!, model)).toBe(true)
    expect(currentModelOption(options, model)).toBe(1)
    expect(modelOptionCurrent(options[2]!, model)).toBe(false)
  })

  it('recognizes a Codex model without a useful description', () => {
    const options = [{ label: 'GPT-6-Sol', hint: 'Workhorse model' }, { label: 'GPT-6-Luna', hint: null }]
    expect(currentModelOption(options, { id: 'gpt-6-sol', label: 'GPT-6-Sol', effort: 'high' })).toBe(0)
  })
})

describe('omp session option usage ordering', () => {
  const now = Date.UTC(2026, 10, 6)
  const snapshot: ModelDashboardSnapshot = {
    models: [
      { selector: 'google-antigravity/gemini-3.8-flash', provider: 'google-antigravity', id: 'gemini-3.8-flash', name: 'Flash', family: 'gemini-flash', tier: 'regular', cost: null },
      { selector: 'openai-codex/gpt-6.1-terra', provider: 'openai-codex', id: 'gpt-6.1-terra', name: 'Terra', family: 'terra', tier: 'regular', cost: null },
      { selector: 'openrouter/anthropic/claude-opus-5.5', provider: 'openrouter', id: 'anthropic/claude-opus-5.5', name: 'Opus', family: 'opus', tier: 'expert', cost: null },
    ],
    defaultSelector: null, selections: [], spending: { currency: 'USD', days: [] },
    quota: { at: now, reports: [
      { provider: 'google-antigravity', fetchedAt: now, limits: [{ id: 'gemini', label: 'Gemini', window: { id: '5h', resetsAt: now + 60000 }, amount: { unit: 'percent', used: 100 } }] },
      { provider: 'openai-codex', fetchedAt: now, limits: [{ id: 'all', label: 'All', window: { id: '5h', resetsAt: now + 60000 }, amount: { unit: 'percent', used: 10 } }] },
    ] },
  }
  const options = [
    { label: 'unlisted/one', hint: null },
    { label: 'google-antigravity/gemini-3.8-flash', hint: 'original hint' },
    { label: 'openai-codex/gpt-6.1-terra', hint: null },
    { label: 'other/anthropic/claude-opus-5.5', hint: null },
    { label: 'openrouter/anthropic/claude-opus-5.5', hint: null },
  ]

  it('orders matched choices by Usage without replacing options or matching another provider', () => {
    const ordered = usageOrderedModelOptions(options, snapshot, now)
    expect(ordered.map(o => o.label)).toEqual([
      options[2]!.label, options[0]!.label, options[3]!.label, options[4]!.label, options[1]!.label,
    ])
    expect(ordered[4]).toBe(options[1])
  })

  it('leaves the session list unchanged when quota is missing and never treats stale readings as fresh', () => {
    expect(usageOrderedModelOptions(options, null, now)).toBe(options)
    expect(usageOrderedModelOptions(options, { ...snapshot, quota: null }, now)).toBe(options)
    const stale = usageOrderedModelOptions(options, snapshot, now + 3600001)
    expect(stale).toEqual(options)
    expect(usageModelRoutes(snapshot, now + 3600001).get(options[2]!.label)?.state).toBe('stale')
  })

  it('ranks available routes by the dashboard recommendation before the Flash fallback', () => {
    const flash = { selector: 'deepseek/deepseek-v4-flash', provider: 'deepseek', id: 'deepseek-v4-flash', name: 'V4 Flash', family: 'deepseek-flash' as const, tier: 'regular' as const, cost: null }
    const reports = snapshot.quota!.reports.map((report, index) => ({
      ...report, limits: report.limits.map(limit => ({
        ...limit, amount: { unit: 'percent' as const, used: index === 0 ? 10 : 50 },
      })),
    }))
    const available = { ...snapshot, models: [...snapshot.models, flash], quota: { at: now, reports } }
    const flashOption = { label: flash.selector, hint: null }
    expect(usageOrderedModelOptions([flashOption, options[2]!, options[1]!], available, now))
      .toEqual([options[1], options[2], flashOption])
  })

  it('prefers offered V4 Flash to exhausted routes without creating a choice or quota', () => {
    const flash = { selector: 'deepseek/deepseek-v4-flash', provider: 'deepseek', id: 'deepseek-v4-flash', name: 'V4 Flash', family: 'deepseek-flash' as const, tier: 'regular' as const, cost: null }
    const withFlash = { ...snapshot, models: [...snapshot.models, flash], quota: {
      ...snapshot.quota!,
      reports: snapshot.quota!.reports.map(report => ({
        ...report, limits: report.limits.map(limit => ({ ...limit, amount: { unit: 'percent' as const, used: 100 } })),
      })),
    } }
    const flashOption = { label: flash.selector, hint: null }
    const ordered = usageOrderedModelOptions([options[1]!, options[2]!, flashOption], withFlash, now)
    expect(ordered).toEqual([flashOption, options[1], options[2]])
    const route = usageModelRoutes(withFlash, now).get(flash.selector)
    expect(route?.state).toBe('unknown')
    expect(route?.windows).toEqual([])
    expect(usageOrderedModelOptions([options[1]!, options[2]!], withFlash, now)).toEqual([options[1], options[2]])
  })

  it('does not promote exhausted V4 Flash and keeps unknown selectors stable', () => {
    const flash = { selector: 'openai-codex/deepseek-v4-flash', provider: 'openai-codex', id: 'deepseek-v4-flash', name: 'V4 Flash', family: 'deepseek-flash' as const, tier: 'regular' as const, cost: null }
    const exhausted = { ...snapshot, models: [...snapshot.models, flash], quota: {
      ...snapshot.quota!,
      reports: snapshot.quota!.reports.map(report => ({
        ...report, limits: report.limits.map(limit => ({ ...limit, amount: { unit: 'percent' as const, used: 100 } })),
      })),
    } }
    const flashOption = { label: flash.selector, hint: null }
    expect(usageModelRoutes(exhausted, now).get(flash.selector)?.state).toBe('exhausted')
    expect(usageOrderedModelOptions([options[0]!, flashOption, options[1]!, options[3]!], exhausted, now))
      .toEqual([options[0], options[3], flashOption, options[1]])
  })

  it('chooses an available account for the exact provider and preserves the underlying windows', () => {
    const reports = snapshot.quota!.reports
    const extra = { ...reports[1]!, limits: reports[1]!.limits.map(limit => ({
      ...limit, amount: { unit: 'percent' as const, used: 100 },
    })) }
    const routes = usageModelRoutes({ ...snapshot, quota: { at: now, reports: [extra, ...reports] } }, now)
    const route = routes.get(options[2]!.label)
    expect(route?.state).toBe('available')
    expect(route?.row?.provider).toBe('openai-codex')
    expect(route?.windows[0]?.used).toBe(10)
    expect(routes.has(options[3]!.label)).toBe(false)
    expect(usageModelRoutes(null, now).size).toBe(0)
  })

  it('treats an elapsed reset as unknown rather than available or exhausted', () => {
    const later = now + 60001
    const routes = usageModelRoutes(snapshot, later)
    expect(routes.get(options[1]!.label)?.state).toBe('unknown')
    expect(routes.get(options[2]!.label)?.state).toBe('unknown')
    expect(usageOrderedModelOptions(options, snapshot, later)).toEqual(options)
  })
})
