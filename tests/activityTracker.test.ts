import { describe, expect, it } from 'vitest'
import { ActivityTracker } from '../server/utils/activityTracker'
import type { AgentStatus } from '../shared/types'

const obs = (status: AgentStatus, seq: number, extra: Partial<{ id: string, agent: string, session: string | null, terminal: string | null }> = {}) =>
  ({ id: 'p1', agent: 'claude', session: 's1', terminal: 't1', status, seq, ...extra })
const at = (tracker: ActivityTracker, machine: string, status: AgentStatus, seq: number, time: number) =>
  tracker.observe(machine, [obs(status, seq)], time).get('p1')?.activityAt
const since = (tracker: ActivityTracker, machine: string, status: AgentStatus, seq: number, time: number) =>
  tracker.observe(machine, [obs(status, seq)], time).get('p1')?.workingSince

describe('observed agent activity', () => {
  it('timestamps observed status changes, not initial or unchanged observations', () => {
    const t = new ActivityTracker()
    expect(at(t, 'a', 'idle', 1, 100)).toBeUndefined()
    expect(at(t, 'a', 'working', 2, 200)).toBe(200)
    expect(at(t, 'a', 'blocked', 3, 300)).toBe(300)
    expect(at(t, 'a', 'blocked', 3, 400)).toBe(300)
    expect(at(t, 'a', 'blocked', 5, 500)).toBe(500)
    expect(at(t, 'a', 'working', 6, 600)).toBe(600)
    expect(at(t, 'a', 'done', 7, 700)).toBe(700)
    expect(at(t, 'a', 'idle', 8, 800)).toBe(800)
    expect(at(t, 'a', 'working', 9, 900)).toBe(900)
    expect(at(t, 'a', 'idle', 10, 1000)).toBe(1000)
    expect(at(t, 'a', 'working', 11, 1100)).toBe(1100)
    expect(at(t, 'a', 'working', 13, 1200)).toBe(1200)
  })

  it('tracks continuous working duration from start of working status', () => {
    const t = new ActivityTracker()
    expect(since(t, 'a', 'idle', 1, 100)).toBeUndefined()
    expect(since(t, 'a', 'working', 2, 200)).toBe(200)
    expect(at(t, 'a', 'working', 2, 200)).toBe(200)
    expect(since(t, 'a', 'working', 3, 250)).toBe(200)
    expect(at(t, 'a', 'working', 3, 250)).toBe(250)
    expect(since(t, 'a', 'working', 4, 300)).toBe(200)
    expect(at(t, 'a', 'working', 4, 300)).toBe(300)
    expect(since(t, 'a', 'idle', 5, 400)).toBeUndefined()
    expect(at(t, 'a', 'idle', 5, 400)).toBe(400)
    expect(since(t, 'a', 'working', 6, 500)).toBe(500)
    expect(at(t, 'a', 'working', 6, 500)).toBe(500)
  })

  it('restores working time across restart until a non-working observation', () => {
    const first = new ActivityTracker()
    expect(since(first, 'a', 'working', 2, 100)).toBe(100)
    const saved = JSON.parse(first.takeSaved()!)
    expect(since(new ActivityTracker(saved), 'a', 'working', 2, 200)).toBe(100)
    expect(since(new ActivityTracker(saved), 'a', 'working', 9, 200)).toBe(100)
    const stopped = new ActivityTracker(saved)
    expect(since(stopped, 'a', 'idle', 3, 200)).toBeUndefined()
    expect(since(stopped, 'a', 'working', 4, 300)).toBe(300)
  })

  it('keeps the working clock through a sequence reset and a link gap', () => {
    const t = new ActivityTracker()
    expect(since(t, 'a', 'working', 9, 100)).toBe(100)
    expect(since(t, 'a', 'working', 2, 200)).toBe(100)
    t.disconnect('a')
    expect(since(t, 'a', 'working', 3, 300)).toBe(100)
    expect(since(t, 'a', 'blocked', 4, 400)).toBeUndefined()
    expect(since(t, 'a', 'working', 5, 500)).toBe(500)
  })

  it('restores timestamps but does not invent transitions across restart, unknown or disconnection', () => {
    const first = new ActivityTracker()
    at(first, 'a', 'working', 1, 10)
    at(first, 'a', 'done', 2, 20)
    const restarted = new ActivityTracker(JSON.parse(first.takeSaved()!))
    expect(at(restarted, 'a', 'working', 3, 30)).toBe(20)
    expect(at(restarted, 'a', 'unknown', 4, 40)).toBe(20)
    expect(at(restarted, 'a', 'blocked', 5, 50)).toBe(20)
    restarted.disconnect('a')
    expect(at(restarted, 'a', 'working', 6, 60)).toBe(20)
    expect(at(restarted, 'a', 'done', 7, 70)).toBe(70)
    const again = new ActivityTracker(JSON.parse(restarted.takeSaved()!))
    expect(at(again, 'a', 'done', 7, 80)).toBe(70)
  })

  it('isolates machines and detects replacement, reset and disappearance', () => {
    const t = new ActivityTracker()
    at(t, 'a', 'working', 90, 10)
    at(t, 'b', 'working', 1, 11)
    expect(at(t, 'a', 'done', 91, 20)).toBe(20)
    expect(at(t, 'b', 'blocked', 2, 30)).toBe(30)
    expect(at(t, 'a', 'working', 1, 40)).toBeUndefined()
    expect(at(t, 'b', 'blocked', 2, 41)).toBe(30)
    expect(t.observe('b', [obs('done', 3, { terminal: 't2' })], 50).get('p1')).toBeUndefined()
    t.observe('b', [], 60)
    expect(at(t, 'b', 'blocked', 4, 70)).toBeUndefined()
    expect(t.observe('a', [obs('blocked', 2, { session: 's2' })], 80).get('p1')).toBeUndefined()
  })

  it('bounds persisted history and ignores invalid saved data', () => {
    const t = new ActivityTracker([null, { machine: 'bad' }])
    const many = Array.from({ length: 2001 }, (_, i) => obs('idle', 1, { id: String(i) }))
    t.observe('a', many, 100)
    expect(JSON.parse(t.takeSaved()!)).toHaveLength(2000)
  })
})
