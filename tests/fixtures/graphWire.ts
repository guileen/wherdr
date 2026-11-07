import { GRAPH_WIRE_EXECUTION_EXTENSION, GRAPH_WIRE_PROTOCOL, type GraphWireRecord, type GraphWireSource, type GraphWireSourceFrame } from '@oh-my-pi/pi-wire/graph'

export interface GraphWireFixture {
  source: GraphWireSource
  records: GraphWireRecord[]
  frames: GraphWireSourceFrame[]
}

/** A real protocol image: program execution has no fabricated Bot or Job identity. */
export function graphWireFixture(execution = true, subscriptionId = 'sub'): GraphWireFixture {
  const now = Date.now(), instant = new Date(now).toISOString()
  const ref = { id: 'snapshot', digest: 'sha256:fixture' }
  const source: GraphWireSource = { source_id: 'local', kind: 'graph', profile_id: null, bot_id: null, capabilities: ['graph.runs.v1', 'graph.history.v1', ...(execution ? [GRAPH_WIRE_EXECUTION_EXTENSION] : [])] }
  const records: GraphWireRecord[] = [{ kind: 'run', value: { graph_id: 'graph', graph_run_id: 'run1', definition_revision: '1', revision: '1', created_at: instant, definition: { nodes: [{ node_id: 'program', label: 'Build assets', bot: null, config_revision: null, acceptance_ref: null }], edges: [] } } }]
  if (execution) records.push(
    { kind: 'execution_run', value: { graph_run_id: 'run1', revision: '1', state: 'running', reason: null, snapshot_ref: ref, budget_refs: ['budget'], decision_refs: [] } },
    { kind: 'execution_member', value: { graph_run_id: 'run1', member_id: 'requester', revision: '1', label: 'Reviewer', bot: null, duty: 'review', model_binding_ref: ref, base_snapshot_ref: ref, communication_targets: ['responder'] } },
    { kind: 'execution_member', value: { graph_run_id: 'run1', member_id: 'responder', revision: '1', label: 'Researcher', bot: null, duty: 'research', model_binding_ref: ref, base_snapshot_ref: ref, communication_targets: [] } },
    { kind: 'execution_invocation', value: { graph_run_id: 'run1', node_id: 'program', invocation_id: 'invocation', revision: '1', member_id: null, kind: 'program', origin: 'executed', iteration: 0, scope_id: 'root', parent_invocation_id: null, state: 'running', selected_outcome: null, input_refs: [], upstream_attempt_ids: [], wait_reason: null, current_attempt_id: 'attempt' } },
    { kind: 'execution_attempt', value: { graph_run_id: 'run1', attempt_id: 'attempt', invocation_id: 'invocation', revision: '1', number: 1, executor_kind: 'program', state: 'running', execution_ref: 'execution', result_ref: null, job: null } },
    { kind: 'execution_conversation', value: { graph_run_id: 'run1', conversation_id: 'conversation', revision: '1', requester_member: 'requester', responder_member: 'responder', state: 'active', remaining_rounds: 2, deadline: new Date(Date.now() + 60000).toISOString(), content_ref: 'protected-content', message_refs: ['protected-message'] } },
    { kind: 'execution_budget', value: { graph_run_id: 'run1', budget_id: 'budget', revision: '1', scope_key: 'run', limit: 10, consumed: 3 } },
  )
  const envelope = { protocol: GRAPH_WIRE_PROTOCOL, in_reply_to: null, subscription_id: subscriptionId }
  const cursor = { journal_id: 'journal', seq: '1' }
  const frames: GraphWireSourceFrame[] = [
    { ...envelope, type: 'subscription', scope_id: 'scope', mode: 'live', sources: [source], authorized_at: instant, authorization_expires_at: new Date(now + 60000).toISOString() },
    { ...envelope, type: 'snapshot.begin', source_id: 'local', snapshot_id: 'snapshot', cursor, page_count: 1 },
    { ...envelope, type: 'snapshot.page', source_id: 'local', snapshot_id: 'snapshot', cursor, page: 1, records },
    { ...envelope, type: 'snapshot.end', source_id: 'local', snapshot_id: 'snapshot', cursor },
    { ...envelope, type: 'source.ready', source_id: 'local', cursor },
  ]
  return { source, records, frames }
}
