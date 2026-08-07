import { rmSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { chatRequest } from '../src/contracts.js'
import { database, migrate, one } from '../src/database.js'
import { createProjectWorkspace } from '../src/project-service.js'
import { projectRoot } from '../src/project-storage.js'
import { testProjectSlug } from './test-project.js'

const mocks = vi.hoisted(() => ({ mastraJson: vi.fn(), ingestProjectMemory: vi.fn(), supermemoryEnabled: vi.fn(() => false) }))

vi.mock('../src/mastra-client.js', () => ({ mastraJson: mocks.mastraJson }))
vi.mock('../src/supermemory-service.js', () => ({
  applyMemoryRevocation: vi.fn(),
  embeddingProfile: vi.fn(() => ({ provider: 'local', model: 'Xenova/bge-m3', dimensions: 1024, base_url: null })),
  ingestProjectMemory: mocks.ingestProjectMemory,
  searchProjectMemory: vi.fn(),
  supermemoryEnabled: mocks.supermemoryEnabled,
}))

const { projectChatTurn } = await import('../src/chat-service.js')

const projectId = testProjectSlug('chat-context')
const ideaVersionId = crypto.randomUUID()

describe('project chat Context Packet integration', () => {
  beforeAll(async () => {
    await migrate()
    await database.query('INSERT INTO projects(id,slug,title) VALUES ($1,$1,$2)', [projectId, 'Context-aware project chat'])
    await createProjectWorkspace(projectId, projectId, {})
    await database.query('INSERT INTO idea_versions(id,project_id,version,spec,change_reason) VALUES ($1,$2,1,$3,$4)', [ideaVersionId, projectId, { schema_version: '1.0', idea: { title: 'Context-aware project chat', research_question: 'How should scoped context be managed?' } }, 'test fixture'])
  })

  beforeEach(() => {
    mocks.mastraJson.mockReset()
    mocks.ingestProjectMemory.mockReset()
    mocks.ingestProjectMemory.mockResolvedValue({})
    mocks.supermemoryEnabled.mockReset()
    mocks.supermemoryEnabled.mockReturnValue(false)
    mocks.mastraJson.mockImplementation(async (path: string) => {
      if (path === '/internal/agents/supervision-intent') return {
        result: { intent: 'explanation', target_field: null, proposed_value: null, policy_rule: null, knowledge_instruction: null, clarification_question: null, assistant_reply: 'Draft answer' },
        route: { tier: 'medium', model: 'test-code-model', reasoning_effort: 'medium' },
      }
      if (path === '/internal/agents/document-reply') return { result: { reply: 'Readable answer' }, route: { model: 'test-document-model', reasoning_effort: 'low' } }
      if (path === '/internal/agents/knowledge-document-draft') return { result: { markdown_body: '## Stable Idea\n\nA bounded, reviewable Idea summary.', summary: 'Create a durable Idea summary', open_verification_items: ['Verify the current method boundary.'] }, route: { model: 'test-document-model', reasoning_effort: 'low' } }
      throw new Error(`unexpected_mastra_path_${path}`)
    })
  })

  afterAll(async () => {
    await database.query('DELETE FROM tasks WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM lineage_impact_items WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM lineage_impact_reports WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM lineage_dependencies WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM knowledge_index_entries WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM knowledge_index_generations WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM knowledge_document_revisions WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM knowledge_documents WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM conversation_turns WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM context_manifests WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM messages WHERE session_id IN (SELECT id FROM conversation_sessions WHERE project_id=$1)', [projectId])
    await database.query('DELETE FROM conversation_sessions WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM proposals WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM idea_versions WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM audit_events WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM projects WHERE id=$1', [projectId])
    rmSync(projectRoot(projectId), { recursive: true, force: true })
  })

  it('injects one governed packet, returns its manifest, and does not enable unfiltered Mastra retrieval', async () => {
    const result = await projectChatTurn(chatRequest.parse({ project_id: projectId, message: 'Explain the current overview.', attachments: [], clarification_mode: 'automatic', workspace_area: 'overview', workspace_tab: 'overview', workspace_label: 'Project overview' }))
    expect(result).toMatchObject({ project_id: projectId, reply: 'Readable answer', context_status: 'empty' })
    expect(result.context_manifest_id).toMatch(/^[0-9a-f-]{36}$/)

    const supervisionCall = mocks.mastraJson.mock.calls.find(call => call[0] === '/internal/agents/supervision-intent')
    expect(supervisionCall?.[1]).toMatchObject({ context_packet: expect.stringContaining(`manifest_id="${result.context_manifest_id}"`) })
    expect(supervisionCall?.[1]).toMatchObject({ project_id: projectId })
    expect(supervisionCall?.[1]).not.toHaveProperty('memory_resource')
    expect(supervisionCall?.[1]).not.toHaveProperty('memory_thread')
    const documentCall = mocks.mastraJson.mock.calls.find(call => call[0] === '/internal/agents/document-reply')
    expect(documentCall?.[1]).toMatchObject({ context: expect.stringContaining(`manifest_id="${result.context_manifest_id}"`) })

    const manifest = await one<{ project_id: string; workspace_scope: string; status: string }>('SELECT project_id,workspace_scope,status FROM context_manifests WHERE id=$1', [result.context_manifest_id])
    expect(manifest).toEqual({ project_id: projectId, workspace_scope: 'overview/overview', status: 'empty' })
    const assistant = await one<{ metadata: Record<string, unknown> }>("SELECT metadata FROM messages WHERE role='assistant' AND session_id=$1", [result.session_id])
    expect(assistant?.metadata).toMatchObject({ context_manifest_id: result.context_manifest_id, context_status: 'empty' })
  })

  it('turns an explicitly stable Idea discussion into one reviewable knowledge document proposal', async () => {
    mocks.mastraJson.mockImplementation(async (path: string) => {
      if (path === '/internal/agents/supervision-intent') return {
        result: { intent: 'idea_knowledge_request', target_field: null, proposed_value: null, policy_rule: null, knowledge_instruction: 'Consolidate the confirmed research question and method boundary into the current durable Idea.', clarification_question: null, assistant_reply: 'I prepared a reviewable durable Idea proposal.' },
        route: { tier: 'medium', model: 'test-code-model', reasoning_effort: 'medium' },
      }
      if (path === '/internal/agents/document-reply') return { result: { reply: 'A reviewable Idea proposal is ready.' }, route: { model: 'test-document-model', reasoning_effort: 'low' } }
      if (path === '/internal/agents/knowledge-document-draft') return { result: { markdown_body: '## Stable Idea\n\nA bounded, reviewable Idea summary.', summary: 'Create a durable Idea summary', open_verification_items: ['Verify the current method boundary.'] }, route: { model: 'test-document-model', reasoning_effort: 'low' } }
      throw new Error(`unexpected_mastra_path_${path}`)
    })
    const result = await projectChatTurn(chatRequest.parse({ project_id: projectId, message: 'The current conclusion is stable. Please consolidate it.', attachments: [], clarification_mode: 'automatic', workspace_area: 'overview', workspace_tab: 'idea', workspace_label: 'Idea discussion' }))
    expect(result.action_required).toMatch(/^[0-9a-f-]{36}$/)
    const proposal = await one<{ kind: string; status: string; payload: Record<string, unknown> }>('SELECT kind,status,payload FROM proposals WHERE id=$1', [result.action_required])
    expect(proposal).toMatchObject({ kind: 'knowledge_document_patch', status: 'pending', payload: { document_id: 'idea:current', patch_kind: 'knowledge_document' } })
    expect(mocks.mastraJson.mock.calls.some(call => call[0] === '/internal/agents/knowledge-document-draft')).toBe(true)
  })

  it('replays an interrupted turn without duplicating its message, manifest, or Proposal', async () => {
    const requestId = crypto.randomUUID()
    mocks.supermemoryEnabled.mockReturnValue(true)
    let assistantIngestAttempts = 0
    mocks.ingestProjectMemory.mockImplementation(async (_projectId: string, payload: { content: string }) => {
      if (payload.content.startsWith('assistant:') && assistantIngestAttempts++ === 0) throw new Error('simulated_assistant_memory_interruption')
      return {}
    })
    mocks.mastraJson.mockImplementation(async (path: string) => {
      if (path === '/internal/agents/supervision-intent') return {
        result: { intent: 'change_request', target_field: 'research_question', proposed_value: 'Use one stable replay-safe turn.', policy_rule: null, knowledge_instruction: null, clarification_question: null, assistant_reply: 'I prepared one reviewable change.' },
        route: { tier: 'medium', model: 'test-code-model', reasoning_effort: 'medium' },
      }
      if (path === '/internal/agents/document-reply') return { result: { reply: 'One reviewable change is ready.' }, route: { model: 'test-document-model', reasoning_effort: 'low' } }
      throw new Error(`unexpected_mastra_path_${path}`)
    })
    const input = chatRequest.parse({ request_id: requestId, project_id: projectId, message: 'Update the research question once.', attachments: [], clarification_mode: 'automatic', workspace_area: 'overview', workspace_tab: 'overview', workspace_label: 'Project overview' })

    await expect(projectChatTurn(input)).rejects.toThrow('simulated_assistant_memory_interruption')
    const interrupted = await one<{ session_id: string; context_manifest_id: string; status: string }>('SELECT session_id,context_manifest_id,status FROM conversation_turns WHERE id=$1', [requestId])
    expect(interrupted?.status).toBe('response_ready')
    expect(await one<{ count: number }>('SELECT COUNT(*)::integer AS count FROM messages WHERE session_id=$1 AND turn_id=$2', [interrupted?.session_id, requestId])).toEqual({ count: 2 })
    expect(await one<{ count: number }>("SELECT COUNT(*)::integer AS count FROM messages WHERE session_id=$1 AND turn_id=$2 AND role='assistant' AND metadata->>'delivery_status'='pending'", [interrupted?.session_id, requestId])).toEqual({ count: 1 })
    expect(await one<{ count: number }>('SELECT COUNT(*)::integer AS count FROM context_manifests WHERE id=$1', [interrupted?.context_manifest_id])).toEqual({ count: 1 })
    expect(await one<{ count: number }>('SELECT COUNT(*)::integer AS count FROM proposals WHERE project_id=$1 AND origin_turn_id=$2', [projectId, requestId])).toEqual({ count: 1 })
    const modelCallsAfterInterruption = mocks.mastraJson.mock.calls.length

    const recovered = await projectChatTurn(input)
    expect(recovered).toMatchObject({ reply: 'One reviewable change is ready.', context_manifest_id: interrupted?.context_manifest_id })
    expect(mocks.mastraJson).toHaveBeenCalledTimes(modelCallsAfterInterruption)
    expect(await one<{ count: number }>('SELECT COUNT(*)::integer AS count FROM messages WHERE session_id=$1 AND turn_id=$2', [recovered.session_id, requestId])).toEqual({ count: 2 })
    expect(await one<{ count: number }>('SELECT COUNT(*)::integer AS count FROM context_manifests WHERE id=$1', [recovered.context_manifest_id])).toEqual({ count: 1 })
    expect(await one<{ count: number }>('SELECT COUNT(*)::integer AS count FROM proposals WHERE project_id=$1 AND origin_turn_id=$2', [projectId, requestId])).toEqual({ count: 1 })
    expect(await one<{ status: string }>('SELECT status FROM conversation_turns WHERE id=$1', [requestId])).toEqual({ status: 'succeeded' })

    await expect(projectChatTurn(chatRequest.parse({ ...input, message: 'A different message must not reuse that request id.' }))).rejects.toMatchObject({ code: 'chat_turn_identity_conflict' })
  })
})
