import { createHash } from 'node:crypto'
import { z } from 'zod'
import { chatRequest, emptyIdeaDraft } from './contracts.js'
import { database, one, rows } from './database.js'
import { ApiError } from './http.js'
import { mastraJson } from './mastra-client.js'
import { tierFor } from './model-routing.js'
import { projectDetail } from './project-service.js'
import { ingestProjectMemory, supermemoryEnabled } from './supermemory-service.js'
import { createWorkflowEditProposal } from './workflow-edit-service.js'
import { buildContextPacket, contextPacketPrompt } from './context-planner.js'
import { createKnowledgeDocumentProposal } from './knowledge-document-proposal-service.js'

type SessionRow = { id: string; project_id: string | null; phase: string; draft: Record<string, unknown>; scope: string }
type MessageRow = { role: string; content: string }
type ConversationTurnRow = {
  id: string
  project_id: string
  session_id: string
  request_sha256: string
  status: 'processing' | 'response_ready' | 'succeeded' | 'failed'
  context_manifest_id: string
  user_message_id: string
  assistant_message_id: string
  last_error_status: number | null
  last_error_code: string | null
  last_error_message: string | null
}
type StoredAssistantMessage = { content: string; metadata: Record<string, unknown> }

type ProjectChatResult = {
  session_id: string
  project_id: string
  phase: 'supervising'
  reply: string
  spec: null
  missing_fields: never[]
  action_required: string | null
  model_tier: string
  model: string
  reasoning_effort: string
  clarification_mode: z.infer<typeof chatRequest>['clarification_mode']
  workspace_scope: string
  context_manifest_id: string
  context_status: string
}

function projectChatRequestHash(input: z.infer<typeof chatRequest>, projectId: string, sessionId: string, scope: string): string {
  return createHash('sha256').update(JSON.stringify({
    project_id: projectId,
    session_id: sessionId,
    message: input.message,
    attachments: input.attachments,
    clarification_mode: input.clarification_mode,
    workspace_area: input.workspace_area || null,
    workspace_tab: input.workspace_tab || null,
    workspace_label: input.workspace_label || null,
    workspace_scope: scope,
  })).digest('hex')
}

