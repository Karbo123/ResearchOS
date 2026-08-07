import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { stringify } from 'yaml'
import { z } from 'zod'
import { buildContextPacket, contextPacketPrompt } from './context-planner.js'
import { audit, database, one, rows } from './database.js'
import { ApiError } from './http.js'
import { queueKnowledgeDocumentReindex } from './indexing-service.js'
import {
  KNOWLEDGE_DOCUMENT_SCHEMA,
  assertKnowledgePathForKind,
  knowledgeDocumentFrontMatter,
  knowledgeDocumentId,
  knowledgeDocumentKind,
  type KnowledgeDocumentFrontMatter,
  type KnowledgeDocumentKind,
  type KnowledgeDocumentManualProposalRequest,
  type KnowledgeDocumentProposalRequest,
} from './knowledge-document-contracts.js'
import { listKnowledgeDocuments, readKnowledgeDocument, reconcileKnowledgeDocuments } from './knowledge-document-service.js'
import { parseKnowledgeMarkdown } from './knowledge-markdown-parser.js'
import { mastraJson } from './mastra-client.js'
import { applyApprovedPatch, gitCommit } from './patch-service.js'
import { pathInside } from './paths.js'
import { requireProject } from './project-service.js'
import { projectRoot } from './project-storage.js'

const generatedDraftSchema = z.object({
  markdown_body: z.string().trim().min(1).max(180_000),
  summary: z.string().trim().min(1).max(2_000),
  open_verification_items: z.array(z.string().trim().min(1).max(2_000)).max(50),
}).strict()

type GeneratedDraft = z.infer<typeof generatedDraftSchema>
type DraftGeneratorInput = {
  project_id: string
  kind: KnowledgeDocumentKind
  title: string
  instruction: string
  current_source: string
  context_packet: string
  source_snapshot: Record<string, unknown>
  evidence_boundary: string
}
type DraftGenerator = (input: DraftGeneratorInput) => Promise<GeneratedDraft>

const patchOperationSchema = z.object({
  action: z.enum(['create', 'replace']),
  path: z.string().min(1).max(500),
  content: z.string().min(1).max(512 * 1024),
  expected_sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict()

export const knowledgeDocumentPatchPayloadSchema = z.object({
  patch_kind: z.literal('knowledge_document'),
  base_git_commit: z.string().regex(/^[a-f0-9]{40,64}$/),
  document_id: knowledgeDocumentId,
  document_kind: knowledgeDocumentKind,
  relative_path: z.string().min(1).max(500),
  context_manifest_id: z.string().uuid().nullable(),
  source_snapshot: z.record(z.string(), z.unknown()),
  operations: z.array(patchOperationSchema).length(1),
}).strict()

type KnowledgeDocumentPatchPayload = z.infer<typeof knowledgeDocumentPatchPayloadSchema>

type PaperRow = {
  id: string
  title: string
  doi: string | null
  source_url: string
  metadata: Record<string, unknown>
  bibtex: string | null
  verified: boolean
  confirmed: boolean
}

type EvidenceRow = {
  id: string
  paper_id: string | null
  claim: string
  quote: string
  locator: string | null
  source_url: string
  metadata: Record<string, unknown>
}

type ExperimentRow = {
  id: string
  proposal_id: string
  status: string
  experiment_type: string
  config: Record<string, unknown>
  metrics: Record<string, unknown>
  run_id: string | null
  error: string | null
  created_at: string
  finished_at: string | null
}

type ArtifactRow = {
  id: string
  experiment_id: string | null
  kind: string
  name: string
  relative_path: string
  mime_type: string
  sha256: string
  metadata: Record<string, unknown>
  valid: boolean
}

type ProposalTarget = {
  documentId: string
  relativePath: string
  title: string
  frontmatter: KnowledgeDocumentFrontMatter
  sourceSnapshot: Record<string, unknown>
  evidenceBoundary: string
  instruction: string
  currentSource: string
  currentSha256: string | null
  immutableCreate: boolean
  workspace: { purpose: 'idea' | 'literature' | 'reproduction' | 'method_experiment' | 'paper_section'; area: string; tab: string; scope: string; query: string; requestedDocumentIds: string[] }
  deterministicAppendix: string
  numericGroundingSource: string | null
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function boundedValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[depth-limited]'
  if (typeof value === 'string') return value.length > 8_000 ? `${value.slice(0, 8_000)}...[truncated]` : value
  if (Array.isArray(value)) return value.slice(0, 100).map(item => boundedValue(item, depth + 1))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 100).map(([key, item]) => [key, boundedValue(item, depth + 1)]))
  }
  return value
}

function readableKey(value: string, fallback: string): string {
  const normalized = value.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
  return normalized.length >= 2 ? normalized : fallback
}

function stableSuffix(value: string, length = 6): string {
  return sha256(value).slice(0, length)
}

function markdownCell(value: unknown): string {
  return String(value ?? '').replaceAll('|', '\\|').replace(/\r?\n/g, ' ').trim()
}

function yamlSource(frontmatter: KnowledgeDocumentFrontMatter): string {
  return stringify(frontmatter, { lineWidth: 0 }).trimEnd()
}

