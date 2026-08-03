import { createHash } from 'node:crypto'
import { z } from 'zod'
import { audit, database, one, rows } from '../database.js'
import { ApiError } from '../http.js'
import { requireProject } from '../project-service.js'
import {
  comparisonCandidateCreateRequest,
  comparisonCandidateDecisionRequest,
  comparisonCandidateType,
  comparisonContext,
  comparisonMetricInput,
  researchComparisonRequest,
  type ComparisonCandidateCreateRequest,
  type ComparisonCandidateDecisionRequest,
  type ComparisonContext,
  type ComparisonMetricInput,
  type ResearchComparisonRequest,
} from './contracts.js'

type RecordValue = Record<string, unknown>

type PaperRow = {
  id: string
  project_id: string
  title: string
  doi: string | null
  confirmed: boolean
  metadata: RecordValue
}

type EvidenceRow = {
  id: string
  project_id: string
  paper_id: string | null
  claim: string
  quote: string
  locator: string | null
  source_url: string
  metadata: RecordValue
}

type ClaimReviewRow = {
  id: string
  evidence_ids: string[]
  status: string
}

type ReproductionRow = {
  id: string
  project_id: string
  repository_id: string
  source_commit: string
  status: string
  plan: RecordValue
}

type ReproductionRunRow = {
  id: string
  project_id: string
  reproduction_id: string
  status: string
  source_commit: string
  entrypoint: string
  random_seeds: number[]
  config: RecordValue
  metrics: unknown
  artifact_ids: string[]
  error: string | null
}

type RepositoryRow = {
  id: string
  project_id: string
  paper_id: string | null
  source_url: string
  commit_or_tag: string | null
}

type ArtifactRow = {
  id: string
  project_id: string
  sha256: string
  valid: boolean
  mime_type: string
  relative_path: string
  metadata: RecordValue
}

type ComparisonRow = {
  id: string
  project_id: string
  paper_id: string
  reproduction_run_id: string
  status: string
  reason: string
  input_hash: string
  paper_context: ComparisonContext
  reproduction_context: RecordValue
  metric_comparisons: RecordValue
  blocking_reasons: string[]
  source_snapshot: RecordValue
  created_by: string
  created_at: string
}

type CandidateRow = {
  id: string
  project_id: string
  comparison_id: string
  candidate_type: string
  statement: string
  basis: RecordValue
  evidence_status: string
  status: string
  actor: string
  decision_comment: string | null
  created_at: string
  decided_at: string | null
}

const aggregateMetric = z.object({
  count: z.number().int().min(1),
  mean: z.number().finite(),
  population_std: z.number().finite().min(0),
  min: z.number().finite(),
  max: z.number().finite(),
}).strict()

const reproductionMetrics = z.object({
  per_seed: z.record(z.string(), z.record(z.string().regex(/^[A-Za-z0-9_.-]{1,120}$/), z.number().finite())),
  aggregate: z.record(z.string().regex(/^[A-Za-z0-9_.-]{1,120}$/), aggregateMetric),
}).strict()

function record(value: unknown): RecordValue {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {}
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim())
}

function numberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is number => typeof item === 'number' && Number.isInteger(item))
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(item => canonical(item))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as RecordValue)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonical(item)]))
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function sameArray(left: string[] | number[], right: string[] | number[]): boolean {
  if (left.length !== right.length) return false
  return [...left].sort().every((value, index) => value === [...right].sort()[index])
}

type MatchState = 'equal' | 'mismatch' | 'unknown'

function matchScalar(left: unknown, right: unknown): MatchState {
  if (left === null || left === undefined || right === null || right === undefined) return 'unknown'
  if (Array.isArray(left) && Array.isArray(right)) return sameArray(left as string[] | number[], right as string[] | number[]) ? 'equal' : 'mismatch'
  return left === right ? 'equal' : 'mismatch'
}

function contextValue(config: RecordValue, key: string): unknown {
  return config[key] ?? null
}

function metricDirectionSignal(direction: ComparisonMetricInput['direction'], delta: number): 'no_difference' | 'potential_improvement' | 'potential_regression' | 'direction_unknown' {
  if (delta === 0) return 'no_difference'
  if (direction === 'higher_is_better') return delta > 0 ? 'potential_improvement' : 'potential_regression'
  if (direction === 'lower_is_better') return delta < 0 ? 'potential_improvement' : 'potential_regression'
  return 'direction_unknown'
}

