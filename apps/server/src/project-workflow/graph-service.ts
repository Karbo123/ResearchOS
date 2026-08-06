import { database, one, rows } from '../database.js'
import { projectWorkflowDefinitionV2Schema, workflowGraphSnapshotSchema, type WorkflowGraphSnapshot } from './contracts.js'

type RuntimeRow = {
  project_id: string
  active_definition_version: number
  state_version: number
  event_cursor: number
  status: string
  coordinator_lease_token: string | null
  lease_until: string | null
  last_error: string | null
  updated_at: string
}

type DefinitionRow = {
  project_id: string
  version: number
  source_sha256: string
  git_commit: string | null
  graph_json: unknown
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return toIso(value)
}

export async function workflowGraphSnapshot(projectId: string): Promise<WorkflowGraphSnapshot> {
  const runtime = await one<RuntimeRow>('SELECT * FROM project_workflow_runtime WHERE project_id=$1', [projectId])
  if (!runtime) {
    return workflowGraphSnapshotSchema.parse({
      project_id: projectId,
      definition_version: 0,
      source_hash: '',
      git_commit: null,
      status: 'blocked',
      last_error: 'workflow_runtime_not_initialized',
      groups: [],
      nodes: [],
      edges: [],
      triggers: [],
      runtime: {
        status: 'blocked',
        state_version: 0,
        event_cursor: 0,
        coordinator_lease_token: null,
        lease_until: null,
        updated_at: new Date().toISOString(),
      },
      node_runs: [],
      tasks: [],
      events: [],
    })
  }
  const definition = await one<DefinitionRow>(
    'SELECT project_id,version,source_sha256,git_commit,graph_json FROM workflow_definitions WHERE project_id=$1 AND version=$2',
    [projectId, runtime.active_definition_version],
  )
  if (!definition) {
    return workflowGraphSnapshotSchema.parse({
      project_id: projectId,
      definition_version: runtime.active_definition_version,
      source_hash: '',
      git_commit: null,
      status: runtime.status,
      last_error: runtime.last_error || 'workflow_active_definition_missing',
      groups: [],
      nodes: [],
      edges: [],
      triggers: [],
      runtime: {
        status: runtime.status,
        state_version: runtime.state_version,
        event_cursor: runtime.event_cursor,
        coordinator_lease_token: runtime.coordinator_lease_token,
        lease_until: toIsoOrNull(runtime.lease_until),
        updated_at: toIso(runtime.updated_at),
      },
      node_runs: [],
      tasks: [],
      events: [],
    })
  }
  const parsed = projectWorkflowDefinitionV2Schema.parse(definition.graph_json)
  const [nodeRuns, tasks, events] = await Promise.all([
    rows<Record<string, unknown>>('SELECT * FROM workflow_node_runs WHERE project_id=$1 ORDER BY created_at DESC LIMIT 200', [projectId]),
    rows<Record<string, unknown>>('SELECT * FROM tasks WHERE project_id=$1 AND workflow_node_run_id IS NOT NULL ORDER BY created_at DESC LIMIT 200', [projectId]),
    rows<Record<string, unknown>>('SELECT sequence,event_type,correlation_id,source,definition_version,created_at FROM workflow_events WHERE project_id=$1 ORDER BY sequence DESC LIMIT 100', [projectId]),
  ])
  return workflowGraphSnapshotSchema.parse({
    project_id: projectId,
    definition_version: definition.version,
    source_hash: definition.source_sha256,
    git_commit: definition.git_commit,
    status: runtime.status,
    last_error: runtime.last_error,
    groups: parsed.groups,
    nodes: parsed.nodes,
    edges: parsed.edges,
    triggers: parsed.triggers,
      runtime: {
        status: runtime.status,
        state_version: runtime.state_version,
        event_cursor: runtime.event_cursor,
        coordinator_lease_token: runtime.coordinator_lease_token,
        lease_until: toIsoOrNull(runtime.lease_until),
        updated_at: toIso(runtime.updated_at),
      },
    node_runs: nodeRuns.map(run => ({
      id: run.id,
      node_id: run.node_id,
      correlation_id: run.correlation_id,
      status: run.status,
      attempt: run.attempt,
      error_code: run.error_code,
      blocked_reason: run.blocked_reason,
      started_at: toIsoOrNull(run.started_at),
      finished_at: toIsoOrNull(run.finished_at),
      created_at: toIso(run.created_at),
      updated_at: toIso(run.updated_at),
      input_ref: (run.input_ref as Record<string, unknown> | null) ?? null,
      output_ref: (run.output_ref as Record<string, unknown> | null) ?? null,
      task_id: run.task_id,
      definition_version: run.definition_version,
    })),
    tasks: tasks.map(task => ({
      id: task.id,
      node_id: task.workflow_node_id,
      status: task.status,
      attempts: task.attempts,
      error: task.error,
      worker_id: task.worker_id,
      created_at: toIso(task.created_at),
      updated_at: toIso(task.updated_at),
    })),
    events: events.map(event => ({
      sequence: event.sequence,
      event_type: event.event_type,
      correlation_id: event.correlation_id,
      source: event.source,
      definition_version: event.definition_version,
      created_at: toIso(event.created_at),
    })),
  })
}
