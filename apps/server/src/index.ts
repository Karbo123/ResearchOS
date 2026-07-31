import './env.js'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import {
  approvalDecision, chatRequest, emptyIdeaDraft, experimentRequest, modelSettingsRequest,
  policyRequest, projectCreateRequest, projectStateRequest, proposalCreateRequest, reportRequest, repositoryCandidateRequest, uuid,
} from './contracts.js'
import { audit, database, migrate, one, rows } from './database.js'
import { cancelRun, submitRun } from './experiment-runner.js'
import { ApiError, errorResponse, jsonBody } from './http.js'
import { mastraJson } from './mastra-client.js'
import { privateModelSettings, publicModelSettings, saveModelSettings } from './model-settings.js'
import { tierFor } from './model-routing.js'
import { artifactsRoot, pathInside, projectsRoot, publicRoot, runtimeRoot } from './paths.js'
import { createProjectWorkspace, enqueue, projectDetail, requireProject, type ProjectRow } from './project-service.js'
import { createOperationalReport, diagnostics, noveltyAnalysis, searchLiterature } from './research-services.js'
import { ingestEvidence } from './evidence-service.js'
import { createCompileProposal, createPaperDraftProposal } from './paper-service.js'
import { applyApprovedPatch } from './patch-service.js'
import { recoverInterruptedWork, startTaskWorker } from './task-worker.js'
import { scanFile } from './malware-scanner.js'
import { canonicalRepositoryUrl, parseRepositoryUrl, validateDownloadGate, verifyRepositoryCandidate } from './repository-service.js'
import { installRepositoryArchive } from './repository-install-service.js'

type SessionRow = { id: string; project_id: string | null; phase: string; draft: Record<string, unknown> }
type MessageRow = { role: string; content: string }
type ProposalRow = { id: string; project_id: string; kind: string; status: string; payload: Record<string, unknown> }
type ExperimentRow = { id: string; project_id: string; status: string; metrics: Record<string, number>; error: string | null }
type RepositoryRow = { id: string; project_id: string; paper_id: string | null; source_url: string; license_spdx: string | null; commit_or_tag: string | null; verified_official: boolean; metadata: Record<string, unknown>; retrieved_at: string }
type PaperIdentity = { id: string; title: string; doi: string | null }

const app = new Hono()
app.onError(errorResponse)
app.use('/api/uploads', bodyLimit({ maxSize: 50 * 1024 * 1024, onError: context => context.json({ code: 'upload_too_large', message: '文件超过 50 MB 限制。' }, 413) }))

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
  await database.query('INSERT INTO messages(id,session_id,role,content,metadata) VALUES ($1,$2,$3,$4,$5)', [crypto.randomUUID(), session.id, 'user', input.message, { clarification_mode: input.clarification_mode }])
  let reply: string
  let phase = session.phase
  let draft = session.draft
  let actionRequired: string | null = null
  if (session.project_id || input.project_id) {
    const projectId = session.project_id || input.project_id!
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
    if (modelResult.result.intent === 'change_request' && modelResult.result.target_field && modelResult.result.proposed_value) {
      const proposalId = crypto.randomUUID()
      await database.query('INSERT INTO proposals(id,project_id,kind,reason,summary,payload) VALUES ($1,$2,$3,$4,$5,$6)', [proposalId, projectId, 'idea_revision', input.message, `Revise ${modelResult.result.target_field}`, { field: modelResult.result.target_field, value: modelResult.result.proposed_value }])
      actionRequired = proposalId
    } else if (modelResult.result.intent === 'policy_change' && modelResult.result.policy_rule) {
      const proposalId = crypto.randomUUID()
      await database.query('INSERT INTO proposals(id,project_id,kind,reason,summary,payload) VALUES ($1,$2,$3,$4,$5,$6)', [proposalId, projectId, 'config_change', input.message, 'Add project policy', { rule: modelResult.result.policy_rule }])
      actionRequired = proposalId
    }
    await database.query('INSERT INTO messages(id,session_id,role,content,metadata) VALUES ($1,$2,$3,$4,$5)', [crypto.randomUUID(), session.id, 'assistant', reply, { model_tier: tier, intent: modelResult.result.intent }])
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
app.get('/api/mastra/open', context => context.redirect(process.env.MASTRA_STUDIO_URL || 'http://127.0.0.1:4111'))

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
  const slug = `research-${id.slice(0, 8)}`
  await database.transaction(async transaction => {
    await transaction.query('INSERT INTO projects(id,slug,title) VALUES ($1,$2,$3)', [id, slug, title])
    await transaction.query('INSERT INTO idea_versions(id,project_id,version,spec) VALUES ($1,$2,1,$3)', [crypto.randomUUID(), id, { schema_version: '1.0', idea: session.draft }])
    await transaction.query("UPDATE conversation_sessions SET project_id=$2,phase='supervising',updated_at=NOW() WHERE id=$1", [session.id, id])
  })
  try { await createProjectWorkspace(id, slug, { schema_version: '1.0', idea: session.draft }) }
  catch (error) {
    await database.query('DELETE FROM projects WHERE id=$1', [id])
    throw error
  }
  await enqueue(id, 'research_bootstrap', { project_id: id }, `research-bootstrap:${id}:v1`)
  return context.json({ project_id: id, project: { id, slug, title, status: 'active' } }, 201)
})
app.get('/api/projects', async context => {
  const status = context.req.query('status')
  if (status && !['active', 'paused', 'cancelled'].includes(status)) throw new ApiError(422, 'invalid_project_status', '项目状态筛选无效。')
  return context.json(await rows<ProjectRow>(`SELECT * FROM projects${status ? ' WHERE status=$1' : ''} ORDER BY updated_at DESC`, status ? [status] : []))
})
app.get('/api/projects/:projectId', async context => context.json(await projectDetail(uuid.parse(context.req.param('projectId')))))