function evidenceHash(evidence: EvidenceRow): string | null {
  const metadata = record(evidence.metadata)
  const hashValue = stringValue(metadata.pdf_sha256)
  if (hashValue && /^[0-9a-f]{64}$/i.test(hashValue)) return hashValue.toLowerCase()
  return null
}

function evidenceArtifactId(evidence: EvidenceRow): string | null {
  return stringValue(record(evidence.metadata).artifact_id)
}

function evidenceSnapshot(evidence: EvidenceRow, claimReviewIds: string[]) {
  return {
    id: evidence.id,
    paper_id: evidence.paper_id,
    claim: evidence.claim,
    locator: evidence.locator,
    source_url: evidence.source_url,
    pdf_sha256: evidenceHash(evidence),
    artifact_id: evidenceArtifactId(evidence),
    claim_review_ids: claimReviewIds,
  }
}

async function loadComparison(projectId: string, comparisonId: string): Promise<ComparisonRow> {
  const comparison = await one<ComparisonRow>('SELECT * FROM research_comparisons WHERE id=$1 AND project_id=$2', [comparisonId, projectId])
  if (!comparison) throw new ApiError(404, 'research_comparison_not_found', '比较记录不存在或不属于当前项目。')
  return comparison
}

function parseStoredContext(value: unknown): ComparisonContext {
  return comparisonContext.parse(value)
}

function blockingStatus(runStatus: string, reasons: string[]): 'blocked' | 'partial' {
  if (runStatus === 'failed' || runStatus === 'cancelled' || runStatus === 'artifact_rejected' || reasons.some(reason => reason.includes('missing') || reason.includes('mismatch') || reason.includes('invalid'))) return 'blocked'
  return 'partial'
}