function renderDocument(frontmatter: KnowledgeDocumentFrontMatter, generated: GeneratedDraft, evidenceBoundary: string, appendix: string): string {
  const body = generated.markdown_body.trim()
  if (/^---(?:\r?\n|$)/.test(body) || /^#\s+/m.test(body)) {
    throw new ApiError(422, 'knowledge_model_body_invalid', '模型生成的知识正文包含 front matter 或一级标题，已拒绝写入。')
  }
  const verification = generated.open_verification_items.length
    ? generated.open_verification_items.map(item => `- ${item}`).join('\n')
    : '- 本次生成未返回开放核验项；这不解除原始证据、人工确认和实验复核要求。'
  return `---\n${yamlSource(frontmatter)}\n---\n\n# ${frontmatter.title}\n\n> 证据边界：${evidenceBoundary}\n\n${body}\n\n${appendix.trim()}\n\n## 开放核验项\n\n${verification}\n`
}

function replacementDiff(path: string, previous: string, next: string): string {
  const before = previous ? previous.replace(/\n$/, '').split('\n') : []
  const after = next.replace(/\n$/, '').split('\n')
  return [
    `--- ${previous ? `a/${path}` : '/dev/null'}`,
    `+++ b/${path}`,
    `@@ -${previous ? 1 : 0},${before.length} +1,${after.length} @@`,
    ...before.map(line => `-${line}`),
    ...after.map(line => `+${line}`),
  ].join('\n')
}

function validateGeneratedReferences(generated: GeneratedDraft, sourceText: string, numericGroundingSource: string | null): void {
  const combined = `${generated.markdown_body}\n${generated.open_verification_items.join('\n')}`
  for (const match of combined.matchAll(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi)) {
    if (!sourceText.includes(match[0])) throw new ApiError(422, 'knowledge_model_reference_ungrounded', '模型生成了来源快照中不存在的实体 ID。')
  }
  for (const match of combined.matchAll(/https?:\/\/[^\s)>\]}]+/gi)) {
    const url = match[0].replace(/[.,;:]+$/, '')
    if (!sourceText.includes(url)) throw new ApiError(422, 'knowledge_model_reference_ungrounded', '模型生成了来源快照中不存在的 URL。')
  }
  if (numericGroundingSource) {
    const allowed = new Set([...numericGroundingSource.matchAll(/(?<![\p{L}\p{N}_])-?\d+(?:\.\d+)?(?:e[+-]?\d+)?(?![\p{L}\p{N}_])/giu)].map(match => match[0].toLowerCase()))
    const generatedNumbers = [...combined.matchAll(/(?<![\p{L}\p{N}_])-?\d+(?:\.\d+)?(?:e[+-]?\d+)?(?![\p{L}\p{N}_])/giu)].map(match => match[0].toLowerCase())
    if (generatedNumbers.some(value => !allowed.has(value))) {
      throw new ApiError(422, 'knowledge_model_metric_ungrounded', '模型生成了真实实验快照中不存在的数值。')
    }
  }
}

async function defaultDraftGenerator(input: DraftGeneratorInput): Promise<GeneratedDraft> {
  const response = await mastraJson<{ result: GeneratedDraft }>('/internal/agents/knowledge-document-draft', input)
  return generatedDraftSchema.parse(response.result)
}

async function currentDocument(projectId: string, documentId: string): Promise<{ source: string; sha256: string; relative_path: string } | null> {
  const row = (await listKnowledgeDocuments(projectId)).find(item => item.document_id === documentId)
  if (!row) return null
  const document = await readKnowledgeDocument(projectId, documentId)
  return { source: document.source, sha256: row.current_sha256, relative_path: row.relative_path }
}

function sourceFingerprint(value: unknown): string {
  return sha256(canonicalJson(value))
}

async function ideaTarget(projectId: string, request: Extract<KnowledgeDocumentProposalRequest, { kind: 'idea' }>): Promise<ProposalTarget> {
  const project = await requireProject(projectId, true)
  const idea = await one<{ id: string; version: number; spec: Record<string, unknown>; created_at: string }>('SELECT id,version,spec,created_at FROM idea_versions WHERE project_id=$1 ORDER BY version DESC LIMIT 1', [projectId])
  if (!idea) throw new ApiError(409, 'idea_version_missing', '项目没有可用于形成长期知识的 Idea 版本。')
  const existing = await currentDocument(projectId, 'idea:current')
  const snapshot = { project_id: projectId, project_title: project.title, idea_version: boundedValue(idea), idea_fingerprint: sourceFingerprint(idea.spec), session_id: request.session_id ?? null }
  return {
    documentId: 'idea:current', relativePath: 'research/idea/current.md', title: `${project.title}：当前 Idea 与方法`,
    frontmatter: knowledgeDocumentFrontMatter.parse({ schema: KNOWLEDGE_DOCUMENT_SCHEMA, project_id: projectId, id: 'idea:current', kind: 'idea', title: `${project.title}：当前 Idea 与方法`, status: 'confirmed', depends_on: [{ id: `idea_version:${idea.id}`, relation: 'represents', impact: 'review_required' }], workspace_scopes: ['overview:overview', 'overview:idea', 'implementation:method', 'paper:introduction', 'paper:paper_method'] }),
    sourceSnapshot: snapshot,
    evidenceBoundary: '本文档记录用户批准的当前研究理解与方法计划，不把创新候选、预期效果或尚未执行的实验写成已证实结论。',
    instruction: request.instruction,
    currentSource: existing?.source || '', currentSha256: existing?.sha256 || null, immutableCreate: false,
    workspace: { purpose: 'idea', area: 'overview', tab: 'idea', scope: 'overview/idea', query: request.instruction, requestedDocumentIds: existing ? ['idea:current'] : [] },
    deterministicAppendix: `## 版本来源\n\n- Idea version：${idea.version}\n- Idea version ID：${idea.id}\n- 结构化规格指纹：${sourceFingerprint(idea.spec)}`,
    numericGroundingSource: null,
  }
}

