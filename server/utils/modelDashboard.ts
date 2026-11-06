import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { dashboardFamily, type DashboardModel, type ModelDashboardSnapshot, type ModelSelection } from '../../shared/modelDashboard'
import type { OmpLimit, OmpQuota } from '../../shared/types'
import { DATA_DIR, HOME } from './env'
import { HerdrError } from './herdr'
import { readOmp } from './quotas'
import { localMachine } from './machines'

export type DashboardRunner = (argv: string[]) => Promise<string>
interface CatalogModel { model: DashboardModel, thinking: string[] }
interface GlobalConfig { roles: Record<string, string>, storage: string }
interface PendingSelection { selection: ModelSelection, before: string | null, target: string }
interface Ledger { selections: ModelSelection[], pending?: PendingSelection }
interface DashboardOptions {
  dataDir: string
  home: string
  run?: DashboardRunner
  readQuota?: () => Promise<OmpQuota | null>
  now?: () => number
  cacheMs?: number
}
const queues = new Map<string, Promise<unknown>>()
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const fail = (message: string): never => { throw new HerdrError('model_dashboard', message) }
const baseSelector = (value: string | null): string | null => value?.replace(/:(?:off|minimal|low|medium|high|xhigh|max|auto)$/, '') || null
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'

// One queue per data directory, including independently created service instances.
function serialized<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(work)
  queues.set(key, next)
  void next.finally(() => { if (queues.get(key) === next) queues.delete(key) }).catch(() => {})
  return next
}

function runner(home: string): DashboardRunner {
  return argv => {
    const { promise, resolve, reject } = Promise.withResolvers<string>()
    // Config set has no --scope flag. OMP writes its global agent config; home
    // context keeps project overlays out of both catalog and config operations.
    execFile('omp', argv, { cwd: home, timeout: 30000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }, (error, stdout) => {
      if (error) reject(new HerdrError('model_dashboard', 'OMP could not complete the model operation'))
      else resolve(stdout)
    })
    return promise
  }
}

function parseJson(text: string): Record<string, unknown> {
  let value: unknown
  try { value = JSON.parse(text) } catch { return fail('OMP returned invalid model configuration') }
  if (!object(value)) return fail('OMP returned invalid model configuration')
  return value
}
function configOf(text: string): GlobalConfig {
  const config = parseJson(text)
  const roles = object(config.modelRoles) ? config.modelRoles.value : undefined
  const storage = object(config.modelRoleStorage) ? config.modelRoleStorage.value : undefined
  if (roles !== undefined && (!object(roles) || Object.values(roles).some(role => typeof role !== 'string'))) return fail('OMP returned invalid model roles')
  if (storage !== undefined && typeof storage !== 'string') return fail('OMP returned invalid model role storage')
  return { roles: { ...(roles as Record<string, string> | undefined) }, storage: storage as string | undefined ?? 'global' }
}
function catalogOf(text: string): CatalogModel[] {
  const value = parseJson(text)
  if (!Array.isArray(value.models) || value.models.length > 20000) return fail('OMP returned an unsupported model catalog')
  const catalog = new Map<string, CatalogModel>()
  const price = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0
  for (const item of value.models) {
    if (!object(item) || typeof item.provider !== 'string' || typeof item.id !== 'string' || item.kind !== 'chat') continue
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(item.provider) || !/^[a-zA-Z0-9][a-zA-Z0-9_./-]*$/.test(item.id)) continue
    const family = dashboardFamily(item.provider, item.id)
    if (!family || item.selector !== `${item.provider}/${item.id}`) continue
    const cost = object(item.cost) && price(item.cost.input) && price(item.cost.output)
      ? { input: item.cost.input as number, output: item.cost.output as number, ...(price(item.cost.cacheRead) ? { cacheRead: item.cost.cacheRead as number } : {}) } : null
    const model: DashboardModel = {
      selector: item.selector, provider: item.provider, id: item.id,
      name: typeof item.name === 'string' ? item.name : item.id,
      family, tier: ['astra', 'argon', 'opus'].includes(family) ? 'expert' : 'regular', cost,
    }
    catalog.set(model.selector, { model, thinking: Array.isArray(item.thinking) ? item.thinking.filter((level): level is string => typeof level === 'string') : [] })
  }
  return [...catalog.values()]
}

