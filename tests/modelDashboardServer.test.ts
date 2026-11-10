import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createModelDashboard, type DashboardRunner } from '../server/utils/modelDashboard'
import type { OmpQuota } from '../shared/types'
import type { Machine } from '../server/utils/machines'

const SOL = 'openai-codex/gpt-6.1-sol'
const TERRA = 'openai-codex/gpt-6.1-terra'
const FLASH = 'deepseek/deepseek-flash'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))) })

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wherdr-model-dashboard-'))
  roots.push(dir)
  const state = {
    roles: { default: `${SOL}:high`, plan: 'openai-codex/gpt-6-astra:max', smol: FLASH } as Record<string, string>,
    storage: 'global', calls: [] as string[][], refuse: false, failAfterWrite: false, ignoreWrite: false,
    catalog: [
      { provider: 'openai-codex', id: 'gpt-6.1-sol', selector: SOL, kind: 'chat', name: 'Sol', thinking: ['high', 'max'], cost: { input: 2, output: 10 } },
      { provider: 'openai-codex', id: 'gpt-6.1-terra', selector: TERRA, kind: 'chat', name: 'Terra', thinking: ['high'], cost: { input: 1, output: 5 } },
      { provider: 'deepseek', id: 'deepseek-flash', selector: FLASH, kind: 'chat', name: 'Flash', thinking: ['low'], cost: { input: 0.3, output: 1.2, timeBased: { offPeakMultiplier: 0.5, peakWindows: [{ weekdays: [1, 2, 3, 4, 5], startMinute: 60, endMinute: 240 }, { weekdays: [1, 2, 3, 4, 5], startMinute: 360, endMinute: 600 }] } } },
      { provider: 'openai-codex', id: 'unrelated', selector: 'openai-codex/unrelated', kind: 'chat', name: 'Unrelated', thinking: [] },
      { provider: 'unconfigured', id: 'gpt-6.1-sol', selector: 'unconfigured/gpt-6.1-sol', kind: 'chat' },
    ],
  }
  const run: DashboardRunner = async argv => {
    state.calls.push([...argv])
    if (argv[0] === 'models') return JSON.stringify({ models: state.catalog })
    if (argv[1] === 'list') return JSON.stringify({ modelRoles: { value: state.roles }, modelRoleStorage: { value: state.storage } })
    if (argv[1] === 'set' && argv[2] === 'modelRoles') {
      if (state.refuse) throw new Error('OMP refused the update')
      if (!state.ignoreWrite) state.roles = JSON.parse(argv[3]!)
      if (state.failAfterWrite) { state.failAfterWrite = false; throw new Error('OMP exited after writing') }
      return 'Saved'
    }
    throw new Error(`Unexpected invocation: ${argv.join(' ')}`)
  }
  const options = { dataDir: dir, home: dir, run, now: () => new Date(2026, 0, 1, 12).getTime() }
  return { dir, state, options, service: createModelDashboard(options) }
}