async function paperTarget(projectId: string, request: Extract<KnowledgeDocumentProposalRequest, { kind: 'paper_summary' }>): Promise<ProposalTarget> {
  const paper = await one<PaperRow>('SELECT id,title,doi,source_url,metadata,bibtex,verified,confirmed FROM papers WHERE id=$1 AND project_id=$2', [request.paper_id, projectId])
  if (!paper) throw new ApiError(404, 'paper_not_found', '论文不存在或不属于当前项目。')
  const evidence = await rows<EvidenceRow>('SELECT id,paper_id,claim,quote,locator,source_url,metadata FROM evidence WHERE project_id=$1 AND paper_id=$2 ORDER BY created_at,id', [projectId, paper.id])
  if (['partial', 'full_text'].includes(request.read_scope) && !evidence.some(item => item.locator && item.quote.trim())) {
    throw new ApiError(422, 'paper_read_scope_unsubstantiated', '部分章节或全文总结必须至少有一条带 locator 的原文 Evidence。')
  }
  const registered = (await listKnowledgeDocuments(projectId)).find(item => item.kind === 'paper_summary' && item.metadata.paper_id === paper.id)
  const key = registered ? basename(registered.relative_path, '.md') : `${readableKey(paper.title, 'paper')}-${stableSuffix(paper.id, 6)}`
  const documentId = registered?.document_id || `paper:${key}`
  const relativePath = registered?.relative_path || `research/related-work/papers/${key}.md`
  const existing = registered ? await currentDocument(projectId, documentId) : null
  const providerProvenance = boundedValue({
    provider: paper.metadata?.provider ?? null,
    providers: paper.metadata?.providers ?? null,
    provenance: paper.metadata?.provenance ?? null,
    source_provenance: paper.metadata?.source_provenance ?? null,
  })
  const snapshot = { project_id: projectId, paper: boundedValue(paper), provider_provenance: providerProvenance, evidence: boundedValue(evidence), read_scope: request.read_scope, paper_fingerprint: sourceFingerprint(paper), evidence_fingerprints: evidence.map(item => ({ id: item.id, sha256: sourceFingerprint(item) })) }
  const locatorRows = evidence.length
    ? evidence.map(item => `| ${item.id} | ${markdownCell(item.locator || 'unresolved')} | ${markdownCell(item.source_url)} |`).join('\n')
    : '| - | unresolved | No page-level Evidence is registered. |'
  return {
    documentId, relativePath, title: paper.title,
    frontmatter: knowledgeDocumentFrontMatter.parse({ schema: KNOWLEDGE_DOCUMENT_SCHEMA, project_id: projectId, id: documentId, kind: 'paper_summary', title: paper.title, status: 'confirmed', depends_on: [{ id: `paper:${paper.id}`, relation: 'summarizes', impact: 'review_required' }, ...evidence.map(item => ({ id: `evidence:${item.id}`, relation: 'supported_by', impact: 'evidence_blocked' as const }))], workspace_scopes: ['related_work:literature', 'related_work:visualization', 'paper:paper_related_work'], paper_id: paper.id, evidence_ids: evidence.map(item => item.id), read_scope: request.read_scope }),
    sourceSnapshot: snapshot,
    evidenceBoundary: request.read_scope === 'metadata' ? '本文只基于元数据，不代表阅读全文，也不能作为全文事实证据。' : request.read_scope === 'abstract' ? '本文基于元数据与摘要；摘要级描述不能替代页码级全文证据。' : '本文只允许把列出的 Evidence locator 作为原文依据；其余内容仍是待复核总结。',
    instruction: request.instruction || '生成一份结构化逐篇文献总结，区分方法、实验、局限、与本项目的关系及开放核验项。',
    currentSource: existing?.source || '', currentSha256: existing?.sha256 || null, immutableCreate: false,
    workspace: { purpose: 'literature', area: 'related_work', tab: 'literature', scope: 'related_work/literature', query: `${paper.title} ${request.instruction || ''}`.trim(), requestedDocumentIds: existing ? [documentId] : [] },
    deterministicAppendix: `## 读取范围与来源\n\n- 读取范围：${request.read_scope}\n- Paper ID：${paper.id}\n- DOI：${paper.doi || 'unresolved'}\n- 来源 URL：${paper.source_url}\n- Provider provenance 指纹：${sourceFingerprint(providerProvenance)}\n\n## 原文 Evidence 定位\n\n| Evidence ID | Locator | Source |\n| --- | --- | --- |\n${locatorRows}`,
    numericGroundingSource: null,
  }
}

