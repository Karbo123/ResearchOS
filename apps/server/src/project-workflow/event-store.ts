import { database, one } from '../database.js'
import type { WorkflowEvent, WorkflowEventAppendInput, WorkflowEventType } from './contracts.js'
import { dispatchProject } from './coordinator.js'

export type AppendEventOptions = {
  payload?: Record<string, unknown>
  source?: string
  correlation_id?: string
  idempotency_key?: string
  causation_id?: string | null
  definition_version?: number
}

export async function appendWorkflowEvent(
  projectId: string,
  eventType: WorkflowEventType,
  options: AppendEventOptions = {},
): Promise<WorkflowEvent> {
  const runtime = await one<{ active_definition_version: number; status: string }>(
    'SELECT active_definition_version,status FROM project_workflow_runtime WHERE project_id=$1',
    [projectId],
  )
  if (!runtime || runtime.active_definition_version < 1) throw new Error('workflow_runtime_not_initialized')
  const correlationId = options.correlation_id || `${eventType}:${crypto.randomUUID()}`
  const idempotencyKey = options.idempotency_key || `event:${eventType}:${correlationId}`
  if (options.idempotency_key) {
    const existing = await one<WorkflowEvent>('SELECT * FROM workflow_events WHERE project_id=$1 AND idempotency_key=$2', [projectId, options.idempotency_key])
    if (existing) return existing
  }
  const event = await database.transaction(async transaction => {
    const sequenceRow = (await transaction.query<{ next: number }>('SELECT COALESCE(MAX(sequence),0)+1 AS next FROM workflow_events WHERE project_id=$1', [projectId])).rows[0]
    const sequence = sequenceRow?.next || 1
    const id = crypto.randomUUID()
    const inserted = (await transaction.query<WorkflowEvent>(
      `INSERT INTO workflow_events(id,project_id,sequence,event_type,payload,source,definition_version,causation_id,correlation_id,idempotency_key)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10) RETURNING *`,
      [
        id,
        projectId,
        sequence,
        eventType,
        JSON.stringify(options.payload || {}),
        options.source || 'api',
        options.definition_version ?? runtime.active_definition_version,
        options.causation_id ?? null,
        correlationId,
        idempotencyKey,
      ],
    )).rows[0]
    if (!inserted) throw new Error('workflow_event_insert_failed')
    return inserted
  })
  await dispatchProject(projectId)
  return event
}

export async function appendWorkflowEventFromInput(projectId: string, input: WorkflowEventAppendInput): Promise<WorkflowEvent> {
  const options: AppendEventOptions = {
    payload: input.payload,
    source: input.source,
  }
  if (input.correlation_id) options.correlation_id = input.correlation_id
  if (input.idempotency_key) options.idempotency_key = input.idempotency_key
  return appendWorkflowEvent(projectId, input.event_type, options)
}

export async function listWorkflowEvents(projectId: string, limit = 200): Promise<WorkflowEvent[]> {
  return (await database.query<WorkflowEvent>(
    'SELECT * FROM workflow_events WHERE project_id=$1 ORDER BY sequence DESC LIMIT $2',
    [projectId, limit],
  )).rows
}