async function durable(file: string, value: Ledger) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${randomUUID()}.tmp`
  try {
    const handle = await fs.open(temp, 'wx', 0o600)
    try { await handle.writeFile(JSON.stringify(value) + '\n'); await handle.sync() } finally { await handle.close() }
    await fs.rename(temp, file)
    const directory = await fs.open(path.dirname(file), 'r')
    try { await directory.sync() } finally { await directory.close() }
  } finally { await fs.unlink(temp).catch(error => { if (!missing(error)) throw error }) }
}
function isSelection(value: unknown): value is ModelSelection {
  return object(value) && typeof value.selector === 'string' && typeof value.provider === 'string' && typeof value.modelId === 'string'
    && value.selector === `${value.provider}/${value.modelId}` && dashboardFamily(value.provider, value.modelId) !== null
    && value.app === 'omp' && value.source === 'manual' && typeof value.at === 'number' && Number.isFinite(value.at)
    && (value.previous === null || typeof value.previous === 'string')
}
async function readLedger(file: string): Promise<Ledger> {
  try {
    const handle = await fs.open(file, 'r')
    let value: unknown
    try {
      if ((await handle.stat()).size > 8 * 1024 * 1024) return fail('Model selection history exceeds its storage limit')
      value = JSON.parse(await handle.readFile('utf8'))
    } finally { await handle.close() }
    if (!object(value) || !Array.isArray(value.selections) || !value.selections.every(isSelection)) return fail('Model selection history cannot be read')
    if (value.pending !== undefined && (!object(value.pending) || !isSelection(value.pending.selection)
      || typeof value.pending.target !== 'string' || (value.pending.before !== null && typeof value.pending.before !== 'string'))) return fail('Pending model selection cannot be read')
    return value as unknown as Ledger
  } catch (error) {
    if (missing(error)) return { selections: [] }
    if (error instanceof HerdrError) throw error
    return fail('Model selection history cannot be read')
  }
}

function privateScope(scope: OmpLimit['scope']): OmpLimit['scope'] {
  if (!scope) return undefined
  const safe: NonNullable<OmpLimit['scope']> = { provider: scope.provider, windowId: scope.windowId, shared: scope.shared, sharedGroup: scope.sharedGroup }
  for (const key of ['model', 'modelId', 'models', 'modelIds']) {
    const value = scope[key]
    if (typeof value === 'string') safe[key] = value
    else if (Array.isArray(value)) safe[key] = value.filter(item => typeof item === 'string')
  }
  if (typeof scope.projectId === 'string' || typeof scope.accountId === 'string') {
    safe.accountScope = createHash('sha256').update(JSON.stringify([scope.projectId, scope.accountId])).digest('hex').slice(0, 16)
  }
  return safe
}

// Whitelist quota fields: account emails, account ids and arbitrary provider
// metadata never leave this endpoint. Provider/model attribution stays intact.
function privateQuota(quota: OmpQuota | null): OmpQuota | null {
  if (!quota) return null
  return { at: quota.at, reports: quota.reports.map(report => ({
    provider: report.provider, fetchedAt: report.fetchedAt,
    limits: report.limits.map(limit => ({
      id: limit.id, label: limit.label, status: limit.status,
      amount: {
        used: limit.amount.used, limit: limit.amount.limit, remaining: limit.amount.remaining, unit: limit.amount.unit,
        usedFraction: limit.amount.usedFraction, remainingFraction: limit.amount.remainingFraction,
      },
      window: limit.window ? { id: limit.window.id, label: limit.window.label, durationMs: limit.window.durationMs, resetsAt: limit.window.resetsAt } : undefined,
      scope: privateScope(limit.scope),
    })),
    ...(typeof report.metadata?.planType === 'string' ? { metadata: { planType: report.metadata.planType } } : {}),
    ...(typeof report.resetCredits?.availableCount === 'number' ? { resetCredits: { availableCount: report.resetCredits.availableCount } } : {}),
  })) }
}

export function createModelDashboard(options: DashboardOptions) {
  const run = options.run ?? runner(options.home)
  const now = options.now ?? Date.now
  const cacheMs = Math.max(0, Math.min(options.cacheMs ?? 30000, 60000))
  const file = path.join(path.resolve(options.dataDir), 'model-selections.json')
  let catalog: { at: number, value: CatalogModel[] } | null = null
  let catalogFlight: Promise<CatalogModel[]> | null = null
  let quota: { at: number, value: OmpQuota | null } | null = null
  let quotaFlight: Promise<OmpQuota | null> | null = null
  const readConfig = async () => configOf(await run(['config', 'list', '--scope', 'global', '--json']))
  function readCatalog(): Promise<CatalogModel[]> {
    if (catalog && now() - catalog.at < cacheMs) return Promise.resolve(catalog.value)
    if (catalogFlight) return catalogFlight
    catalogFlight = run(['models', 'ls', '--json']).then(text => {
      const value = catalogOf(text)
      catalog = { at: now(), value }
      return value
    }).finally(() => { catalogFlight = null })
    return catalogFlight
  }
  function readQuota(): Promise<OmpQuota | null> {
    if (!options.readQuota) return Promise.resolve(null)
    if (quota && now() - quota.at < cacheMs) return Promise.resolve(quota.value)
    if (quotaFlight) return quotaFlight
    quotaFlight = options.readQuota().then(privateQuota).catch(() => null).then(value => {
      quota = { at: now(), value }
      return value
    }).finally(() => { quotaFlight = null })
    return quotaFlight
  }
  async function recover(config: GlobalConfig): Promise<Ledger> {
    const ledger = await readLedger(file)
    if (!ledger.pending) return ledger
    // A crash can leave a durable intent after OMP saved but before the receipt.
    // Readback, not the intent, decides whether it became a manual selection.
    const committed = config.roles.default === ledger.pending.target && config.storage === 'global'
    const recovered = { selections: committed ? [...ledger.selections, ledger.pending.selection] : ledger.selections }
    await durable(file, recovered)
    return recovered
  }
  function snapshot(config: GlobalConfig, ledger: Ledger, models: CatalogModel[], quota: OmpQuota | null): ModelDashboardSnapshot {
    const today = new Date(now())
    const days = [2, 1, 0].map(offset => {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset)
      return { date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`, amount: null }
    })
    return { models: models.map(item => item.model), defaultSelector: baseSelector(config.roles.default ?? null), selections: ledger.selections.slice(-100).reverse(), spending: { currency: 'USD', days }, quota }
  }
  return {
    get: () => serialized(file, async () => {
      const [config, models, quota] = await Promise.all([readConfig(), readCatalog(), readQuota()])
      return snapshot(config, await recover(config), models, quota)
    }),
    select: (selector: unknown) => serialized(file, async () => {
      if (typeof selector !== 'string' || selector.length > 300) return fail('Choose a supported dashboard model')
      const models = await readCatalog()
      const chosen = models.find(item => item.model.selector === selector)
      if (!chosen) return fail('Choose an available dashboard model')
      const config = await readConfig()
      if (config.storage !== 'global') return fail('OMP model role storage must be global to save a new-session default')
      const ledger = await recover(config)
      const before = config.roles.default ?? null
      const effort = before?.match(/:(off|minimal|low|medium|high|xhigh|max|auto)$/)?.[1]
      const target = selector + (effort && chosen.thinking.includes(effort) ? `:${effort}` : '')
      const selection: ModelSelection = { selector, provider: chosen.model.provider, modelId: chosen.model.id, app: 'omp', source: 'manual', at: now(), previous: baseSelector(before) }
      await durable(file, { ...ledger, pending: { selection, before, target } })
      let attempted = false
      try {
        // OMP accepts only the whole role record, not dotted role keys. Read
        // immediately before setting and never change any non-default role.
        const latest = await readConfig()
        if (latest.storage !== 'global' || (latest.roles.default ?? null) !== before) fail('OMP default changed while saving; refresh before choosing again')
        attempted = true
        await run(['config', 'set', 'modelRoles', JSON.stringify({ ...latest.roles, default: target })])
        const verified = await readConfig()
        if (verified.storage !== 'global' || verified.roles.default !== target) fail('OMP did not confirm the new-session default')
        const receipt = { selections: [...ledger.selections, selection] }
        await durable(file, receipt)
        return snapshot(verified, receipt, models, await readQuota())
      } catch (error) {
        // A command can fail after writing. Restore only our default, retaining
        // unrelated roles as they exist now; never overwrite an external choice.
        try {
          const current = await readConfig()
          if (attempted && current.roles.default === target) {
            const roles = { ...current.roles }
            if (before === null) delete roles.default
            else roles.default = before
            await run(['config', 'set', 'modelRoles', JSON.stringify(roles)])
            if ((await readConfig()).roles.default !== (before ?? undefined)) fail('Previous OMP default could not be restored')
          }
          await durable(file, ledger)
        } catch { return fail('Model save failed and could not be reconciled; refresh the global OMP default before choosing again') }
        throw error
      }
    }),
  }
}

export const modelDashboard = createModelDashboard({
  dataDir: DATA_DIR, home: HOME,
  readQuota: () => readOmp(localMachine),
})
