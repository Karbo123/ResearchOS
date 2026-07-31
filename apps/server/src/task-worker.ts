import { database, one } from './database.js'

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
  if (task.kind !== 'research_bootstrap') throw new Error('task_kind_not_allowlisted')
  const response = await fetch(`${(process.env.MASTRA_BASE_URL || 'http://127.0.0.1:4111').replace(/\/$/, '')}/internal/workflows/research-bootstrap`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project_id: task.project_id, task_id: task.id, idempotency_key: task.idempotency_key }), signal: AbortSignal.timeout(120_000),
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
      const terminal = task.attempts >= task.max_attempts
      const delay = Math.min(300, 5 * 2 ** Math.max(0, task.attempts - 1))
      await database.query(`UPDATE tasks SET status=$2,error=$3,lease_token=NULL,leased_until=NULL,next_attempt_at=NOW()+($4::text||' seconds')::interval,updated_at=NOW() WHERE id=$1`, [task.id, terminal ? 'failed' : 'retrying', message, String(delay)])
    }
  } finally { working = false }
}

export async function recoverInterruptedWork(): Promise<void> {
  await database.query("UPDATE tasks SET status='retrying',leased_until=NULL,lease_token=NULL,next_attempt_at=NOW(),error='native_process_restarted' WHERE status='running'")
  await database.query("UPDATE experiments SET status='failed',error='native_process_restarted',finished_at=NOW() WHERE status IN ('queued','running')")
}

export function startTaskWorker(): NodeJS.Timeout {
  void tick()
  return setInterval(() => void tick(), 2_000)
}
