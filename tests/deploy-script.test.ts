import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let root: string
let bin: string
let home: string

function fake(name: string, body: string) {
  const path = join(bin, name)
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
}

function deploy(args: string[] = [], extra: Record<string, string> = {}) {
  return spawnSync('/bin/bash', [resolve('deploy.sh'), ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, TMPDIR: root, PATH: `${bin}:/usr/bin:/bin`, WHERDR_SSH_HOST: 'fake-host', ...extra },
  })
}

describe.skipIf(process.platform === 'win32')('deployment output', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'wherdr-deploy-test-'))
    bin = join(root, 'bin')
    home = join(root, 'home')
    mkdirSync(bin)
    mkdirSync(home)
    fake('npm', 'echo "npm notice noisy package listing" >&2; touch "$3/package.tgz"')
    fake('scp', 'echo "upload noise" >&2')
    fake('ssh', `case "$*" in *"rm -f"*) exit 0 ;; esac
cat > "${root}/remote-script"
echo "remote noise" >&2
[ "${'$'}{FAKE_SSH_FAIL:-0}" = 0 ] || { echo "launchctl: service unavailable" >&2; exit 23; }`)
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('prints only the deployment status on remote success', () => {
    const result = deploy()
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('Deploying\nDeployment successful: dev.wherdr is active and healthy on 127.0.0.1:7683.\n')
    expect(result.stderr).toBe('')
    expect(readFileSync(join(root, 'remote-script'), 'utf8')).toContain('set -euo pipefail')
  })

  it('reports check success without claiming a deployment', () => {
    const result = deploy(['--check'])
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('Checking\nCheck successful: staged server is healthy; running service unchanged.\n')
    expect(result.stderr).toBe('')
  })

  it('retains actionable pack errors without notice floods', () => {
    fake('npm', 'echo "npm notice noisy package listing" >&2; echo "npm error build failed" >&2; exit 17')
    const result = deploy()
    expect(result.status).toBe(17)
    expect(result.stdout).toBe('Deploying\n')
    expect(result.stderr).toContain('Fail: npm pack failed')
    expect(result.stderr).toContain('npm error build failed')
    expect(result.stderr).not.toContain('npm notice')
  })

  it('retains remote failure details and exit status', () => {
    const result = deploy([], { FAKE_SSH_FAIL: '1' })
    expect(result.status).toBe(23)
    expect(result.stderr).toContain('Fail: Deployment target fake-host failed')
    expect(result.stderr).toContain('launchctl: service unavailable')
    expect(result.stdout).not.toContain('successful')
  })

  it('fails safely on a local host without a LaunchAgent', () => {
    const result = deploy(['--check'], { WHERDR_SSH_HOST: 'local' })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Fail:')
    expect(result.stderr).toContain('Missing dev.wherdr LaunchAgent')
    expect(result.stdout).not.toContain('successful')
  })
})
