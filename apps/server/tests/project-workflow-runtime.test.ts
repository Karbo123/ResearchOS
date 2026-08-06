import { testProjectSlug } from './test-project.js'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { database, migrate } from '../src/database.js'
import { projectsRoot } from '../src/paths.js'
import { pathInside } from '../src/paths.js'
import { WorkflowDefinitionLoader } from '../src/project-workflow/definition-loader.js'
import { appendWorkflowEvent } from '../src/project-workflow/event-store.js'
import { startTaskWorker, recoverInterruptedWork } from '../src/task-worker.js'
import { workflowGraphSnapshot } from '../src/project-workflow/graph-service.js'

const projectId = testProjectSlug()

function testDefinition() {
  return {
    schemaVersion: 2,
    templateVersion: 'v2-runtime-test@1',
    groups: [
      { id: 'test', label_key: 'test' },
    ],
    nodes: [
      {
        id: 'a',
        group: 'test',
        capability: 'noop',
        label_key: 'a',
        retry: { max_attempts: 3, backoff_seconds: 1 },
        timeout_seconds: 10,
        concurrency: 'parallel',
      },
      {
        id: 'b',
        group: 'test',
        capability: 'noop',
        label_key: 'b',
        requires: ['a'],
        retry: { max_attempts: 3, backoff_seconds: 1 },
        timeout_seconds: 10,
        concurrency: 'thread-serial',
      },
      {
        id: 'left',
        group: 'test',
        capability: 'noop',
        label_key: 'left',
        retry: { max_attempts: 1, backoff_seconds: 1 },
        timeout_seconds: 10,
        concurrency: 'parallel',
      },
      {
        id: 'right',
        group: 'test',
        capability: 'noop',
        label_key: 'right',
        retry: { max_attempts: 1, backoff_seconds: 1 },
        timeout_seconds: 10,
        concurrency: 'parallel',
      },
      {
        id: 'unrelated_context',
        group: 'test',
        capability: 'noop',
        label_key: 'unrelated_context',
        retry: { max_attempts: 1, backoff_seconds: 1 },
        timeout_seconds: 10,
        concurrency: 'parallel',
      },
      {
        id: 'unrelated_turn',
        group: 'test',
        capability: 'noop',
        label_key: 'unrelated_turn',
        requires: ['unrelated_context'],
        retry: { max_attempts: 1, backoff_seconds: 1 },
        timeout_seconds: 10,
        concurrency: 'thread-serial',
      },
    ],
    edges: [{ from: 'a', to: 'b' }],
    triggers: [
      { event_type: 'test.start', node_id: 'a', mode: 'root' },
      { event_type: 'test.parallel', node_id: 'left', mode: 'root' },
      { event_type: 'test.parallel', node_id: 'right', mode: 'root' },
    ],
  }
}

async function waitForNodeRun(nodeId: string, status: string, timeoutMs = 15_000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const snapshot = await workflowGraphSnapshot(projectId)
    const run = snapshot.node_runs.find(item => item.node_id === nodeId && item.status === status)
    if (run) return run as unknown as Record<string, unknown>
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`node run ${nodeId} did not reach ${status}`)
}

