import { database, one } from './database.js'
import { ingestProjectMemory, supermemoryEnabled } from './supermemory-service.js'
import { extractMaterialChunks, type MaterialFile } from './material-indexer.js'
import { executeQueuedReproductionRun } from './reproduction-service.js'
import { executeWorkflowCapability } from './project-workflow/capabilities.js'
import { appendWorkflowEvent } from './project-workflow/event-store.js'
import type { WorkflowTaskInput } from './project-workflow/capabilities.js'
import { ApiError } from './http.js'

type Task = {
  id: string
  project_id: string
  kind: string
  payload: Record<string, unknown>
  attempts: number
  max_attempts: number
  idempotency_key: string
  workflow_definition_version: number | null
  workflow_node_id: string | null
  workflow_node_run_id: string | null
  workflow_trigger_event_id: string | null
  workflow_correlation_id: string | null
  workflow_concurrency: string | null
  workflow_thread_key: string | null
  worker_id: string | null
  cancel_requested: boolean
}

type NodeRunUpdate = {
  id: string
  project_id: string
  correlation_id: string
  node_id: string
  definition_version: number
}

async function claim(workerId: string): Promise<Task | null> {
  const token = crypto.randomUUID().replaceAll('-', '')
  return one<Task>(`UPDATE tasks SET status='running',attempts=attempts+1,lease_token=$1,leased_until=NOW()+INTERVAL '2 minutes',worker_id=$2,heartbeat_until=NOW()+INTERVAL '1 minute',updated_at=NOW()
    WHERE id=(
      SELECT candidate.id FROM tasks candidate
      WHERE candidate.status IN ('queued','retrying')
        AND candidate.cancel_requested=FALSE
        AND candidate.next_attempt_at<=NOW()
        AND (candidate.leased_until IS NULL OR candidate.leased_until<NOW())
        AND NOT EXISTS (
          SELECT 1 FROM tasks running
          WHERE running.status='running'
            AND running.workflow_node_run_id IS NOT NULL
            AND running.project_id=candidate.project_id
            AND (
              candidate.workflow_concurrency='project-serial'
              OR (candidate.workflow_concurrency='thread-serial'
                  AND (running.workflow_concurrency='project-serial'
                       OR (running.workflow_concurrency='thread-serial'
                           AND running.workflow_thread_key=candidate.workflow_thread_key)))
            )
        )
      ORDER BY candidate.created_at LIMIT 1
    )
    RETURNING *`, [token, workerId])
}

async function markTaskSucceeded(task: Task): Promise<void> {
  const current = await one<{ cancel_requested: boolean }>('SELECT cancel_requested FROM tasks WHERE id=$1', [task.id])
  if (current?.cancel_requested) {
    await database.query("UPDATE tasks SET status='cancelled',lease_token=NULL,leased_until=NULL,heartbeat_until=NULL,updated_at=NOW() WHERE id=$1", [task.id])
    return
  }
  await database.query("UPDATE tasks SET status='succeeded',lease_token=NULL,leased_until=NULL,heartbeat_until=NULL,updated_at=NOW() WHERE id=$1", [task.id])
}

async function markNodeRunRunning(task: Task): Promise<void> {
  if (!task.workflow_node_run_id) return
  await database.query(
    `UPDATE workflow_node_runs
     SET status='running',worker_id=$2,started_at=COALESCE(started_at,NOW()),updated_at=NOW()
     WHERE id=$1 AND status NOT IN ('succeeded','failed','cancelled')`,
    [task.workflow_node_run_id, task.worker_id],
  )
}

async function markNodeRunSucceeded(task: Task, output: unknown): Promise<void> {
  if (!task.workflow_node_run_id) return
  const current = await one<{ cancel_requested: boolean }>('SELECT cancel_requested FROM tasks WHERE id=$1', [task.id])
  if (current?.cancel_requested) {
    await database.query(
      `UPDATE workflow_node_runs
       SET status='cancelled',error_code='cancelled',blocked_reason='用户取消任务',worker_id=NULL,started_at=COALESCE(started_at,NOW()),finished_at=NOW(),updated_at=NOW()
       WHERE id=$1`,
      [task.workflow_node_run_id],
    )
    await appendWorkflowEvent(task.project_id, 'workflow.task.cancelled', {
      payload: { task_id: task.id, node_run_id: task.workflow_node_run_id, node_id: task.workflow_node_id },
      source: 'task-worker',
      correlation_id: `cancel:${task.id}`,
      idempotency_key: `workflow-task-cancelled:${task.id}`,
      causation_id: task.workflow_trigger_event_id,
      ...(task.workflow_definition_version ? { definition_version: task.workflow_definition_version } : {}),
    })
    return
  }
  const run = await one<NodeRunUpdate>(
    `SELECT id,project_id,correlation_id,node_id,definition_version FROM workflow_node_runs
     WHERE id=$1 AND project_id=$2`,
    [task.workflow_node_run_id, task.project_id],
  )
  if (!run) return
  await database.query(
    `UPDATE workflow_node_runs
     SET status='succeeded',output_ref=$2::jsonb,worker_id=NULL,started_at=COALESCE(started_at,NOW()),finished_at=NOW(),updated_at=NOW()
     WHERE id=$1`,
    [run.id, JSON.stringify(output ?? null)],
  )
  await appendWorkflowEvent(run.project_id, 'workflow.task.completed', {
    payload: {
      task_id: task.id,
      node_run_id: run.id,
      node_id: run.node_id,
      output_ref: output ?? null,
    },
    source: 'task-worker',
    correlation_id: run.correlation_id,
    idempotency_key: `workflow-task-completed:${task.id}`,
    causation_id: task.workflow_trigger_event_id,
    definition_version: run.definition_version,
  })
}