async function ensureProjectChatTurn(input: z.infer<typeof chatRequest>, projectId: string, sessionId: string, scope: string): Promise<ConversationTurnRow> {
  const turnId = input.request_id || crypto.randomUUID()
  const requestSha = projectChatRequestHash(input, projectId, sessionId, scope)
  await database.query(
    `INSERT INTO conversation_turns(id,project_id,session_id,request_sha256,status,context_manifest_id,user_message_id,assistant_message_id)
     VALUES ($1,$2,$3,$4,'processing',$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
    [turnId, projectId, sessionId, requestSha, crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()],
  )
  const turn = await one<ConversationTurnRow>('SELECT * FROM conversation_turns WHERE id=$1', [turnId])
  if (!turn || turn.project_id !== projectId || turn.session_id !== sessionId || turn.request_sha256 !== requestSha) {
    throw new ApiError(409, 'chat_turn_identity_conflict', '对话请求标识已用于另一条不同的消息。')
  }
  return turn
}

function resultFromStoredAssistant(turn: ConversationTurnRow, assistant: StoredAssistantMessage, input: z.infer<typeof chatRequest>, scope: string): ProjectChatResult {
  const metadata = assistant.metadata || {}
  return {
    session_id: turn.session_id,
    project_id: turn.project_id,
    phase: 'supervising',
    reply: assistant.content,
    spec: null,
    missing_fields: [],
    action_required: typeof metadata.action_required === 'string' ? metadata.action_required : null,
    model_tier: typeof metadata.result_model_tier === 'string' ? metadata.result_model_tier : 'document',
    model: typeof metadata.model === 'string' ? metadata.model : '',
    reasoning_effort: typeof metadata.reasoning_effort === 'string' ? metadata.reasoning_effort : 'default',
    clarification_mode: input.clarification_mode,
    workspace_scope: scope,
    context_manifest_id: turn.context_manifest_id,
    context_status: typeof metadata.context_status === 'string' ? metadata.context_status : 'empty',
  }
}

async function existingTurnProposal(projectId: string, turnId: string): Promise<{ id: string } | null> {
  return one<{ id: string }>('SELECT id FROM proposals WHERE project_id=$1 AND origin_turn_id=$2', [projectId, turnId])
}

async function createSimpleTurnProposal(input: {
  projectId: string
  turnId: string
  kind: 'idea_revision' | 'config_change'
  reason: string
  summary: string
  payload: Record<string, unknown>
}): Promise<string> {
  const proposalId = crypto.randomUUID()
  await database.query(
    `INSERT INTO proposals(id,project_id,kind,reason,summary,payload,origin_turn_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (project_id,origin_turn_id) WHERE origin_turn_id IS NOT NULL DO NOTHING`,
    [proposalId, input.projectId, input.kind, input.reason, input.summary, input.payload, input.turnId],
  )
  const proposal = await existingTurnProposal(input.projectId, input.turnId)
  if (!proposal) throw new ApiError(500, 'chat_proposal_persist_failed', '对话产生的待审批变更未能安全保存。')
  return proposal.id
}

async function finalizeProjectChatTurn(turn: ConversationTurnRow, input: z.infer<typeof chatRequest>, scope: string): Promise<ProjectChatResult> {
  const assistant = await one<StoredAssistantMessage>('SELECT content,metadata FROM messages WHERE id=$1 AND session_id=$2 AND turn_id=$3 AND role=$4', [turn.assistant_message_id, turn.session_id, turn.id, 'assistant'])
  if (!assistant) throw new ApiError(500, 'chat_turn_assistant_missing', '对话轮次缺少待提交的助手消息。')
  const metadata = assistant.metadata || {}
  if (supermemoryEnabled()) await ingestProjectMemory(turn.project_id, {
    source_type: 'project_chat_message', source_id: turn.assistant_message_id, artifact_id: null, uploaded_file_id: null,
    content: `assistant: ${assistant.content}`, source_url: null, quote: null, locator: null,
    metadata: {
      session_id: turn.session_id,
      role: 'assistant',
      model_tier: typeof metadata.routing_tier === 'string' ? metadata.routing_tier : 'medium',
      intent: typeof metadata.intent === 'string' ? metadata.intent : 'explanation',
      workspace_scope: scope,
      evidence_status: 'semantic_candidate',
    },
    task_type: 'memory', idempotency_key: `project-chat-assistant:${turn.assistant_message_id}`,
  })
  await database.transaction(async transaction => {
    await transaction.query('UPDATE messages SET metadata=$2 WHERE id=$1', [turn.assistant_message_id, { ...metadata, delivery_status: 'complete' }])
    await transaction.query("UPDATE conversation_turns SET status='succeeded',last_error_status=NULL,last_error_code=NULL,last_error_message=NULL,updated_at=NOW() WHERE id=$1", [turn.id])
    await transaction.query('UPDATE conversation_sessions SET updated_at=NOW() WHERE id=$1', [turn.session_id])
  })
  return resultFromStoredAssistant(turn, { ...assistant, metadata: { ...metadata, delivery_status: 'complete' } }, input, scope)
}

function compactProjectContext(project: Record<string, unknown>): Record<string, unknown> {
  const list = (key: string) => Array.isArray(project[key]) ? project[key] as Array<Record<string, unknown>> : []
  return {
    id: project.id,
    slug: project.slug,
    title: project.title,
    status: project.status,
    current_stage: project.current_stage,
    current_idea_version: project.current_idea_version,
    spec: project.spec,
    counts: {
      papers: list('papers').length,
      evidence: list('evidence').length,
      experiments: list('experiments').length,
      artifacts: list('artifacts').length,
      pending_proposals: list('proposals').filter(item => item.status === 'pending').length,
    },
    pending_proposals: list('proposals').filter(item => item.status === 'pending').slice(0, 12).map(item => ({ id: item.id, kind: item.kind, summary: item.summary, reason: item.reason })),
    active_policies: list('policies').slice(0, 20).map(item => ({ id: item.id, rule: item.rule, rationale: item.rationale })),
    recent_experiments: list('experiments').slice(0, 12).map(item => ({ id: item.id, status: item.status, experiment_type: item.experiment_type, run_id: item.run_id, error: item.error })),
  }
}

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

export async function projectChatTurn(input: z.infer<typeof chatRequest>): Promise<ProjectChatResult> {
  const session = await projectSessionFor(input)
  const scope = input.workspace_area && input.workspace_tab ? `${input.workspace_area}/${input.workspace_tab}` : session.scope
  const workspaceContext = input.workspace_area && input.workspace_tab
    ? { area: input.workspace_area, tab: input.workspace_tab, label: input.workspace_label || input.workspace_tab, scope }
    : null
  const projectId = session.project_id || input.project_id
  if (!projectId) throw new ApiError(422, 'project_required', '项目对话必须绑定项目。')
  const turn = await ensureProjectChatTurn(input, projectId, session.id, scope)
  try {
    if (turn.status === 'failed') {
      const status = turn.last_error_status && [400, 401, 403, 404, 409, 413, 415, 422, 500, 501, 502, 503, 504].includes(turn.last_error_status) ? turn.last_error_status as ApiError['status'] : 502
      throw new ApiError(status, turn.last_error_code || 'chat_turn_failed', turn.last_error_message || '该对话轮次执行失败。')
    }
    if (turn.status === 'response_ready' || turn.status === 'succeeded') {
      const assistant = await one<StoredAssistantMessage>('SELECT content,metadata FROM messages WHERE id=$1 AND session_id=$2 AND turn_id=$3 AND role=$4', [turn.assistant_message_id, session.id, turn.id, 'assistant'])
      if (!assistant) throw new ApiError(500, 'chat_turn_assistant_missing', '对话轮次缺少已生成的助手消息。')
      if (turn.status === 'succeeded') return resultFromStoredAssistant(turn, assistant, input, scope)
      return await finalizeProjectChatTurn(turn, input, scope)
    }

    const transcript = await rows<MessageRow>('SELECT role,content FROM messages WHERE session_id=$1 AND (turn_id IS NULL OR turn_id<>$2) AND COALESCE(metadata->>\'delivery_status\',\'complete\')=\'complete\' ORDER BY created_at DESC LIMIT 12', [session.id, turn.id])
    const recentTranscript = [...transcript].reverse()
    const tier = tierFor(input.message, input.clarification_mode, input.attachments.length)
    const contextPacket = await buildContextPacket({
      project_id: projectId,
      purpose: 'project_chat',
      ...(input.workspace_area ? { workspace_area: input.workspace_area } : {}),
      ...(input.workspace_tab ? { workspace_tab: input.workspace_tab } : {}),
      workspace_scope: scope,
      query: input.message,
      session_id: session.id,
      exclude_turn_id: turn.id,
      manifest_id: turn.context_manifest_id,
    })
    if (contextPacket.status === 'blocked') throw new ApiError(503, 'project_context_blocked', '当前项目知识上下文无法安全装配，请先完成知识文档对账或索引后重试。', { context_manifest_id: contextPacket.manifest_id })
    const researchContext = contextPacketPrompt(contextPacket)
    await database.query(
      `INSERT INTO messages(id,session_id,role,content,metadata,turn_id) VALUES ($1,$2,'user',$3,$4,$5)
       ON CONFLICT (session_id,turn_id,role) WHERE turn_id IS NOT NULL DO NOTHING`,
      [turn.user_message_id, session.id, input.message, { clarification_mode: input.clarification_mode, workspace_scope: scope, context_manifest_id: contextPacket.manifest_id, delivery_status: 'complete' }, turn.id],
    )
    if (supermemoryEnabled()) await ingestProjectMemory(projectId, {
      source_type: 'project_chat_message', source_id: turn.user_message_id, artifact_id: null, uploaded_file_id: null,
      content: `user: ${input.message}`, source_url: null, quote: null, locator: null,
      metadata: { session_id: session.id, role: 'user', clarification_mode: input.clarification_mode, workspace_scope: scope, evidence_status: 'semantic_candidate' },
      task_type: 'memory', idempotency_key: `project-chat-user:${turn.user_message_id}`,
    })
    const project = await projectDetail(projectId)
    const projectContext = compactProjectContext(project as Record<string, unknown>)
    const modelResult = await mastraJson<{ result: { intent: string; target_field: string | null; proposed_value: string | null; policy_rule: string | null; knowledge_instruction: string | null; clarification_question: string | null; assistant_reply: string }; route: { tier: string; model: string; reasoning_effort: string } }>('/internal/agents/supervision-intent', {
      project_id: projectId,
      message: input.message,
      project_context: projectContext,
      transcript: recentTranscript,
      tier,
      context_packet: researchContext,
      workspace_context: workspaceContext,
    })
    const documentResult = await readableDocumentReply({
      purpose: 'supervise',
      user_message: input.message,
      context: `${JSON.stringify({ project_context: projectContext, workspace_context: workspaceContext })}\n\n${researchContext}`,
      draft_reply: modelResult.result.assistant_reply,
      project_id: projectId,
      workspace_context: workspaceContext,
    })
    const reply = documentResult.result.reply
    let actionRequired = (await existingTurnProposal(projectId, turn.id))?.id || null
    if (!actionRequired && modelResult.result.intent === 'change_request' && modelResult.result.target_field && modelResult.result.proposed_value) {
      actionRequired = await createSimpleTurnProposal({ projectId, turnId: turn.id, kind: 'idea_revision', reason: input.message, summary: `Revise ${modelResult.result.target_field}`, payload: { field: modelResult.result.target_field, value: modelResult.result.proposed_value } })
    } else if (!actionRequired && modelResult.result.intent === 'policy_change' && modelResult.result.policy_rule) {
      actionRequired = await createSimpleTurnProposal({ projectId, turnId: turn.id, kind: 'config_change', reason: input.message, summary: 'Add project policy', payload: { rule: modelResult.result.policy_rule } })
    } else if (!actionRequired && modelResult.result.intent === 'workflow_change_request') {
      const workflowProposal = await createWorkflowEditProposal(projectId, input.message, project as Record<string, unknown>, { originTurnId: turn.id })
      actionRequired = workflowProposal.proposal_id
    } else if (!actionRequired && modelResult.result.intent === 'idea_knowledge_request' && modelResult.result.knowledge_instruction) {
      if (workspaceContext?.area !== 'overview' || workspaceContext.tab !== 'idea') throw new ApiError(422, 'idea_knowledge_workspace_required', 'Idea 长期知识只能从“项目概述 / Idea 讨论”工作区生成。')
      const knowledgeProposal = await createKnowledgeDocumentProposal(projectId, {
        kind: 'idea',
        instruction: modelResult.result.knowledge_instruction,
        session_id: session.id,
      }, { originTurnId: turn.id })
      actionRequired = knowledgeProposal.proposal_id
    }
    const assistantMetadata = {
      routing_tier: tier,
      result_model_tier: 'document',
      model: documentResult.route.model,
      reasoning_effort: documentResult.route.reasoning_effort,
      intent: modelResult.result.intent,
      action_required: actionRequired,
      workspace_scope: scope,
      context_manifest_id: contextPacket.manifest_id,
      context_status: contextPacket.status,
      delivery_status: 'pending',
    }
    await database.transaction(async transaction => {
      await transaction.query(
        `INSERT INTO messages(id,session_id,role,content,metadata,turn_id) VALUES ($1,$2,'assistant',$3,$4,$5)
         ON CONFLICT (session_id,turn_id,role) WHERE turn_id IS NOT NULL DO NOTHING`,
        [turn.assistant_message_id, session.id, reply, assistantMetadata, turn.id],
      )
      await transaction.query("UPDATE conversation_turns SET status='response_ready',updated_at=NOW() WHERE id=$1 AND status='processing'", [turn.id])
    })
    return await finalizeProjectChatTurn({ ...turn, status: 'response_ready' }, input, scope)
  } catch (error) {
    if (error instanceof ApiError) {
      const current = await one<{ status: string }>('SELECT status FROM conversation_turns WHERE id=$1', [turn.id])
      if (current?.status === 'processing') {
        await database.query("UPDATE conversation_turns SET status='failed',last_error_status=$2,last_error_code=$3,last_error_message=$4,updated_at=NOW() WHERE id=$1", [turn.id, error.status, error.code, error.message])
      }
    }
    throw error
  }
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
