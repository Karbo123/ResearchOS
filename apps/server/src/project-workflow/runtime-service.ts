import { audit, database, one, rows } from '../database.js'
import { ApiError } from '../http.js'
import { WorkflowDefinitionLoader, removeWorkflowDefinitionCache } from './definition-loader.js'
import { workflowRuntime, dispatchProject } from './coordinator.js'
import { appendWorkflowEvent } from './event-store.js'

export async function initializeProjectWorkflow(projectId: string): Promise<void> {
  await new WorkflowDefinitionLoader().initializeProject(projectId)
}

export async function scanProjectWorkflow(projectId: string): Promise<void> {
  await new WorkflowDefinitionLoader().scanProject(projectId)
}

export async function pauseProjectWorkflow(projectId: string, reason: string): Promise<void> {
  await database.query(
    `UPDATE project_workflow_runtime SET status='paused',last_error=$2,updated_at=NOW() WHERE project_id=$1`,
    [projectId, reason],
  )
}

export async function resumeProjectWorkflow(projectId: string): Promise<void> {
  await database.query(
    `UPDATE project_workflow_runtime SET status='waiting',last_error=NULL,updated_at=NOW() WHERE project_id=$1`,
    [projectId],
  )
  await dispatchProject(projectId)
}

export async function deleteProjectWorkflow(projectId: string): Promise<void> {
  await database.query('DELETE FROM workflow_events WHERE project_id=$1', [projectId])
  await database.query('DELETE FROM workflow_node_runs WHERE project_id=$1', [projectId])
  await database.query('DELETE FROM workflow_definitions WHERE project_id=$1', [projectId])
  await database.query('DELETE FROM project_workflow_runtime WHERE project_id=$1', [projectId])
  await removeWorkflowDefinitionCache(projectId)
}

export async function recoverProjectWorkflowRuntimes(): Promise<void> {
  await database.query(
    `UPDATE project_workflow_runtime
     SET status='waiting',coordinator_lease_token=NULL,lease_until=NULL,updated_at=NOW()
     WHERE status='dispatching' AND (lease_until IS NULL OR lease_until<NOW())`,
  )
  const projects = await rows<{ id: string }>('SELECT id FROM projects')
  for (const project of projects) {
    try {
      await dispatchProject(project.id)
    } catch (error) {
      await audit('workflow_v2.recovery_dispatch_failed', project.id, {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

export async function projectWorkflowRuntime(projectId: string) {
  return workflowRuntime(projectId)
}

export async function listProjectWorkflowNodeRuns(projectId: string, limit = 200) {
  return rows('SELECT * FROM workflow_node_runs WHERE project_id=$1 ORDER BY created_at DESC LIMIT $2', [projectId, limit])
}

export async function listProjectWorkflowTasks(projectId: string, limit = 200) {
  return rows('SELECT * FROM tasks WHERE project_id=$1 AND workflow_node_run_id IS NOT NULL ORDER BY created_at DESC LIMIT $2', [projectId, limit])
}

export async function cancelProjectWorkflowTask(projectId: string, taskId: string): Promise<{ task_id: string; status: string }> {
  const task = await one<{ id: string; status: string; workflow_node_run_id: string | null }>(
    'SELECT id,status,workflow_node_run_id FROM tasks WHERE id=$1 AND project_id=$2 AND workflow_node_run_id IS NOT NULL',
    [taskId, projectId],
  )
  if (!task) throw new ApiError(404, 'workflow_task_not_found', '找不到该项目的工作流任务。')
  if (['succeeded', 'failed', 'cancelled'].includes(task.status)) {
    throw new ApiError(409, 'workflow_task_finished', `任务已结束，当前状态为 ${task.status}。`)
  }
  await database.query('UPDATE tasks SET cancel_requested=TRUE WHERE id=$1', [taskId])
  if (task.status === 'queued' || task.status === 'retrying') {
    await database.query(
      `UPDATE tasks SET status='cancelled',leased_until=NULL,lease_token=NULL,worker_id=NULL,error='cancelled_by_user',updated_at=NOW()
       WHERE id=$1`,
      [taskId],
    )
    if (task.workflow_node_run_id) {
      await database.query(
        `UPDATE workflow_node_runs SET status='cancelled',error_code='cancelled',blocked_reason='用户取消任务',finished_at=NOW(),updated_at=NOW()
         WHERE id=$1 AND status NOT IN ('succeeded','failed','cancelled')`,
        [task.workflow_node_run_id],
      )
    }
    await appendWorkflowEvent(projectId, 'workflow.task.cancelled', {
      payload: { task_id: taskId, node_run_id: task.workflow_node_run_id },
      source: 'api',
      correlation_id: `cancel:${taskId}`,
      idempotency_key: `workflow-task-cancelled:${taskId}`,
    })
  }
  return { task_id: taskId, status: 'cancelled' }
}
