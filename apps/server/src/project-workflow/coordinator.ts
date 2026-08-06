import { database, one } from '../database.js'
import { projectWorkflowDefinitionV2Schema, type ProjectWorkflowDefinitionV2, type WorkflowEvent, type WorkflowNode } from './contracts.js'

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

type NodeRunRow = {
  id: string
  project_id: string
  node_id: string
  node_run_id: string
  definition_version: number
  trigger_event_id: string
  correlation_id: string
  status: string
  attempt: number
  input_ref: Record<string, unknown>
  output_ref: Record<string, unknown> | null
  blocked_reason: string | null
  error_code: string | null
  started_at: string | null
  finished_at: string | null
  task_id: string | null
  worker_id: string | null
  created_at: string
  updated_at: string
}

type Transaction = {
  query<T extends object>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount?: number }>
}

type QueryExecutor = {
  query<T extends object>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount?: number }>
}

async function activeDefinition(projectId: string, executor: QueryExecutor = database): Promise<ProjectWorkflowDefinitionV2 | null> {
  const row = (await executor.query<{ graph_json: unknown }>(
    `SELECT d.graph_json
     FROM workflow_definitions d
     JOIN project_workflow_runtime r ON r.active_definition_version=d.version
     WHERE d.project_id=$1 AND d.status='active'`,
    [projectId],
  )).rows[0]
  if (!row) return null
  return projectWorkflowDefinitionV2Schema.safeParse(row.graph_json).success
    ? projectWorkflowDefinitionV2Schema.parse(row.graph_json)
    : null
}

async function nodeRun(transaction: Transaction, projectId: string, correlationId: string, nodeId: string, version: number): Promise<NodeRunRow | null> {
  const row = (await transaction.query<NodeRunRow>(
    `SELECT * FROM workflow_node_runs
     WHERE project_id=$1 AND correlation_id=$2 AND node_id=$3 AND definition_version=$4`,
    [projectId, correlationId, nodeId, version],
  )).rows[0]
  return row ?? null
}

async function insertNodeRun(
  transaction: Transaction,
  event: WorkflowEvent,
  projectId: string,
  definition: ProjectWorkflowDefinitionV2,
  node: WorkflowNode,
  blockedReason: string | null,
  inputPayload: Record<string, unknown> = event.payload,
): Promise<NodeRunRow> {
  const existing = await nodeRun(transaction, projectId, event.correlation_id, node.id, event.definition_version)
  if (existing) return existing
  const id = crypto.randomUUID()
  const status = blockedReason ? 'blocked' : 'queued'
  const inserted = (await transaction.query<NodeRunRow>(
    `INSERT INTO workflow_node_runs(
      id,project_id,node_id,node_run_id,definition_version,trigger_event_id,correlation_id,status,input_ref,blocked_reason,capability,updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,NOW()) RETURNING *`,
    [
      id,
      projectId,
      node.id,
      id,
      event.definition_version,
      event.id,
      event.correlation_id,
      status,
      JSON.stringify({ event_type: event.event_type, payload: inputPayload }),
      blockedReason,
      node.capability,
    ],
  )).rows[0]
  if (!inserted) throw new Error('workflow_node_run_insert_failed')
  if (!blockedReason) await queueNodeTask(transaction, event, projectId, node, id, inputPayload)
  return inserted
}

