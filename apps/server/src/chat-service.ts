import { z } from 'zod'
import { chatRequest, emptyIdeaDraft } from './contracts.js'
import { database, rows } from './database.js'
import { ApiError } from './http.js'
import { mastraJson } from './mastra-client.js'
import { tierFor } from './model-routing.js'
import { projectDetail } from './project-service.js'
import { ingestProjectMemory, supermemoryEnabled } from './supermemory-service.js'
import { createWorkflowEditProposal } from './workflow-edit-service.js'

type SessionRow = { id: string; project_id: string | null; phase: string; draft: Record<string, unknown>; scope: string }
type MessageRow = { role: string; content: string }

export async function projectSessionFor(input: z.infer<typeof chatRequest>): Promise<SessionRow> {
  const scope = input.workspace_area && input.workspace_tab ? `${input.workspace_area}/${input.workspace_tab}` : 'project'
  if (input.project_id && input.workspace_area && input.workspace_tab) {
    if (input.session_id) {
      const supplied = await rows<SessionRow>('SELECT * FROM conversation_sessions WHERE id=$1', [input.session_id])
      if (supplied[0]?.project_id === input.project_id && supplied[0].scope === scope) return supplied[0]
    }
    const existing = await rows<SessionRow>('SELECT * FROM conversation_sessions WHERE project_id=$1 AND scope=$2 ORDER BY updated_at DESC LIMIT 1', [input.project_id, scope])
    if (existing[0]) return existing[0]
    const session: SessionRow = { id: crypto.randomUUID(), project_id: input.project_id, phase: 'supervising', draft: emptyIdeaDraft(), scope }
    await database.query('INSERT INTO conversation_sessions(id,project_id,phase,draft,scope) VALUES ($1,$2,$3,$4,$5)', [session.id, session.project_id, session.phase, session.draft, session.scope])
    return session
  }
  if (input.session_id) {
    const session = await rows<SessionRow>('SELECT * FROM conversation_sessions WHERE id=$1', [input.session_id])
    if (!session[0]) throw new ApiError(404, 'session_not_found', '对话会话不存在。')
    if (input.project_id && session[0].project_id && input.project_id !== session[0].project_id) throw new ApiError(409, 'session_project_mismatch', '会话不属于该项目。')
    return session[0]
  }
  const session: SessionRow = { id: crypto.randomUUID(), project_id: input.project_id ?? null, phase: input.project_id ? 'supervising' : 'clarifying', draft: emptyIdeaDraft(), scope }
  await database.query('INSERT INTO conversation_sessions(id,project_id,phase,draft,scope) VALUES ($1,$2,$3,$4,$5)', [session.id, session.project_id, session.phase, session.draft, session.scope])
  return session
}

async function readableDocumentReply(input: {
  purpose: 'clarify' | 'supervise'
  user_message: string
  context: string
  draft_reply: string
  project_id?: string
  workspace_context?: Record<string, string> | null
}) {
  return mastraJson<{ result: { reply: string }; route: { model: string; reasoning_effort: string } }>('/internal/agents/document-reply', {
    ...input,
    project_id: input.project_id || undefined,
  })
}

