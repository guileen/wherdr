import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasCommands } from './helpers/commands'
import type { Quotas } from '../shared/types'
import { readClaude, mergeQuotas } from '../server/utils/quotas'
import { localFs } from '../server/utils/fsx'
import { claudeInstallCommand, claudeSetupOf, claudeSetupRows, claudeSuggestion, machineQuotaRows, ompReportToQuota, quotaLeft, quotaLevel, quotaRows, quotaShown, resetText, tabQuotaRows } from '../app/utils/quotas'

// The install command passes settings.json to python3 (missing from node:22-alpine).
const hasPython = hasCommands('python3')
const five = (used: number) => ({ used, resetsAt: 2000, minutes: 300 })

describe('quota split (top / machines)', () => {
  it('a tab showing one machine: shared and own rows together, Claude then Codex', () => {
    const q: Quotas = {
      claude: null, codex: { five: five(40), week: null, at: 2 },
      claudeAccounts: [
        { five: five(10), week: null, at: 1, account: 'a', machines: [{ key: '', label: 'Server' }] },
        { five: five(20), week: null, at: 1, account: 'b', machines: [{ key: 'laptop', label: 'Laptop' }] },
      ],
    }
    expect(quotaRows(q).map(r => r.key)).toEqual(['codex'])
    expect(tabQuotaRows(quotaRows(q), machineQuotaRows(q, 'laptop')).map(r => r.key)).toEqual(['claude:laptop', 'codex'])
    expect(tabQuotaRows(quotaRows(q), [])).toEqual(quotaRows(q))
  })
  it('a single account: Claude and Codex at the top, nothing under the machines', () => {
    const q: Quotas = { claude: { five: five(10), week: null, at: 1 }, codex: { five: five(40), week: null, at: 2 } }
    expect(quotaRows(q).map(r => r.key)).toEqual(['claude', 'codex'])
    expect(machineQuotaRows(q, '')).toEqual([])
    expect(quotaRows(null)).toEqual([])
    expect(quotaRows(q, ['claude']).map(r => r.key)).toEqual(['codex'])
    expect(quotaRows(q, ['codex']).map(r => r.key)).toEqual(['claude'])
    expect(quotaRows(q, ['claude', 'codex'])).toEqual([])
  })

  it('different accounts: Codex (shared) at the top, each machine\'s Claude account under it', () => {
    const q: Quotas = {
      claude: { five: five(30), week: null, at: 3 },
      codex: { five: five(40), week: null, at: 2 },
      claudeAccounts: [
        { five: five(10), week: null, at: 1, machines: [{ key: '', label: 'host-a' }, { key: '0c1d2e3f', label: 'Workstation' }] },
        { five: five(30), week: null, at: 3, machines: [{ key: '0a1b2c3d', label: 'Laptop' }] },
      ],
    }
    expect(quotaRows(q).map(r => r.key)).toEqual(['codex'])
    const mac = machineQuotaRows(q, '0a1b2c3d')
    expect(mac.map(r => [r.agent, r.q.five!.used])).toEqual([['claude', 30]])
    expect(mac[0]!.q).not.toHaveProperty('machines')
    // Same account on two machines out of three: under each of the two.
    expect(machineQuotaRows(q, '')[0]!.q.five!.used).toBe(10)
    expect(machineQuotaRows(q, '0c1d2e3f')[0]!.q.five!.used).toBe(10)
    expect(machineQuotaRows(q, 'deadbeef')).toEqual([])
    expect(quotaRows(q, ['codex'])).toEqual([])
    expect(machineQuotaRows(q, '0a1b2c3d', ['claude'])).toEqual([])
    expect(machineQuotaRows(q, '', ['codex']).map(r => r.agent)).toEqual(['claude'])
  })

  it('remaining share: window reset since the reading = 100 %', () => {
    expect(quotaLeft(five(62.4), 1000)).toBe(38)
    expect(quotaLeft(five(62.4), 3000)).toBe(100)
  })
})

describe('reset time', () => {
  const now = new Date(2026, 8, 26, 20, 0).getTime() // samedi 20:00 (heure locale)
  const w = (at: Date | null) => ({ used: 10, resetsAt: at ? at.getTime() : null, minutes: 300 })
  it('within 24 h: the time alone, even the next day', () => {
    expect(resetText(w(new Date(2026, 8, 27, 0, 0)), now, 'fr')).toBe('00:00')
    expect(resetText(w(new Date(2026, 8, 26, 23, 20)), now, 'fr')).toBe('23:20')
  })
  it('beyond: with the day; past: null; unknown: empty', () => {
    expect(resetText(w(new Date(2026, 8, 28, 19, 0)), now, 'fr')).toMatch(/^lun\.? 19:00$/)
    expect(resetText(w(new Date(2026, 8, 26, 19, 0)), now, 'fr')).toBeNull()
    expect(resetText(w(null), now, 'fr')).toBe('')
  })
})