async function markNodeRunFailed(task: Task, code: string, reason: string, terminal: boolean): Promise<void> {
  if (!task.workflow_node_run_id) return
  const run = await one<NodeRunUpdate>(
    `SELECT id,project_id,correlation_id,node_id,definition_version FROM workflow_node_runs
     WHERE id=$1 AND project_id=$2`,
    [task.workflow_node_run_id, task.project_id],
  )
  if (!run) return
  await database.query(
    `UPDATE workflow_node_runs
     SET status=$2,error_code=$3,blocked_reason=$4,worker_id=NULL,started_at=COALESCE(started_at,NOW()),finished_at=CASE WHEN $5 THEN NOW() ELSE finished_at END,updated_at=NOW()
     WHERE id=$1`,
    [run.id, terminal ? 'failed' : 'running', code, reason, terminal],
  )
  if (terminal) {
    await appendWorkflowEvent(run.project_id, 'workflow.task.failed', {
      payload: {
        task_id: task.id,
        node_run_id: run.id,
        node_id: run.node_id,
        error_code: code,
      },
      source: 'task-worker',
      correlation_id: run.correlation_id,
      idempotency_key: `workflow-task-failed:${task.id}`,
      causation_id: task.workflow_trigger_event_id,
      definition_version: run.definition_version,
    })
  }
}

async function runWorkflowNodeTask(task: Task): Promise<void> {
  if (!task.workflow_node_id || !task.workflow_node_run_id) throw new Error('workflow_node_metadata_missing')
  const input = task.payload as WorkflowTaskInput
  const capability = task.payload.capability
  if (typeof capability !== 'string') throw new Error('workflow_capability_missing')
  const node = await one<{ capability: string }>('SELECT capability FROM workflow_node_runs WHERE id=$1', [task.workflow_node_run_id])
  if (!node) throw new Error('workflow_node_run_not_found')
  const output = await executeWorkflowCapability(node.capability as Parameters<typeof executeWorkflowCapability>[0], task.project_id, task.id, input)
  await markNodeRunSucceeded(task, output)
  await markTaskSucceeded(task)
}

async function runTask(task: Task): Promise<void> {
  if (task.kind === 'workflow_node_task') {
    await runWorkflowNodeTask(task)
    return
  }
  if (task.kind === 'material_index') {
    if (!supermemoryEnabled()) throw new Error('supermemory_not_configured')
    const uploadedFileId = typeof task.payload.uploaded_file_id === 'string' ? task.payload.uploaded_file_id : ''
    const file = await one<Record<string, unknown>>('SELECT * FROM uploaded_files WHERE id=$1 AND project_id=$2', [uploadedFileId, task.project_id])
    if (!file) throw new Error('uploaded_file_not_found')
    const extracted = await extractMaterialChunks(file as MaterialFile)
    let indexed = 0
    if (extracted.raw_upload) {
      await ingestProjectMemory(task.project_id, {
        source_type: 'artifact', source_id: null, artifact_id: null, uploaded_file_id: uploadedFileId,
        content: null, source_url: null, quote: null, locator: null,
        metadata: { task_id: task.id, parse_status: extracted.parse_status, evidence_status: 'untrusted_uploaded_material' },
        task_type: 'memory', idempotency_key: `material-index:${uploadedFileId}:raw`,
      })
      indexed += 1
    }
    for (const chunk of extracted.chunks) {
      await ingestProjectMemory(task.project_id, {
        source_type: 'artifact', source_id: null, artifact_id: null, uploaded_file_id: uploadedFileId,
        content: chunk.content, source_url: null, quote: chunk.content, locator: chunk.locator,
        metadata: { task_id: task.id, chunk_index: chunk.index, parse_status: extracted.parse_status, content_sha256: chunk.content_sha256, evidence_status: 'untrusted_uploaded_material' },
        task_type: 'superrag', idempotency_key: `material-index:${uploadedFileId}:chunk:${chunk.content_sha256}`,
      })
      indexed += 1
    }
    await database.query('UPDATE uploaded_files SET metadata=$2 WHERE id=$1 AND project_id=$3', [uploadedFileId, { ...((file.metadata || {}) as Record<string, unknown>), semantic_index_status: 'active', semantic_index_task_id: task.id, semantic_indexed_items: indexed, parse_status: extracted.parse_status }, task.project_id])
    return
  }
  if (task.kind === 'repository_reproduction_run') {
    const runId = typeof task.payload.reproduction_run_id === 'string' ? task.payload.reproduction_run_id : ''
    if (!runId) throw new Error('reproduction_run_id_missing')
    await executeQueuedReproductionRun(runId)
    return
  }
  if (task.kind === 'research_bootstrap') {
    throw new Error('legacy_research_bootstrap_removed_in_workflow_v2')
  }
  throw new Error('task_kind_not_allowlisted')
}