async function relatedWorkTarget(projectId: string, request: Extract<KnowledgeDocumentProposalRequest, { kind: 'related_work_synthesis' }>): Promise<ProposalTarget> {
  const papers = request.paper_ids.length
    ? await rows<PaperRow>('SELECT id,title,doi,source_url,metadata,bibtex,verified,confirmed FROM papers WHERE project_id=$1 AND id=ANY($2::uuid[]) ORDER BY title,id', [projectId, request.paper_ids])
    : await rows<PaperRow>('SELECT id,title,doi,source_url,metadata,bibtex,verified,confirmed FROM papers WHERE project_id=$1 AND confirmed=TRUE ORDER BY title,id', [projectId])
  if (request.paper_ids.length && papers.length !== new Set(request.paper_ids).size) throw new ApiError(422, 'paper_scope_invalid', '部分论文不存在或不属于当前项目。')
  if (!papers.length || papers.some(paper => !paper.confirmed)) throw new ApiError(422, 'confirmed_papers_required', '相关工作综合只能使用当前项目中用户确认的论文。')
  const summaries = (await listKnowledgeDocuments(projectId)).filter(item => item.kind === 'paper_summary' && papers.some(paper => paper.id === item.metadata.paper_id) && item.author_status === 'confirmed')
  if (summaries.length !== papers.length) throw new ApiError(422, 'confirmed_paper_summaries_required', '每篇入选论文都必须先有用户确认的独立 summary 文档。')
  const existing = await currentDocument(projectId, 'related-work:synthesis')
  const snapshot = { project_id: projectId, papers: boundedValue(papers), summary_documents: summaries.map(item => ({ document_id: item.document_id, sha256: item.current_sha256, paper_id: item.metadata.paper_id, read_scope: item.metadata.read_scope })), paper_fingerprints: papers.map(item => ({ id: item.id, sha256: sourceFingerprint(item) })) }
  return {
    documentId: 'related-work:synthesis', relativePath: 'research/related-work/synthesis.md', title: '相关工作综合与研究现状',
    frontmatter: knowledgeDocumentFrontMatter.parse({ schema: KNOWLEDGE_DOCUMENT_SCHEMA, project_id: projectId, id: 'related-work:synthesis', kind: 'related_work_synthesis', title: '相关工作综合与研究现状', status: 'confirmed', depends_on: summaries.map(item => ({ id: item.document_id, relation: 'synthesizes', impact: 'review_required' as const })), workspace_scopes: ['related_work:literature', 'related_work:visualization', 'paper:paper_related_work'] }),
    sourceSnapshot: snapshot,
    evidenceBoundary: '跨论文比较只能综合已确认 summary 及其来源边界；研究空白、聚类和创新性判断必须明确写成待核验候选。',
    instruction: request.instruction || '综合已确认论文的方法、数据集、指标、结论边界和局限，并单独列出待核验的研究空白与创新候选。',
    currentSource: existing?.source || '', currentSha256: existing?.sha256 || null, immutableCreate: false,
    workspace: { purpose: 'literature', area: 'related_work', tab: 'literature', scope: 'related_work/literature', query: request.instruction || '综合已确认论文并比较方法、实验、局限和待核验研究空白', requestedDocumentIds: summaries.map(item => item.document_id) },
    deterministicAppendix: `## 纳入范围\n\n${summaries.map(item => `- ${item.document_id} @ ${item.current_sha256}`).join('\n')}\n\n## 候选声明规则\n\n所有 gap、cluster、novelty 和优越性描述均为待核验候选，不能因本综合文档获批而变成科学结论。`,
    numericGroundingSource: null,
  }
}

function experimentKey(experiment: ExperimentRow, supplied?: string): string {
  return supplied || `${readableKey(experiment.experiment_type, 'experiment')}-${stableSuffix(experiment.id, 8)}`
}

async function experimentAndArtifacts(projectId: string, experimentId: string): Promise<{ experiment: ExperimentRow; artifacts: ArtifactRow[] }> {
  const experiment = await one<ExperimentRow>('SELECT id,proposal_id,status,experiment_type,config,metrics,run_id,error,created_at,finished_at FROM experiments WHERE id=$1 AND project_id=$2', [experimentId, projectId])
  if (!experiment) throw new ApiError(404, 'experiment_not_found', '实验不存在或不属于当前项目。')
  const artifacts = await rows<ArtifactRow>('SELECT id,experiment_id,kind,name,relative_path,mime_type,sha256,metadata,valid FROM artifacts WHERE project_id=$1 AND experiment_id=$2 ORDER BY created_at,id', [projectId, experimentId])
  return { experiment, artifacts }
}

