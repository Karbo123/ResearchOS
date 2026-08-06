import { audit, database, one, rows } from '../database.js'
import { WorkflowDefinitionLoader, removeWorkflowDefinitionCache } from './definition-loader.js'
import { workflowRuntime, dispatchProject } from './coordinator.js'

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
