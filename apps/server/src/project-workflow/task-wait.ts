import { one } from '../database.js'
import { ApiError } from '../http.js'
import type { AppendEventOptions } from './event-store.js'
import { appendWorkflowEvent } from './event-store.js'
import type { WorkflowEventType } from './contracts.js'

type NodeRunResult = {
  id: string
  node_id: string
  status: string
  output_ref: Record<string, unknown> | null
  error_code: string | null
  blocked_reason: string | null
  correlation_id: string
}

const NODE_ERROR_STATUS: Record<string, 409 | 422 | 502> = {
  report_no_events: 409,
  spec_field_unconfirmed: 409,
  paper_experiments_valid_artifacts_required: 422,
}

export async function appendWorkflowEventAndWait(
  projectId: string,
  eventType: WorkflowEventType,
  options: AppendEventOptions & { target_node_id: string; timeout_ms?: number },
): Promise<unknown> {
  const correlationId = options.correlation_id || `${eventType}:${crypto.randomUUID()}`
  await appendWorkflowEvent(projectId, eventType, { ...options, correlation_id: correlationId })
  const deadline = Date.now() + (options.timeout_ms || 240_000)
  let last: NodeRunResult | null = null
  while (Date.now() < deadline) {
    const runtime = await one<{ active_definition_version: number }>('SELECT active_definition_version FROM project_workflow_runtime WHERE project_id=$1', [projectId])
    last = await one<NodeRunResult>(
      `SELECT id,node_id,status,output_ref,error_code,blocked_reason,correlation_id
       FROM workflow_node_runs
       WHERE project_id=$1 AND correlation_id=$2 AND node_id=$3 AND definition_version=$4`,
      [projectId, correlationId, options.target_node_id, runtime?.active_definition_version || 0],
    )
    if (!last) {
      await new Promise(resolve => setTimeout(resolve, 200))
      continue
    }
    if (last.status === 'succeeded') return last.output_ref ?? { ok: true }
    if (last.status === 'failed' || last.status === 'blocked') {
      const status = NODE_ERROR_STATUS[last.error_code || ''] || 502
      throw new ApiError(status, last.error_code || 'workflow_node_failed', last.blocked_reason || `节点 ${last.node_id} 执行失败。`)
    }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new ApiError(504, 'workflow_node_timeout', `节点 ${options.target_node_id} 在限定时间内未完成。`)
}
