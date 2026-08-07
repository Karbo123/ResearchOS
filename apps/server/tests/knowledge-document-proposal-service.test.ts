import { existsSync, readFileSync, rmSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { contextPacket, type ContextPacket } from '../src/context-planner-contracts.js'
import { buildContextPacket } from '../src/context-planner.js'
import { database, migrate, one } from '../src/database.js'
import { app } from '../src/index.js'
import {
  createManualKnowledgeDocumentProposal,
  createKnowledgeDocumentProposal,
  proposedKnowledgeSource,
} from '../src/knowledge-document-proposal-service.js'
import { readKnowledgeDocument } from '../src/knowledge-document-service.js'
import { parseKnowledgeMarkdown } from '../src/knowledge-markdown-parser.js'
import { gitCommit } from '../src/patch-service.js'
import { pathInside } from '../src/paths.js'
import { createProjectWorkspace } from '../src/project-service.js'
import { projectRoot } from '../src/project-storage.js'
import { testProjectSlug } from './test-project.js'

const projectId = testProjectSlug('memory-proposal')
const otherProjectId = testProjectSlug('memory-foreign')
const ideaVersionId = crypto.randomUUID()
const paperId = crypto.randomUUID()
const evidenceId = crypto.randomUUID()
const executionProposalId = crypto.randomUUID()
const experimentId = crypto.randomUUID()
const artifactId = crypto.randomUUID()

const generated = vi.fn(async () => ({
  markdown_body: '## 当前结论\n\n这是严格受来源边界约束的候选正文。',
  summary: '生成一份待审批的科研知识文档',
  open_verification_items: ['复核原始证据和用户决定。'],
}))

const fakeBuildContext: typeof buildContextPacket = async input => {
  const manifestId = crypto.randomUUID()
  const packet: ContextPacket = contextPacket.parse({
    id: manifestId,
    project_id: input.project_id,
    status: 'complete',
    plan: {
      project_id: input.project_id,
      purpose: input.purpose || 'project_chat',
      workspace_scope: input.workspace_scope || 'overview/overview',
      query: input.query || '',
      requested_document_ids: input.requested_document_ids || [],
      direct_document_ids: [],
      search_mode: input.search_mode || 'hybrid',
      max_documents: 8,
      token_budget: 8_000,
      output_reserve: 2_000,
    },
    blocks: [],
    excluded: [],
    included_tokens: 0,
    search: { mode: input.search_mode || 'hybrid', attempted: false, result_count: 0, local_result_count: 0, filtered_stale_results: 0, blocked_code: null },
    manifest_id: manifestId,
  })
  return packet
}

async function approve(proposalId: string): Promise<Record<string, unknown>> {
  const response = await app.request(`/api/proposals/${proposalId}/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decision: 'approved', actor: 'memory-v2-test' }),
  })
  expect(response.status).toBe(200)
  return response.json() as Promise<Record<string, unknown>>
}

describe('Memory v2 knowledge document proposals', () => {
  beforeAll(async () => {
    await migrate()
    await database.query('INSERT INTO projects(id,slug,title) VALUES ($1,$1,$2)', [projectId, 'Memory proposal test'])
    await database.query('INSERT INTO projects(id,slug,title) VALUES ($1,$1,$2)', [otherProjectId, 'Foreign memory graph test'])
    await createProjectWorkspace(projectId, projectId, { idea: { title: 'Memory proposal test', research_question: 'How should controlled research knowledge be organized?' } })
    await database.query('INSERT INTO idea_versions(id,project_id,version,spec,change_reason) VALUES ($1,$2,1,$3,$4)', [ideaVersionId, projectId, { schema_version: '1.0', idea: { title: 'Memory proposal test', research_question: 'How should controlled research knowledge be organized?' } }, 'test fixture'])
    await database.query('INSERT INTO papers(id,project_id,title,doi,source_url,metadata,bibtex,verified,confirmed) VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,TRUE)', [paperId, projectId, 'Controlled Memory Retrieval', '10.1000/memory', 'https://example.invalid/paper', { provider: 'test-provider', provenance: { operation: 'fixture' } }, '@article{memory,title={Controlled Memory Retrieval}}'])
    await database.query('INSERT INTO evidence(id,project_id,paper_id,claim,quote,locator,source_url,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [evidenceId, projectId, paperId, 'The method uses scoped retrieval.', 'Scoped retrieval is applied before generation.', 'p. 4, Sec. 3', 'https://example.invalid/paper', { provenance: 'fixture' }])
    await database.query('INSERT INTO proposals(id,project_id,kind,status,reason,summary,payload) VALUES ($1,$2,$3,$4,$5,$6,$7)', [executionProposalId, projectId, 'experiment_plan', 'approved', 'Controlled test experiment', 'Controlled test experiment', { experiment_type: 'topic_specific' }])
    await database.query('INSERT INTO experiments(id,project_id,proposal_id,status,experiment_type,config,metrics,run_id,finished_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())', [experimentId, projectId, executionProposalId, 'succeeded', 'retrieval_benchmark', { seed: 13, dataset: 'fixture' }, { accuracy: 0.91, latency_ms: 42 }, 'run-memory-001'])
    await database.query('INSERT INTO artifacts(id,project_id,experiment_id,kind,name,relative_path,mime_type,sha256,metadata,valid) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE)', [artifactId, projectId, experimentId, 'experiment_output', 'metrics.json', `artifacts/runs/${experimentId}/metrics.json`, 'application/json', 'a'.repeat(64), {}])
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
    await database.query('DELETE FROM context_manifests WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM artifacts WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM experiments WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM evidence WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM papers WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM proposals WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM idea_versions WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM audit_events WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM projects WHERE id=ANY($1::varchar[])', [[projectId, otherProjectId]])
    rmSync(projectRoot(projectId), { recursive: true, force: true })
  })

  it('creates one pending Idea write proposal and applies it through Git, reconcile, lineage and indexing queue', async () => {
    const beforeCommit = gitCommit(projectId)
    const result = await createKnowledgeDocumentProposal(projectId, { kind: 'idea', instruction: '把当前稳定的 Idea 与方法讨论整理为长期知识。' }, { generate: generated, buildContext: fakeBuildContext })
    expect(result).toMatchObject({ status: 'pending', document_id: 'idea:current', relative_path: 'research/idea/current.md' })
    const proposal = await one<{ kind: string; status: string; payload: Record<string, unknown>; diff: string }>('SELECT kind,status,payload,diff FROM proposals WHERE id=$1', [result.proposal_id])
    expect(proposal).toMatchObject({ kind: 'knowledge_document_patch', status: 'pending', payload: { patch_kind: 'knowledge_document', document_id: 'idea:current', context_manifest_id: result.context_manifest_id } })
    expect(proposal?.diff).toContain('+++ b/research/idea/current.md')
    await expect(createKnowledgeDocumentProposal(projectId, { kind: 'idea', instruction: '再次生成同一份 Idea 文档。' }, { generate: generated, buildContext: fakeBuildContext })).rejects.toMatchObject({ code: 'knowledge_document_proposal_pending' })

    const decision = await approve(result.proposal_id)
    expect(decision).toMatchObject({ status: 'approved', knowledge_document: { document_id: 'idea:current', index_task: { queued: true } } })
    expect(gitCommit(projectId)).not.toBe(beforeCommit)
    const document = await readKnowledgeDocument(projectId, 'idea:current')
    expect(document.parsed.frontmatter).toMatchObject({ kind: 'idea', status: 'confirmed', depends_on: [expect.objectContaining({ id: `idea_version:${ideaVersionId}` })] })
    expect(document.source).toContain('证据边界')
    expect(await one('SELECT id FROM lineage_dependencies WHERE project_id=$1 AND downstream_type=$2 AND downstream_id=$3 AND upstream_type=$4 AND upstream_id=$5', [projectId, 'knowledge_document', 'idea:current', 'idea_version', ideaVersionId])).not.toBeNull()
    expect(await one('SELECT id FROM tasks WHERE project_id=$1 AND kind=$2 AND payload->>\'document_id\'=$3', [projectId, 'knowledge_reindex', 'idea:current'])).not.toBeNull()
    expect(existsSync(pathInside(projectRoot(projectId), 'research', 'idea', 'current.md'))).toBe(true)
  })

  it('preserves paper read scope, provider provenance, Evidence locators and confirmation in an independent summary', async () => {
    const result = await createKnowledgeDocumentProposal(projectId, { kind: 'paper_summary', paper_id: paperId, read_scope: 'partial' }, { generate: generated, buildContext: fakeBuildContext })
    const proposal = await one<{ payload: Record<string, unknown> }>('SELECT payload FROM proposals WHERE id=$1', [result.proposal_id])
    const source = proposedKnowledgeSource(proposal!.payload)
    const parsed = parseKnowledgeMarkdown(source, projectId, result.relative_path)
    expect(parsed.frontmatter).toMatchObject({ kind: 'paper_summary', paper_id: paperId, evidence_ids: [evidenceId], read_scope: 'partial', status: 'confirmed' })
    expect(source).toContain('p. 4, Sec. 3')
    expect(source).toContain('Provider provenance 指纹')
    expect(JSON.stringify(proposal?.payload.source_snapshot)).toContain('test-provider')
    await approve(result.proposal_id)
  })

  it('turns a manual Markdown edit into a hash-bound diff Proposal instead of writing directly', async () => {
    const current = await readKnowledgeDocument(projectId, 'idea:current')
    const edited = current.source.replace('这是严格受来源边界约束的候选正文。', '这是经过手工修订、仍受来源边界约束的候选正文。')
    const result = await createManualKnowledgeDocumentProposal(projectId, { document_id: 'idea:current', expected_sha256: current.row.current_sha256, source: edited, reason: '人工修订当前 Idea 的措辞并保留原有证据边界。' })
    expect((await readKnowledgeDocument(projectId, 'idea:current')).source).toBe(current.source)
    const proposal = await one<{ diff: string; payload: Record<string, unknown> }>('SELECT diff,payload FROM proposals WHERE id=$1', [result.proposal_id])
    expect(proposal?.diff).toContain('手工修订')
    expect(proposal).toMatchObject({ payload: { context_manifest_id: null, operations: [expect.objectContaining({ action: 'replace', expected_sha256: current.row.current_sha256 })] } })
    await approve(result.proposal_id)
    expect((await readKnowledgeDocument(projectId, 'idea:current')).source).toContain('手工修订')
  })

  it('only synthesizes confirmed papers with confirmed per-paper summaries and labels novelty as a candidate', async () => {
    const result = await createKnowledgeDocumentProposal(projectId, { kind: 'related_work_synthesis', paper_ids: [paperId] }, { generate: generated, buildContext: fakeBuildContext })
    const proposal = await one<{ payload: Record<string, unknown> }>('SELECT payload FROM proposals WHERE id=$1', [result.proposal_id])
    const source = proposedKnowledgeSource(proposal!.payload)
    expect(source).toContain('所有 gap、cluster、novelty 和优越性描述均为待核验候选')
    expect(source).toContain('paper:controlled-memory-retrieval-')
    const parsed = parseKnowledgeMarkdown(source, projectId, 'research/related-work/synthesis.md')
    expect(parsed.frontmatter.kind).toBe('related_work_synthesis')
    expect(parsed.frontmatter.depends_on).toEqual([expect.objectContaining({ relation: 'synthesizes', impact: 'review_required' })])
  })

  it('rejects invented metrics and renders authoritative immutable run results from Experiment and Artifact rows', async () => {
    await expect(createKnowledgeDocumentProposal(projectId, { kind: 'run_result', experiment_id: experimentId, track: 'method' }, {
      buildContext: fakeBuildContext,
      generate: async () => ({ markdown_body: '## 解释\n\n模型声称准确率是 0.95。', summary: '非法数值测试', open_verification_items: [] }),
    })).rejects.toMatchObject({ code: 'knowledge_model_metric_ungrounded' })

    const result = await createKnowledgeDocumentProposal(projectId, { kind: 'run_result', experiment_id: experimentId, track: 'method' }, { generate: generated, buildContext: fakeBuildContext })
    const proposal = await one<{ payload: Record<string, unknown> }>('SELECT payload FROM proposals WHERE id=$1', [result.proposal_id])
    const source = proposedKnowledgeSource(proposal!.payload)
    expect(source).toContain('"accuracy":0.91')
    expect(source).toContain('"latency_ms":42')
    expect(source).toContain(artifactId)
    expect(source).toContain('a'.repeat(64))
    const metricsBefore = await one<{ metrics: Record<string, number>; status: string }>('SELECT metrics,status FROM experiments WHERE id=$1', [experimentId])
    await approve(result.proposal_id)
    await expect(createKnowledgeDocumentProposal(projectId, { kind: 'run_result', experiment_id: experimentId, track: 'method' }, { generate: generated, buildContext: fakeBuildContext })).rejects.toMatchObject({ code: 'run_result_document_immutable' })
    expect(await one<{ metrics: Record<string, number>; status: string }>('SELECT metrics,status FROM experiments WHERE id=$1', [experimentId])).toEqual(metricsBefore)
    const registered = await readKnowledgeDocument(projectId, result.document_id)
    expect(readFileSync(pathInside(projectRoot(projectId), ...result.relative_path.split('/')), 'utf8')).toBe(registered.source)
  }, 15_000)

  it('creates experiment plans, multi-run synthesis, and section writing briefs without executing downstream work', async () => {
    const plan = await createKnowledgeDocumentProposal(projectId, { kind: 'experiment_plan', experiment_id: experimentId, track: 'method', instruction: '整理该实验的受控计划与停止条件。' }, { generate: generated, buildContext: fakeBuildContext })
    const planProposal = await one<{ payload: Record<string, unknown>; impact: Record<string, unknown> }>('SELECT payload,impact FROM proposals WHERE id=$1', [plan.proposal_id])
    const planSource = proposedKnowledgeSource(planProposal!.payload)
    expect(planSource).toContain(`Experiment ID：${experimentId}`)
    expect(planSource).toContain('本 Markdown 不直接启动实验')
    expect(planProposal?.impact).toMatchObject({ automatic_execution: false, requires_separate_downstream_proposals: true })
    await approve(plan.proposal_id)

    const synthesis = await createKnowledgeDocumentProposal(projectId, { kind: 'experiment_synthesis', experiment_id: experimentId, related_experiment_ids: [], track: 'method' }, { generate: generated, buildContext: fakeBuildContext })
    const synthesisProposal = await one<{ payload: Record<string, unknown>; impact: Record<string, unknown> }>('SELECT payload,impact FROM proposals WHERE id=$1', [synthesis.proposal_id])
    const synthesisSource = proposedKnowledgeSource(synthesisProposal!.payload)
    const parsedSynthesis = parseKnowledgeMarkdown(synthesisSource, projectId, synthesis.relative_path)
    expect(parsedSynthesis.frontmatter.depends_on).toEqual(expect.arrayContaining([
      expect.objectContaining({ relation: 'synthesizes', impact: 'review_required' }),
      expect.objectContaining({ id: `experiment:${experimentId}`, impact: 'rerun_required' }),
      expect.objectContaining({ id: `artifact:${artifactId}`, impact: 'evidence_blocked' }),
    ]))
    expect(synthesisSource).toContain('"accuracy":0.91')
    expect(synthesisProposal?.impact).toMatchObject({ automatic_execution: false })

    const brief = await createKnowledgeDocumentProposal(projectId, { kind: 'writing_brief', section: 'experiments', instruction: '整理实验章节可使用的已确认材料与缺失证据。' }, { generate: generated, buildContext: fakeBuildContext })
    const briefProposal = await one<{ payload: Record<string, unknown>; impact: Record<string, unknown> }>('SELECT payload,impact FROM proposals WHERE id=$1', [brief.proposal_id])
    const briefSource = proposedKnowledgeSource(briefProposal!.payload)
    expect(parseKnowledgeMarkdown(briefSource, projectId, 'research/writing/section-briefs/experiments.md').frontmatter).toMatchObject({ id: 'writing:experiments', kind: 'writing_brief', status: 'confirmed' })
    expect(briefSource).toContain('最终章节变更继续使用现有 LaTeX Proposal、项目 Git 和编译门禁')
    expect(briefProposal?.impact).toMatchObject({ automatic_execution: false })
  }, 20_000)

  it('projects only project-scoped knowledge documents and lineage entities into the knowledge graph', async () => {
    const response = await app.request(`/api/projects/${projectId}/knowledge/graph`)
    expect(response.status).toBe(200)
    const graph = await response.json() as { project_id: string; graph_status: string; nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> }
    expect(graph.project_id).toBe(projectId)
    expect(graph.graph_status).toBe('ready')
    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ node_type: 'knowledge_document', entity_id: 'idea:current', permission: 'project_scoped' }),
      expect.objectContaining({ node_type: 'paper', entity_id: paperId, permission: 'project_scoped' }),
      expect.objectContaining({ node_type: 'experiment', entity_id: experimentId, permission: 'project_scoped' }),
    ]))
    expect(JSON.stringify(graph)).not.toContain('knowledge_index_entries')
    expect(JSON.stringify(graph)).not.toContain('chunk_key')
    expect(graph.edges.every(edge => String(edge.source).includes('::') && String(edge.target).includes('::'))).toBe(true)
    const foreign = await app.request(`/api/projects/${otherProjectId}/knowledge/graph`)
    await expect(foreign.json()).resolves.toMatchObject({ project_id: otherProjectId, graph_status: 'empty', nodes: [], edges: [] })
  })
})
