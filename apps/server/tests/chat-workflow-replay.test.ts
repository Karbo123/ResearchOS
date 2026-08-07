import { rmSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { database, migrate, one } from '../src/database.js'
import { createProjectWorkspace } from '../src/project-service.js'
import { initializeProjectWorkflow } from '../src/project-workflow/runtime-service.js'
import { projectRoot } from '../src/project-storage.js'
import { startTaskWorker } from '../src/task-worker.js'
import { testProjectSlug } from './test-project.js'

const mocks = vi.hoisted(() => ({
  mastraJson: vi.fn(),
  ingestProjectMemory: vi.fn(),
}))

vi.mock('../src/mastra-client.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/mastra-client.js')>(),
  mastraJson: mocks.mastraJson,
}))
vi.mock('../src/supermemory-service.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/supermemory-service.js')>(),
  ingestProjectMemory: mocks.ingestProjectMemory,
  supermemoryEnabled: vi.fn(() => true),
}))

const { app } = await import('../src/index.js')

const projectId = testProjectSlug('chat-replay')
const requestId = crypto.randomUUID()

async function waitForRetryingTask(timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const task = await one<{ id: string; status: string }>(
      "SELECT id,status FROM tasks WHERE project_id=$1 AND workflow_node_id='conversation.agent_turn' ORDER BY created_at DESC LIMIT 1",
      [projectId],
    )
    if (task?.status === 'retrying') {
      await database.query('UPDATE tasks SET next_attempt_at=NOW() WHERE id=$1', [task.id])
      return
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('chat workflow task did not enter retrying state')
}

async function postChat(message: string) {
  const response = await app.request('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      request_id: requestId,
      project_id: projectId,
      message,
      attachments: [],
      clarification_mode: 'automatic',
      workspace_area: 'overview',
      workspace_tab: 'overview',
      workspace_label: 'Project overview',
    }),
  })
  return { response, body: await response.json() as Record<string, unknown> }
}

describe('project chat workflow replay integration', () => {
  let worker: ReturnType<typeof startTaskWorker>

  beforeAll(async () => {
    await migrate()
    await database.query('INSERT INTO projects(id,slug,title,status) VALUES ($1,$1,$2,\'active\')', [projectId, 'Replay-safe project chat'])
    await createProjectWorkspace(projectId, projectId, { schema_version: '1.0', idea: { title: 'Replay-safe project chat' } })
    await database.query('INSERT INTO idea_versions(id,project_id,version,spec) VALUES ($1,$2,1,$3)', [crypto.randomUUID(), projectId, { schema_version: '1.0', idea: { title: 'Replay-safe project chat', research_question: 'Can one workflow turn be replayed without duplicate side effects?' } }])
    await initializeProjectWorkflow(projectId)

    mocks.mastraJson.mockImplementation(async (path: string) => {
      if (path === '/internal/agents/supervision-intent') return {
        result: {
          intent: 'change_request',
          target_field: 'research_question',
          proposed_value: 'Use one stable turn identity through the API and worker.',
          policy_rule: null,
          knowledge_instruction: null,
          clarification_question: null,
          assistant_reply: 'I prepared one reviewable change.',
        },
        route: { tier: 'medium', model: 'test-code-model', reasoning_effort: 'medium' },
      }
      if (path === '/internal/agents/document-reply') return {
        result: { reply: 'One reviewable change is ready.' },
        route: { model: 'test-document-model', reasoning_effort: 'low' },
      }
      throw new Error(`unexpected_mastra_path_${path}`)
    })
    let assistantAttempts = 0
    mocks.ingestProjectMemory.mockImplementation(async (_projectId: string, input: { content: string }) => {
      if (input.content.startsWith('assistant:') && assistantAttempts++ === 0) throw new Error('simulated_assistant_memory_interruption')
      return { link: { id: crypto.randomUUID() } }
    })
    worker = startTaskWorker({ concurrency: 1 })
  }, 30_000)

  afterAll(async () => {
    worker?.stop()
    await worker?.done
    await database.query('DELETE FROM lineage_impact_items WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM lineage_impact_reports WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM lineage_dependencies WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM conversation_turns WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM context_manifests WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM messages WHERE session_id IN (SELECT id FROM conversation_sessions WHERE project_id=$1)', [projectId])
    await database.query('DELETE FROM conversation_sessions WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM proposals WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM idea_versions WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM audit_events WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM workflow_events WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM workflow_node_runs WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM tasks WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM workflow_definitions WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM project_workflow_runtime WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM projects WHERE id=$1', [projectId])
    rmSync(projectRoot(projectId), { recursive: true, force: true })
  }, 30_000)

  it('retries an interrupted public API turn without duplicating durable side effects', async () => {
    const message = 'Update the research question through one replay-safe workflow turn.'
    const request = postChat(message)
    await waitForRetryingTask()
    const completed = await request
    expect(completed.response.status).toBe(200)
    expect(completed.body).toMatchObject({ reply: 'One reviewable change is ready.', project_id: projectId })

    const turn = await one<{ session_id: string; context_manifest_id: string; status: string }>('SELECT session_id,context_manifest_id,status FROM conversation_turns WHERE id=$1', [requestId])
    expect(turn?.status).toBe('succeeded')
    expect(await one<{ count: number }>('SELECT COUNT(*)::integer AS count FROM workflow_events WHERE project_id=$1 AND idempotency_key=$2', [projectId, `chat:${requestId}`])).toEqual({ count: 1 })
    expect(await one<{ count: number }>('SELECT COUNT(*)::integer AS count FROM workflow_node_runs WHERE project_id=$1 AND correlation_id=$2 AND node_id=$3', [projectId, `chat:${requestId}`, 'conversation.agent_turn'])).toEqual({ count: 1 })
    expect(await one<{ count: number; attempts: number }>("SELECT COUNT(*)::integer AS count,MAX(attempts)::integer AS attempts FROM tasks WHERE project_id=$1 AND workflow_correlation_id=$2 AND workflow_node_id='conversation.agent_turn'", [projectId, `chat:${requestId}`])).toEqual({ count: 1, attempts: 2 })
    expect(await one<{ count: number }>('SELECT COUNT(*)::integer AS count FROM messages WHERE session_id=$1 AND turn_id=$2', [turn?.session_id, requestId])).toEqual({ count: 2 })
    expect(await one<{ count: number }>('SELECT COUNT(*)::integer AS count FROM context_manifests WHERE id=$1', [turn?.context_manifest_id])).toEqual({ count: 1 })
    expect(await one<{ count: number }>('SELECT COUNT(*)::integer AS count FROM proposals WHERE project_id=$1 AND origin_turn_id=$2', [projectId, requestId])).toEqual({ count: 1 })
    expect(mocks.mastraJson).toHaveBeenCalledTimes(2)

    const replayed = await postChat(message)
    expect(replayed.response.status).toBe(200)
    expect(replayed.body).toMatchObject({ reply: completed.body.reply, context_manifest_id: completed.body.context_manifest_id })
    expect(mocks.mastraJson).toHaveBeenCalledTimes(2)
    expect(await one<{ count: number }>('SELECT COUNT(*)::integer AS count FROM messages WHERE session_id=$1 AND turn_id=$2', [turn?.session_id, requestId])).toEqual({ count: 2 })

    const conflicting = await postChat('A different message must not reuse the same request identifier.')
    expect(conflicting.response.status).toBe(409)
    expect(conflicting.body).toMatchObject({ code: 'chat_turn_identity_conflict' })
    expect(mocks.mastraJson).toHaveBeenCalledTimes(2)
  }, 30_000)
})