async function experimentTarget(projectId: string, request: Extract<KnowledgeDocumentProposalRequest, { kind: 'experiment_plan' | 'run_result' | 'experiment_synthesis' }>): Promise<ProposalTarget> {
  const primary = await experimentAndArtifacts(projectId, request.experiment_id)
  const key = experimentKey(primary.experiment, request.document_key)
  const scopeTab = request.track === 'reproductions' ? 'reproduction' : 'method'
  const scope = `implementation:${scopeTab}`
  const base = `research/experiments/${request.track}/${key}`
  const isRun = request.kind === 'run_result'
  const runKey = `${readableKey(primary.experiment.run_id || primary.experiment.experiment_type, 'run')}-${stableSuffix(primary.experiment.id, 8)}`
  const documentId = request.kind === 'experiment_plan' ? `experiment:${key}/plan` : request.kind === 'run_result' ? `run:${key}/${runKey}` : `experiment:${key}/synthesis`
  const relativePath = request.kind === 'experiment_plan' ? `${base}/plan.md` : request.kind === 'run_result' ? `${base}/runs/${runKey}/result.md` : `${base}/synthesis.md`
  const existingByBinding = (await listKnowledgeDocuments(projectId)).find(item => item.kind === request.kind && item.metadata.experiment_id === primary.experiment.id && (request.kind !== 'run_result' || item.metadata.run_id === (primary.experiment.run_id || primary.experiment.id)))
  const effectiveDocumentId = existingByBinding?.document_id || documentId
  const effectivePath = existingByBinding?.relative_path || relativePath
  const existing = existingByBinding ? await currentDocument(projectId, effectiveDocumentId) : null
  if (isRun && existing) throw new ApiError(409, 'run_result_document_immutable', '该实验 run 已有结果文档；不能用新配置结果覆盖历史 run 文档。')
  const relatedIds = request.kind === 'experiment_synthesis' ? [...new Set([request.experiment_id, ...request.related_experiment_ids])] : [request.experiment_id]
  const relatedExperiments = request.kind === 'experiment_synthesis'
    ? await rows<ExperimentRow>('SELECT id,proposal_id,status,experiment_type,config,metrics,run_id,error,created_at,finished_at FROM experiments WHERE project_id=$1 AND id=ANY($2::uuid[]) ORDER BY created_at,id', [projectId, relatedIds])
    : [primary.experiment]
  if (relatedExperiments.length !== relatedIds.length) throw new ApiError(422, 'experiment_scope_invalid', '部分实验不存在或不属于当前项目。')
  if (request.kind === 'run_result' && !['succeeded', 'failed', 'cancelled', 'invalidated'].includes(primary.experiment.status)) throw new ApiError(409, 'experiment_not_finished', '实验尚未结束，不能生成 run 结果文档。')
  if (request.kind === 'experiment_synthesis' && relatedExperiments.some(item => !['succeeded', 'failed', 'cancelled', 'invalidated'].includes(item.status))) throw new ApiError(409, 'experiment_not_finished', '综合范围中存在尚未结束的实验。')
  const allArtifacts = request.kind === 'experiment_synthesis'
    ? await rows<ArtifactRow>('SELECT id,experiment_id,kind,name,relative_path,mime_type,sha256,metadata,valid FROM artifacts WHERE project_id=$1 AND experiment_id=ANY($2::uuid[]) ORDER BY experiment_id,created_at,id', [projectId, relatedIds])
    : primary.artifacts
  const validArtifacts = allArtifacts.filter(item => item.valid)
  const currentIdea = (await listKnowledgeDocuments(projectId)).find(item => item.document_id === 'idea:current' && item.author_status === 'confirmed')
  const runDocuments = request.kind === 'experiment_synthesis'
    ? (await listKnowledgeDocuments(projectId)).filter(item => item.kind === 'run_result' && relatedIds.includes(String(item.metadata.experiment_id)) && item.author_status === 'confirmed')
    : []
  if (request.kind === 'experiment_synthesis' && runDocuments.length !== relatedExperiments.length) throw new ApiError(422, 'run_result_documents_required', '实验综合要求范围内每次 run 都已有确认后的独立结果文档。')
  const title = request.kind === 'experiment_plan' ? `${primary.experiment.experiment_type} 实验计划` : request.kind === 'run_result' ? `${primary.experiment.experiment_type} 运行结果` : `${primary.experiment.experiment_type} 实验综合`
  const dependencies = [
    ...(currentIdea ? [{ id: currentIdea.document_id, relation: 'tests', impact: 'review_required' as const }] : []),
    ...runDocuments.map(item => ({ id: item.document_id, relation: 'synthesizes', impact: 'review_required' as const })),
    ...relatedExperiments.map(item => ({ id: `experiment:${item.id}`, relation: request.kind === 'experiment_plan' ? 'plans_from' : 'summarizes', impact: 'rerun_required' as const })),
    ...validArtifacts.map(item => ({ id: `artifact:${item.id}`, relation: 'references_artifact', impact: 'evidence_blocked' as const })),
  ]
  const snapshot = { project_id: projectId, experiments: boundedValue(relatedExperiments), artifacts: boundedValue(allArtifacts), experiment_fingerprints: relatedExperiments.map(item => ({ id: item.id, sha256: sourceFingerprint(item) })), artifact_fingerprints: allArtifacts.map(item => ({ id: item.id, sha256: item.sha256, valid: item.valid })) }
  const metricsRows = relatedExperiments.map(item => `| ${item.id} | ${markdownCell(item.run_id || item.id)} | ${item.status} | \`${markdownCell(canonicalJson(item.metrics))}\` |`).join('\n')
  const artifactRows = allArtifacts.length ? allArtifacts.map(item => `| ${item.id} | ${markdownCell(item.name)} | ${item.valid ? 'valid' : 'invalid'} | ${item.sha256} | ${markdownCell(item.relative_path)} |`).join('\n') : '| - | - | - | - | No artifact registered |'
  const appendix = request.kind === 'experiment_plan'
    ? `## 受控执行来源\n\n- Experiment ID：${primary.experiment.id}\n- Proposal ID：${primary.experiment.proposal_id}\n- 当前状态：${primary.experiment.status}\n- 配置指纹：${sourceFingerprint(primary.experiment.config)}\n\n配置、seed、数据版本和执行入口仍以批准后的 Experiment 结构化记录为准；本 Markdown 不直接启动实验。`
    : `## 真实运行账本\n\n| Experiment ID | Run ID | Status | Metrics |\n| --- | --- | --- | --- |\n${metricsRows}\n\n## 受控 Artifact\n\n| Artifact ID | Name | Validity | SHA-256 | Path |\n| --- | --- | --- | --- | --- |\n${artifactRows}`
  return {
    documentId: effectiveDocumentId, relativePath: effectivePath, title,
    frontmatter: knowledgeDocumentFrontMatter.parse({ schema: KNOWLEDGE_DOCUMENT_SCHEMA, project_id: projectId, id: effectiveDocumentId, kind: request.kind, title, status: 'confirmed', depends_on: dependencies, workspace_scopes: [scope, 'paper:paper_experiments'], experiment_id: primary.experiment.id, ...(request.kind === 'run_result' ? { run_id: primary.experiment.run_id || primary.experiment.id } : {}), artifact_ids: validArtifacts.map(item => item.id) }),
    sourceSnapshot: snapshot,
    evidenceBoundary: request.kind === 'experiment_plan' ? '本文是待审批实验计划的知识表达，不代表实验已经运行。' : '所有数值只来自列出的真实 Experiment.metrics；模型解释不是测量值，也不能覆盖历史 run。无效 Artifact 不得作为当前证据。',
    instruction: request.instruction || (request.kind === 'experiment_plan' ? '解释该实验要验证的问题、协议、变量、指标、风险和停止条件。' : request.kind === 'run_result' ? '解释该次真实运行的观察、局限和后续核验，不重复或改写指标表。' : '综合多个真实 run 的可比性、观察、失败与限制，并提出待审批的后续实验候选。'),
    currentSource: existing?.source || '', currentSha256: existing?.sha256 || null, immutableCreate: isRun,
    workspace: { purpose: request.track === 'reproductions' ? 'reproduction' : 'method_experiment', area: 'implementation', tab: scopeTab, scope: `implementation/${scopeTab}`, query: request.instruction || title, requestedDocumentIds: [...(currentIdea ? [currentIdea.document_id] : []), ...runDocuments.map(item => item.document_id)] },
    deterministicAppendix: appendix,
    numericGroundingSource: request.kind === 'run_result' || request.kind === 'experiment_synthesis' ? canonicalJson({ experiments: relatedExperiments.map(item => ({ metrics: item.metrics, status: item.status, config: item.config })), artifacts: allArtifacts.map(item => ({ sha256: item.sha256, valid: item.valid })) }) : null,
  }
}