describe('global OMP dashboard defaults', () => {
  it('reads only usable shortlisted catalog models and never mutates config on GET', async () => {
    const { service, state, dir } = await fixture()
    const result = await service.get()
    expect(result.models.map(model => model.selector)).toEqual([SOL, TERRA, FLASH])
    expect(result.models.find(model => model.selector === FLASH)?.cost?.timeBased).toEqual({
      offPeakMultiplier: 0.5,
      peakWindows: [
        { weekdays: [1, 2, 3, 4, 5], startMinute: 60, endMinute: 240 },
        { weekdays: [1, 2, 3, 4, 5], startMinute: 360, endMinute: 600 },
      ],
    })
    expect(result.models.map(model => [model.selector, model.thinking])).toEqual([
      [SOL, ['high', 'max']], [TERRA, ['high']], [FLASH, ['low']],
    ])
    expect('thinking' in result.additionalModels![0]!).toBe(false)
    expect(result.additionalModels?.map(model => model.selector)).toEqual(['openai-codex/unrelated', 'unconfigured/gpt-6.1-sol'])
    expect(result.defaultSelector).toBe(SOL)
    expect(result.selections).toEqual([])
    expect(result.spending).toEqual({ currency: 'CNY', days: [
      { date: '2025-12-30', amount: null }, { date: '2025-12-31', amount: null }, { date: '2026-01-01', amount: null },
    ] })
    expect(state.calls).toEqual([['config', 'list', '--scope', 'global', '--json'], ['models', 'ls', '--json']])
    await expect(fs.stat(path.join(dir, 'model-selections.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reports observed DeepSeek spend for today and the two previous local days', async () => {
    const { options } = await fixture()
    const dates: string[] = []
    const service = createModelDashboard({ ...options, readSpending: async days => {
      dates.push(...days.map(day => day.date))
      return [0.12, null, 0.34]
    } })
    const result = await service.get()
    expect(dates).toEqual(['2025-12-30', '2025-12-31', '2026-01-01'])
    expect(result.spending.currency).toBe('CNY')
    expect(result.spending.days[0]!.amount).toBeCloseTo(0.12 * 20 / 3)
    expect(result.spending.days[1]!.amount).toBeNull()
    expect(result.spending.days[2]!.amount).toBeCloseTo(0.34 * 20 / 3)
  })

  it('persists only the new-session default, preserves other roles and supported effort, then records a durable receipt', async () => {
    const { service, state, dir } = await fixture()
    const result = await service.select(TERRA)
    expect(state.roles).toEqual({ default: `${TERRA}:high`, plan: 'openai-codex/gpt-6-astra:max', smol: FLASH })
    expect(state.calls.filter(argv => argv[1] === 'set')).toEqual([
      ['config', 'set', 'modelRoles', JSON.stringify(state.roles)],
    ])
    expect(result.defaultSelector).toBe(TERRA)
    expect(result.selections).toEqual([{
      selector: TERRA, provider: 'openai-codex', modelId: 'gpt-6.1-terra', app: 'omp', source: 'manual', previous: SOL, at: new Date(2026, 0, 1, 12).getTime(),
    }])
    const saved = JSON.parse(await fs.readFile(path.join(dir, 'model-selections.json'), 'utf8'))
    expect(saved).toEqual({ selections: [...result.selections] })
    expect((await fs.stat(path.join(dir, 'model-selections.json'))).mode & 0o777).toBe(0o600)
  })

  it('retains unrelated roles changed while its durable intent is being prepared', async () => {
    const { options, state } = await fixture()
    let reads = 0
    const service = createModelDashboard({ ...options, run: async argv => {
      if (argv[1] === 'list' && ++reads === 2) state.roles.review = 'openai-codex/gpt-6-astra:high'
      return options.run(argv)
    } })
    await service.select(TERRA)
    expect(state.roles.review).toBe('openai-codex/gpt-6-astra:high')
    expect(state.roles.default).toBe(`${TERRA}:high`)
  })

  it('does not overwrite an external default changed before its OMP write', async () => {
    const { options, state } = await fixture()
    let reads = 0
    const service = createModelDashboard({ ...options, run: async argv => {
      if (argv[1] === 'list' && ++reads === 2) state.roles.default = FLASH
      return options.run(argv)
    } })
    await expect(service.select(TERRA)).rejects.toThrow('default changed while saving')
    expect(state.roles.default).toBe(FLASH)
    expect(state.calls.some(argv => argv[1] === 'set')).toBe(false)
    expect((await service.get()).selections).toEqual([])
  })

  it('does not force an unsupported effort onto a different model', async () => {
    const { service, state } = await fixture()
    await service.select(FLASH)
    expect(state.roles.default).toBe(FLASH)
  })

  it.each(['openai-codex/unrelated', 'unconfigured/gpt-6.1-sol', `${SOL}:max`, `${SOL}; touch /tmp/unwanted`, '--help', null])('rejects an unsupported selector %s without a write', async selector => {
    const { service, state } = await fixture()
    await expect(service.select(selector)).rejects.toThrow()
    expect(state.calls.some(argv => argv[1] === 'set')).toBe(false)
    expect(state.roles.default).toBe(`${SOL}:high`)
  })

  it('keeps the previous default and no successful history when the CLI refuses', async () => {
    const { service, state, options } = await fixture()
    state.refuse = true
    await expect(service.select(TERRA)).rejects.toThrow('OMP refused')
    state.refuse = false
    const restored = await createModelDashboard(options).get()
    expect(restored.defaultSelector).toBe(SOL)
    expect(restored.selections).toEqual([])
  })

  it('restores the previous default if the CLI writes but loses its receipt', async () => {
    const { service, state } = await fixture()
    state.failAfterWrite = true
    await expect(service.select(TERRA)).rejects.toThrow('OMP exited after writing')
    expect(state.roles.default).toBe(`${SOL}:high`)
    expect((await service.get()).selections).toEqual([])
  })

  it('does not claim success when global readback differs from the requested model', async () => {
    const { service, state } = await fixture()
    state.ignoreWrite = true
    await expect(service.select(TERRA)).rejects.toThrow('OMP did not confirm')
    expect((await service.get()).selections).toEqual([])
    expect(state.roles.default).toBe(`${SOL}:high`)
  })

  it('does not touch OMP if a durable intent cannot be stored', async () => {
    const { state, options, dir } = await fixture()
    await fs.writeFile(path.join(dir, 'not-a-directory'), 'blocked')
    const service = createModelDashboard({ ...options, dataDir: path.join(dir, 'not-a-directory') })
    await expect(service.select(TERRA)).rejects.toThrow()
    expect(state.calls.some(argv => argv[1] === 'set')).toBe(false)
    expect(state.roles.default).toBe(`${SOL}:high`)
  })

  it('rejects non-global role storage without changing that policy or the default', async () => {
    const { service, state } = await fixture()
    state.storage = 'project'
    await expect(service.select(TERRA)).rejects.toThrow('role storage must be global')
    expect(state.calls.some(argv => argv[1] === 'set')).toBe(false)
    expect(state.roles.default).toBe(`${SOL}:high`)
    expect(state.storage).toBe('project')
  })

  it('does not poison the serialized write queue after a failed selection', async () => {
    const { service, state } = await fixture()
    state.refuse = true
    await expect(service.select(TERRA)).rejects.toThrow('OMP refused')
    state.refuse = false
    const result = await service.select(FLASH)
    expect(result.defaultSelector).toBe(FLASH)
    expect(result.selections.map(selection => selection.selector)).toEqual([FLASH])
  })

  it('serializes concurrent choices across service instances and retains their order after restart', async () => {
    const { service, state, options } = await fixture()
    const second = createModelDashboard(options)
    const results = await Promise.all([service.select(TERRA), second.select(FLASH)])
    expect(results[0]!.defaultSelector).toBe(TERRA)
    expect(results[1]!.defaultSelector).toBe(FLASH)
    expect(state.roles).toEqual({ default: FLASH, plan: 'openai-codex/gpt-6-astra:max', smol: FLASH })
    const restarted = await createModelDashboard(options).get()
    expect(restarted.defaultSelector).toBe(FLASH)
    expect(restarted.selections.map(selection => [selection.selector, selection.previous])).toEqual([[FLASH, TERRA], [TERRA, SOL]])
  })

  it('reconciles a crash after verified OMP persistence from its durable intent without changing config on GET', async () => {
    const { state, options, dir } = await fixture()
    const selection = { selector: TERRA, provider: 'openai-codex', modelId: 'gpt-6.1-terra', app: 'omp', source: 'manual', at: 123, previous: SOL }
    await fs.writeFile(path.join(dir, 'model-selections.json'), JSON.stringify({ selections: [], pending: { selection, before: `${SOL}:high`, target: `${TERRA}:high` } }))
    state.roles.default = `${TERRA}:high`
    expect((await createModelDashboard(options).get()).selections).toEqual([selection])
    expect(state.calls.some(argv => argv[1] === 'set')).toBe(false)
    expect((await createModelDashboard(options).get()).selections).toEqual([selection])
  })

  it('discards a crash intent that never reached the global config', async () => {
    const { options, dir } = await fixture()
    const selection = { selector: TERRA, provider: 'openai-codex', modelId: 'gpt-6.1-terra', app: 'omp', source: 'manual', at: 123, previous: SOL }
    await fs.writeFile(path.join(dir, 'model-selections.json'), JSON.stringify({ selections: [], pending: { selection, before: `${SOL}:high`, target: `${TERRA}:high` } }))
    expect((await createModelDashboard(options).get()).selections).toEqual([])
  })

  it('fails closed on corrupt history rather than dropping prior preferences', async () => {
    const { service, state, dir } = await fixture()
    await fs.writeFile(path.join(dir, 'model-selections.json'), '{broken')
    await expect(service.select(TERRA)).rejects.toThrow('history cannot be read')
    expect(state.calls.some(argv => argv[1] === 'set')).toBe(false)
  })

  it('uses a bounded single-flight catalog cache and expires it without changing config', async () => {
    const { options, state } = await fixture()
    let clock = 0
    const service = createModelDashboard({ ...options, now: () => clock, cacheMs: 20 })
    await Promise.all([service.get(), service.get(), service.get()])
    expect(state.calls.filter(argv => argv[0] === 'models')).toHaveLength(1)
    clock = 21
    await service.get()
    expect(state.calls.filter(argv => argv[0] === 'models')).toHaveLength(2)
  })

  it('returns only local quota data and removes account identifiers and opaque metadata', async () => {
    const { options } = await fixture()
    let reads = 0
    const raw: OmpQuota = { at: 123, reports: [{ provider: 'openai-codex', fetchedAt: 123, metadata: { email: 'private@example.test', accountId: 'secret', planType: 'pro', arbitrary: 'secret' }, limits: [{ id: 'weekly', label: 'Weekly', amount: { remainingFraction: 0.6 }, scope: { provider: 'openai-codex', shared: true, accountId: 'secret' } }] }] }
    raw.reports[0]!.resetCredits = { availableCount: 2, private: 'secret', credits: [
      { grantedAt: '2026-10-31T20:33:18.064683Z', expiresAt: '2026-11-30T20:33:18.064683Z', status: 'available', private: 'secret' },
      { status: 'used' },
    ] }
    raw.reports[0]!.limits[0]!.scope!.modelIds = ['gpt-6.1-terra']
    raw.reports[0]!.limits.push({ ...raw.reports[0]!.limits[0]!, scope: { provider: 'openai-codex', shared: true, accountId: 'another-account', modelIds: ['gpt-6.1-sol'] } })
    const service = createModelDashboard({ ...options, readQuota: async () => { reads++; return raw } })
    const snapshot = await service.get()
    expect(snapshot.quota?.reports[0]?.metadata).toEqual({ planType: 'pro' })
    expect(snapshot.quota?.reports[0]?.resetCredits).toEqual({ availableCount: 2, credits: [
      { grantedAt: '2026-10-31T20:33:18.064683Z', expiresAt: '2026-11-30T20:33:18.064683Z', status: 'available' },
      { status: 'used' },
    ] })
    expect(snapshot.quota?.reports[0]?.limits[0]?.scope).not.toHaveProperty('accountId')
    expect(JSON.stringify(snapshot.quota)).not.toContain('secret')
    expect(JSON.stringify(snapshot.quota)).not.toContain('private@example.test')
    const limits = snapshot.quota!.reports[0]!.limits
    expect(limits[0]!.scope?.modelIds).toEqual(['gpt-6.1-terra'])
    expect(limits[1]!.scope?.modelIds).toEqual(['gpt-6.1-sol'])
    expect(limits[0]!.scope?.accountScope).not.toBe(limits[1]!.scope?.accountScope)
    await service.get()
    expect(reads).toBe(1)
  })
  it('isolates remote catalogs, defaults, quotas and selection history from local and other machines', async () => {
    const { service, dir, state } = await fixture()
    await service.select(TERRA)
    const ledgerFile = path.join(dir, 'model-selections.json')
    const ledger = await fs.readFile(ledgerFile, 'utf8')
    const remote = (selector: string, provider: string): Machine => ({
      local: false, status: 'online', home: '/remote', exec: async (script, args = [], options) => {
        if (script.includes('stats.db')) {
          expect(options?.maxBytes).toBe(1024 * 1024)
          return { code: 0, stdout: Buffer.from('0.1|0|0.2|0|0.3|0'), stderr: '' }
        }
        expect(options?.maxBytes).toBe(8 * 1024 * 1024)
        const text = script === 'sh -s'
          ? JSON.stringify({ reports: [{ provider, fetchedAt: 123, limits: [], metadata: { email: 'secret@example.test' } }] })
          : args[0] === 'models'
            ? JSON.stringify({ models: state.catalog.filter(item => item.selector === selector) })
            : JSON.stringify({ modelRoles: { value: { default: `${selector}:high` } } })
        return { code: 0, stdout: Buffer.from(text), stderr: '' }
      },
    }) as Machine
    const first = await service.getRemote(remote(SOL, 'remote-one'))
    const second = await service.getRemote(remote(FLASH, 'remote-two'))
    expect(first.models.map(model => model.selector)).toEqual([SOL])
    expect(first.defaultSelector).toBe(SOL)
    expect(first.quota?.reports.map(report => report.provider)).toEqual(['remote-one'])
    expect(JSON.stringify(first.quota)).not.toContain('secret@example.test')
    expect(second.models.map(model => model.selector)).toEqual([FLASH])
    expect(second.defaultSelector).toBe(FLASH)
    expect(second.quota?.reports.map(report => report.provider)).toEqual(['remote-two'])
    expect(first.selections).toEqual([])
    expect(first.spending.days.map(day => day.amount)).toEqual([0.1, 0.2, 0.3].map(amount => amount * (20 / 3)))
    expect(second.selections).toEqual([])
    expect(await fs.readFile(ledgerFile, 'utf8')).toBe(ledger)
    expect((await service.get()).selections).toHaveLength(1)
  })

  it('fails remote requests on offline machines and failed catalog or quota commands', async () => {
    const { service } = await fixture()
    await expect(service.getRemote({ local: false, status: 'offline' } as Machine)).rejects.toThrow('unreachable')
    for (const failed of ['models', 'sh -s']) {
      const machine = {
        local: false, status: 'online', home: '/remote',
        exec: async (script: string, args: string[] = []) => ({
          code: script === failed || args[0] === failed ? 1 : 0,
          stdout: Buffer.from(args[0] === 'models' ? '{"models":[]}' : args[0] === 'config' ? '{}' : ''),
          stderr: '',
        }),
      } as Machine
      await expect(service.getRemote(machine)).rejects.toThrow('OMP could not complete')
    }
  })
})