app.post('/api/search', async context => {
  const body = await jsonBody(context, z.object({ project_id: uuid, query: z.string().max(500).nullable().optional(), limit: z.number().int().min(1).max(30).default(8) }).strict())
  const project = await requireProject(body.project_id, true)
  return context.json(await searchLiterature(body.project_id, body.query || project.title, body.limit))
})
app.get('/api/projects/:projectId/novelty', async context => context.json(await noveltyAnalysis(uuid.parse(context.req.param('projectId')))))
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
  const existing = await one<{ id: string }>("SELECT id FROM proposals WHERE project_id=$1 AND kind='dependency_install' AND status IN ('pending','approved') AND payload->>'repository_id'=$2", [projectId, repositoryId])
  if (existing) throw new ApiError(409, 'repository_download_proposal_exists', '该仓库已经有待处理或已批准的下载 Proposal。')
  const proposalId = crypto.randomUUID()
  await database.query('INSERT INTO proposals(id,project_id,kind,reason,summary,impact,payload) VALUES ($1,$2,$3,$4,$5,$6,$7)', [proposalId, projectId, 'dependency_install', 'User requested a verified repository archive', 'Download verified repository at fixed commit', { repository_id: repositoryId, commit, license_spdx: repository.license_spdx, source_url: repository.source_url }, { repository_id: repositoryId, requested_commit: commit, source_url: repository.source_url, paper_id: repository.paper_id }])
  await audit('proposal.created', projectId, { proposal_id: proposalId, kind: 'dependency_install', repository_id: repositoryId, commit }, 'local-user')
  return context.json({ proposal_id: proposalId, status: 'pending', commit }, 201)
})

