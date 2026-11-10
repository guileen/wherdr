import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { DEEPSEEK_CNY_PER_USD, dashboardFamily, type DashboardModel, type DashboardPeakWindow, type DashboardTimeBasedPricing, type ModelDashboardSnapshot, type ModelSelection } from '../../shared/modelDashboard'
import type { OmpLimit, OmpQuota } from '../../shared/types'
import { DATA_DIR, HOME, log } from './env'
import { HerdrError } from './herdr'
import { readOmp } from './quotas'
import { type ShellExec } from './fsx'
import { localMachine, type Machine } from './machines'

export type DashboardRunner = (argv: string[]) => Promise<string>
interface CatalogModel { model: DashboardModel, thinking: string[] }
interface GlobalConfig { roles: Record<string, string>, storage: string }
interface PendingSelection { selection: ModelSelection, before: string | null, target: string }
interface Ledger { selections: ModelSelection[], pending?: PendingSelection }
interface SpendingDay { date: string, start: number, end: number }
interface DashboardOptions {
  dataDir: string
  home: string
  run?: DashboardRunner
  readQuota?: () => Promise<OmpQuota | null>
  readSpending?: (days: SpendingDay[]) => Promise<(number | null)[]>
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
    execFile('omp', argv, { cwd: home, timeout: 30000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        // The interface gets one stable sentence; the log keeps what omp said.
        log('model dashboard: omp failed', argv.slice(0, 3).join(' '), (error as NodeJS.ErrnoException).code || 'error', String(stderr || error.message).trim().slice(0, 400))
        reject(new HerdrError('model_dashboard', 'OMP could not complete the model operation'))
      } else resolve(stdout)
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
  const timeBased = (value: unknown): DashboardTimeBasedPricing | undefined => {
    if (!object(value)) return undefined
    const multiplier = value.offPeakMultiplier
    if (typeof multiplier !== 'number' || !Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 1) return undefined
    if (!Array.isArray(value.peakWindows) || value.peakWindows.length === 0 || value.peakWindows.length > 16) return undefined
    const windows: DashboardPeakWindow[] = []
    for (const window of value.peakWindows) {
      if (!object(window) || !Array.isArray(window.weekdays) || window.weekdays.length === 0 || window.weekdays.length > 7) return undefined
      if (!window.weekdays.every(day => typeof day === 'number' && Number.isInteger(day) && day >= 0 && day <= 6)) return undefined
      if (typeof window.startMinute !== 'number' || typeof window.endMinute !== 'number' || !Number.isInteger(window.startMinute) || !Number.isInteger(window.endMinute)
        || window.startMinute < 0 || window.endMinute > 1440 || window.startMinute >= window.endMinute) return undefined
      windows.push({ weekdays: [...new Set(window.weekdays)], startMinute: window.startMinute, endMinute: window.endMinute })
    }
    return { offPeakMultiplier: multiplier, peakWindows: windows }
  }
  for (const item of value.models) {
    if (!object(item) || typeof item.provider !== 'string' || typeof item.id !== 'string' || item.kind !== 'chat') continue
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(item.provider) || !/^[a-zA-Z0-9][a-zA-Z0-9_./-]*$/.test(item.id)) continue
    const family = dashboardFamily(item.provider, item.id) || 'other'
    if (item.selector !== `${item.provider}/${item.id}` || item.selector.length > 300) continue
    const timing = object(item.cost) ? timeBased(item.cost.timeBased) : undefined
    const cost = object(item.cost) && price(item.cost.input) && price(item.cost.output)
      ? { input: item.cost.input as number, output: item.cost.output as number, ...(price(item.cost.cacheRead) ? { cacheRead: item.cost.cacheRead as number } : {}), ...(timing ? { timeBased: timing } : {}) } : null
    const thinking = Array.isArray(item.thinking) ? item.thinking.filter((level): level is string => typeof level === 'string') : []
    const model: DashboardModel = {
      selector: item.selector, provider: item.provider, id: item.id,
      name: typeof item.name === 'string' ? item.name : item.id,
      family, tier: ['astra', 'argon', 'opus'].includes(family) ? 'expert' : 'regular', cost,
      ...(thinking.length ? { thinking } : {}),
    }
    catalog.set(model.selector, { model, thinking })
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
    ...(object(report.resetCredits) ? { resetCredits: {
      ...(typeof report.resetCredits.availableCount === 'number' ? { availableCount: report.resetCredits.availableCount } : {}),
      ...(Array.isArray(report.resetCredits.credits) ? { credits: report.resetCredits.credits.filter(object).map(credit => ({
        ...(typeof credit.grantedAt === 'string' ? { grantedAt: credit.grantedAt } : {}),
        ...(typeof credit.expiresAt === 'string' ? { expiresAt: credit.expiresAt } : {}),
        ...(typeof credit.status === 'string' ? { status: credit.status } : {}),
      })) } : {}),
    } } : {}),
  })) }
}