async function writingBriefTarget(projectId: string, request: Extract<KnowledgeDocumentProposalRequest, { kind: 'writing_brief' }>): Promise<ProposalTarget> {
  const tab = request.section === 'related-work' ? 'paper_related_work' : request.section === 'method' ? 'paper_method' : request.section === 'experiments' ? 'paper_experiments' : request.section
  const documentId = `writing:${request.section}`
  const relativePath = `research/writing/section-briefs/${request.section}.md`
  const existing = await currentDocument(projectId, documentId)
  const title = `${request.section} 章节写作简报`
  return {
    documentId, relativePath, title,
    frontmatter: knowledgeDocumentFrontMatter.parse({ schema: KNOWLEDGE_DOCUMENT_SCHEMA, project_id: projectId, id: documentId, kind: 'writing_brief', title, status: 'confirmed', depends_on: [], workspace_scopes: [`paper:${tab}`] }),
    sourceSnapshot: { project_id: projectId, section: request.section },
    evidenceBoundary: '写作简报只能组织已确认知识和真实证据；它不是论文终稿，最终 LaTeX 仍须独立 Proposal、Git 和编译门禁。',
    instruction: request.instruction || `为论文 ${request.section} 章节生成写作目标、可用主张、必要证据、图表需求、限制和开放核验项。`,
    currentSource: existing?.source || '', currentSha256: existing?.sha256 || null, immutableCreate: false,
    workspace: { purpose: 'paper_section', area: 'paper', tab, scope: `paper/${tab}`, query: request.instruction || `${request.section} writing brief`, requestedDocumentIds: existing ? [documentId] : [] },
    deterministicAppendix: `## 写作门禁\n\n- 本简报不会直接修改 \`paper/main.tex\`。\n- 只有已确认 Paper summary、带 locator 的 Evidence、accepted ClaimReview 和有效 Experiment/Artifact 可以支持事实性表述。\n- 最终章节变更继续使用现有 LaTeX Proposal、项目 Git 和编译门禁。`,
    numericGroundingSource: null,
  }
}

async function targetFor(projectId: string, request: KnowledgeDocumentProposalRequest): Promise<ProposalTarget> {
  if (request.kind === 'idea') return ideaTarget(projectId, request)
  if (request.kind === 'paper_summary') return paperTarget(projectId, request)
  if (request.kind === 'related_work_synthesis') return relatedWorkTarget(projectId, request)
  if (request.kind === 'writing_brief') return writingBriefTarget(projectId, request)
  return experimentTarget(projectId, request)
}

function proposalImpact(target: ProposalTarget, generated: GeneratedDraft): Record<string, unknown> {
  return {
    document_id: target.documentId,
    document_kind: target.frontmatter.kind,
    relative_path: target.relativePath,
    current_sha256: target.currentSha256,
    source_snapshot_sha256: sourceFingerprint(target.sourceSnapshot),
    open_verification_items: generated.open_verification_items,
    automatic_execution: false,
    requires_separate_downstream_proposals: true,
  }
}

