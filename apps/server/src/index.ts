import './env.js'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import {
  approvalDecision, chatRequest, emptyIdeaDraft, experimentRequest, modelSettingsRequest, projectEmbeddingSettingsRequest,
  claimReviewDecisionRequest, claimReviewRequest, feedbackProposalRequest, humanFeedbackDecisionRequest, humanFeedbackRequest, memoryIngestRequest, memoryRevokeRequest, memorySearchRequest, policyRequest, projectCreateRequest, projectDeleteRequest, projectOrderRequest, projectPinRequest, projectStateRequest, proposalCreateRequest, reportRequest, repositoryCandidateRequest, repositoryDependencyPlanRequest, repositoryReproductionRunRequest, uuid, voiceSettingsRequest,
} from './contracts.js'
import { audit, database, migrate, one, rows } from './database.js'
import { cancelRun, submitRun } from './experiment-runner.js'
import { ApiError, errorResponse, jsonBody } from './http.js'
import { mastraJson } from './mastra-client.js'
import { privateModelSettings, publicModelSettings, saveModelSettings } from './model-settings.js'
import { publicVoiceSettings, saveVoiceSettings } from './voice-settings.js'
import { transcribeWithGroq } from './voice-transcription.js'
import { tierFor } from './model-routing.js'
import { pathInside, projectsRoot, publicRoot, runtimeRoot } from './paths.js'
import { createProjectWorkspace, enqueue, moveSessionUploadsIntoProject, projectDetail, reorderProjectGroup, requireProject, type ProjectRow } from './project-service.js'
import { nextAvailableProjectSlug, normalizeProjectSlug, normalizeProjectSlugKeywords } from './project-slug.js'
import { createOperationalReport, diagnostics, searchLiterature } from './research-services.js'
import { ingestEvidence } from './evidence-service.js'
import { createCompileProposal, createPaperDraftProposal } from './paper-service.js'
import { applyApprovedPatch, gitCommit as readGitCommit } from './patch-service.js'
import { recoverInterruptedWork, startTaskWorker } from './task-worker.js'
import { scanFile } from './malware-scanner.js'
import { canonicalRepositoryUrl, discoverRepositoryCandidates, parseRepositoryUrl, validateDownloadGate, verifyRepositoryCandidate } from './repository-service.js'
import { applyApprovedIdeaRevision } from './idea-service.js'
import { assertCheckpointRecoverable, invalidateFromNodes } from './impact-service.js'
import { applyMemoryRevocation, ingestConversationMemory, ingestProjectMemory, listProjectMemoryLinks, memoryGraph, memoryStatus, searchProjectMemory, supermemoryEnabled, SupermemoryArtifactError, SupermemoryConfigurationError } from './supermemory-service.js'
import { computedEmbeddingSettings, projectEmbeddingSettings, publicProjectEmbeddingSettings, saveProjectEmbeddingSettings } from './project-embedding-settings.js'
import { projectInstanceStatus, stopPoolInstance } from './supermemory-instance.js'
import { buildArtifactPreview, verifyArtifactFile } from './artifact-preview-service.js'
import { relatedWorkCandidateDecisionRequest, relatedWorkEnrichmentRequest, relatedWorkFieldName, relatedWorkFieldSelectionRequest, relatedWorkRecursivePlanRequest, relatedWorkRunCancelRequest, relatedWorkRunExecuteRequest, relatedWorkSeedRequest } from './related-work/contracts.js'
import { cancelRelatedWorkRun, createRelatedWorkEnrichmentProposal, createRelatedWorkRecursiveProposal, createRelatedWorkSeed, decideRelatedWorkCandidate, executeRelatedWorkEnrichment, relatedWorkRunDetail, resumeQueuedRelatedWorkRuns, selectRelatedWorkField, startRelatedWorkRun } from './related-work/service.js'
import { projectWorkspaceDetail } from './workspace-service.js'
import { researchStatusExportFormat, researchStatusFilterRequest, researchStatusGapCandidateRequest, researchStatusGapDecisionRequest, researchStatusMatrixCreateRequest } from './research-status/contracts.js'
import { createResearchStatusGapCandidate, createResearchStatusMatrix, decideResearchStatusGapCandidate, exportResearchStatus, getResearchStatus } from './research-status/service.js'
import { createDependencyInstallProposal, createRunProposal, downloadRepositoryForReproduction, finalizeReproductionArtifacts, installReproductionDependencies, queueReproductionRun, rejectReproductionArtifacts } from './reproduction-service.js'
import { comparisonCandidateCreateRequest, comparisonCandidateDecisionRequest, researchComparisonRequest } from './research-comparison/contracts.js'
import { createResearchComparison, createResearchComparisonCandidate, decideResearchComparisonCandidate, getResearchComparison, listResearchComparisons } from './research-comparison/service.js'
import { deleteProject } from './project-delete-service.js'
import { migrateProjectArtifactFiles } from './project-artifact-migration.js'
import { migrateProjectSlugs } from './project-slug-migration.js'
import { projectArtifactPath, projectArtifactRelativePath, projectFilePath } from './project-storage.js'

type SessionRow = { id: string; project_id: string | null; phase: string; draft: Record<string, unknown> }
type MessageRow = { role: string; content: string }
type ProposalRow = { id: string; project_id: string; kind: string; status: string; payload: Record<string, unknown>; impact: Record<string, unknown> }
type ExperimentRow = { id: string; project_id: string; status: string; metrics: Record<string, number>; error: string | null }
type RepositoryRow = { id: string; project_id: string; paper_id: string | null; source_url: string; license_spdx: string | null; commit_or_tag: string | null; verified_official: boolean; metadata: Record<string, unknown>; retrieved_at: string }
type PaperIdentity = { id: string; title: string; doi: string | null }

async function projectIdForReference(reference: string): Promise<string> {
  let decoded: string
  try { decoded = decodeURIComponent(reference) } catch { throw new ApiError(404, 'project_not_found', '项目不存在。') }
  const parsed = uuid.safeParse(decoded)
  if (parsed.success) return parsed.data
  const project = await one<{ id: string }>('SELECT id FROM projects WHERE slug=$1 UNION ALL SELECT project_id AS id FROM project_slug_aliases WHERE slug=$1 LIMIT 1', [decoded])
  if (!project) throw new ApiError(404, 'project_not_found', '项目不存在。')
  return project.id
}

export const app = new Hono()
app.onError((error, context) => {
  if (error instanceof SupermemoryConfigurationError || error instanceof SupermemoryArtifactError) {
    return context.json({ code: error.code, message: error.message }, error.status)
  }
  return errorResponse(error, context)
})
app.use('/api/uploads', bodyLimit({ maxSize: 50 * 1024 * 1024, onError: context => context.json({ code: 'upload_too_large', message: '文件超过 50 MB 限制。' }, 413) }))
app.use('/api/voice', bodyLimit({ maxSize: 25 * 1024 * 1024, onError: context => context.json({ code: 'voice_upload_too_large', message: '录音文件超过 25 MB 限制。' }, 413) }))

async function sessionFor(input: z.infer<typeof chatRequest>): Promise<SessionRow> {
  if (input.session_id) {
    const session = await one<SessionRow>('SELECT * FROM conversation_sessions WHERE id=$1', [input.session_id])
    if (!session) throw new ApiError(404, 'session_not_found', '对话会话不存在。')
    if (input.project_id && session.project_id && input.project_id !== session.project_id) throw new ApiError(409, 'session_project_mismatch', '会话不属于该项目。')
    return session
  }
  const session: SessionRow = { id: crypto.randomUUID(), project_id: input.project_id ?? null, phase: input.project_id ? 'supervising' : 'clarifying', draft: emptyIdeaDraft() }
  await database.query('INSERT INTO conversation_sessions(id,project_id,phase,draft) VALUES ($1,$2,$3,$4)', [session.id, session.project_id, session.phase, session.draft])
  return session
}