describe('Claude quotas not configured', () => {
  const q: Quotas = { claude: null, codex: null, claudeSetup: [{ key: '0a1b2c3d', state: 'missing', installable: true }] }
  it('suggested only on a listed machine that has Claude', () => {
    expect(claudeSuggestion(q, '0a1b2c3d', true)).toEqual({ key: '0a1b2c3d', state: 'missing', installable: true })
    expect(claudeSuggestion(q, '0a1b2c3d', false)).toBeNull()
    expect(claudeSuggestion(q, '', true)).toBeNull()
    expect(claudeSuggestion(null, '', true)).toBeNull()
    expect(claudeSuggestion(q, '0a1b2c3d', true, ['claude'])).toBeNull()
    expect(claudeSuggestion(q, '0a1b2c3d', true, ['codex'])).not.toBeNull()
  })

  it('regression: no suggestion once set up, waiting, or declined; an update for an old status line', () => {
    const of = (state: 'ok' | 'pending' | 'outdated' | 'missing', dismissed?: boolean): Quotas => ({ claude: null, codex: null, claudeSetup: [{ key: '', state, installable: true, ...(dismissed ? { dismissed } : {}) }] })
    expect(claudeSuggestion(of('ok'), '', true)).toBeNull()
    expect(claudeSuggestion(of('pending'), '', true)).toBeNull()
    expect(claudeSuggestion(of('missing', true), '', true)).toBeNull()
    expect(claudeSuggestion(of('outdated', true), '', true)).toBeNull()
    expect(claudeSuggestion(of('outdated'), '', true)?.state).toBe('outdated')
    // Settings still sees the state of a declined machine.
    expect(claudeSetupOf(of('missing', true), '')?.dismissed).toBe(true)
  })

  it('Settings lists the machines with Claude, or whose status line was found', () => {
    const qs: Quotas = { claude: null, codex: null, claudeSetup: [
      { key: '', state: 'ok', installable: true },
      { key: 'aa11', state: 'outdated', installable: true },
      { key: 'bb22', state: 'missing', installable: false },
      { key: 'cc33', state: 'missing', installable: true },
    ] }
    const rows = claudeSetupRows(qs, [
      { key: '', name: 'Server', online: true, kinds: ['claude', 'codex'] },
      { key: 'aa11', name: 'Codex box', online: true, kinds: ['codex'] },
      { key: 'bb22', name: 'Laptop', online: true, kinds: ['claude'] },
      { key: 'cc33', name: 'No Claude', online: true, kinds: ['codex'] },
      { key: 'dd44', name: 'Asleep', online: false, kinds: ['claude'] },
    ])
    expect(rows.map(r => [r.key, r.setup?.state ?? null])).toEqual([['', 'ok'], ['aa11', 'outdated'], ['bb22', 'missing'], ['dd44', null]])
    expect(claudeSetupRows(null, [{ key: '', name: 'Server', online: true, kinds: ['claude'] }])).toEqual([{ key: '', name: 'Server', online: true, setup: null }])
  })

  it.skipIf(!hasPython)('binds each reading to its account immediately after switching', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wherdr-switch-'))
    try {
      const env = { PATH: process.env.PATH, HOME: home }
      execFileSync('sh', ['-c', claudeInstallCommand], { env })
      const config = path.join(home, '.claude.json')
      const write = (account: string, used: number) => {
        fs.writeFileSync(config, JSON.stringify({ oauthAccount: { accountUuid: account } }))
        execFileSync('sh', [path.join(home, '.claude/wherdr-statusline.sh')], {
          env, input: JSON.stringify({ rate_limits: { five_hour: { used_percentage: used } } }),
        })
      }
      write('test-account-a', 98)
      const original = (await readClaude(localFs, home)).q!
      write('test-account-b', 11)
      const switched = (await readClaude(localFs, home)).q!
      expect(switched.account).not.toBe(original.account)
      // A stale compatibility sidecar cannot relabel an atomic reading.
      fs.writeFileSync(path.join(home, '.cache/herdr-web/claude-account'), original.account!)
      expect((await readClaude(localFs, home)).q!.account).toBe(switched.account)
      const out = mergeQuotas([
        { key: 'server', label: 'Server', claude: switched, codex: null },
        { key: 'laptop', label: 'Laptop', claude: original, codex: null },
        { key: 'desktop', label: 'Desktop', claude: { ...original, at: original.at - 1000 }, codex: null },
      ])
      expect(machineQuotaRows(out, 'server')[0]!.q.five!.used).toBe(11)
      expect(machineQuotaRows(out, 'laptop')[0]!.q.five!.used).toBe(98)
      expect(machineQuotaRows(out, 'desktop')[0]!.q.five!.used).toBe(98)
      fs.rmSync(config)
      execFileSync('sh', [path.join(home, '.claude/wherdr-statusline.sh')], {
        env, input: '{"rate_limits":{"five_hour":{"used_percentage":7}}}',
      })
      expect((await readClaude(localFs, home)).q!.account).toBeNull()
    } finally { fs.rmSync(home, { recursive: true, force: true }) }
  })

  it.skipIf(!hasPython)('the command to copy is self-contained: status line written and wired', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wherdr-'))
    try {
      const env = { PATH: process.env.PATH, HOME: home }
      execFileSync('sh', ['-c', claudeInstallCommand], { env, stdio: 'pipe' })
      const settings = JSON.parse(fs.readFileSync(path.join(home, '.claude/settings.json'), 'utf8'))
      expect(settings.statusLine.command).toContain('wherdr-statusline.sh')
      // It keeps the quotas and lets a chained status line through.
      const out = execFileSync('sh', [path.join(home, '.claude/wherdr-statusline.sh'), 'cat'], { env, input: '{"rate_limits":{}}' }).toString()
      expect(out).toBe('{"rate_limits":{}}')
      expect(JSON.parse(fs.readFileSync(path.join(home, '.cache/herdr-web/claude-status.json'), 'utf8'))).toMatchObject({ rate_limits: {}, _wherdr: { account: null } })
      // Run again: nothing changes in settings.json.
      execFileSync('sh', ['-c', claudeInstallCommand], { env, stdio: 'pipe' })
      expect(JSON.parse(fs.readFileSync(path.join(home, '.claude/settings.json'), 'utf8'))).toEqual(settings)
    } finally { fs.rmSync(home, { recursive: true, force: true }) }
  })
})

