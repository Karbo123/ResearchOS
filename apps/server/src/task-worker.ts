import { database, one } from './database.js'
import { ingestProjectMemory, supermemoryEnabled } from './supermemory-service.js'
import { extractMaterialChunks, type MaterialFile } from './material-indexer.js'
import { executeQueuedReproductionRun } from './reproduction-service.js'

type Task = { id: string; project_id: string; kind: string; payload: Record<string, unknown>; attempts: number; max_attempts: number; idempotency_key: string }
let working = false

async function claim(): Promise<Task | null> {
  const token = crypto.randomUUID().replaceAll('-', '')
  const task = await one<Task>(`UPDATE tasks SET status='running',attempts=attempts+1,lease_token=$1,leased_until=NOW()+INTERVAL '2 minutes',updated_at=NOW()
    WHERE id=(SELECT id FROM tasks WHERE status IN ('queued','retrying') AND next_attempt_at<=NOW() AND (leased_until IS NULL OR leased_until<NOW()) ORDER BY created_at LIMIT 1)
    RETURNING *`, [token])
  return task
}

async function runTask(task: Task): Promise<void> {
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
  if (task.kind !== 'research_bootstrap') throw new Error('task_kind_not_allowlisted')
  const response = await fetch(`${(process.env.MASTRA_BASE_URL || 'http://127.0.0.1:4111').replace(/\/$/, '')}/internal/workflows/project/${task.project_id}/run`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'research_bootstrap', project_id: task.project_id, task_id: task.id, idempotency_key: task.idempotency_key }), signal: AbortSignal.timeout(120_000),
  })
  if (!response.ok) throw new Error(`workflow_http_${response.status}`)
}

async function tick(): Promise<void> {
  if (working) return
  working = true
  try {
    const task = await claim()
    if (!task) return
    try {
      await runTask(task)
      await database.query("UPDATE tasks SET status='succeeded',lease_token=NULL,leased_until=NULL,updated_at=NOW() WHERE id=$1", [task.id])
    } catch (error) {
      const message = error instanceof Error ? error.message : 'task_failed'
      if (task.kind === 'material_index') {
        const uploadedFileId = typeof task.payload.uploaded_file_id === 'string' ? task.payload.uploaded_file_id : ''
        const file = uploadedFileId ? await one<Record<string, unknown>>('SELECT metadata FROM uploaded_files WHERE id=$1 AND project_id=$2', [uploadedFileId, task.project_id]) : null
        if (file) await database.query('UPDATE uploaded_files SET metadata=$2 WHERE id=$1 AND project_id=$3', [uploadedFileId, { ...((file.metadata || {}) as Record<string, unknown>), semantic_index_status: 'failed', semantic_index_error: message, semantic_index_task_id: task.id }, task.project_id])
      }
      const terminal = task.attempts >= task.max_attempts
      const delay = Math.min(300, 5 * 2 ** Math.max(0, task.attempts - 1))
      await database.query(`UPDATE tasks SET status=$2,error=$3,lease_token=NULL,leased_until=NULL,next_attempt_at=NOW()+($4::text||' seconds')::interval,updated_at=NOW() WHERE id=$1`, [task.id, terminal ? 'failed' : 'retrying', message, String(delay)])
    }
  } finally { working = false }
}

export async function recoverInterruptedWork(): Promise<void> {
  await database.query("UPDATE tasks SET status='retrying',leased_until=NULL,lease_token=NULL,next_attempt_at=NOW(),error='native_process_restarted' WHERE status='running'")
  await database.query("UPDATE experiments SET status='failed',error='native_process_restarted',finished_at=NOW() WHERE status IN ('queued','running')")
  await database.query("UPDATE reproduction_runs SET status='failed',error='native_process_restarted',finished_at=NOW() WHERE status='running'")
  await database.query("UPDATE related_work_recursive_runs SET status='cancelled',finished_at=NOW(),error='cancelled_after_restart' WHERE status='running' AND cancel_requested=TRUE")
  await database.query("UPDATE related_work_recursive_runs SET status='queued',started_at=NULL,finished_at=NULL,error='native_process_restarted' WHERE status='running' AND cancel_requested=FALSE")
}

export function startTaskWorker(): NodeJS.Timeout {
  void tick()
  return setInterval(() => void tick(), 2_000)
}