async function chatTurn(input: z.infer<typeof chatRequest>) {
  const session = await sessionFor(input)
  const transcript = await rows<MessageRow>('SELECT role,content FROM messages WHERE session_id=$1 ORDER BY created_at DESC LIMIT 12', [session.id])
  const tier = tierFor(input.message, input.clarification_mode, input.attachments.length)
  const userMessageId = crypto.randomUUID()
  await database.query('INSERT INTO messages(id,session_id,role,content,metadata) VALUES ($1,$2,$3,$4,$5)', [userMessageId, session.id, 'user', input.message, { clarification_mode: input.clarification_mode }])
  let reply: string
  let phase = session.phase
  let draft = session.draft
  let actionRequired: string | null = null
  if (session.project_id || input.project_id) {
    const projectId = session.project_id || input.project_id!
    if (supermemoryEnabled()) await ingestProjectMemory(projectId, {
      source_type: 'project_chat_message', source_id: userMessageId, artifact_id: null, uploaded_file_id: null,
      content: `user: ${input.message}`, source_url: null, quote: null, locator: null,
      metadata: { session_id: session.id, role: 'user', clarification_mode: input.clarification_mode, evidence_status: 'semantic_candidate' },
      task_type: 'memory', idempotency_key: `project-chat-user:${userMessageId}`,
    })
    const project = await projectDetail(projectId)
    const modelResult = await mastraJson<{ result: { intent: string; target_field: string | null; proposed_value: string | null; policy_rule: string | null; clarification_question: string | null; assistant_reply: string }; route: { tier: string; model: string; reasoning_effort: string } }>('/internal/agents/supervision-intent', {
      message: input.message,
      project_context: project,
      transcript: transcript.reverse(),
      tier,
      memory_resource: `project:${projectId}`,
      memory_thread: `session:${session.id}`,
    })
    reply = modelResult.result.assistant_reply
    const assistantMessageId = crypto.randomUUID()
    if (supermemoryEnabled()) await ingestProjectMemory(projectId, {
      source_type: 'project_chat_message', source_id: assistantMessageId, artifact_id: null, uploaded_file_id: null,
      content: `assistant: ${reply}`, source_url: null, quote: null, locator: null,
      metadata: { session_id: session.id, role: 'assistant', model_tier: tier, intent: modelResult.result.intent, evidence_status: 'semantic_candidate' },
      task_type: 'memory', idempotency_key: `project-chat-assistant:${assistantMessageId}`,
    })
    if (modelResult.result.intent === 'change_request' && modelResult.result.target_field && modelResult.result.proposed_value) {
      const proposalId = crypto.randomUUID()
      await database.query('INSERT INTO proposals(id,project_id,kind,reason,summary,payload) VALUES ($1,$2,$3,$4,$5,$6)', [proposalId, projectId, 'idea_revision', input.message, `Revise ${modelResult.result.target_field}`, { field: modelResult.result.target_field, value: modelResult.result.proposed_value }])
      actionRequired = proposalId
    } else if (modelResult.result.intent === 'policy_change' && modelResult.result.policy_rule) {
      const proposalId = crypto.randomUUID()
      await database.query('INSERT INTO proposals(id,project_id,kind,reason,summary,payload) VALUES ($1,$2,$3,$4,$5,$6)', [proposalId, projectId, 'config_change', input.message, 'Add project policy', { rule: modelResult.result.policy_rule }])
      actionRequired = proposalId
    }
    await database.query('INSERT INTO messages(id,session_id,role,content,metadata) VALUES ($1,$2,$3,$4,$5)', [assistantMessageId, session.id, 'assistant', reply, { model_tier: tier, intent: modelResult.result.intent }])
    return { session_id: session.id, project_id: projectId, phase: 'supervising', reply, spec: null, missing_fields: [], action_required: actionRequired, model_tier: tier, model: modelResult.route.model, reasoning_effort: modelResult.route.reasoning_effort, clarification_mode: input.clarification_mode }
  }
  const modelResult = await mastraJson<{ result: { draft: Record<string, unknown>; assistant_reply: string; ready_for_confirmation: boolean; unresolved_items: string[] }; route: { tier: string; model: string; reasoning_effort: string } }>('/internal/agents/clarify', {
    message: input.message,
    current_draft: session.draft,
    transcript: transcript.reverse(),
    attachment_count: input.attachments.length,
    clarification_mode: input.clarification_mode,
    attachment_context: [],
    attachment_images: [],
    tier,
    memory_resource: `idea:${session.id}`,
    memory_thread: `session:${session.id}`,
  })
  reply = modelResult.result.assistant_reply
  draft = modelResult.result.draft
  phase = modelResult.result.ready_for_confirmation ? 'ready_for_confirmation' : 'clarifying'
  await database.query('UPDATE conversation_sessions SET draft=$2,phase=$3,updated_at=NOW() WHERE id=$1', [session.id, draft, phase])
  await database.query('INSERT INTO messages(id,session_id,role,content,metadata) VALUES ($1,$2,$3,$4,$5)', [crypto.randomUUID(), session.id, 'assistant', reply, { model_tier: tier, clarification_mode: input.clarification_mode }])
  return { session_id: session.id, project_id: null, phase, reply, spec: phase === 'ready_for_confirmation' ? { schema_version: '1.0', idea: draft, feasibility: 'medium', feasibility_notes: [], required_approvals: [], candidate_modifications: [], policies: [] } : null, missing_fields: modelResult.result.unresolved_items, action_required: null, model_tier: tier, model: modelResult.route.model, reasoning_effort: modelResult.route.reasoning_effort, clarification_mode: input.clarification_mode }
}

app.get('/api/health', async context => context.json({ status: 'ok', runtime: 'native-typescript', database: 'pglite', container_runtime_required: false, secrets_exposed: false }))
app.get('/api/settings/models', context => context.json({ tiers: publicModelSettings() }))
app.put('/api/settings/models', async context => {
  const body = await jsonBody(context, modelSettingsRequest)
  return context.json({ tiers: saveModelSettings(body) })
})
app.get('/api/settings/voice', context => context.json(publicVoiceSettings()))
app.put('/api/settings/voice', async context => {
  const body = await jsonBody(context, voiceSettingsRequest)
  return context.json(saveVoiceSettings(body))
})
app.post('/api/voice/transcribe', async context => {
  const form = await context.req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) throw new ApiError(400, 'voice_file_required', '请求必须包含录音文件。')
  if (file.size === 0) throw new ApiError(400, 'voice_file_empty', '录音文件为空。')
  const language = form.get('language')
  const text = await transcribeWithGroq(file, typeof language === 'string' && language ? language : undefined)
  return context.json({ text })
})
app.get('/api/mastra/open', context => context.redirect(process.env.MASTRA_STUDIO_URL || 'http://127.0.0.1:4111'))

app.get('/api/projects/:projectId/memory/status', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  await requireProject(projectId)
  return context.json(await memoryStatus(projectId))
})
app.get('/api/projects/:projectId/embedding-settings', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  await requireProject(projectId)
  const instance = await projectInstanceStatus(projectId)
  return context.json({ ...publicProjectEmbeddingSettings(projectId), instance })
})
app.put('/api/projects/:projectId/embedding-settings', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  await requireProject(projectId)
  const body = await jsonBody(context, projectEmbeddingSettingsRequest)
  const previous = projectEmbeddingSettings(projectId)
  const computed = computedEmbeddingSettings(projectId, body, previous)
  if (computed.settings !== null && computed.reset_required && !body.reset_data) {
    throw new ApiError(409, 'embedding_requires_reset', '切换 embedding 模型或维度会为该项目分配新的配置池（全新数据目录），现有语义记忆需要重新摄入。请确认后重试。')
  }
  const { released_pool_keys } = saveProjectEmbeddingSettings(projectId, body)
  for (const poolKey of released_pool_keys) await stopPoolInstance(poolKey)
  await audit('embedding.settings_updated', projectId, {
    mode: body.mode,
    provider: body.mode === 'custom' ? body.provider : 'global_default',
    model: body.mode === 'custom' ? body.model || undefined : 'global_default',
    dimensions: body.mode === 'custom' ? body.dimensions : undefined,
    pool_key: body.mode === 'custom' ? computed.pool_key : 'global_default',
  })
  const instance = await projectInstanceStatus(projectId)
  return context.json({ ...publicProjectEmbeddingSettings(projectId), instance })
})
app.get('/api/projects/:projectId/memory/links', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  await requireProject(projectId)
  return context.json({ project_id: projectId, links: await listProjectMemoryLinks(projectId) })
})
app.post('/api/projects/:projectId/memory/ingest', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  await requireProject(projectId, true)
  const body = await jsonBody(context, memoryIngestRequest)
  try { return context.json(await ingestProjectMemory(projectId, body), 201) }
  catch (error) {
    if (error instanceof SupermemoryConfigurationError || error instanceof SupermemoryArtifactError) throw new ApiError(error.status, error.code, error.message)
    throw error
  }
})
app.post('/api/projects/:projectId/memory/search', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  await requireProject(projectId)
  const body = await jsonBody(context, memorySearchRequest)
  try { return context.json(await searchProjectMemory(projectId, body.query, body.limit, body.search_mode)) }
  catch (error) { if (error instanceof SupermemoryConfigurationError) throw new ApiError(error.status, error.code, error.message); throw error }
})
app.post('/api/projects/:projectId/memory/links/:linkId/revoke', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  const linkId = uuid.parse(context.req.param('linkId'))
  await requireProject(projectId, true)
  const body = await jsonBody(context, memoryRevokeRequest)
  const link = await one<{ id: string; status: string; project_id: string }>('SELECT id,status,project_id FROM memory_links WHERE id=$1 AND project_id=$2', [linkId, projectId])
  if (!link) throw new ApiError(404, 'memory_link_not_found', '项目语义记忆关联不存在。')
  if (link.status !== 'active') throw new ApiError(409, 'memory_link_not_active', '只有 active 语义记忆可以撤销或删除。')
  const proposalId = crypto.randomUUID()
  await database.query('INSERT INTO proposals(id,project_id,kind,reason,summary,payload,impact) VALUES ($1,$2,$3,$4,$5,$6,$7)', [proposalId, projectId, 'memory_revoke', body.reason, 'Revoke project semantic memory', { memory_link_id: linkId, operation: body.operation }, { memory_link_id: linkId, operation: body.operation, external_side_effect: true }])
  await audit('memory.revoke_proposal_created', projectId, { proposal_id: proposalId, memory_link_id: linkId, operation: body.operation })
  return context.json({ proposal_id: proposalId, status: 'pending' }, 201)
})
app.post('/api/projects/:projectId/memory/graph', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  await requireProject(projectId)
  const body = await jsonBody(context, z.object({ query: z.string().min(1).max(2000), limit: z.number().int().min(1).max(20) }).strict())
  try { return context.json(await memoryGraph(projectId, body.query, body.limit)) }
  catch (error) { if (error instanceof SupermemoryConfigurationError) throw new ApiError(error.status, error.code, error.message); throw error }
})