describe('different Codex accounts', () => {
  it('Codex under each machine, no longer at the top', () => {
    const w = (used: number) => ({ used, resetsAt: null, minutes: 300 })
    const q: Quotas = {
      claude: { five: w(5), week: null, at: 1 },
      codex: { five: w(40), week: null, at: 2 },
      codexAccounts: [
        { five: w(40), week: null, at: 2, machines: [{ key: '', label: 'host-a' }] },
        { five: w(70), week: null, at: 1, machines: [{ key: '0a1b2c3d', label: 'Laptop' }] },
      ],
    }
    expect(quotaRows(q).map(r => r.key)).toEqual(['claude'])
    expect(machineQuotaRows(q, '0a1b2c3d').map(r => [r.key, r.q.five!.used])).toEqual([['codex:0a1b2c3d', 70]])
    expect(machineQuotaRows(q, '', ['codex'])).toEqual([])
  })
})

describe('omp usage and deduplication', () => {
  const w = (used: number) => ({ used, resetsAt: null, minutes: 300 })

  it('keeps only the latest data when omp covers standalone codex', () => {
    const standaloneCodex: Quota = { five: w(40), week: null, at: 100 }
    const ompCodexReport: OmpProviderReport = {
      provider: 'openai-codex',
      fetchedAt: 200,
      limits: [{
        id: 'openai-codex:primary',
        label: '7 days',
        amount: { used: 85, unit: 'percent' },
        window: { id: '7d', label: '7 days', durationMs: 604800000, resetsAt: null },
      }],
      resetCredits: { availableCount: 3 },
    }
    const qOmpNewer: Quotas = {
      claude: null,
      codex: standaloneCodex,
      omp: { at: 200, reports: [ompCodexReport] },
    }
    // omp is newer (200 > 100): standalone codex is dropped, omp:openai-codex is used
    const rows1 = quotaRows(qOmpNewer)
    expect(rows1.map(r => r.key)).toEqual(['omp:openai-codex'])
    expect(rows1[0]!.label).toBe('OpenAI Codex')
    expect(rows1[0]!.q.credits).toBe(3)
    expect(rows1[0]!.q.windows?.[0]?.used).toBe(85)

    // Standalone codex is newer (300 > 200): omp codex is dropped, standalone codex is used
    const qStandaloneNewer: Quotas = {
      claude: null,
      codex: { five: w(50), week: null, at: 300 },
      omp: { at: 200, reports: [ompCodexReport] },
    }
    const rows2 = quotaRows(qStandaloneNewer)
    expect(rows2.map(r => r.key)).toEqual(['codex'])
    expect(rows2[0]!.q.five?.used).toBe(50)
  })

  it('includes multiple omp providers and preserves shared limit identities', () => {
    const q: Quotas = {
      claude: null,
      codex: null,
      omp: {
        at: 500,
        reports: [
          {
            provider: 'google-antigravity',
            fetchedAt: 500,
            limits: [
              {
                id: 'ga:anthropic:weekly',
                label: 'Claude & GPT (shared)',
                scope: { sharedGroup: '3p-weekly:weekly' },
                amount: { used: 80, unit: 'percent' },
                window: { id: 'weekly', label: 'Weekly', durationMs: 604800000 },
              },
              {
                id: 'ga:openai:weekly',
                label: 'Claude & GPT (shared)',
                scope: { sharedGroup: '3p-weekly:weekly' },
                amount: { used: 80, unit: 'percent' },
                window: { id: 'weekly', label: 'Weekly', durationMs: 604800000 },
              },
              {
                id: 'ga:gemini:5h',
                label: 'Gemini',
                amount: { used: 15, unit: 'percent' },
                window: { id: '5h', label: '5 Hour', durationMs: 18000000 },
              },
            ],
          },
          {
            provider: 'cursor',
            fetchedAt: 450,
            limits: [{
              id: 'cursor:monthly',
              label: 'Cursor Models',
              amount: { usedFraction: 0.1 },
              window: { id: 'monthly', label: 'Monthly' },
            }],
          },
        ],
      },
    }

    const rows = quotaRows(q)
    expect(rows.map(r => r.key)).toEqual(['omp:google-antigravity', 'omp:cursor'])
    expect(rows[0]!.label).toBe('Google Antigravity')
    expect(rows[0]!.q.windows).toHaveLength(3)
    expect(rows[0]!.q.windows![0]!.label).toBe('Claude & GPT (shared) (Weekly)')
    expect(rows[0]!.q.windows![1]!.id).toBe('ga:openai:weekly')
    expect(rows[0]!.q.windows![1]!.scope?.sharedGroup).toBe('3p-weekly:weekly')
    expect(rows[0]!.q.windows![2]!.label).toBe('Gemini (5 Hour)')
    expect(rows[1]!.label).toBe('Cursor')
    expect(rows[1]!.q.windows![0]!.used).toBe(10)
  })

  it('keeps available reset-credit expiry without inventing missing dates', () => {
    const q = ompReportToQuota({
      provider: 'openai-codex', fetchedAt: 1, limits: [],
      resetCredits: { availableCount: 2, credits: [
        { grantedAt: '2026-10-31T20:33:18.064683Z', expiresAt: '2026-11-30T20:33:18.064683Z', status: 'available' },
        { status: 'used', expiresAt: '2026-11-01T00:00:00Z' },
        { status: 'available' },
      ] },
    })
    expect(q.credits).toBe(2)
    expect(q.resetCredits?.credits).toEqual([
      { grantedAt: '2026-10-31T20:33:18.064683Z', expiresAt: '2026-11-30T20:33:18.064683Z', status: 'available' },
      { grantedAt: undefined, expiresAt: undefined, status: 'available' },
    ])
    expect(ompReportToQuota({ provider: 'openai-codex', fetchedAt: 1, limits: [] }).resetCredits).toBeUndefined()
  })

  it('retains raw units without inventing a percentage for an unknown limit', () => {
    const q = ompReportToQuota({
      provider: 'example', fetchedAt: 1,
      limits: [
        { id: 'unknown', label: 'Tokens', scope: { shared: true, sharedGroup: 'models' }, amount: { used: 42, unit: 'tokens' }, window: { id: '5h', resetsAt: 2000 } },
        { id: 'fraction', label: 'Fraction', amount: { usedFraction: 0.25 } },
        { id: 'ratio', label: 'Requests', amount: { used: 30, limit: 60, unit: 'requests' } },
        { id: 'invalid', label: 'Invalid', amount: { used: Number.NaN, unit: 'percent' } },
      ],
    })
    const [unknown, fraction, ratio, invalid] = q.windows!
    expect(unknown).toMatchObject({ id: 'unknown', windowId: '5h', scope: { shared: true, sharedGroup: 'models' }, amount: { used: 42, unit: 'tokens' }, used: null })
    expect(quotaLeft(unknown!, 3000)).toBeNull()
    expect(quotaShown(unknown!, 1000, 'used')).toBeNull()
    expect(quotaLevel(unknown!, 1000)).toBe('unknown')
    expect([fraction!.used, ratio!.used, invalid!.used]).toEqual([25, 50, null])
  })

  it('hiding codex or claude also hides covered omp reports', () => {
    const q: Quotas = {
      claude: null,
      codex: null,
      omp: {
        at: 100,
        reports: [
          { provider: 'openai-codex', fetchedAt: 100, limits: [] },
          { provider: 'google-antigravity', fetchedAt: 100, limits: [] },
        ],
      },
    }
    expect(quotaRows(q, ['codex']).map(r => r.key)).toEqual(['omp:google-antigravity'])
  })
})
