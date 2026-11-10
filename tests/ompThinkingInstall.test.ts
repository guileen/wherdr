import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

it('installs a discoverable extension without replacing a foreign file', () => {
  const home = mkdtempSync(join(tmpdir(), 'wherdr-omp-install-'))
  roots.push(home)
  const env = { ...process.env, HOME: home, PI_CONFIG_DIR: join(home, 'config'), PI_CODING_AGENT_DIR: join(home, 'agent') }
  const install = () => spawnSync(process.execPath, [resolve('bin/wherdr.mjs'), 'install-omp-thinking'], { env, encoding: 'utf8' })
  const target = join(env.PI_CODING_AGENT_DIR, 'extensions', 'wherdr-live-thinking.js')
  expect(install().status).toBe(0)
  expect(readFileSync(target, 'utf8')).toBe(readFileSync(resolve('bin/omp-live-thinking.js'), 'utf8'))
  expect(install().status).toBe(0)
  writeFileSync(target, 'foreign extension')
  const result = install()
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain('refusing to overwrite')
  expect(readFileSync(target, 'utf8')).toBe('foreign extension')
})