app.get('/api/sessions/:sessionId/messages', async context => {
  const sessionId = uuid.parse(context.req.param('sessionId'))
  const session = await one<{ id: string }>('SELECT id FROM conversation_sessions WHERE id=$1', [sessionId])
  if (!session) throw new ApiError(404, 'session_not_found', '对话会话不存在。')
  const messages = await rows<Record<string, unknown>>('SELECT id,role,content,metadata,created_at FROM messages WHERE session_id=$1 ORDER BY created_at,id', [sessionId])
  return context.json({ session_id: sessionId, messages })
})

app.post('/api/chat', async context => context.json(await chatTurn(await jsonBody(context, chatRequest))))
app.post('/api/chat/stream', async context => {
  const body = await jsonBody(context, chatRequest)
  return streamSSE(context, async stream => {
    await stream.writeSSE({ event: 'stage', data: JSON.stringify({ stage: 'model_request' }) })
    try { await stream.writeSSE({ event: 'result', data: JSON.stringify(await chatTurn(body)) }) }
    catch (error) {
      const failure = error instanceof ApiError ? { code: error.code, message: error.message, status: error.status } : { code: 'internal_error', message: '服务器处理请求失败。', status: 500 }
      await stream.writeSSE({ event: 'error', data: JSON.stringify(failure) })
    }
  })
})

app.post('/api/projects', async context => {
  const body = await jsonBody(context, projectCreateRequest)
  const session = await one<SessionRow>('SELECT * FROM conversation_sessions WHERE id=$1', [body.session_id])
  if (!session) throw new ApiError(404, 'session_not_found', '对话会话不存在。')
  if (session.phase !== 'ready_for_confirmation') throw new ApiError(409, 'idea_not_ready', '研究 Idea 尚未达到可确认状态。')
  const id = crypto.randomUUID()
  const title = typeof session.draft.title === 'string' ? session.draft.title : 'Untitled Research Project'
  let slug: string
  if (body.slug?.trim()) {
    try { slug = normalizeProjectSlug(body.slug) }
    catch { throw new ApiError(422, 'project_slug_invalid', '项目地址标识必须由两个英文小写单词和四位小写字母或数字组成，并用连字符连接。') }
    if (await one<{ id: string }>('SELECT id FROM projects WHERE slug=$1 UNION ALL SELECT project_id AS id FROM project_slug_aliases WHERE slug=$1 LIMIT 1', [slug])) throw new ApiError(409, 'project_slug_conflict', '这个项目地址标识已经被使用，请换两个词和四位后缀。')
  } else {
    const slugResult = await mastraJson<{ result: { keywords: string[] } }>('/internal/agents/project-slug', { idea: session.draft, tier: 'medium' })
    try { slug = await nextAvailableProjectSlug(normalizeProjectSlugKeywords(slugResult.result.keywords)) }
    catch (error) {
      if (error instanceof Error && error.message === 'project_slug_invalid') throw new ApiError(422, 'project_slug_generation_failed', '模型生成的项目地址标识未提供严格的两个语义词格式。')
      throw new ApiError(503, 'project_slug_unavailable', '暂时无法生成唯一的项目地址标识，请稍后重试。')
    }
  }
  await database.transaction(async transaction => {
    const nextOrder = (await transaction.query<{ next_order: number }>('SELECT COALESCE(MAX(sidebar_order),-1)+1 AS next_order FROM projects WHERE pinned=FALSE')).rows[0]?.next_order || 0
    await transaction.query('INSERT INTO projects(id,slug,title,sidebar_order) VALUES ($1,$2,$3,$4)', [id, slug, title, nextOrder])
    await transaction.query('INSERT INTO idea_versions(id,project_id,version,spec) VALUES ($1,$2,1,$3)', [crypto.randomUUID(), id, { schema_version: '1.0', idea: session.draft }])
    await transaction.query("UPDATE conversation_sessions SET project_id=$2,phase='supervising',updated_at=NOW() WHERE id=$1", [session.id, id])
    await transaction.query('UPDATE uploaded_files SET project_id=$2 WHERE session_id=$1 AND project_id IS NULL', [session.id, id])
  })
  try { await createProjectWorkspace(id, slug, { schema_version: '1.0', idea: session.draft }) }
  catch (error) {
    await database.query('DELETE FROM projects WHERE id=$1', [id])
    throw error
  }
  try { await moveSessionUploadsIntoProject(id, session.id) }
  catch (error) {
    await database.query('DELETE FROM projects WHERE id=$1', [id]).catch(() => undefined)
    throw new ApiError(500, 'project_upload_migration_failed', error instanceof Error ? error.message : '项目上传文件迁移失败。')
  }
  if (supermemoryEnabled()) {
    try { await ingestConversationMemory(id, session.id) }
    catch (error) {
      if (error instanceof SupermemoryConfigurationError || error instanceof SupermemoryArtifactError) throw new ApiError(error.status, error.code, error.message)
      throw error
    }
    const uploadedFiles = await rows<{ id: string }>('SELECT id FROM uploaded_files WHERE session_id=$1 AND project_id=$2 ORDER BY created_at,id', [session.id, id])
    for (const uploadedFile of uploadedFiles) await enqueue(id, 'material_index', { uploaded_file_id: uploadedFile.id }, `material-index:${uploadedFile.id}`)
  }
  await enqueue(id, 'research_bootstrap', { project_id: id }, `research-bootstrap:${id}:v1`)
  return context.json({ project_id: id, project: { id, slug, title, status: 'active' } }, 201)
})
app.get('/api/projects', async context => {
  const status = context.req.query('status')
  if (status && !['active', 'paused', 'cancelled'].includes(status)) throw new ApiError(422, 'invalid_project_status', '项目状态筛选无效。')
  return context.json(await rows<ProjectRow>(`SELECT * FROM projects${status ? ' WHERE status=$1' : ''} ORDER BY pinned DESC,sidebar_order ASC,updated_at DESC,created_at DESC,id`, status ? [status] : []))
})
app.patch('/api/projects/order', async context => {
  const body = await jsonBody(context, projectOrderRequest)
  const ordered = await reorderProjectGroup(body.project_ids)
  await audit('project.reordered', body.project_ids[0] || null, { project_ids: body.project_ids, pinned: ordered.find(project => project.id === body.project_ids[0])?.pinned || false })
  return context.json(ordered)
})
app.get('/api/projects/:projectRef', async context => context.json(await projectDetail(await projectIdForReference(context.req.param('projectRef')))))
app.patch('/api/projects/:projectId/pin', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  const body = await jsonBody(context, projectPinRequest)
  await requireProject(projectId)
  const project = await database.transaction(async transaction => {
    const current = (await transaction.query<ProjectRow>('SELECT * FROM projects WHERE id=$1 FOR UPDATE', [projectId])).rows[0]
    if (!current) return null
    if (current.pinned === body.pinned) return current
    const nextOrder = (await transaction.query<{ next_order: number }>('SELECT COALESCE(MAX(sidebar_order),-1)+1 AS next_order FROM projects WHERE pinned=$1', [body.pinned])).rows[0]?.next_order || 0
    return (await transaction.query<ProjectRow>('UPDATE projects SET pinned=$2,sidebar_order=$3,updated_at=NOW() WHERE id=$1 RETURNING *', [projectId, body.pinned, nextOrder])).rows[0] || null
  })
  if (!project) throw new ApiError(404, 'project_not_found', '项目不存在。')
  await audit(body.pinned ? 'project.pinned' : 'project.unpinned', projectId, { pinned: body.pinned })
  return context.json(project)
})
app.delete('/api/projects/:projectId', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  const body = await jsonBody(context, projectDeleteRequest)
  return context.json(await deleteProject(projectId, body.project_title, body.confirmation))
})
app.get('/api/projects/:projectId/workspace', async context => context.json(await projectWorkspaceDetail(uuid.parse(context.req.param('projectId')))))