app.post('/api/proposals', async context => {
  const body = await jsonBody(context, proposalCreateRequest)
  await requireProject(body.project_id, true)
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
  let gitCommit: string | null = null
  if (body.decision === 'approved' && proposal.kind === 'code_patch') gitCommit = applyApprovedPatch(proposal.project_id, proposal.payload, body.actor)
  let repositoryInstall: Awaited<ReturnType<typeof installRepositoryArchive>> | null = null
  if (body.decision === 'approved' && proposal.kind === 'dependency_install') {
    const repositoryId = uuid.parse(String(proposal.payload.repository_id || ''))
    const repository = await one<RepositoryRow>('SELECT * FROM repositories WHERE id=$1 AND project_id=$2', [repositoryId, proposal.project_id])
    if (!repository || !repository.paper_id) throw new ApiError(404, 'repository_not_found', '待下载的仓库候选不存在。')
    const paper = await one<PaperIdentity>('SELECT id,title,doi FROM papers WHERE id=$1 AND project_id=$2', [repository.paper_id, proposal.project_id])
    if (!paper) throw new ApiError(404, 'paper_not_found', '仓库关联论文不存在。')
    const refreshed = await refreshRepositoryVerification(repository, paper)
    const commit = validateDownloadGate(refreshed, String(proposal.payload.requested_commit || ''))
    repositoryInstall = await installRepositoryArchive(refreshed, body.actor, commit)
  }
  await database.query('UPDATE proposals SET status=$2,decided_by=$3,decision_comment=$4,decided_at=NOW() WHERE id=$1', [proposalId, body.decision, body.actor, body.comment ?? null])
  if (body.decision === 'approved' && proposal.kind === 'config_change' && typeof proposal.payload.rule === 'string') await database.query('INSERT INTO policies(id,project_id,rule,rationale) VALUES ($1,$2,$3,$4)', [crypto.randomUUID(), proposal.project_id, proposal.payload.rule, body.comment ?? null])
  await audit(`proposal.${body.decision}`, proposal.project_id, { proposal_id: proposalId }, body.actor)
  return context.json({ proposal_id: proposalId, status: body.decision, git_commit: gitCommit, repository_install: repositoryInstall })
})

app.post('/api/projects/:projectId/paper-draft', async context => context.json(await createPaperDraftProposal(uuid.parse(context.req.param('projectId'))), 201))
app.post('/api/projects/:projectId/compile-plan', async context => context.json(await createCompileProposal(uuid.parse(context.req.param('projectId'))), 201))
app.post('/api/projects/:projectId/checkpoints/:checkpointId/rerun', async context => {
  const projectId = uuid.parse(context.req.param('projectId'))
  const checkpointId = uuid.parse(context.req.param('checkpointId'))
  const body = await jsonBody(context, z.object({ reason: z.string().min(5).max(2000) }).strict())
  await requireProject(projectId, true)
  const checkpoint = await one<{ state: Record<string, unknown> }>('SELECT state FROM checkpoints WHERE id=$1 AND project_id=$2', [checkpointId, projectId])
  if (!checkpoint || typeof checkpoint.state.source_run_id !== 'string') throw new ApiError(422, 'checkpoint_not_rerunnable', '该检查点不包含可审查的来源运行。')
  const source = await one<{ experiment_type: string; config: Record<string, unknown> }>('SELECT experiment_type,config FROM experiments WHERE id=$1 AND project_id=$2', [checkpoint.state.source_run_id, projectId])
  if (!source) throw new ApiError(404, 'source_experiment_not_found', '来源实验不存在。')
  const proposalId = crypto.randomUUID()
  const config = source.config || {}
  await database.query('INSERT INTO proposals(id,project_id,kind,reason,summary,payload) VALUES ($1,$2,$3,$4,$5,$6)', [proposalId, projectId, 'experiment_plan', body.reason, 'Rerun from reviewed checkpoint', { experiment_type: source.experiment_type, execution_backend: config.execution_backend || 'windows', config, random_seeds: config.random_seeds || [13, 37, 73], topic_plan: config.topic_plan || null, topic_resume: checkpoint.state }])
  return context.json({ proposal_id: proposalId, status: 'pending' }, 201)
})