// Calendar days in this machine's time zone; each range is half-open so DST
// changes cannot double-count or skip an hour.
function spendingDays(at: number): SpendingDay[] {
  const today = new Date(at)
  return [2, 1, 0].map(offset => {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset)
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1)
    const date = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`
    return { date, start: start.getTime(), end: end.getTime() }
  })
}

const noSpending = (days: SpendingDay[]) => days.map(() => null)

// OMP's stats database records the price it charged each message, including
// DeepSeek's peak/off-peak multiplier. Aggregate only; no prompt or message
// text leaves this process.
function spendingSql(days: SpendingDay[]): string {
  const sums = days.map(day => [
    `SUM(CASE WHEN timestamp >= ${day.start} AND timestamp < ${day.end} THEN cost_total ELSE 0 END)`,
    `SUM(CASE WHEN timestamp >= ${day.start} AND timestamp < ${day.end} THEN cost_unpriced ELSE 0 END)`,
  ].join(', ')).join(', ')
  return `SELECT ${sums} FROM messages WHERE provider = 'deepseek' AND timestamp >= ${days[0]!.start} AND timestamp < ${days[days.length - 1]!.end};`
}

function parseSpending(text: string, days: SpendingDay[]): (number | null)[] {
  const values = text.trim().split('|').map(Number)
  if (values.length !== days.length * 2 || values.some(value => !Number.isFinite(value))) return noSpending(days)
  return days.map((_, index) => values[index * 2 + 1]! > 0 ? null : values[index * 2]!)
}

async function localSpending(home: string, days: SpendingDay[]): Promise<(number | null)[]> {
  const db = path.join(home, '.omp', 'stats.db')
  try { await fs.stat(db) } catch { return noSpending(days) }
  const { promise, resolve } = Promise.withResolvers<(number | null)[]>()
  execFile('sqlite3', ['-readonly', '-separator', '|', db, spendingSql(days)], { timeout: 5000, maxBuffer: 1024 * 1024, encoding: 'utf8' }, (error, stdout) => {
    resolve(error ? noSpending(days) : parseSpending(stdout, days))
  })
  return promise
}

async function remoteSpending(exec: ShellExec, days: SpendingDay[]): Promise<(number | null)[]> {
  const script = 'db="$HOME/.omp/stats.db"; sql="$1"; [ -f "$db" ] || exit 3; command -v sqlite3 >/dev/null 2>&1 || exit 4; sqlite3 -readonly -separator "|" "$db" "$sql"'
  try {
    const result = await exec(script, [spendingSql(days)], { timeoutMs: 5000, maxBytes: 1024 * 1024 })
    return result.code === 0 ? parseSpending(result.stdout.toString('utf8'), days) : noSpending(days)
  } catch { return noSpending(days) }
}

export function createModelDashboard(options: DashboardOptions) {
  const run = options.run ?? runner(options.home)
  const now = options.now ?? Date.now
  const cacheMs = Math.max(0, Math.min(options.cacheMs ?? 30000, 60000))
  const readSpending = options.readSpending ?? ((days: SpendingDay[]) => localSpending(options.home, days))
  const loadSpending = (days: SpendingDay[]) => readSpending(days).catch(() => noSpending(days))
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
  function snapshot(config: GlobalConfig, ledger: Ledger, models: CatalogModel[], quota: OmpQuota | null, amounts: (number | null)[], at = now()): ModelDashboardSnapshot {
    const days = spendingDays(at).map((day, index) => {
      const amount = amounts[index]
      return { date: day.date, amount: amount == null ? null : amount * DEEPSEEK_CNY_PER_USD }
    })
    return { models: models.filter(item => item.model.family !== 'other').map(item => item.model), additionalModels: models.filter(item => item.model.family === 'other').map(item => item.model), defaultSelector: baseSelector(config.roles.default ?? null), selections: ledger.selections.slice(-100).reverse(), spending: { currency: 'CNY', days }, quota }
  }
  return {
    get: () => serialized(file, async () => {
      const at = now()
      const days = spendingDays(at)
      const [config, models, quota, amounts] = await Promise.all([readConfig(), readCatalog(), readQuota(), loadSpending(days)])
      return snapshot(config, await recover(config), models, quota, amounts, at)
    }),
    getRemote: async (machine: Machine) => {
      if (machine.local || machine.status !== 'online' || !machine.home || !machine.exec) {
        throw new HerdrError('unreachable', 'Machine unreachable')
      }
      const exec = machine.exec
      const remoteRun: DashboardRunner = async argv => {
        const result = await exec('export PATH="$HOME/.local/bin:$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"; cd "$HOME" || exit 1; exec omp "$@"', argv, { timeoutMs: 30000, maxBytes: 8 * 1024 * 1024 })
        if (result.code !== 0) {
          log('model dashboard: remote omp failed', machine.key, argv.slice(0, 3).join(' '), result.code, String(result.stderr || '').trim().slice(0, 400))
          return fail('OMP could not complete the model operation on the selected machine')
        }
        return result.stdout.toString('utf8')
      }
      const at = now()
      const days = spendingDays(at)
      try {
        const [config, models, quota, amounts] = await Promise.all([
          remoteRun(['config', 'list', '--scope', 'global', '--json']).then(configOf),
          remoteRun(['models', 'ls', '--json']).then(catalogOf),
          readOmp(machine, { strict: true }).then(privateQuota),
          remoteSpending(exec, days),
        ])
        return snapshot(config, { selections: [] }, models, quota, amounts, at)
      } catch (error) {
        if (error instanceof HerdrError) throw error
        return fail('OMP could not complete the model operation on the selected machine')
      }
    },
    select: (selector: unknown) => serialized(file, async () => {
      if (typeof selector !== 'string' || selector.length > 300) return fail('Choose a supported dashboard model')
      const models = await readCatalog()
      const chosen = models.find(item => item.model.selector === selector && item.model.family !== 'other')
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
        const at = now()
        const [quota, amounts] = await Promise.all([readQuota(), loadSpending(spendingDays(at))])
        return snapshot(verified, receipt, models, quota, amounts, at)
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