async function queueNodeTask(
  transaction: Transaction,
  event: WorkflowEvent,
  projectId: string,
  node: WorkflowNode,
  nodeRunId: string,
  inputPayload: Record<string, unknown>,
): Promise<void> {
  const retry = node.retry === 'explicit' ? { max_attempts: 3, backoff_seconds: 5 } : node.retry
  const taskId = crypto.randomUUID()
  const taskIdempotencyKey = `workflow-node:${projectId}:${event.correlation_id}:${node.id}:${event.definition_version}`
  const threadKey = node.concurrency === 'thread-serial'
    ? typeof inputPayload.session_id === 'string' && inputPayload.session_id
      ? inputPayload.session_id
      : event.correlation_id
    : null
  await transaction.query(
    `INSERT INTO tasks(
      id,project_id,kind,status,payload,idempotency_key,max_attempts,workflow_definition_version,
      workflow_node_id,workflow_node_run_id,workflow_trigger_event_id,workflow_correlation_id,
      workflow_concurrency,workflow_thread_key,created_at,updated_at
     ) VALUES ($1,$2,'workflow_node_task','queued',$3::jsonb,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW())
     ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
    [
      taskId,
      projectId,
      JSON.stringify({
        workflow: {
          project_id: projectId,
          node_id: node.id,
          node_run_id: nodeRunId,
          definition_version: event.definition_version,
          trigger_event_id: event.id,
          correlation_id: event.correlation_id,
        },
        capability: node.capability,
        input: inputPayload,
      }),
      taskIdempotencyKey,
      retry.max_attempts,
      event.definition_version,
      node.id,
      nodeRunId,
      event.id,
      event.correlation_id,
      node.concurrency,
      threadKey,
    ],
  )
  await transaction.query('UPDATE workflow_node_runs SET task_id=$2,updated_at=NOW() WHERE id=$1', [nodeRunId, taskId])
}

async function ensureNodeReady(
  transaction: Transaction,
  event: WorkflowEvent,
  definition: ProjectWorkflowDefinitionV2,
  nodeId: string,
  stack: Set<string>,
  inputPayload: Record<string, unknown> = event.payload,
): Promise<void> {
  if (stack.has(nodeId)) throw new Error(`workflow_dependency_cycle_${nodeId}`)
  const node = definition.nodes.find(candidate => candidate.id === nodeId)
  if (!node) return
  const existing = await nodeRun(transaction, event.project_id, event.correlation_id, nodeId, event.definition_version)
  if (existing && ['succeeded', 'failed', 'cancelled'].includes(existing.status)) return
  if (existing && ['queued', 'running', 'waiting_approval'].includes(existing.status)) return

  const dependencyIds = [
    ...node.requires,
    ...definition.edges.filter(edge => edge.to === node.id).map(edge => edge.from),
  ]
  stack.add(nodeId)
  let blockedReason: string | null = null
  for (const dependencyId of dependencyIds) {
    await ensureNodeReady(transaction, event, definition, dependencyId, stack, inputPayload)
    const dependencyRun = await nodeRun(transaction, event.project_id, event.correlation_id, dependencyId, event.definition_version)
    if (!dependencyRun || !['succeeded'].includes(dependencyRun.status)) {
      blockedReason = `workflow_dependency_not_ready_${dependencyId}_${dependencyRun?.status || 'missing'}`
      break
    }
  }
  stack.delete(nodeId)
  if (blockedReason) {
    if (existing?.status === 'blocked') {
      await transaction.query('UPDATE workflow_node_runs SET blocked_reason=$2,updated_at=NOW() WHERE id=$1', [existing.id, blockedReason])
    }
    return
  }
  if (existing?.status === 'blocked') {
    await transaction.query(
      `UPDATE workflow_node_runs SET status='queued',blocked_reason=NULL,updated_at=NOW() WHERE id=$1`,
      [existing.id],
    )
    await queueNodeTask(transaction, event, event.project_id, node, existing.id, inputPayload)
    return
  }
  await insertNodeRun(transaction, event, event.project_id, definition, node, null, inputPayload)
}

async function dispatchDownstream(
  transaction: Transaction,
  definition: ProjectWorkflowDefinitionV2,
  event: WorkflowEvent,
  completedNodeId: string,
): Promise<void> {
  const downstreamIds = new Set<string>()
  for (const edge of definition.edges) {
    if (edge.from === completedNodeId) downstreamIds.add(edge.to)
  }
  for (const node of definition.nodes) {
    if (node.requires.includes(completedNodeId)) downstreamIds.add(node.id)
  }
  const completedRun = await nodeRun(transaction, event.project_id, event.correlation_id, completedNodeId, event.definition_version)
  const completedInput = completedRun?.input_ref as { payload?: Record<string, unknown> } | null
  const inputPayload = completedInput?.payload && typeof completedInput.payload === 'object' && !Array.isArray(completedInput.payload)
    ? completedInput.payload
    : event.payload
  for (const nodeId of downstreamIds) {
    await ensureNodeReady(transaction, event, definition, nodeId, new Set(), inputPayload)
  }
}

async function dispatchEvent(transaction: Transaction, definition: ProjectWorkflowDefinitionV2, event: WorkflowEvent): Promise<void> {
  const matchingTriggers = definition.triggers.filter(trigger => trigger.event_type === event.event_type)
  if (matchingTriggers.length) {
    for (const trigger of matchingTriggers) {
      await ensureNodeReady(transaction, event, definition, trigger.node_id, new Set(), event.payload)
    }
    return
  }
  if (event.event_type === 'workflow.task.completed') {
    const completedNodeId = typeof event.payload.node_id === 'string' ? event.payload.node_id : null
    if (completedNodeId) await dispatchDownstream(transaction, definition, event, completedNodeId)
  }
}

export async function dispatchProject(projectId: string): Promise<boolean> {
  const runtime = await one<RuntimeRow>('SELECT * FROM project_workflow_runtime WHERE project_id=$1', [projectId])
  if (!runtime) return false
  if (runtime.status === 'paused' || runtime.status === 'failed') return false
  const token = crypto.randomUUID().replaceAll('-', '')
  const lease = await database.query<{ project_id: string }>(
    `UPDATE project_workflow_runtime
     SET status='dispatching',coordinator_lease_token=$2,lease_until=NOW()+INTERVAL '30 seconds',state_version=state_version+1,updated_at=NOW()
     WHERE project_id=$1 AND status<>'paused' AND (lease_until IS NULL OR lease_until<NOW())
     RETURNING project_id`,
    [projectId, token],
  )
  if (!lease.rows.length) return false
  try {
    await database.transaction(async transaction => {
      const definition = await activeDefinition(projectId, transaction)
      if (!definition) throw new Error('workflow_active_definition_missing')
      const pendingEvents = (await transaction.query<WorkflowEvent>(
        'SELECT * FROM workflow_events WHERE project_id=$1 AND processed_at IS NULL ORDER BY sequence',
        [projectId],
      )).rows
      for (const event of pendingEvents) {
        await dispatchEvent(transaction, definition, event)
        await transaction.query('UPDATE workflow_events SET processed_at=NOW() WHERE id=$1', [event.id])
      }
      await transaction.query(
        `UPDATE project_workflow_runtime
         SET event_cursor=event_cursor+$2,status='waiting',coordinator_lease_token=NULL,lease_until=NULL,updated_at=NOW()
         WHERE project_id=$1`,
        [projectId, pendingEvents.length],
      )
    })
    return true
  } catch (error) {
    await database.query(
      `UPDATE project_workflow_runtime
       SET status='failed',coordinator_lease_token=NULL,lease_until=NULL,last_error=$2,updated_at=NOW()
       WHERE project_id=$1`,
      [projectId, error instanceof Error ? error.message : String(error)],
    )
    throw error
  }
}

export async function workflowRuntime(projectId: string): Promise<RuntimeRow | null> {
  return one<RuntimeRow>('SELECT * FROM project_workflow_runtime WHERE project_id=$1', [projectId])
}
