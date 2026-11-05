import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGraphWorkspace, type GraphRunner } from '../server/utils/bots/graph'

const directories: string[] = []
const source = { id: 'local', label: 'Local', command: ['/trusted/omp'], profile: 'work' }
async function setup(run: GraphRunner) {
  const dataDir = await fs.mkdtemp(path.join(tmpdir(), 'wherdr-graphs-'))
  directories.push(dataDir)
  await fs.writeFile(path.join(dataDir, 'graph-sources.json'), JSON.stringify({ sources: [source] }))
  const workspace = createGraphWorkspace({ dataDir, run })
  const token = (await workspace.sources()).sources[0]!.token
  return { workspace, dataDir, scope: { source_id: 'local', source_token: token } }
}
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))) })

describe('Graph authoring trust boundary', () => {
  it('requires explicit Graph source configuration, independent of Bot sources', async () => {
    const run = vi.fn<GraphRunner>()
    const { workspace, dataDir } = await setup(run)
    await fs.rename(path.join(dataDir, 'graph-sources.json'), path.join(dataDir, 'bot-sources.json'))
    expect(await workspace.sources()).toEqual({ sources: [] })
    expect(run).not.toHaveBeenCalled()
  })
  it('passes revision guards, keys and Markdown without interpreting text as argv', async () => {
    const run = vi.fn<GraphRunner>().mockResolvedValue({ code: 0, output: 'Request: k1\nGraph: g1\nState: completed\nRevision: 2\n' })
    const { workspace, scope } = await setup(run)
    const content = '---\nname: test\n---\n--request-key=bad $(command)'
    expect(await workspace.request({ ...scope, action: 'edit', graph_id: 'g1', revision: '1', request_key: 'k1', content })).toMatchObject({ graph_id: 'g1', revision: '2', state: 'completed' })
    expect(run).toHaveBeenCalledWith(source, ['edit', 'g1', '--file=-', '--if-revision=1', '--request-key=k1'], content)
    await expect(workspace.request({ ...scope, action: 'edit', graph_id: 'g1', revision: '1', request_key: 'k1', content, command: ['evil'] })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(workspace.request({ ...scope, action: 'read', graph_id: '--help' })).rejects.toMatchObject({ code: 'invalid_input' })
  })
  it('refuses a changed source and malformed or mismatched receipts', async () => {
    const run = vi.fn<GraphRunner>().mockResolvedValue({ code: 0, output: 'Request: different\nGraph: g1\nState: completed\nRevision: 1\n' })
    const { workspace, dataDir, scope } = await setup(run)
    await expect(workspace.request({ ...scope, action: 'create', name: 'test', request_key: 'k1' })).rejects.toMatchObject({ code: 'unsupported' })
    await fs.writeFile(path.join(dataDir, 'graph-sources.json'), JSON.stringify({ sources: [{ ...source, profile: 'other' }] }))
    await expect(workspace.request({ ...scope, action: 'receipt', request_key: 'k1' })).rejects.toMatchObject({ code: 'source_changed' })
    expect(run).toHaveBeenCalledTimes(1)
  })
  it('does not associate exported content with a changing revision', async () => {
    const run = vi.fn<GraphRunner>()
      .mockResolvedValueOnce({ code: 0, output: 'Graph: g1\nState: valid\nRevision: 1\n' })
      .mockResolvedValueOnce({ code: 0, output: 'definition' })
      .mockResolvedValueOnce({ code: 0, output: 'Graph: g1\nState: valid\nRevision: 2\n' })
    const { workspace, scope } = await setup(run)
    await expect(workspace.request({ ...scope, action: 'read', graph_id: 'g1' })).rejects.toMatchObject({ code: 'revision_conflict' })
  })
})