async function validatedInputs(projectId: string, input: ResearchComparisonRequest) {
  const paperMetrics = input.paper_metrics as Record<string, ComparisonMetricInput>
  const paper = await one<PaperRow>('SELECT id,project_id,title,doi,confirmed,metadata FROM papers WHERE id=$1 AND project_id=$2', [input.paper_id, projectId])
  if (!paper) throw new ApiError(404, 'research_comparison_paper_not_found', '比较论文不存在或不属于当前项目。')
  if (!paper.confirmed) throw new ApiError(409, 'research_comparison_paper_confirmation_required', '比较只能使用用户确认的 Paper。')

  const evidenceIds = unique(input.evidence_ids)
  const metricEvidenceIds = unique(Object.values(paperMetrics).flatMap(metric => metric.evidence_ids))
  if (evidenceIds.length !== input.evidence_ids.length || metricEvidenceIds.length !== Object.values(paperMetrics).flatMap(metric => metric.evidence_ids).length) {
    throw new ApiError(422, 'research_comparison_duplicate_evidence', '比较证据 ID 不能重复。')
  }
  const allEvidenceIds = unique([...evidenceIds, ...metricEvidenceIds])
  const evidenceRows = await rows<EvidenceRow>('SELECT id,project_id,paper_id,claim,quote,locator,source_url,metadata FROM evidence WHERE project_id=$1 AND id=ANY($2::uuid[])', [projectId, allEvidenceIds])
  if (evidenceRows.length !== allEvidenceIds.length) throw new ApiError(403, 'research_comparison_evidence_scope', '比较只能引用当前项目的 Evidence。')
  if (evidenceRows.some(evidence => evidence.paper_id !== input.paper_id)) throw new ApiError(409, 'research_comparison_evidence_paper_mismatch', '比较 Evidence 必须全部属于指定 Paper。')
  if (evidenceRows.some(evidence => !evidence.locator?.trim())) throw new ApiError(409, 'research_comparison_locator_required', '比较 Evidence 必须有页码或章节定位。')
  if (evidenceRows.some(evidence => !/^https:\/\//i.test(evidence.source_url) || !evidenceHash(evidence))) throw new ApiError(409, 'research_comparison_evidence_hash_required', '比较 Evidence 必须有 HTTPS 稳定来源和 PDF SHA-256。')

  const reviews = await rows<ClaimReviewRow>('SELECT id,evidence_ids,status FROM claim_reviews WHERE project_id=$1 AND status=\'accepted\'', [projectId])
  const claimReviewIds = new Map<string, string[]>()
  for (const evidenceId of allEvidenceIds) {
    const ids = reviews.filter(review => Array.isArray(review.evidence_ids) && review.evidence_ids.includes(evidenceId)).map(review => review.id)
    if (!ids.length) throw new ApiError(409, 'research_comparison_claim_review_required', `Evidence ${evidenceId} 尚未有 accepted ClaimReview。`)
    claimReviewIds.set(evidenceId, ids)
  }

  const run = await one<ReproductionRunRow>('SELECT * FROM reproduction_runs WHERE id=$1 AND project_id=$2', [input.reproduction_run_id, projectId])
  if (!run) throw new ApiError(404, 'research_comparison_run_not_found', '复现运行不存在或不属于当前项目。')
  const reproduction = await one<ReproductionRow>('SELECT id,project_id,repository_id,source_commit,status,plan FROM reproductions WHERE id=$1 AND project_id=$2', [run.reproduction_id, projectId])
  if (!reproduction) throw new ApiError(404, 'research_comparison_reproduction_not_found', '复现环境不存在或不属于当前项目。')
  const repository = await one<RepositoryRow>('SELECT id,project_id,paper_id,source_url,commit_or_tag FROM repositories WHERE id=$1 AND project_id=$2', [reproduction.repository_id, projectId])
  if (!repository) throw new ApiError(404, 'research_comparison_repository_not_found', '复现仓库不存在或不属于当前项目。')
  if (repository.paper_id !== input.paper_id) throw new ApiError(409, 'research_comparison_reproduction_paper_mismatch', '复现仓库关联的论文与比较 Paper 不一致。')

  const artifactIds = unique(Array.isArray(run.artifact_ids) ? run.artifact_ids.filter((id): id is string => typeof id === 'string') : [])
  const artifacts = artifactIds.length
    ? await rows<ArtifactRow>('SELECT id,project_id,sha256,valid,mime_type,relative_path,metadata FROM artifacts WHERE project_id=$1 AND id=ANY($2::uuid[])', [projectId, artifactIds])
    : []
  const reasons: string[] = []
  if (!/^[0-9a-f]{40}$/i.test(run.source_commit)) reasons.push('source_commit_invalid')
  if (run.status !== 'completed') reasons.push(`reproduction_run_${run.status}`)
  if (!artifactIds.length) reasons.push('reproduction_artifacts_missing')
  if (artifacts.length !== artifactIds.length) reasons.push('reproduction_artifact_scope_or_missing')
  if (artifacts.some(artifact => !artifact.valid)) reasons.push('reproduction_artifact_invalid')
  let parsedMetrics: z.infer<typeof reproductionMetrics> | null = null
  const metricResult = reproductionMetrics.safeParse(run.metrics)
  if (!metricResult.success) reasons.push('reproduction_metrics_invalid')
  else parsedMetrics = metricResult.data

  return { paper, evidenceRows, claimReviewIds, run, reproduction, repository, artifacts, parsedMetrics, reasons }
}

function buildComparison(input: ResearchComparisonRequest, validated: Awaited<ReturnType<typeof validatedInputs>>) {
  const { paper, evidenceRows, claimReviewIds, run, reproduction, repository, artifacts, parsedMetrics, reasons } = validated
  const paperContext = input.paper_context
  const runConfig = record(run.config)
  const plan = record(reproduction.plan)
  const reproductionContext = {
    data_version: stringValue(contextValue(runConfig, 'data_version')) || stringValue(contextValue(runConfig, 'dataset_version')),
    datasets: stringArray(contextValue(runConfig, 'datasets')),
    config_fingerprint: stringValue(plan.config_fingerprint) || hash(runConfig),
    seeds: numberArray(run.random_seeds),
    metric_definitions: record(contextValue(runConfig, 'metric_definitions')),
    source_commit: run.source_commit,
    repository_id: repository.id,
    repository_url: repository.source_url,
    reproduction_id: reproduction.id,
  }

  const contextMatches = {
    data_version: matchScalar(paperContext.data_version, reproductionContext.data_version),
    datasets: paperContext.datasets.length && reproductionContext.datasets.length ? matchScalar(paperContext.datasets, reproductionContext.datasets) : 'unknown' as const,
    config_fingerprint: matchScalar(paperContext.config_fingerprint, reproductionContext.config_fingerprint),
    seeds: paperContext.seeds ? matchScalar(paperContext.seeds, reproductionContext.seeds) : 'unknown' as const,
  }
  const contextMismatches = Object.entries(contextMatches).filter(([, status]) => status === 'mismatch').map(([key]) => `${key}_mismatch`)
  const contextUnknowns = Object.entries(contextMatches).filter(([, status]) => status === 'unknown').map(([key]) => `${key}_unknown`)
  const metricDefinitions = record(reproductionContext.metric_definitions)
  const metricComparisons: RecordValue = {}
  const signals: Array<{ candidate_type: 'innovation' | 'counterexample' | 'difference' | 'comparability_gap' | 'potential_improvement' | 'potential_regression'; statement: string; basis: RecordValue }> = []
  let comparableMetricCount = 0
  let partialMetricCount = 0

  const paperMetrics = input.paper_metrics as Record<string, ComparisonMetricInput>
  for (const [metricName, inputMetric] of Object.entries(paperMetrics)) {
    const aggregate = parsedMetrics?.aggregate[metricName]
    const reproductionDefinition = stringValue(metricDefinitions[metricName])
    const paperDefinition = inputMetric.definition || stringValue(paperContext.metric_definitions[metricName])
    const definitionMatch = matchScalar(paperDefinition, reproductionDefinition)
    if (!aggregate) {
      metricComparisons[metricName] = { status: 'blocked', reason: 'metric_missing_from_reproduction', paper_value: inputMetric.value, reproduction_value: null, direction: inputMetric.direction }
      continue
    }
    const metricContextUnknown = contextUnknowns.length > 0 || definitionMatch === 'unknown'
    const metricContextMismatch = contextMismatches.length > 0 || definitionMatch === 'mismatch'
    const status = metricContextMismatch ? 'blocked' : metricContextUnknown ? 'partial' : 'comparable'
    const delta = aggregate.mean - inputMetric.value
    const relativeDelta = inputMetric.value === 0 ? null : delta / Math.abs(inputMetric.value)
    const signal = metricDirectionSignal(inputMetric.direction, delta)
    metricComparisons[metricName] = {
      status,
      paper_value: inputMetric.value,
      reproduction_mean: aggregate.mean,
      reproduction_population_std: aggregate.population_std,
      reproduction_count: aggregate.count,
      reproduction_min: aggregate.min,
      reproduction_max: aggregate.max,
      delta,
      relative_delta: relativeDelta,
      direction: inputMetric.direction,
      signal,
      evidence_ids: inputMetric.evidence_ids,
      definition: { paper: paperDefinition, reproduction: reproductionDefinition, status: definitionMatch },
      per_seed: parsedMetrics?.per_seed ? Object.fromEntries(Object.entries(parsedMetrics.per_seed).map(([seed, metrics]) => [seed, metrics[metricName] ?? null])) : {},
    }
    if (status === 'comparable') comparableMetricCount += 1
    if (status === 'partial') partialMetricCount += 1
    if (signal !== 'no_difference') {
      const candidateType = signal === 'potential_improvement' ? 'potential_improvement' : signal === 'potential_regression' ? 'counterexample' : 'difference'
      signals.push({
        candidate_type: candidateType,
        statement: `指标 ${metricName} 出现 ${signal === 'potential_improvement' ? '潜在改善' : signal === 'potential_regression' ? '潜在回归' : '数值差异'}信号；这不是科学结论，仍需复核。`,
        basis: { metric_name: metricName, evidence_ids: inputMetric.evidence_ids, artifact_ids: artifacts.map(artifact => artifact.id), status },
      })
    }
  }

  if (contextMismatches.length) reasons.push(...contextMismatches)
  const metricStatuses = Object.values(metricComparisons).map(value => String(record(value).status))
  if (metricStatuses.some(status => status === 'blocked')) reasons.push('metric_not_comparable')
  if (!comparableMetricCount && !partialMetricCount) reasons.push('no_comparable_metric')
  const status = reasons.length ? blockingStatus(run.status, reasons) : partialMetricCount || contextUnknowns.length ? 'partial' : 'comparable'
  const sourceSnapshot = {
    project_id: input.paper_id ? paper.project_id : null,
    paper: { id: paper.id, title: paper.title, doi: paper.doi, confirmed: paper.confirmed },
    evidence: evidenceRows.map(evidence => evidenceSnapshot(evidence, validated.claimReviewIds.get(evidence.id) || [])),
    reproduction: { id: reproduction.id, status: reproduction.status, repository_id: repository.id, source_commit: reproduction.source_commit, source_tree_sha256: stringValue(reproduction.plan.source_tree_sha256) },
    reproduction_run: { id: run.id, status: run.status, entrypoint: run.entrypoint, random_seeds: run.random_seeds, error: run.error },
    artifacts: artifacts.map(artifact => ({ id: artifact.id, sha256: artifact.sha256, valid: artifact.valid, mime_type: artifact.mime_type, relative_path: artifact.relative_path })),
  }
  const inputHash = hash({ paper_id: paper.id, reproduction_run_id: run.id, paper_context: paperContext, paper_metrics: paperMetrics, source_snapshot: sourceSnapshot })
  if (status === 'comparable' && signals.length && signals.every(signal => signal.candidate_type === 'potential_improvement')) {
    signals.push({
      candidate_type: 'innovation',
      statement: '所有已比较指标出现同方向潜在改善信号；仅作为待核验候选，不能表述为创新或优于原文。',
      basis: { metric_names: Object.keys(metricComparisons), evidence_ids: evidenceRows.map(evidence => evidence.id), artifact_ids: artifacts.map(artifact => artifact.id), comparison_status: status },
    })
  }
  if (status !== 'comparable') {
    signals.push({
      candidate_type: 'comparability_gap',
      statement: `当前比较存在不可比或未披露条件（${[...new Set([...contextMismatches, ...contextUnknowns, ...reasons])].join('、')}），需要补充证据或重新运行。`,
      basis: { context_matches: contextMatches, blocking_reasons: [...new Set(reasons)], evidence_ids: evidenceRows.map(evidence => evidence.id), artifact_ids: artifacts.map(artifact => artifact.id) },
    })
  }
  return { status, paperContext, reproductionContext, metricComparisons, blockingReasons: [...new Set(reasons)], sourceSnapshot, inputHash, signals }
}

async function insertSignalCandidates(projectId: string, comparisonId: string, signals: Array<{ candidate_type: string; statement: string; basis: RecordValue }>, actor: string) {
  const ids: string[] = []
  for (const signal of signals) {
    const candidateType = comparisonCandidateType.safeParse(signal.candidate_type)
    if (!candidateType.success) continue
    const id = crypto.randomUUID()
    ids.push(id)
    await database.query(`INSERT INTO research_comparison_candidates
      (id,project_id,comparison_id,candidate_type,statement,basis,evidence_status,status,actor)
      VALUES ($1,$2,$3,$4,$5,$6,'comparison_requires_review','candidate',$7)`, [id, projectId, comparisonId, candidateType.data, signal.statement, signal.basis, actor])
  }
  return ids
}

export async function createResearchComparison(projectId: string, input: ResearchComparisonRequest) {
  await requireProject(projectId, true)
  const validated = await validatedInputs(projectId, input)
  const built = buildComparison(input, validated)
  const comparisonId = crypto.randomUUID()
  await database.query(`INSERT INTO research_comparisons
    (id,project_id,paper_id,reproduction_run_id,status,reason,input_hash,paper_context,reproduction_context,metric_comparisons,blocking_reasons,source_snapshot,created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [
    comparisonId, projectId, input.paper_id, input.reproduction_run_id, built.status, input.reason, built.inputHash,
    built.paperContext, built.reproductionContext, built.metricComparisons, built.blockingReasons, built.sourceSnapshot, input.actor,
  ])
  const candidateIds = await insertSignalCandidates(projectId, comparisonId, built.signals, input.actor)
  await audit('research_comparison.created', projectId, { comparison_id: comparisonId, paper_id: input.paper_id, reproduction_run_id: input.reproduction_run_id, status: built.status, blocking_reasons: built.blockingReasons, candidate_ids: candidateIds }, input.actor)
  return {
    project_id: projectId,
    comparison_id: comparisonId,
    status: built.status,
    input_hash: built.inputHash,
    blocking_reasons: built.blockingReasons,
    metric_comparisons: built.metricComparisons,
    source_snapshot: built.sourceSnapshot,
    candidate_ids: candidateIds,
    evidence_status: 'comparison_requires_review',
  }
}

export async function listResearchComparisons(projectId: string) {
  await requireProject(projectId)
  const comparisons = await rows<ComparisonRow>('SELECT * FROM research_comparisons WHERE project_id=$1 ORDER BY created_at DESC,id', [projectId])
  const candidates = await rows<CandidateRow>('SELECT * FROM research_comparison_candidates WHERE project_id=$1 ORDER BY created_at DESC,id', [projectId])
  return { project_id: projectId, permission_status: 'project_scoped', comparisons: comparisons.map(comparison => ({ ...comparison, candidates: candidates.filter(candidate => candidate.comparison_id === comparison.id) })) }
}

export async function getResearchComparison(projectId: string, comparisonId: string) {
  await requireProject(projectId)
  const comparison = await loadComparison(projectId, comparisonId)
  const candidates = await rows<CandidateRow>('SELECT * FROM research_comparison_candidates WHERE project_id=$1 AND comparison_id=$2 ORDER BY created_at,id', [projectId, comparisonId])
  return { project_id: projectId, permission_status: 'project_scoped', comparison, candidates }
}

export async function createResearchComparisonCandidate(projectId: string, comparisonId: string, input: ComparisonCandidateCreateRequest) {
  await requireProject(projectId, true)
  const comparison = await loadComparison(projectId, comparisonId)
  if (comparison.status === 'blocked') throw new ApiError(409, 'research_comparison_candidate_blocked', '不可比的比较不能直接提交创新、研究空白或反例候选。')
  const id = crypto.randomUUID()
  const basis = { comparison_id: comparison.id, input_hash: comparison.input_hash, source_snapshot: comparison.source_snapshot, evidence_status: 'comparison_requires_review' }
  await database.query(`INSERT INTO research_comparison_candidates
    (id,project_id,comparison_id,candidate_type,statement,basis,evidence_status,status,actor)
    VALUES ($1,$2,$3,$4,$5,$6,'comparison_requires_review','candidate',$7)`, [id, projectId, comparison.id, input.candidate_type, input.statement, basis, input.actor])
  await audit('research_comparison.candidate_created', projectId, { comparison_id: comparison.id, candidate_id: id, candidate_type: input.candidate_type }, input.actor)
  return { project_id: projectId, comparison_id: comparison.id, candidate_id: id, status: 'candidate', evidence_status: 'comparison_requires_review' }
}

export async function decideResearchComparisonCandidate(projectId: string, comparisonId: string, candidateId: string, input: ComparisonCandidateDecisionRequest) {
  await requireProject(projectId, true)
  await loadComparison(projectId, comparisonId)
  const candidate = await one<CandidateRow>('SELECT * FROM research_comparison_candidates WHERE id=$1 AND project_id=$2 AND comparison_id=$3', [candidateId, projectId, comparisonId])
  if (!candidate) throw new ApiError(404, 'research_comparison_candidate_not_found', '比较候选不存在或不属于当前项目。')
  if (candidate.status !== 'candidate' && input.decision !== 'reopened') throw new ApiError(409, 'research_comparison_candidate_already_decided', '比较候选已经有终态决定。')
  const nextStatus = input.decision === 'reopened' ? 'candidate' : input.decision
  if (nextStatus === 'candidate') {
    await database.query(`UPDATE research_comparison_candidates
      SET status=$2,decision_comment=$3,decided_at=NULL
      WHERE id=$1 AND project_id=$4 AND comparison_id=$5`, [candidateId, nextStatus, input.reason, projectId, comparisonId])
  } else {
    await database.query(`UPDATE research_comparison_candidates
      SET status=$2,decision_comment=$3,decided_at=NOW()
      WHERE id=$1 AND project_id=$4 AND comparison_id=$5`, [candidateId, nextStatus, input.reason, projectId, comparisonId])
  }
  await audit(`research_comparison.candidate_${input.decision}`, projectId, { comparison_id: comparisonId, candidate_id: candidateId, reason: input.reason, evidence_status: 'comparison_requires_review' }, input.actor)
  return { project_id: projectId, comparison_id: comparisonId, candidate_id: candidateId, status: nextStatus, evidence_status: 'comparison_requires_review' }
}

export const parseResearchComparisonRequest = researchComparisonRequest
export const parseComparisonCandidateCreateRequest = comparisonCandidateCreateRequest
export const parseComparisonCandidateDecisionRequest = comparisonCandidateDecisionRequest
export const comparisonMetricInputSchema = comparisonMetricInput