app.post('/api/projects/:projectId/related-work/seeds', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  const body = await jsonBody(context, relatedWorkSeedRequest)
  return context.json(await createRelatedWorkSeed(projectId, body), 201)
})
app.post('/api/projects/:projectId/related-work/candidates/:candidateId/decision', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  const candidateId = uuid.parse(context.req.param('candidateId'))
  const body = await jsonBody(context, relatedWorkCandidateDecisionRequest)
  return context.json(await decideRelatedWorkCandidate(projectId, candidateId, body))
})
app.post('/api/projects/:projectId/related-work/candidates/:candidateId/fields/:fieldName/select', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  const candidateId = uuid.parse(context.req.param('candidateId'))
  const fieldName = relatedWorkFieldName.parse(context.req.param('fieldName'))
  const body = await jsonBody(context, relatedWorkFieldSelectionRequest)
  return context.json(await selectRelatedWorkField(projectId, candidateId, fieldName, body))
})
app.post('/api/projects/:projectId/related-work/candidate-enrichment', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  const body = await jsonBody(context, relatedWorkEnrichmentRequest)
  return context.json(await createRelatedWorkEnrichmentProposal(projectId, body), 201)
})
app.post('/api/projects/:projectId/related-work/recursive-plan', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  const body = await jsonBody(context, relatedWorkRecursivePlanRequest)
  return context.json(await createRelatedWorkRecursiveProposal(projectId, body), 201)
})
app.get('/api/projects/:projectId/related-work/runs/:runId', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  const runId = uuid.parse(context.req.param('runId'))
  return context.json(await relatedWorkRunDetail(projectId, runId))
})
app.post('/api/projects/:projectId/related-work/runs/:runId/execute', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  const runId = uuid.parse(context.req.param('runId'))
  const body = await jsonBody(context, relatedWorkRunExecuteRequest)
  const run = await one<{ id: string; proposal_id: string }>('SELECT id,proposal_id FROM related_work_recursive_runs WHERE id=$1 AND project_id=$2', [runId, projectId])
  if (!run) throw new ApiError(404, 'related_work_run_not_found', '相关工作递归运行不存在。')
  return context.json(await startRelatedWorkRun(projectId, run.proposal_id, body.actor))
})
app.post('/api/projects/:projectId/related-work/runs/:runId/cancel', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  const runId = uuid.parse(context.req.param('runId'))
  const body = await jsonBody(context, relatedWorkRunCancelRequest)
  return context.json(await cancelRelatedWorkRun(projectId, runId, body.reason, body.actor))
})

app.post('/api/search', async context => {
  const body = await jsonBody(context, z.object({ project_id: uuid, query: z.string().max(500).nullable().optional(), limit: z.number().int().min(1).max(30).default(8) }).strict())
  const project = await requireProject(body.project_id, true)
  return context.json(await searchLiterature(body.project_id, body.query || project.title, body.limit))
})
app.get('/api/projects/:projectId/research-status', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  const filter = researchStatusFilterRequest.parse({
    matrix_id: context.req.query('matrix_id') || undefined,
    theme: context.req.query('theme') || undefined,
    method: context.req.query('method') || undefined,
    year: context.req.query('year') || undefined,
  })
  return context.json(await getResearchStatus(projectId, filter))
})
app.post('/api/projects/:projectId/research-status/matrices', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  const body = await jsonBody(context, researchStatusMatrixCreateRequest)
  return context.json(await createResearchStatusMatrix(projectId, body), 201)
})
app.get('/api/projects/:projectId/research-status/export', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  const format = researchStatusExportFormat.parse(context.req.query('format') || 'json')
  const matrixId = context.req.query('matrix_id') || null
  const filter = researchStatusFilterRequest.parse({ matrix_id: matrixId || undefined })
  const exported = await exportResearchStatus(projectId, matrixId, filter, format)
  return new Response(exported.content, { status: 200, headers: { 'content-type': exported.contentType, 'content-disposition': `attachment; filename="${exported.filename}"` } })
})
app.post('/api/projects/:projectId/research-status/gap-candidates', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  const body = await jsonBody(context, researchStatusGapCandidateRequest)
  return context.json(await createResearchStatusGapCandidate(projectId, body), 201)
})
app.post('/api/projects/:projectId/research-status/gap-candidates/:candidateId/decision', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  const candidateId = uuid.parse(context.req.param('candidateId'))
  const body = await jsonBody(context, researchStatusGapDecisionRequest)
  return context.json(await decideResearchStatusGapCandidate(projectId, candidateId, body))
})
app.post('/api/projects/:projectId/evidence/ingest', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  const body = await jsonBody(context, z.object({ limit: z.number().int().min(1).max(10).default(3) }).strict())
  return context.json(await ingestEvidence(projectId, body.limit))
})

async function refreshRepositoryVerification(repository: RepositoryRow, paper: PaperIdentity): Promise<RepositoryRow> {
  const verification = await verifyRepositoryCandidate(repository.source_url, paper.title, paper.doi)
  const updated = {
    ...repository,
    license_spdx: typeof verification.license_spdx === 'string' ? verification.license_spdx : null,
    commit_or_tag: typeof verification.commit === 'string' ? verification.commit : null,
    verified_official: verification.official_match === true,
    metadata: { ...repository.metadata, verification },
  }
  await database.query('UPDATE repositories SET license_spdx=$2,commit_or_tag=$3,verified_official=$4,metadata=$5,retrieved_at=NOW() WHERE id=$1', [repository.id, updated.license_spdx, updated.commit_or_tag, updated.verified_official, updated.metadata])
  return updated
}

app.get('/api/projects/:projectId/papers/:paperId/repositories/discover', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  const paperId = uuid.parse(context.req.param('paperId'))
  await requireProject(projectId)
  const paper = await one<{ id: string; source_url: string; metadata: unknown }>('SELECT id,source_url,metadata FROM papers WHERE id=$1 AND project_id=$2', [paperId, projectId])
  if (!paper) throw new ApiError(404, 'paper_not_found', '该文献不属于当前项目。')
  return context.json({
    project_id: projectId,
    paper_id: paperId,
    candidates: discoverRepositoryCandidates(paper),
    evidence_status: 'candidate_requires_repository_and_paper_verification',
    limitations: ['只读取 Paper 已保存的 URL/metadata，不根据标题猜仓库；用户仍需逐个验证论文与仓库的官方关系、许可证、固定 commit、入口、依赖、数据和运行要求。'],
  })
})

app.post('/api/projects/:projectId/repositories', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  const body = await jsonBody(context, repositoryCandidateRequest)
  await requireProject(projectId, true)
  const paper = await one<PaperIdentity>('SELECT id,title,doi FROM papers WHERE id=$1 AND project_id=$2', [body.paper_id, projectId])
  if (!paper) throw new ApiError(404, 'paper_not_found', '该文献不属于当前项目。')
  const sourceUrl = canonicalRepositoryUrl(parseRepositoryUrl(body.source_url))
  const existing = await one<{ id: string }>('SELECT id FROM repositories WHERE project_id=$1 AND paper_id=$2 AND source_url=$3', [projectId, paper.id, sourceUrl])
  if (existing) throw new ApiError(409, 'repository_candidate_exists', '该项目已经添加过这个仓库候选。')
  const repositoryId = crypto.randomUUID()
  await database.query('INSERT INTO repositories(id,project_id,paper_id,source_url,metadata) VALUES ($1,$2,$3,$4,$5)', [repositoryId, projectId, paper.id, sourceUrl, { candidate_source: 'user_submitted', paper_title: paper.title, paper_doi: paper.doi }])
  await audit('repository.candidate_created', projectId, { repository_id: repositoryId, paper_id: paper.id, source_url: sourceUrl }, 'local-user')
  return context.json({ repository_id: repositoryId, status: 'candidate' }, 201)
})

app.post('/api/projects/:projectId/repositories/:repositoryId/verify', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  const repositoryId = uuid.parse(context.req.param('repositoryId'))
  await requireProject(projectId, true)
  const repository = await one<RepositoryRow>('SELECT * FROM repositories WHERE id=$1 AND project_id=$2', [repositoryId, projectId])
  if (!repository) throw new ApiError(404, 'repository_not_found', '仓库候选不存在。')
  if (!repository.paper_id) throw new ApiError(422, 'repository_paper_missing', '仓库候选没有关联论文。')
  const paper = await one<PaperIdentity>('SELECT id,title,doi FROM papers WHERE id=$1 AND project_id=$2', [repository.paper_id, projectId])
  if (!paper) throw new ApiError(404, 'paper_not_found', '仓库关联论文不存在。')
  const updated = await refreshRepositoryVerification(repository, paper)
  await audit('repository.verified', projectId, { repository_id: repositoryId, official_match: updated.verified_official, commit: updated.commit_or_tag, license_spdx: updated.license_spdx }, 'local-user')
  return context.json({ repository_id: repositoryId, verified_official: updated.verified_official, verification: updated.metadata.verification })
})