export async function createKnowledgeDocumentProposal(
  projectId: string,
  request: KnowledgeDocumentProposalRequest,
  dependencies: { generate?: DraftGenerator; buildContext?: typeof buildContextPacket; originTurnId?: string } = {},
): Promise<{ proposal_id: string; status: 'pending'; document_id: string; relative_path: string; context_manifest_id: string }> {
  await requireProject(projectId, true)
  if (dependencies.originTurnId) {
    const existing = await one<{ id: string; status: string; payload: Record<string, unknown> }>('SELECT id,status,payload FROM proposals WHERE project_id=$1 AND origin_turn_id=$2', [projectId, dependencies.originTurnId])
    if (existing) {
      const documentId = typeof existing.payload.document_id === 'string' ? existing.payload.document_id : ''
      const relativePath = typeof existing.payload.relative_path === 'string' ? existing.payload.relative_path : ''
      const contextManifestId = typeof existing.payload.context_manifest_id === 'string' ? existing.payload.context_manifest_id : ''
      if (existing.status !== 'pending' || !documentId || !relativePath || !contextManifestId) throw new ApiError(409, 'chat_proposal_state_conflict', '该对话轮次已有不兼容的 Proposal 状态。')
      return { proposal_id: existing.id, status: 'pending', document_id: documentId, relative_path: relativePath, context_manifest_id: contextManifestId }
    }
  }
  await reconcileKnowledgeDocuments(projectId, 'api')
  const target = await targetFor(projectId, request)
  assertKnowledgePathForKind(target.relativePath, target.frontmatter.kind)
  const pending = await one<{ id: string }>("SELECT id FROM proposals WHERE project_id=$1 AND kind='knowledge_document_patch' AND status='pending' AND payload->>'document_id'=$2 ORDER BY created_at DESC LIMIT 1", [projectId, target.documentId])
  if (pending) throw new ApiError(409, 'knowledge_document_proposal_pending', '该知识文档已有待审批的写入 Proposal。', { proposal_id: pending.id })
  if (target.immutableCreate && target.currentSource) throw new ApiError(409, 'knowledge_document_immutable', '历史 run 结果文档不能原地覆盖。')

  const packet = await (dependencies.buildContext || buildContextPacket)({
    project_id: projectId,
    purpose: target.workspace.purpose,
    workspace_area: target.workspace.area,
    workspace_tab: target.workspace.tab,
    workspace_scope: target.workspace.scope,
    query: target.workspace.query,
    ...(request.kind === 'idea' && request.session_id ? { session_id: request.session_id } : {}),
    requested_document_ids: target.workspace.requestedDocumentIds,
    search_mode: 'hybrid',
  })
  if (packet.status === 'blocked') throw new ApiError(503, 'knowledge_context_blocked', '当前知识上下文无法安全装配，未生成 Proposal。', { context_manifest_id: packet.manifest_id })
  const sourceSnapshot = {
    ...target.sourceSnapshot,
    context_manifest_id: packet.manifest_id,
    context_sources: packet.blocks.map(block => block.provenance),
    context_status: packet.status,
  }
  const generated = generatedDraftSchema.parse(await (dependencies.generate || defaultDraftGenerator)({
    project_id: projectId,
    kind: target.frontmatter.kind,
    title: target.title,
    instruction: target.instruction,
    current_source: target.currentSource,
    context_packet: contextPacketPrompt(packet),
    source_snapshot: sourceSnapshot,
    evidence_boundary: target.evidenceBoundary,
  }))
  const sourceText = canonicalJson({ sourceSnapshot, context: packet.blocks.map(block => block.content), instruction: target.instruction, current: target.currentSource })
  validateGeneratedReferences(generated, sourceText, target.numericGroundingSource)

  if (target.frontmatter.kind === 'writing_brief') {
    target.frontmatter.depends_on = [...new Map(packet.blocks
      .filter(block => block.provenance.document_id && block.provenance.document_id !== target.documentId)
      .map(block => [block.provenance.document_id!, { id: block.provenance.document_id!, relation: 'informed_by', impact: 'review_required' as const }])).values()].slice(0, 200)
  }
  const content = renderDocument(target.frontmatter, generated, target.evidenceBoundary, target.deterministicAppendix)
  parseKnowledgeMarkdown(content, projectId, target.relativePath)
  const operation = target.currentSha256
    ? { action: 'replace' as const, path: target.relativePath, content, expected_sha256: target.currentSha256 }
    : { action: 'create' as const, path: target.relativePath, content }
  const payload = knowledgeDocumentPatchPayloadSchema.parse({
    patch_kind: 'knowledge_document',
    base_git_commit: gitCommit(projectId),
    document_id: target.documentId,
    document_kind: target.frontmatter.kind,
    relative_path: target.relativePath,
    context_manifest_id: packet.manifest_id,
    source_snapshot: sourceSnapshot,
    operations: [operation],
  })
  const proposalId = crypto.randomUUID()
  await database.query('INSERT INTO proposals(id,project_id,kind,reason,summary,diff,impact,payload,origin_turn_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
    proposalId,
    projectId,
    'knowledge_document_patch',
    target.instruction,
    generated.summary,
    replacementDiff(target.relativePath, target.currentSource, content),
    proposalImpact(target, generated),
    payload,
    dependencies.originTurnId || null,
  ])
  await audit('knowledge.proposal_created', projectId, { proposal_id: proposalId, document_id: target.documentId, document_kind: target.frontmatter.kind, relative_path: target.relativePath, context_manifest_id: packet.manifest_id, source_snapshot_sha256: sourceFingerprint(sourceSnapshot) })
  return { proposal_id: proposalId, status: 'pending', document_id: target.documentId, relative_path: target.relativePath, context_manifest_id: packet.manifest_id }
}

