import type { AgentStatus } from '../../shared/types'

interface Observation {
  id: string
  agent: string
  session: string | null
  terminal: string | null
  status: AgentStatus | null
  seq?: number
}
interface RecordState {
  machine: string
  id: string
  agent: string
  session: string | null
  terminal: string | null
  activityAt?: number
  touched: number
  // Status is deliberately not persisted: transitions during downtime are unknown.
  status?: AgentStatus
  seq?: number
}
const MAX_RECORDS = 2000
const known = (status: AgentStatus | null): status is AgentStatus =>
  status === 'working' || status === 'blocked' || status === 'idle' || status === 'done'

export class ActivityTracker {
  private records = new Map<string, RecordState>()
  private dirty = false
  private key(machine: string, id: string) { return JSON.stringify([machine, id]) }

  constructor(saved?: unknown) {
    if (!Array.isArray(saved)) return
    for (const value of saved.slice(-MAX_RECORDS)) {
      if (!value || typeof value !== 'object') continue
      const r = value as RecordState
      if (typeof r.machine !== 'string' || typeof r.id !== 'string' || typeof r.agent !== 'string'
        || !(r.session === null || typeof r.session === 'string')
        || !(r.terminal === null || typeof r.terminal === 'string')
        || !Number.isFinite(r.touched) || (r.activityAt !== undefined && !Number.isFinite(r.activityAt))) continue
      this.records.set(this.key(r.machine, r.id), { machine: r.machine, id: r.id, agent: r.agent,
        session: r.session, terminal: r.terminal, touched: r.touched,
        ...(Number.isFinite(r.seq) ? { seq: r.seq } : {}),
        ...(r.activityAt === undefined ? {} : { activityAt: r.activityAt }) })
    }
  }

  observe(machine: string, observations: Observation[], now: number): Map<string, number> {
    const live = new Set<string>()
    const result = new Map<string, number>()
    for (const o of observations) {
      const key = this.key(machine, o.id)
      live.add(key)
      let r = this.records.get(key)
      const changedIdentity = r && (r.agent !== o.agent
        || (r.session && o.session && r.session !== o.session)
        || (r.terminal && o.terminal && r.terminal !== o.terminal))
      const reset = r && r.seq !== undefined && o.seq !== undefined && o.seq < r.seq
      if (!r || changedIdentity || reset) {
        r = { machine, id: o.id, agent: o.agent, session: o.session, terminal: o.terminal, touched: now }
        this.records.set(key, r)
        this.dirty = true
      } else {
        // Missing identifiers are not evidence of a new incarnation.
        if (o.session && r.session !== o.session) { r.session = o.session; this.dirty = true }
        if (o.terminal && r.terminal !== o.terminal) { r.terminal = o.terminal; this.dirty = true }
      }
      if (known(o.status)) {
        const advanced = o.seq !== undefined && r.seq !== undefined && o.seq > r.seq
        if (r.status && ((o.status === 'blocked' && (r.status !== 'blocked' || advanced))
          || ((o.status === 'idle' || o.status === 'done') && r.status === 'working'))) {
          r.activityAt = now
          this.dirty = true
        }
        r.status = o.status
      } else {
        // Unknown classification breaks the observed transition chain.
        r.status = undefined
      }
      if (o.seq !== undefined && r.seq !== o.seq) { r.seq = o.seq; this.dirty = true }
      r.touched = now
      if (r.activityAt !== undefined) result.set(o.id, r.activityAt)
    }
    // Only a successful complete snapshot can prove a pane disappeared.
    for (const [key, r] of this.records) if (r.machine === machine && !live.has(key)) {
      this.records.delete(key)
      this.dirty = true
    }
    if (this.records.size > MAX_RECORDS) {
      const oldest = [...this.records.entries()].sort((a, b) => a[1].touched - b[1].touched)
      for (const [key] of oldest.slice(0, this.records.size - MAX_RECORDS)) this.records.delete(key)
      this.dirty = true
    }
    return result
  }

  disconnect(machine: string) {
    for (const r of this.records.values()) if (r.machine === machine) r.status = undefined
  }

  // Call after each observation; returns null when disk need not be updated.
  takeSaved(): string | null {
    if (!this.dirty) return null
    this.dirty = false
    return JSON.stringify([...this.records.values()].map(({ status: _status, ...r }) => r)) + '\n'
  }
}