app.post('/api/projects/:projectId/repositories/:repositoryId/download', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  const repositoryId = uuid.parse(context.req.param('repositoryId'))
  await requireProject(projectId, true)
  const repository = await one<RepositoryRow>('SELECT * FROM repositories WHERE id=$1 AND project_id=$2', [repositoryId, projectId])
  if (!repository) throw new ApiError(404, 'repository_not_found', '仓库候选不存在。')
  const commit = validateDownloadGate(repository)
  const existing = await one<{ id: string }>("SELECT id FROM proposals WHERE project_id=$1 AND kind='repository_download' AND status='pending' AND payload->>'repository_id'=$2", [projectId, repositoryId])
  if (existing) throw new ApiError(409, 'repository_download_proposal_exists', '该仓库已经有待审批的下载 Proposal。')
  const proposalId = crypto.randomUUID()
  await database.query('INSERT INTO proposals(id,project_id,kind,reason,summary,impact,payload) VALUES ($1,$2,$3,$4,$5,$6,$7)', [proposalId, projectId, 'repository_download', 'User requested a verified repository archive', 'Download verified repository to the isolated reproduction area', { repository_id: repositoryId, commit, license_spdx: repository.license_spdx, source_url: repository.source_url }, { repository_id: repositoryId, requested_commit: commit, source_url: repository.source_url, paper_id: repository.paper_id }])
  await audit('proposal.created', projectId, { proposal_id: proposalId, kind: 'repository_download', repository_id: repositoryId, commit }, 'local-user')
  return context.json({ proposal_id: proposalId, status: 'pending', commit }, 201)
})

app.post('/api/projects/:projectId/reproductions/:reproductionId/dependency-plan', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  const reproductionId = uuid.parse(context.req.param('reproductionId'))
  const body = await jsonBody(context, repositoryDependencyPlanRequest)
  await requireProject(projectId, true)
  return context.json(await createDependencyInstallProposal(projectId, reproductionId, body.dependency_manifest, body.reason), 201)
})

app.get('/api/projects/:projectId/reproductions', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  await requireProject(projectId)
  const reproductions = await rows('SELECT * FROM reproductions WHERE project_id=$1 ORDER BY created_at DESC', [projectId])
  const runs = await rows('SELECT * FROM reproduction_runs WHERE project_id=$1 ORDER BY created_at DESC', [projectId])
  return context.json({ project_id: projectId, reproductions, runs })
})

app.post('/api/projects/:projectId/reproductions/:reproductionId/run-plan', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  const reproductionId = uuid.parse(context.req.param('reproductionId'))
  const body = await jsonBody(context, repositoryReproductionRunRequest)
  await requireProject(projectId, true)
  return context.json(await createRunProposal(projectId, reproductionId, body), 201)
})
app.post('/api/projects/:projectId/research-comparisons', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  const body = await jsonBody(context, researchComparisonRequest)
  return context.json(await createResearchComparison(projectId, body), 201)
})
app.get('/api/projects/:projectId/research-comparisons', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  return context.json(await listResearchComparisons(projectId))
})
app.get('/api/projects/:projectId/research-comparisons/:comparisonId', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  const comparisonId = uuid.parse(context.req.param('comparisonId'))
  return context.json(await getResearchComparison(projectId, comparisonId))
})
app.post('/api/projects/:projectId/research-comparisons/:comparisonId/candidates', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  const comparisonId = uuid.parse(context.req.param('comparisonId'))
  const body = await jsonBody(context, comparisonCandidateCreateRequest)
  return context.json(await createResearchComparisonCandidate(projectId, comparisonId, body), 201)
})
app.post('/api/projects/:projectId/research-comparisons/:comparisonId/candidates/:candidateId/decision', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  const comparisonId = uuid.parse(context.req.param('comparisonId'))
  const candidateId = uuid.parse(context.req.param('candidateId'))
  const body = await jsonBody(context, comparisonCandidateDecisionRequest)
  return context.json(await decideResearchComparisonCandidate(projectId, comparisonId, candidateId, body))
})

app.post('/api/proposals', async context => {
  const body = await jsonBody(context, proposalCreateRequest)
  await requireProject(body.project_id, true)
  if (body.kind.startsWith('repository_')) throw new ApiError(422, 'repository_proposal_route_required', '仓库复现 Proposal 必须通过受控的阶段 API 创建。')
  const id = crypto.randomUUID()
  await database.query('INSERT INTO proposals(id,project_id,kind,reason,summary,diff,impact,estimated_cost_usd,payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id, body.project_id, body.kind, body.reason, body.summary, body.diff ?? null, body.impact, body.estimated_cost_usd, body.payload])
  await audit('proposal.created', body.project_id, { proposal_id: id, kind: body.kind }, 'local-user')
  return context.json({ proposal_id: id, status: 'pending' }, 201)
})

app.post('/api/projects/:projectId/experiment-plan', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  const project = await projectDetail(projectId)
  if (project.status !== 'active') throw new ApiError(409, 'project_not_active', '项目当前不可执行实验规划。')
  const idea = project.idea_versions[0] as Record<string, unknown> | undefined
  const result = await mastraJson<{ result: Record<string, unknown> }>('/internal/agents/experiment-plan', { project_id: projectId, idea_version: project.current_idea_version, planning_context: { idea: idea?.spec, evidence: project.evidence, policies: project.policies } })
  const proposalId = crypto.randomUUID()
  await database.query('INSERT INTO proposals(id,project_id,kind,reason,summary,payload) VALUES ($1,$2,$3,$4,$5,$6)', [proposalId, projectId, 'experiment_plan', 'Mastra topic-specific plan', 'Topic-specific experiment plan requiring approval', { experiment_type: 'topic_specific', config: {}, random_seeds: result.result.random_seeds, topic_plan: result.result }])
  return context.json({ proposal_id: proposalId, status: 'pending' }, 201)
})

