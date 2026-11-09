import { describe, expect, it } from 'vitest'
import { parseLines } from '../server/utils/transcripts'

const parse = (agent: string, ...lines: object[]) => parseLines(lines.map(x => JSON.stringify(x)).join('\n'), agent).filter(x => x.role === 'tool')
const claude = (id: string, input: unknown) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'TodoWrite', input }] } })
const claudeResult = (id: string, is_error: boolean) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error, content: 'result' }] } })
const codex = (id: string, args: string) => ({ type: 'response_item', payload: { type: 'function_call', name: 'update_plan', call_id: id, arguments: args } })
const codexResult = (id: string, is_error: boolean) => ({ type: 'response_item', payload: { type: 'function_call_output', call_id: id, is_error, output: 'result' } })
const omp = (id: string) => ({ type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', id, name: 'todo', arguments: { op: 'done', task: 'one' } }] } })
const ompResult = (id: string, details: unknown, isError = false) => ({ type: 'message', message: { role: 'toolResult', toolCallId: id, toolName: 'todo', content: [{ type: 'text', text: 'Remaining items: none.' }], details, isError } })

describe('transcript todo snapshots', () => {
  it('reads Claude TodoWrite inputs, preserves empty lists, and rejects failed or malformed calls', () => {
    const items = parse('claude',
      claude('a', { todos: [{ content: 'one', status: 'in_progress', activeForm: 'working' }, { content: 'two', status: 'blocked' }] }), claudeResult('a', false),
      claude('b', { todos: [] }), claude('c', { todos: [{ content: 'bad' }] }),
      claude('d', { todos: [{ content: 'failed', status: 'completed' }] }), claudeResult('d', true))
    expect(items[0]!.todos).toEqual([{ text: 'one', status: 'in_progress' }, { text: 'two', status: 'blocked' }])
    expect(items[1]!.todos).toEqual([])
    expect(items[2]!.todos).toBeUndefined()
    expect(items[3]).toMatchObject({ error: true })
    expect(items[3]!.todos).toBeUndefined()
  })

  it('reads Codex update_plan arguments and does not turn invalid or failed updates into snapshots', () => {
    const items = parse('codex',
      codex('a', JSON.stringify({ explanation: 'working', plan: [{ step: 'first', status: 'completed' }, { step: 'next', status: 'pending' }] })), codexResult('a', false),
      codex('b', '{"plan":[]}'), codex('c', '{bad'), codex('d', '{"plan":[{"step":"x"}]}'),
      codex('e', '{"plan":[]}'), codexResult('e', true))
    expect(items[0]!.todos).toEqual([{ text: 'first', status: 'completed' }, { text: 'next', status: 'pending' }])
    expect(items[1]!.todos).toEqual([])
    expect(items[2]!.todos).toBeUndefined()
    expect(items[3]!.todos).toBeUndefined()
    expect(items[4]).toMatchObject({ error: true })
    expect(items[4]!.todos).toBeUndefined()
  })

  it('reads omp result phase details, including completed tasks, not its remaining-items text', () => {
    const phases = [{ name: 'A', tasks: [{ content: 'one', status: 'completed' }, { content: 'two', status: 'in_progress' }] }, { name: 'B', tasks: [{ content: 'three', status: 'blocked' }] }]
    const items = parse('omp', omp('a'), ompResult('a', { op: 'done', phases }), omp('b'), ompResult('b', { phases: [] }),
      omp('c'), ompResult('c', { phases: [{ tasks: [{ content: 'bad' }] }] }),
      omp('d'), ompResult('d', { phases }, true), omp('e'), ompResult('e', {}), omp('f'))
    expect(items[0]!.todos).toEqual([{ text: 'one', status: 'completed' }, { text: 'two', status: 'in_progress' }, { text: 'three', status: 'blocked' }])
    expect(items[1]!.todos).toEqual([])
    expect(items[2]!.todos).toBeUndefined()
    expect(items[3]).toMatchObject({ error: true })
    expect(items[3]!.todos).toBeUndefined()
    expect(items[4]!.todos).toBeUndefined()
    expect(items[5]!.todos).toBeUndefined()
  })
})