describe('workflow v2 runtime', () => {
  let worker: ReturnType<typeof startTaskWorker>

  beforeAll(async () => {
    await migrate()
    await database.query('INSERT INTO projects(id,slug,title,status) VALUES ($1,$2,$3,$4)', [projectId, projectId, 'Workflow v2 runtime test', 'active'])
    mkdirSync(pathInside(projectsRoot, projectId), { recursive: true })
    writeFileSync(pathInside(projectsRoot, projectId, 'workflow.ts'), `const workflow = ${JSON.stringify(testDefinition(), null, 2)}\nexport default workflow\n`, 'utf8')
    const loader = new WorkflowDefinitionLoader()
    const loaded = await loader.initializeProject(projectId)
    expect(loaded?.definition.templateVersion).toBe('v2-runtime-test@1')
    worker = startTaskWorker({ concurrency: 2 })
  }, 30_000)

  afterAll(async () => {
    worker?.stop()
    await database.query('DELETE FROM workflow_events WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM workflow_node_runs WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM tasks WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM workflow_definitions WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM project_workflow_runtime WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM audit_events WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM projects WHERE id=$1', [projectId])
    rmSync(pathInside(projectsRoot, projectId), { recursive: true, force: true })
  })

  it('activates a declarative v2 workflow and dispatches finite node tasks', async () => {
    const snapshot = await workflowGraphSnapshot(projectId)
    expect(snapshot.definition_version).toBe(1)
    expect(snapshot.groups.map(group => group.id)).toContain('test')
    expect(snapshot.status).toBe('waiting')

    await appendWorkflowEvent(projectId, 'test.start', {
      payload: { sleep_ms: 50 },
      source: 'test',
      correlation_id: 'correlation-one',
      idempotency_key: 'event-one',
    })
    const a = await waitForNodeRun('a', 'succeeded')
    const b = await waitForNodeRun('b', 'succeeded')
    expect(a.output_ref).toMatchObject({ ok: true })
    expect(b.output_ref).toMatchObject({ ok: true })
    const finalSnapshot = await workflowGraphSnapshot(projectId)
    expect(finalSnapshot.node_runs.filter(run => ['unrelated_context', 'unrelated_turn'].includes(run.node_id))).toHaveLength(0)
  })

  it('keeps event append idempotent', async () => {
    const first = await appendWorkflowEvent(projectId, 'test.start', {
      payload: { sleep_ms: 10 },
      source: 'test',
      correlation_id: 'correlation-one',
      idempotency_key: 'event-one',
    })
    const second = await appendWorkflowEvent(projectId, 'test.start', {
      payload: { sleep_ms: 10 },
      source: 'test',
      correlation_id: 'correlation-one',
      idempotency_key: 'event-one',
    })
    expect(second.id).toBe(first.id)
  })

  it('runs independent nodes on multiple workers', async () => {
    await appendWorkflowEvent(projectId, 'test.parallel', {
      payload: { sleep_ms: 500 },
      source: 'test',
      correlation_id: 'parallel',
      idempotency_key: 'parallel-event',
    })
    const left = await waitForNodeRun('left', 'succeeded')
    const right = await waitForNodeRun('right', 'succeeded')
    const leftTask = await database.query<{ worker_id: string | null }>('SELECT worker_id FROM tasks WHERE id=$1', [left.task_id])
    const rightTask = await database.query<{ worker_id: string | null }>('SELECT worker_id FROM tasks WHERE id=$1', [right.task_id])
    expect(leftTask.rows[0]?.worker_id).toBeTruthy()
    expect(rightTask.rows[0]?.worker_id).toBeTruthy()
    expect(leftTask.rows[0]?.worker_id).not.toBe(rightTask.rows[0]?.worker_id)
  })

  it('rejects an invalid hot reload and keeps the active version', async () => {
    const workflowPath = pathInside(projectsRoot, projectId, 'workflow.ts')
    writeFileSync(workflowPath, `export default ${JSON.stringify({ schemaVersion: 2, templateVersion: 'broken', groups: [], nodes: [], edges: [], triggers: [] })}`, 'utf8')
    const loader = new WorkflowDefinitionLoader()
    await expect(loader.scanProject(projectId)).rejects.toThrow()
    const snapshot = await workflowGraphSnapshot(projectId)
    expect(snapshot.definition_version).toBe(1)
    expect(snapshot.source_hash).toBeTruthy()

    writeFileSync(workflowPath, `const workflow = ${JSON.stringify(testDefinition(), null, 2)}\nexport default workflow\n`, 'utf8')
    await loader.scanProject(projectId)
  })

  it('recovers interrupted workflow tasks on restart', async () => {
    await database.query("UPDATE tasks SET status='running',lease_token='x',worker_id='worker-test',leased_until=NOW() WHERE project_id=$1 AND workflow_node_run_id IS NOT NULL", [projectId])
    await recoverInterruptedWork()
    const running = await database.query<{ id: string }>("SELECT id FROM tasks WHERE project_id=$1 AND status='running'", [projectId])
    expect(running.rows).toHaveLength(0)
  })
})