app.post('/api/proposals/:proposalId/decision', async context => {
  const proposalId = uuid.parse(context.req.param('proposalId'))
  const body = await jsonBody(context, approvalDecision)
  const proposal = await one<ProposalRow>('SELECT * FROM proposals WHERE id=$1', [proposalId])
  if (!proposal) throw new ApiError(404, 'proposal_not_found', 'Proposal 不存在。')
  if (proposal.status !== 'pending') throw new ApiError(409, 'proposal_already_decided', 'Proposal 已经完成决策。')
  if (body.decision === 'approved' && proposal.kind === 'dependency_install' && typeof proposal.payload.repository_id === 'string') throw new ApiError(422, 'legacy_repository_proposal_unsupported', '旧的仓库 dependency_install Proposal 已淘汰，请重新从代码复现页面创建四阶段审批链。')
  const mastraApprovalFields = [body.mastra_run_id, body.tool_name, body.args_fingerprint, body.policy_version]
  if (mastraApprovalFields.some(value => value !== undefined && value !== null) && mastraApprovalFields.some(value => !value)) {
    throw new ApiError(422, 'mastra_approval_binding_incomplete', 'Mastra 审批必须同时绑定 run、工具、参数指纹和策略版本。')
  }
  let gitCommit: string | null = null
  let lineageInvalidation: unknown = null
  if (body.decision === 'approved' && proposal.kind === 'code_patch') {
    const previousGitCommit = typeof proposal.payload.base_git_commit === 'string' ? proposal.payload.base_git_commit : null
    gitCommit = applyApprovedPatch(proposal.project_id, proposal.payload, body.actor)
    if (previousGitCommit) lineageInvalidation = await invalidateFromNodes(proposal.project_id, [{ type: 'git_commit', id: previousGitCommit }], 'approved_code_change', body.actor)
  }
  let ideaRevision: unknown = null
  if (body.decision === 'approved' && proposal.kind === 'idea_revision') ideaRevision = await applyApprovedIdeaRevision(proposal.project_id, proposal.payload, body.actor)
  let repositoryDownload: Awaited<ReturnType<typeof downloadRepositoryForReproduction>> | null = null
  if (body.decision === 'approved' && proposal.kind === 'repository_download') {
    const repositoryId = uuid.parse(String(proposal.payload.repository_id || ''))
    const repository = await one<RepositoryRow>('SELECT * FROM repositories WHERE id=$1 AND project_id=$2', [repositoryId, proposal.project_id])
    if (!repository || !repository.paper_id) throw new ApiError(404, 'repository_not_found', '待下载的仓库候选不存在。')
    const paper = await one<PaperIdentity>('SELECT id,title,doi FROM papers WHERE id=$1 AND project_id=$2', [repository.paper_id, proposal.project_id])
    if (!paper) throw new ApiError(404, 'paper_not_found', '仓库关联论文不存在。')
    const refreshed = await refreshRepositoryVerification(repository, paper)
    const commit = validateDownloadGate(refreshed, String(proposal.payload.requested_commit || ''))
    repositoryDownload = await downloadRepositoryForReproduction(refreshed, body.actor, commit)
  }
  let reproductionDependencies: Awaited<ReturnType<typeof installReproductionDependencies>> | null = null
  if (body.decision === 'approved' && proposal.kind === 'repository_dependency_install') {
    const reproductionId = uuid.parse(String(proposal.payload.reproduction_id || ''))
    const dependencyManifest = String(proposal.payload.dependency_manifest || '')
    const dependencySha256 = String(proposal.payload.dependency_sha256 || '')
    reproductionDependencies = await installReproductionDependencies(proposal.project_id, reproductionId, dependencyManifest, dependencySha256, body.actor)
  }
  let reproductionRun: { run_id: string; task_id: string; status: string } | null = null
  if (body.decision === 'approved' && proposal.kind === 'repository_reproduction_run') reproductionRun = await queueReproductionRun(proposal.project_id, proposalId, proposal.payload)
  let reproductionArtifacts: { reproduction_run_id: string; artifact_ids: string[] } | null = null
  if (body.decision === 'approved' && proposal.kind === 'repository_artifact_write') reproductionArtifacts = await finalizeReproductionArtifacts(proposal.project_id, proposalId, body.actor)
  if (body.decision === 'rejected' && proposal.kind === 'repository_artifact_write') await rejectReproductionArtifacts(proposal.project_id, proposalId, body.actor, body.comment || 'local-user rejected the reproduction artifact registration')
  let memoryRevocation: unknown = null
  if (body.decision === 'approved' && proposal.kind === 'memory_revoke') {
    const memoryLinkId = uuid.parse(String(proposal.payload.memory_link_id || ''))
    const operation = proposal.payload.operation === 'delete' ? 'delete' : 'forget'
    try { memoryRevocation = await applyMemoryRevocation(proposal.project_id, memoryLinkId, operation, body.actor) }
    catch (error) {
      if (error instanceof SupermemoryConfigurationError || error instanceof SupermemoryArtifactError) throw new ApiError(error.status, error.code, error.message)
      throw error
    }
  }
  let automaticExecution: Record<string, unknown> | null = null
  if (body.decision === 'approved' && proposal.kind === 'experiment_rerun') {
    const checkpointId = uuid.parse(String(proposal.payload.checkpoint_id || ''))
    const recovered = await assertCheckpointRecoverable(proposal.project_id, checkpointId)
    const project = await requireProject(proposal.project_id, true)
    if (Number(recovered.checkpoint.idea_version) !== project.current_idea_version) throw new ApiError(409, 'checkpoint_idea_version_stale', '检查点属于旧 Idea 版本，不能直接恢复。')
    const currentGit = readGitCommit(proposal.project_id)
    if (typeof recovered.checkpoint.git_commit === 'string' && recovered.checkpoint.git_commit !== currentGit) throw new ApiError(409, 'checkpoint_git_base_changed', '检查点 Git 基线已变化，不能直接恢复。')
    const source = recovered.sourceRun
    const sourceConfig = (source.config || {}) as Record<string, unknown>
    const rerunRequest = experimentRequest.parse({
      project_id: proposal.project_id,
      proposal_id: proposalId,
      experiment_type: proposal.payload.experiment_type,
      execution_backend: proposal.payload.execution_backend,
      config: sourceConfig,
      random_seeds: proposal.payload.random_seeds,
      topic_plan: proposal.payload.topic_plan ?? null,
      topic_resume: { ...(recovered.checkpoint.state as Record<string, unknown>), recovery_checkpoint_id: checkpointId },
    })
    const runId = crypto.randomUUID()
    await database.query('INSERT INTO experiments(id,project_id,proposal_id,experiment_type,config,run_id) VALUES ($1,$2,$3,$4,$5,$6)', [runId, proposal.project_id, proposalId, rerunRequest.experiment_type, { ...rerunRequest.config, execution_backend: rerunRequest.execution_backend, random_seeds: rerunRequest.random_seeds, topic_plan: rerunRequest.topic_plan ?? null, topic_resume: rerunRequest.topic_resume }, runId])
    submitRun(runId, rerunRequest)
    automaticExecution = { status: 'queued', run_id: runId, checkpoint_id: checkpointId }
  }
  const impact = automaticExecution ? { ...proposal.impact, automatic_execution: automaticExecution } : proposal.impact
  await database.query('UPDATE proposals SET status=$2,decided_by=$3,decision_comment=$4,impact=$5,decided_at=NOW() WHERE id=$1', [proposalId, body.decision, body.actor, body.comment ?? null, impact])
  let relatedWorkRun: { run_id: string; status: string } | null = null
  if (body.decision === 'approved' && proposal.kind === 'related_work_recursive') relatedWorkRun = await startRelatedWorkRun(proposal.project_id, proposalId, body.actor)
  let relatedWorkEnrichment: Record<string, unknown> | null = null
  if (body.decision === 'approved' && proposal.kind === 'related_work_field_enrichment') relatedWorkEnrichment = await executeRelatedWorkEnrichment(proposal.project_id, proposalId, body.actor)
  if (body.decision === 'approved' && proposal.kind === 'config_change' && typeof proposal.payload.rule === 'string') await database.query('INSERT INTO policies(id,project_id,rule,rationale) VALUES ($1,$2,$3,$4)', [crypto.randomUUID(), proposal.project_id, proposal.payload.rule, body.comment ?? null])
  await audit(`proposal.${body.decision}`, proposal.project_id, {
    proposal_id: proposalId,
    mastra_approval: body.mastra_run_id ? {
      run_id: body.mastra_run_id,
      tool_name: body.tool_name,
      args_fingerprint: body.args_fingerprint,
      policy_version: body.policy_version,
    } : null,
  }, body.actor)
  return context.json({ proposal_id: proposalId, status: body.decision, git_commit: gitCommit, idea_revision: ideaRevision, repository_download: repositoryDownload, reproduction_dependencies: reproductionDependencies, reproduction_run: reproductionRun, reproduction_artifacts: reproductionArtifacts, lineage_invalidation: lineageInvalidation, automatic_execution: automaticExecution, memory_revocation: memoryRevocation, related_work_run: relatedWorkRun, related_work_enrichment: relatedWorkEnrichment })
})

app.post('/api/projects/:projectId/paper-draft', async context => context.json(await createPaperDraftProposal(uuid.parse(context.req.param('projectId'))), 201))
app.post('/api/projects/:projectId/compile-plan', async context => context.json(await createCompileProposal(uuid.parse(context.req.param('projectId'))), 201))
app.post('/api/projects/:projectId/checkpoints/:checkpointId/rerun', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  const checkpointId = uuid.parse(context.req.param('checkpointId'))
  const body = await jsonBody(context, z.object({ reason: z.string().min(5).max(2000) }).strict())
  const project = await requireProject(projectId, true)
  const recovered = await assertCheckpointRecoverable(projectId, checkpointId)
  if (Number(recovered.checkpoint.idea_version) !== project.current_idea_version) throw new ApiError(409, 'checkpoint_idea_version_stale', '检查点属于旧 Idea 版本，不能直接恢复。')
  const currentGit = readGitCommit(projectId)
  if (typeof recovered.checkpoint.git_commit === 'string' && recovered.checkpoint.git_commit !== currentGit) throw new ApiError(409, 'checkpoint_git_base_changed', '检查点 Git 基线已变化，不能直接恢复。')
  const source = recovered.sourceRun
  const sourceConfig = (source.config || {}) as Record<string, unknown>
  const state = recovered.checkpoint.state as Record<string, unknown>
  const proposalId = crypto.randomUUID()
  const payload = { checkpoint_id: checkpointId, experiment_type: source.experiment_type, execution_backend: sourceConfig.execution_backend, config: sourceConfig, random_seeds: sourceConfig.random_seeds, topic_plan: sourceConfig.topic_plan ?? null, topic_resume: { ...state, recovery_checkpoint_id: checkpointId }, expected_idea_version: project.current_idea_version, expected_git_commit: currentGit }
  await database.query('INSERT INTO proposals(id,project_id,kind,reason,summary,impact,payload) VALUES ($1,$2,$3,$4,$5,$6,$7)', [proposalId, projectId, 'experiment_rerun', body.reason, 'Recover approved experiment from verified checkpoint', { checkpoint_id: checkpointId, recovery_mode: 'exact_dependency_and_git_match' }, payload])
  return context.json({ proposal_id: proposalId, status: 'pending' }, 201)
})

app.post('/api/experiments', async context => {
  const body = await jsonBody(context, experimentRequest)
  await requireProject(body.project_id, true)
  const proposal = await one<ProposalRow>('SELECT * FROM proposals WHERE id=$1 AND project_id=$2', [body.proposal_id, body.project_id])
  if (!proposal) throw new ApiError(404, 'proposal_not_found', '实验 Proposal 不存在。')
  if (proposal.status !== 'approved') throw new ApiError(409, 'proposal_not_approved', '实验必须先获得明确批准。')
  if (proposal.kind !== 'experiment_plan') throw new ApiError(409, 'experiment_proposal_kind_invalid', '只有新的实验计划 Proposal 可以手动提交；检查点恢复由批准流程自动提交。')
  const runId = crypto.randomUUID()
  await database.query('INSERT INTO experiments(id,project_id,proposal_id,experiment_type,config,run_id) VALUES ($1,$2,$3,$4,$5,$6)', [runId, body.project_id, body.proposal_id, body.experiment_type, { ...body.config, execution_backend: body.execution_backend, random_seeds: body.random_seeds, topic_plan: body.topic_plan ?? null }, runId])
  submitRun(runId, body)
  return context.json({ run_id: runId, status: 'queued' }, 202)
})
app.post('/api/experiments/:runId/sync', async context => {
  const run = await one<ExperimentRow>('SELECT * FROM experiments WHERE id=$1', [uuid.parse(context.req.param('runId'))])
  if (!run) throw new ApiError(404, 'experiment_not_found', '实验运行不存在。')
  return context.json(run)
})
app.post('/api/experiments/:runId/cancel', async context => {
  const runId = uuid.parse(context.req.param('runId'))
  const run = await one<ExperimentRow>('SELECT * FROM experiments WHERE id=$1', [runId])
  if (!run) throw new ApiError(404, 'experiment_not_found', '实验运行不存在。')
  if (!['queued', 'running'].includes(run.status)) throw new ApiError(409, 'experiment_not_cancellable', '该实验已经处于终态。')
  await cancelRun(runId)
  return context.json({ run_id: runId, status: 'cancelled' })
})