async function tick(workerId: string): Promise<void> {
  const task = await claim(workerId)
  if (!task) return
  await markNodeRunRunning(task)
  try {
    await runTask(task)
    await markTaskSucceeded(task)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'task_failed'
    if (task.kind === 'material_index') {
      const uploadedFileId = typeof task.payload.uploaded_file_id === 'string' ? task.payload.uploaded_file_id : ''
      const file = uploadedFileId ? await one<Record<string, unknown>>('SELECT metadata FROM uploaded_files WHERE id=$1 AND project_id=$2', [uploadedFileId, task.project_id]) : null
      if (file) await database.query('UPDATE uploaded_files SET metadata=$2 WHERE id=$1 AND project_id=$3', [uploadedFileId, { ...((file.metadata || {}) as Record<string, unknown>), semantic_index_status: 'failed', semantic_index_error: message, semantic_index_task_id: task.id }, task.project_id])
    }
    const terminal = task.attempts >= task.max_attempts
    if (task.kind === 'workflow_node_task') {
      const code = error instanceof ApiError ? error.code : message
      const reason = error instanceof ApiError ? error.message : message
      await markNodeRunFailed(task, code, reason, terminal)
    }
    const delay = Math.min(300, 5 * 2 ** Math.max(0, task.attempts - 1))
    await database.query(`UPDATE tasks SET status=$2,error=$3,lease_token=NULL,leased_until=NULL,worker_id=NULL,heartbeat_until=NULL,next_attempt_at=NOW()+($4::text||' seconds')::interval,updated_at=NOW() WHERE id=$1`, [task.id, terminal ? 'failed' : 'retrying', message, String(delay)])
  }
}

export async function recoverInterruptedWork(): Promise<void> {
  await database.query("UPDATE tasks SET status='retrying',leased_until=NULL,lease_token=NULL,worker_id=NULL,heartbeat_until=NULL,next_attempt_at=NOW(),error='native_process_restarted' WHERE status='running'")
  await database.query("UPDATE workflow_node_runs SET status='queued',worker_id=NULL,error_code='native_process_restarted',updated_at=NOW() WHERE status='running'")
  await database.query("UPDATE experiments SET status='failed',error='native_process_restarted',finished_at=NOW() WHERE status IN ('queued','running')")
  await database.query("UPDATE reproduction_runs SET status='failed',error='native_process_restarted',finished_at=NOW() WHERE status='running'")
  await database.query("UPDATE related_work_recursive_runs SET status='cancelled',finished_at=NOW(),error='cancelled_after_restart' WHERE status='running' AND cancel_requested=TRUE")
  await database.query("UPDATE related_work_recursive_runs SET status='queued',started_at=NULL,finished_at=NULL,error='native_process_restarted' WHERE status='running' AND cancel_requested=FALSE")
}

export type TaskWorkerHandle = { stop(): void }

export function startTaskWorker(options?: { concurrency?: number }): TaskWorkerHandle {
  const concurrency = Math.max(1, Math.min(32, options?.concurrency ?? Number(process.env.RESEARCH_TASK_WORKER_CONCURRENCY || 4)))
  const running = new Set<ReturnType<typeof setInterval>>()
  const workers = new Set<Promise<void>>()
  let stopped = false
  for (let index = 0; index < concurrency; index += 1) {
    const workerId = `worker-${process.pid}-${index}-${crypto.randomUUID().slice(0, 6)}`
    const worker = (async () => {
      while (!stopped) {
        try {
          await tick(workerId)
        } catch (error) {
          await database.query('UPDATE tasks SET status=$2,error=$3 WHERE status=\'running\' AND worker_id=$1', [workerId, 'retrying', error instanceof Error ? error.message : String(error)])
            .catch(innerError => console.error('workflow task worker recovery failed', innerError))
        }
        await new Promise(resolve => setTimeout(resolve, 250))
      }
    })()
    workers.add(worker)
  }
  const heartbeat = setInterval(() => {
    void database.query("UPDATE tasks SET leased_until=NOW()+INTERVAL '2 minutes',heartbeat_until=NOW() WHERE status='running' AND worker_id IS NOT NULL")
      .catch(error => console.error('workflow task heartbeat failed', error))
  }, 30_000)
  running.add(heartbeat)
  return {
    stop() {
      stopped = true
      clearInterval(heartbeat)
      running.clear()
    },
  }
}