export async function createManualKnowledgeDocumentProposal(projectId: string, request: KnowledgeDocumentManualProposalRequest): Promise<{
  proposal_id: string
  status: 'pending'
  document_id: string
  relative_path: string
}> {
  await requireProject(projectId, true)
  await reconcileKnowledgeDocuments(projectId, 'api')
  const current = await readKnowledgeDocument(projectId, request.document_id)
  if (current.row.current_sha256 !== request.expected_sha256) throw new ApiError(409, 'knowledge_document_changed', '知识文档已经变化，请重新载入后再提交。')
  const parsed = parseKnowledgeMarkdown(request.source, projectId, current.row.relative_path)
  if (parsed.frontmatter.id !== current.row.document_id || parsed.frontmatter.kind !== current.row.kind) {
    throw new ApiError(422, 'knowledge_patch_identity_mismatch', '手工编辑不能改变知识文档 ID、kind 或受控路径。')
  }
  if (parsed.document_sha256 === current.row.current_sha256) throw new ApiError(409, 'knowledge_document_unchanged', '知识文档内容没有变化。')
  const pending = await one<{ id: string }>("SELECT id FROM proposals WHERE project_id=$1 AND kind='knowledge_document_patch' AND status='pending' AND payload->>'document_id'=$2 ORDER BY created_at DESC LIMIT 1", [projectId, request.document_id])
  if (pending) throw new ApiError(409, 'knowledge_document_proposal_pending', '该知识文档已有待审批的写入 Proposal。', { proposal_id: pending.id })
  const payload = knowledgeDocumentPatchPayloadSchema.parse({
    patch_kind: 'knowledge_document',
    base_git_commit: gitCommit(projectId),
    document_id: current.row.document_id,
    document_kind: current.parsed.frontmatter.kind,
    relative_path: current.row.relative_path,
    context_manifest_id: null,
    source_snapshot: { project_id: projectId, source: 'manual_editor', previous_sha256: current.row.current_sha256, next_sha256: parsed.document_sha256 },
    operations: [{ action: 'replace', path: current.row.relative_path, content: request.source, expected_sha256: request.expected_sha256 }],
  })
  const proposalId = crypto.randomUUID()
  await database.query('INSERT INTO proposals(id,project_id,kind,reason,summary,diff,impact,payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [
    proposalId,
    projectId,
    'knowledge_document_patch',
    request.reason,
    `Edit ${current.parsed.frontmatter.title}`,
    replacementDiff(current.row.relative_path, current.source, request.source),
    { document_id: current.row.document_id, document_kind: current.row.kind, current_sha256: current.row.current_sha256, next_sha256: parsed.document_sha256, automatic_execution: false, requires_separate_downstream_proposals: true },
    payload,
  ])
  await audit('knowledge.manual_proposal_created', projectId, { proposal_id: proposalId, document_id: current.row.document_id, previous_sha256: current.row.current_sha256, next_sha256: parsed.document_sha256 })
  return { proposal_id: proposalId, status: 'pending', document_id: current.row.document_id, relative_path: current.row.relative_path }
}

function validateApprovedPayload(projectId: string, payload: KnowledgeDocumentPatchPayload): void {
  const operation = payload.operations[0]!
  if (operation.path !== payload.relative_path) throw new ApiError(422, 'knowledge_patch_path_mismatch', '知识 Proposal 的操作路径与目标路径不一致。')
  assertKnowledgePathForKind(payload.relative_path, payload.document_kind)
  const parsed = parseKnowledgeMarkdown(operation.content, projectId, payload.relative_path)
  if (parsed.frontmatter.id !== payload.document_id || parsed.frontmatter.kind !== payload.document_kind) throw new ApiError(422, 'knowledge_patch_identity_mismatch', '知识 Proposal 的文档身份与正文 front matter 不一致。')
  if (operation.action === 'replace' && !operation.expected_sha256) throw new ApiError(422, 'knowledge_patch_expected_sha_missing', '替换知识文档必须绑定原始 SHA-256。')
  if (operation.action === 'create' && operation.expected_sha256) throw new ApiError(422, 'knowledge_patch_create_sha_invalid', '新建知识文档不能携带旧 SHA-256。')
}

export async function applyApprovedKnowledgeDocumentPatch(projectId: string, rawPayload: Record<string, unknown>, actor: string): Promise<{
  document_id: string
  relative_path: string
  git_commit: string
  index_task: { queued: boolean; task_id: string | null }
}> {
  const payload = knowledgeDocumentPatchPayloadSchema.parse(rawPayload)
  validateApprovedPayload(projectId, payload)
  await reconcileKnowledgeDocuments(projectId, 'api')
  const registered = (await listKnowledgeDocuments(projectId)).find(item => item.document_id === payload.document_id)
  const operation = payload.operations[0]!
  if (operation.action === 'create' && (registered || existsSync(pathInside(projectRoot(projectId), ...payload.relative_path.split('/'))))) throw new ApiError(409, 'patch_create_conflict', '待创建的知识文档已经存在。')
  if (operation.action === 'replace' && (!registered || registered.relative_path !== payload.relative_path || registered.current_sha256 !== operation.expected_sha256)) throw new ApiError(409, 'knowledge_document_changed', '知识文档在审批期间已经变化，必须重新生成 Proposal。')
  const commit = applyApprovedPatch(projectId, payload, actor)
  const reconciled = await reconcileKnowledgeDocuments(projectId, 'api')
  const document = reconciled.documents.find(item => item.row.document_id === payload.document_id)
  if (!document || document.row.relative_path !== payload.relative_path) throw new ApiError(409, 'knowledge_reconcile_failed', '批准后的知识文档没有按预期完成对账。')
  const indexTask = await queueKnowledgeDocumentReindex(projectId, payload.document_id)
  await audit('knowledge.proposal_applied', projectId, { document_id: payload.document_id, relative_path: payload.relative_path, git_commit: commit, context_manifest_id: payload.context_manifest_id, index_task: indexTask }, actor)
  return { document_id: payload.document_id, relative_path: payload.relative_path, git_commit: commit, index_task: indexTask }
}

export function proposedKnowledgeSource(payload: Record<string, unknown>): string {
  const parsed = knowledgeDocumentPatchPayloadSchema.parse(payload)
  return parsed.operations[0]!.content
}