app.post('/api/projects/:projectId/diagnostics', async context => context.json(await diagnostics(uuid.parse(context.req.param('projectId')))))
app.post('/api/policies', async context => {
  const body = await jsonBody(context, policyRequest)
  await requireProject(body.project_id, true)
  const proposalId = crypto.randomUUID()
  await database.query('INSERT INTO proposals(id,project_id,kind,reason,summary,payload) VALUES ($1,$2,$3,$4,$5,$6)', [proposalId, body.project_id, 'config_change', body.rationale || 'User requested a durable project policy', 'Add project policy', { rule: body.rule }])
  return context.json({ proposal_id: proposalId, status: 'pending' }, 201)
})
app.post('/api/reports', async context => {
  const body = await jsonBody(context, reportRequest)
  if (body.notify) throw new ApiError(501, 'notifications_not_implemented', '原生通知适配器尚未实现。')
  return context.json(await createOperationalReport(body.project_id, body.period))
})
app.post('/api/projects/:projectId/feedback', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  await requireProject(projectId, true)
  const body = await jsonBody(context, humanFeedbackRequest)
  if (body.session_id) {
    const session = await one<{ id: string; project_id: string | null }>('SELECT id,project_id FROM conversation_sessions WHERE id=$1', [body.session_id])
    if (!session || session.project_id !== projectId) throw new ApiError(409, 'feedback_session_project_mismatch', 'feedback 会话不属于当前项目。')
  }
  const feedbackId = crypto.randomUUID()
  if (supermemoryEnabled()) await ingestProjectMemory(projectId, {
    source_type: 'manual', source_id: feedbackId, artifact_id: null, uploaded_file_id: null,
    content: body.instruction, source_url: null, quote: null, locator: null,
    metadata: {
      category: body.category,
      ...(body.session_id ? { session_id: body.session_id } : {}),
      ...(body.reference_id ? { reference_id: body.reference_id } : {}),
      evidence_status: 'semantic_feedback_requires_review',
    },
    task_type: 'memory', idempotency_key: `feedback:${feedbackId}`,
  })
  await database.query('INSERT INTO human_feedback(id,project_id,session_id,reference_id,category,instruction) VALUES ($1,$2,$3,$4,$5,$6)', [feedbackId, projectId, body.session_id ?? null, body.reference_id ?? null, body.category, body.instruction])
  await audit('human_feedback.created', projectId, { feedback_id: feedbackId, category: body.category, reference_id: body.reference_id ?? null }, 'local-user')
  return context.json({ id: feedbackId, project_id: projectId, status: 'recorded', semantic_memory: supermemoryEnabled() ? 'active' : 'disabled' }, 201)
})
app.get('/api/projects/:projectId/feedback', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  await requireProject(projectId)
  return context.json({ project_id: projectId, feedback: await rows('SELECT * FROM human_feedback WHERE project_id=$1 ORDER BY created_at DESC', [projectId]) })
})
app.post('/api/projects/:projectId/feedback/:feedbackId/decision', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  const feedbackId = uuid.parse(context.req.param('feedbackId'))
  await requireProject(projectId)
  const body = await jsonBody(context, humanFeedbackDecisionRequest)
  const feedback = await one<{ id: string; status: string }>('SELECT id,status FROM human_feedback WHERE id=$1 AND project_id=$2', [feedbackId, projectId])
  if (!feedback) throw new ApiError(404, 'feedback_not_found', '当前项目中不存在该反馈。')
  if (feedback.status !== 'open') throw new ApiError(409, 'feedback_already_decided', '该反馈已经完成决策。')
  await database.query('UPDATE human_feedback SET status=$2,decided_by=$3,decision_comment=$4,decided_at=NOW() WHERE id=$1 AND project_id=$5', [feedbackId, body.decision, body.actor, body.comment ?? null, projectId])
  await audit(`human_feedback.${body.decision}`, projectId, { feedback_id: feedbackId, comment: body.comment ?? null }, body.actor)
  return context.json({ id: feedbackId, project_id: projectId, status: body.decision })
})
app.post('/api/projects/:projectId/feedback/:feedbackId/proposal', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  const feedbackId = uuid.parse(context.req.param('feedbackId'))
  await requireProject(projectId, true)
  const body = await jsonBody(context, feedbackProposalRequest)
  const feedback = await one<{ id: string; status: string; instruction: string; reference_id: string | null }>('SELECT id,status,instruction,reference_id FROM human_feedback WHERE id=$1 AND project_id=$2', [feedbackId, projectId])
  if (!feedback) throw new ApiError(404, 'feedback_not_found', '当前项目中不存在该反馈。')
  if (feedback.status === 'rejected') throw new ApiError(409, 'feedback_rejected', '被拒绝的反馈不能创建 Proposal。')
  const proposalId = crypto.randomUUID()
  const payload = { ...body.payload, feedback_id: feedbackId, feedback_reference_id: feedback.reference_id, feedback_instruction: feedback.instruction }
  await database.query('INSERT INTO proposals(id,project_id,kind,reason,summary,diff,impact,estimated_cost_usd,payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [proposalId, projectId, body.kind, body.reason, body.summary, body.diff ?? null, { source: 'human_feedback', feedback_id: feedbackId }, body.estimated_cost_usd, payload])
  await database.query("UPDATE human_feedback SET status='proposal_created' WHERE id=$1 AND project_id=$2", [feedbackId, projectId])
  await audit('human_feedback.proposal_created', projectId, { feedback_id: feedbackId, proposal_id: proposalId, kind: body.kind }, 'local-user')
  return context.json({ proposal_id: proposalId, feedback_id: feedbackId, status: 'pending' }, 201)
})
app.get('/api/projects/:projectId/claim-reviews', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  await requireProject(projectId)
  return context.json({ project_id: projectId, reviews: await rows('SELECT * FROM claim_reviews WHERE project_id=$1 ORDER BY created_at DESC', [projectId]) })
})
app.post('/api/projects/:projectId/claim-reviews', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  await requireProject(projectId)
  const body = await jsonBody(context, claimReviewRequest)
  const evidence = await rows<{ id: string }>('SELECT id FROM evidence WHERE project_id=$1 AND id = ANY($2::uuid[])', [projectId, body.evidence_ids])
  if (evidence.length !== body.evidence_ids.length) throw new ApiError(403, 'claim_review_evidence_scope', 'claim review 只能引用当前项目的 evidence。')
  const id = crypto.randomUUID()
  await database.query('INSERT INTO claim_reviews(id,project_id,claim,evidence_ids) VALUES ($1,$2,$3,$4)', [id, projectId, body.claim, body.evidence_ids])
  await audit('claim_review.created', projectId, { claim_review_id: id, evidence_ids: body.evidence_ids, evidence_status: 'page_quote_requires_claim_review' }, 'local-user')
  return context.json({ id, project_id: projectId, status: 'pending', evidence_status: 'page_quote_requires_claim_review' }, 201)
})
app.post('/api/projects/:projectId/claim-reviews/:reviewId/decision', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  const reviewId = uuid.parse(context.req.param('reviewId'))
  await requireProject(projectId)
  const body = await jsonBody(context, claimReviewDecisionRequest)
  const review = await one<{ id: string; status: string }>('SELECT id,status FROM claim_reviews WHERE id=$1 AND project_id=$2', [reviewId, projectId])
  if (!review) throw new ApiError(404, 'claim_review_not_found', 'claim review 不存在。')
  if (review.status !== 'pending') throw new ApiError(409, 'claim_review_already_decided', 'claim review 已经完成决策。')
  await database.query('UPDATE claim_reviews SET status=$2,reviewer=$3,decision_comment=$4,decided_at=NOW() WHERE id=$1 AND project_id=$5', [reviewId, body.decision, body.actor, body.comment ?? null, projectId])
  await audit(`claim_review.${body.decision}`, projectId, { claim_review_id: reviewId, comment: body.comment ?? null, evidence_status: 'page_quote_requires_claim_review' }, body.actor)
  return context.json({ id: reviewId, project_id: projectId, status: body.decision, evidence_status: 'page_quote_requires_claim_review' })
})
app.get('/api/projects/:projectId/audit', async context => context.json(await rows('SELECT * FROM audit_events WHERE project_id=$1 ORDER BY created_at DESC', [uuid.parse(context.req.param('projectId'))])))
app.post('/api/projects/:projectId/state', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  const body = await jsonBody(context, projectStateRequest)
  const project = await requireProject(projectId)
  if (project.status === 'cancelled') throw new ApiError(409, 'project_cancelled', '已取消项目不能恢复。')
  const target = body.action === 'pause' ? 'paused' : body.action === 'resume' ? 'active' : 'cancelled'
  if (body.action === 'resume' && project.status !== 'paused') throw new ApiError(409, 'project_not_paused', '只有暂停项目可以恢复。')
  await database.query('UPDATE projects SET status=$2,updated_at=NOW() WHERE id=$1', [projectId, target])
  if (body.action !== 'resume') {
    const active = await rows<{ id: string }>("SELECT id FROM experiments WHERE project_id=$1 AND status IN ('queued','running')", [projectId])
    for (const run of active) await cancelRun(run.id)
  }
  await database.query('INSERT INTO checkpoints(id,project_id,stage,idea_version,state) VALUES ($1,$2,$3,$4,$5)', [crypto.randomUUID(), projectId, `project_${target}`, project.current_idea_version, { reason: body.reason }])
  await audit(`project.${target}`, projectId, { reason: body.reason }, 'local-user')
  return context.json({ project_id: projectId, status: target })
})