app.post('/api/experiments', async context => {
  const body = await jsonBody(context, experimentRequest)
  await requireProject(body.project_id, true)
  const proposal = await one<ProposalRow>('SELECT * FROM proposals WHERE id=$1 AND project_id=$2', [body.proposal_id, body.project_id])
  if (!proposal) throw new ApiError(404, 'proposal_not_found', '实验 Proposal 不存在。')
  if (proposal.status !== 'approved') throw new ApiError(409, 'proposal_not_approved', '实验必须先获得明确批准。')
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
  const matches = await rows<Record<string, unknown>>('SELECT id,name,mime_type,size_bytes,sha256,metadata,created_at FROM uploaded_files WHERE project_id=$1 AND (LOWER(name) LIKE $2 OR LOWER(metadata::text) LIKE $2) ORDER BY created_at DESC LIMIT $3 OFFSET $4', [projectId, `%${query.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`, limit, offset])
  return context.json({ items: matches, limit, offset, match_mode: 'deterministic_lexical_metadata_only', evidence_status: 'unverified_material_context' })
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
  const directory = pathInside(artifactsRoot, 'uploads', sessionId)
  mkdirSync(directory, { recursive: true })
  const target = pathInside(directory, `${id}-${safeName}`)
  writeFileSync(target, bytes, { flag: 'wx' })
  try { await scanFile(target) } catch (error) { try { await import('node:fs').then(module => module.rmSync(target)) } catch { /* Preserve scanner error. */ } throw error }
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const relativePath = target.slice(artifactsRoot.length + 1).replaceAll('\\', '/')
  await database.query('INSERT INTO uploaded_files(id,session_id,project_id,name,relative_path,mime_type,size_bytes,sha256,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id, sessionId, session.project_id, safeName, relativePath, file.type || 'application/octet-stream', bytes.length, sha256, { scan: 'windows_defender_clean', evidence_status: 'untrusted_uploaded_material' }])
  return context.json({ artifact_id: id, name: safeName, size_bytes: bytes.length, sha256, evidence_status: 'untrusted_uploaded_material' }, 201)
})

app.get('/api/artifacts/:artifactId', async context => {
  const artifact = await one<Record<string, unknown>>('SELECT * FROM artifacts WHERE id=$1', [uuid.parse(context.req.param('artifactId'))])
  if (!artifact) throw new ApiError(404, 'artifact_not_found', '产物不存在。')
  return context.json(artifact)
})
app.get('/api/artifacts/:artifactId/preview', async context => {
  const artifact = await one<{ relative_path: string; mime_type: string; name: string }>('SELECT relative_path,mime_type,name FROM artifacts WHERE id=$1 AND valid=TRUE', [uuid.parse(context.req.param('artifactId'))])
  if (!artifact) throw new ApiError(404, 'artifact_not_found', '产物不存在或已经失效。')
  const path = pathInside(artifactsRoot, ...artifact.relative_path.split('/'))
  if (!existsSync(path) || statSync(path).size > 20 * 1024 * 1024) throw new ApiError(422, 'artifact_preview_unavailable', '产物缺失或超过预览限制。')
  const textual = /json|text|csv|tab-separated/.test(artifact.mime_type) || ['.json', '.txt', '.csv', '.tsv', '.log', '.ply', '.pcd'].includes(extname(path).toLowerCase())
  return textual ? context.json({ kind: 'text', name: artifact.name, content: readFileSync(path, 'utf8').slice(0, 1_000_000), download_url: `/api/artifacts/${context.req.param('artifactId')}/download` }) : context.json({ kind: 'download', name: artifact.name, download_url: `/api/artifacts/${context.req.param('artifactId')}/download` })
})
app.get('/api/artifacts/:artifactId/download', async context => {
  const artifact = await one<{ relative_path: string; mime_type: string; name: string }>('SELECT relative_path,mime_type,name FROM artifacts WHERE id=$1 AND valid=TRUE', [uuid.parse(context.req.param('artifactId'))])
  if (!artifact) throw new ApiError(404, 'artifact_not_found', '产物不存在或已经失效。')
  const path = pathInside(artifactsRoot, ...artifact.relative_path.split('/'))
  if (!existsSync(path)) throw new ApiError(404, 'artifact_file_missing', '产物文件缺失。')
  context.header('content-type', artifact.mime_type)
  context.header('content-disposition', `attachment; filename="${artifact.name.replaceAll('"', '')}"`)
  return context.body(readFileSync(path))
})

app.use('/*', serveStatic({ root: publicRoot, rewriteRequestPath: path => path === '/' ? '/index.html' : path }))

await migrate()
await recoverInterruptedWork()
const port = Number(process.env.RESEARCH_API_PORT || 8080)
serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, info => console.log(`Research OS native TypeScript server: http://127.0.0.1:${info.port}`))
startTaskWorker()