export async function projectChatTurn(input: z.infer<typeof chatRequest>) {
  const session = await projectSessionFor(input)
  const scope = input.workspace_area && input.workspace_tab ? `${input.workspace_area}/${input.workspace_tab}` : session.scope
  const workspaceContext = input.workspace_area && input.workspace_tab
    ? { area: input.workspace_area, tab: input.workspace_tab, label: input.workspace_label || input.workspace_tab, scope }
    : null
  const transcript = await rows<MessageRow>('SELECT role,content FROM messages WHERE session_id=$1 ORDER BY created_at DESC LIMIT 12', [session.id])
  const recentTranscript = [...transcript].reverse()
  const tier = tierFor(input.message, input.clarification_mode, input.attachments.length)
  const userMessageId = crypto.randomUUID()
  await database.query('INSERT INTO messages(id,session_id,role,content,metadata) VALUES ($1,$2,$3,$4,$5)', [userMessageId, session.id, 'user', input.message, { clarification_mode: input.clarification_mode, workspace_scope: scope }])
  if (session.project_id || input.project_id) {
    const projectId = session.project_id || input.project_id!
    if (supermemoryEnabled()) await ingestProjectMemory(projectId, {
      source_type: 'project_chat_message', source_id: userMessageId, artifact_id: null, uploaded_file_id: null,
      content: `user: ${input.message}`, source_url: null, quote: null, locator: null,
      metadata: { session_id: session.id, role: 'user', clarification_mode: input.clarification_mode, workspace_scope: scope, evidence_status: 'semantic_candidate' },
      task_type: 'memory', idempotency_key: `project-chat-user:${userMessageId}`,
    })
    const project = await projectDetail(projectId)
    const modelResult = await mastraJson<{ result: { intent: string; target_field: string | null; proposed_value: string | null; policy_rule: string | null; clarification_question: string | null; assistant_reply: string }; route: { tier: string; model: string; reasoning_effort: string } }>('/internal/agents/supervision-intent', {
      message: input.message,
      project_context: project,
      transcript: recentTranscript,
      tier,
      memory_resource: `project:${projectId}`,
      memory_thread: `session:${session.id}`,
      workspace_context: workspaceContext,
    })
    const documentResult = await readableDocumentReply({
      purpose: 'supervise',
      user_message: input.message,
      context: JSON.stringify({ project_context: project, recent_conversation: recentTranscript, workspace_context: workspaceContext }).slice(0, 12_000),
      draft_reply: modelResult.result.assistant_reply,
      project_id: projectId,
      workspace_context: workspaceContext,
    })
    const reply = documentResult.result.reply
    const assistantMessageId = crypto.randomUUID()
    if (supermemoryEnabled()) await ingestProjectMemory(projectId, {
      source_type: 'project_chat_message', source_id: assistantMessageId, artifact_id: null, uploaded_file_id: null,
      content: `assistant: ${reply}`, source_url: null, quote: null, locator: null,
      metadata: { session_id: session.id, role: 'assistant', model_tier: tier, intent: modelResult.result.intent, workspace_scope: scope, evidence_status: 'semantic_candidate' },
      task_type: 'memory', idempotency_key: `project-chat-assistant:${assistantMessageId}`,
    })
    let actionRequired: string | null = null
    if (modelResult.result.intent === 'change_request' && modelResult.result.target_field && modelResult.result.proposed_value) {
      const proposalId = crypto.randomUUID()
      await database.query('INSERT INTO proposals(id,project_id,kind,reason,summary,payload) VALUES ($1,$2,$3,$4,$5,$6)', [proposalId, projectId, 'idea_revision', input.message, `Revise ${modelResult.result.target_field}`, { field: modelResult.result.target_field, value: modelResult.result.proposed_value }])
      actionRequired = proposalId
    } else if (modelResult.result.intent === 'policy_change' && modelResult.result.policy_rule) {
      const proposalId = crypto.randomUUID()
      await database.query('INSERT INTO proposals(id,project_id,kind,reason,summary,payload) VALUES ($1,$2,$3,$4,$5,$6)', [proposalId, projectId, 'config_change', input.message, 'Add project policy', { rule: modelResult.result.policy_rule }])
      actionRequired = proposalId
    } else if (modelResult.result.intent === 'workflow_change_request') {
      const workflowProposal = await createWorkflowEditProposal(projectId, input.message, project as Record<string, unknown>)
      actionRequired = workflowProposal.proposal_id
    }
    await database.query('INSERT INTO messages(id,session_id,role,content,metadata) VALUES ($1,$2,$3,$4,$5)', [assistantMessageId, session.id, 'assistant', reply, { model_tier: tier, intent: modelResult.result.intent, workspace_scope: scope }])
    return { session_id: session.id, project_id: projectId, phase: 'supervising', reply, spec: null, missing_fields: [], action_required: actionRequired, model_tier: 'document', model: documentResult.route.model, reasoning_effort: documentResult.route.reasoning_effort, clarification_mode: input.clarification_mode, workspace_scope: scope }
  }
  throw new ApiError(422, 'project_required', '项目对话必须绑定项目。')
}

export async function clarifyChatTurn(input: z.infer<typeof chatRequest>) {
  const session = await projectSessionFor(input)
  const transcript = await rows<MessageRow>('SELECT role,content FROM messages WHERE session_id=$1 ORDER BY created_at DESC LIMIT 12', [session.id])
  const recentTranscript = [...transcript].reverse()
  const tier = tierFor(input.message, input.clarification_mode, input.attachments.length)
  const userMessageId = crypto.randomUUID()
  await database.query('INSERT INTO messages(id,session_id,role,content,metadata) VALUES ($1,$2,$3,$4,$5)', [userMessageId, session.id, 'user', input.message, { clarification_mode: input.clarification_mode }])
  const modelResult = await mastraJson<{ result: { draft: Record<string, unknown>; assistant_reply: string; ready_for_confirmation: boolean; unresolved_items: string[] }; route: { tier: string; model: string; reasoning_effort: string } }>('/internal/agents/clarify', {
    message: input.message,
    current_draft: session.draft,
    transcript: recentTranscript,
    attachment_count: input.attachments.length,
    clarification_mode: input.clarification_mode,
    attachment_context: [],
    attachment_images: [],
    tier,
    memory_resource: `idea:${session.id}`,
    memory_thread: `session:${session.id}`,
  })
  const documentResult = await readableDocumentReply({
    purpose: 'clarify',
    user_message: input.message,
    context: JSON.stringify({ current_draft: session.draft, recent_conversation: recentTranscript }).slice(0, 12_000),
    draft_reply: modelResult.result.assistant_reply,
  })
  const reply = documentResult.result.reply
  const phase = modelResult.result.ready_for_confirmation ? 'ready_for_confirmation' : 'clarifying'
  await database.query('UPDATE conversation_sessions SET draft=$2,phase=$3,updated_at=NOW() WHERE id=$1', [session.id, modelResult.result.draft, phase])
  await database.query('INSERT INTO messages(id,session_id,role,content,metadata) VALUES ($1,$2,$3,$4,$5)', [crypto.randomUUID(), session.id, 'assistant', reply, { model_tier: tier, clarification_mode: input.clarification_mode }])
  return {
    session_id: session.id,
    project_id: null,
    phase,
    reply,
    spec: phase === 'ready_for_confirmation' ? { schema_version: '1.0', idea: modelResult.result.draft, feasibility: 'medium', feasibility_notes: [], required_approvals: [], candidate_modifications: [], policies: [] } : null,
    missing_fields: modelResult.result.unresolved_items,
    action_required: null,
    model_tier: 'document',
    model: documentResult.route.model,
    reasoning_effort: documentResult.route.reasoning_effort,
    clarification_mode: input.clarification_mode,
  }
}