app.get('/api/projects/:projectId/materials/search', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  await requireProject(projectId)
  const query = (context.req.query('q') || '').trim().toLowerCase()
  const limit = Math.min(50, Math.max(1, Number(context.req.query('limit') || 20)))
  const offset = Math.max(0, Number(context.req.query('offset') || 0))
  if (!query || query.length > 200) throw new ApiError(422, 'invalid_material_query', '材料查询不能为空且不能超过 200 字符。')
  if (offset > 0) throw new ApiError(422, 'material_search_pagination_unsupported', 'Supermemory 语义检索当前不支持本地 offset 分页。')
  const result = await searchProjectMemory(projectId, query, Math.min(20, limit), 'hybrid')
  return context.json({
    project_id: projectId,
    total_matches: result.total,
    next_offset: null,
    match_mode: 'supermemory_project_scoped_hybrid',
    evidence_status: 'semantic_candidates_not_scientific_evidence',
    results: result.results.map(item => {
      const metadata = (item.metadata || {}) as Record<string, unknown>
      return {
      id: item.id,
      name: String(metadata.artifact_name || metadata.source_id || item.id || '语义候选'),
      kind: item.source_type || 'material',
      parse_status: metadata.parse_status || 'semantic_indexed',
      sha256: metadata.artifact_sha256 || metadata.content_sha256 || null,
      snippet: item.memory,
      similarity: item.similarity,
      source_type: item.source_type,
      source_id: item.source_id,
      uploaded_file_id: item.uploaded_file_id,
      locator: metadata.locator || null,
      }
    }),
  })
})

app.post('/api/uploads', async context => {
  const form = await context.req.formData()
  const sessionId = uuid.parse(String(form.get('session_id') || ''))
  const file = form.get('file')
  if (!(file instanceof File)) throw new ApiError(422, 'upload_file_missing', '缺少上传文件。')
  const session = await one<SessionRow>('SELECT * FROM conversation_sessions WHERE id=$1', [sessionId])
  if (!session) throw new ApiError(404, 'session_not_found', '对话会话不存在。')
  const safeName = basename(file.name).replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 180)
  if (!safeName || ['.exe', '.dll', '.bat', '.cmd', '.ps1', '.msi'].includes(extname(safeName).toLowerCase())) throw new ApiError(422, 'upload_type_forbidden', '该文件类型不允许上传。')
  const bytes = Buffer.from(await file.arrayBuffer())
  const id = crypto.randomUUID()
  const relativePath = session.project_id
    ? projectArtifactRelativePath(`uploads/${sessionId}/${id}-${safeName}`)
    : `staging/uploads/${sessionId}/${id}-${safeName}`
  const target = session.project_id
    ? projectArtifactPath(session.project_id, relativePath)
    : pathInside(runtimeRoot, ...relativePath.split('/'))
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, bytes, { flag: 'wx' })
  try { await scanFile(target) } catch (error) { try { await import('node:fs').then(module => module.rmSync(target)) } catch { /* Preserve scanner error. */ } throw error }
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  await database.query('INSERT INTO uploaded_files(id,session_id,project_id,name,relative_path,mime_type,size_bytes,sha256,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id, sessionId, session.project_id, safeName, relativePath, file.type || 'application/octet-stream', bytes.length, sha256, { scan: 'windows_defender_clean', evidence_status: 'untrusted_uploaded_material' }])
  let indexTask: { id: string } | null = null
  if (session.project_id && supermemoryEnabled()) indexTask = await enqueue(session.project_id, 'material_index', { uploaded_file_id: id }, `material-index:${id}`)
  return context.json({ artifact_id: id, name: safeName, size_bytes: bytes.length, sha256, evidence_status: 'untrusted_uploaded_material', semantic_index_status: indexTask ? 'queued' : 'disabled', index_task_id: indexTask?.id ?? null }, 201)
})

app.get('/api/projects/:projectId/artifacts/:artifactId/preview', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  const artifactId = uuid.parse(context.req.param('artifactId'))
  await requireProject(projectId)
  const artifact = await one<{ relative_path: string; mime_type: string; name: string; sha256: string; valid: boolean }>('SELECT relative_path,mime_type,name,sha256,valid FROM artifacts WHERE id=$1 AND project_id=$2', [artifactId, projectId])
  if (!artifact) throw new ApiError(404, 'artifact_not_found', '项目中不存在该产物或产物已经失效。')
  if (!artifact.valid) throw new ApiError(409, 'artifact_invalidated', '该产物已经因上游依赖变化而失效，不能继续预览。')
  const path = projectFilePath(projectId, artifact.relative_path)
  if (!existsSync(path)) throw new ApiError(404, 'artifact_file_missing', '产物文件缺失。')
  try {
    await verifyArtifactFile(path, artifact.sha256)
    return context.json(buildArtifactPreview(path, artifact.name, artifact.mime_type, `/api/projects/${projectId}/artifacts/${artifactId}/download`))
  } catch (error) {
    const code = error instanceof Error ? error.message : 'artifact_preview_unavailable'
    throw new ApiError(422, code, '产物预览不可用或不符合受控预览契约。')
  }
})
app.get('/api/projects/:projectId/artifacts/:artifactId/download', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  const artifactId = uuid.parse(context.req.param('artifactId'))
  await requireProject(projectId)
  const artifact = await one<{ relative_path: string; mime_type: string; name: string; sha256: string; valid: boolean }>('SELECT relative_path,mime_type,name,sha256,valid FROM artifacts WHERE id=$1 AND project_id=$2', [artifactId, projectId])
  if (!artifact) throw new ApiError(404, 'artifact_not_found', '项目中不存在该产物或产物已经失效。')
  if (!artifact.valid) throw new ApiError(409, 'artifact_invalidated', '该产物已经因上游依赖变化而失效，不能下载。')
  const path = projectFilePath(projectId, artifact.relative_path)
  if (!existsSync(path)) throw new ApiError(404, 'artifact_file_missing', '产物文件缺失。')
  try { await verifyArtifactFile(path, artifact.sha256) }
  catch (error) {
    const code = error instanceof Error ? error.message : 'artifact_integrity_failed'
    throw new ApiError(code === 'artifact_hash_mismatch' ? 409 : 422, code, code === 'artifact_hash_mismatch' ? '产物内容已经变化，不能继续下载。' : '产物必须是完整的普通文件。')
  }
  context.header('content-type', artifact.mime_type)
  context.header('content-disposition', `attachment; filename="${artifact.name.replaceAll('"', '')}"`)
  return context.body(readFileSync(path))
})

// HTML must always revalidate so UI/CSS fixes reach browsers immediately;
// versioned assets (app.js/styles.css?v=...) remain cacheable by default.
app.get('/project/*', context => {
  context.header('Cache-Control', 'no-cache')
  context.header('Content-Type', 'text/html; charset=UTF-8')
  return context.body(readFileSync(resolve(publicRoot, 'index.html')))
})
app.use('/*', async (context, next) => {
  if (context.req.path === '/' || context.req.path === '/index.html') context.header('Cache-Control', 'no-cache')
  await next()
})
app.use('/*', serveStatic({ root: publicRoot, rewriteRequestPath: path => path === '/' ? '/index.html' : path }))
app.notFound(context => {
  const requestPath = context.req.path
  if (requestPath === '/api' || requestPath.startsWith('/api/')) {
    return context.json({ code: 'not_found', message: '请求地址不存在。' }, 404)
  }
  const acceptsHtml = (context.req.header('accept') || '').includes('text/html')
  if (context.req.method === 'GET' && acceptsHtml) {
    context.header('Cache-Control', 'no-cache')
    context.header('Content-Type', 'text/html; charset=UTF-8')
    return context.body(readFileSync(resolve(publicRoot, 'index.html')))
  }
  return context.json({ code: 'not_found', message: '请求地址不存在。' }, 404)
})

const isTestRuntime = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true'
if (!isTestRuntime) {
  await migrate()
  await migrateProjectSlugs()
  await migrateProjectArtifactFiles()
  await recoverInterruptedWork()
  await resumeQueuedRelatedWorkRuns()
  const port = Number(process.env.RESEARCH_API_PORT || 8080)
  serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, info => console.log(`Research OS native TypeScript server: http://127.0.0.1:${info.port}`))
  startTaskWorker()
}
