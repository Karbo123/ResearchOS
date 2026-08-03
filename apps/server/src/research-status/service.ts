import { audit, database, one, rows } from '../database.js'
import { ApiError } from '../http.js'
import { requireProject } from '../project-service.js'
import {
  type ResearchStatusFilterRequest,
  type ResearchStatusGapCandidateRequest,
  type ResearchStatusGapDecisionRequest,
  type ResearchStatusMatrixCreateRequest,
  type ResearchStatusMatrixRowRequest,
  type ResearchStatusExportFormat,
} from './contracts.js'

type MatrixRowRecord = {
  id: string
  project_id: string
  matrix_id: string
  paper_id: string
  theme: string | null
  method: string | null
  year: number | null
  datasets: string[]
  metrics: string[]
  limitations: string | null
  code_availability: string
  evidence_ids: string[]
  claim_review_ids: string[]
  evidence_status: string
  provenance: Record<string, unknown>
  created_at: string
  updated_at: string
}

type MatrixRecord = {
  id: string
  project_id: string
  idea_version: number
  status: string
  created_by: string
  created_at: string
  updated_at: string
}

type PaperRecord = {
  id: string
  project_id: string
  title: string
  doi: string | null
  source_url: string
  metadata: Record<string, unknown>
  verified: boolean
  confirmed: boolean
}

type EvidenceRecord = {
  id: string
  project_id: string
  paper_id: string | null
  claim: string
  quote: string
  locator: string | null
  source_url: string
}

type ClaimReviewRecord = {
  id: string
  project_id: string
  claim: string
  evidence_ids: string[]
  status: string
  decision_comment: string | null
}

type GapCandidateRecord = {
  id: string
  project_id: string
  matrix_id: string
  candidate_type: string
  statement: string
  row_ids: string[]
  paper_ids: string[]
  evidence_ids: string[]
  claim_review_ids: string[]
  idea_version: number
  basis: Record<string, unknown>
  evidence_status: string
  status: string
  actor: string
  decision_comment: string | null
  created_at: string
  decided_at: string | null
}

type CandidatePaperRecord = {
  id: string
  title: string
  doi: string | null
  source_url: string
}

type CandidateEvidenceRecord = {
  id: string
  paper_id: string | null
  claim: string
  locator: string | null
  source_url: string
}

type CandidateReviewRecord = {
  id: string
  claim: string
  evidence_ids: string[]
}

type GraphNode = {
  id: string
  kind: 'candidate' | 'paper' | 'evidence' | 'claim_review'
  label: string
  status: string
  citation_count?: number | null
  source: {
    source_type: string
    source_id: string
    provider?: string
    stable_id?: string
    url?: string
    locator?: string | null
  }
  permission_status: 'project_scoped'
  evidence_status: 'metadata_only' | 'page_quote' | 'claim_reviewed'
}

type GraphEdge = {
  id: string
  source: string
  target: string
  relation: 'references' | 'has_evidence' | 'uses_evidence'
  source_type: string
  source_id: string
  permission_status: 'project_scoped'
  evidence_status: 'metadata_only' | 'page_quote' | 'claim_reviewed'
}

function jsonArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function metadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function rowFromDatabase(row: MatrixRowRecord, paper: PaperRecord | undefined) {
  return {
    ...row,
    datasets: jsonArray(row.datasets),
    metrics: jsonArray(row.metrics),
    evidence_ids: jsonArray(row.evidence_ids),
    claim_review_ids: jsonArray(row.claim_review_ids),
    provenance: metadataObject(row.provenance),
    paper: paper ? {
      id: paper.id,
      title: paper.title,
      doi: paper.doi,
      source_url: paper.source_url,
      confirmed: paper.confirmed,
      verified: paper.verified,
    } : null,
  }
}

function matrixFromDatabase(matrix: MatrixRecord, matrixRows: MatrixRowRecord[], papers: PaperRecord[]) {
  const paperMap = new Map(papers.map(paper => [paper.id, paper]))
  return {
    ...matrix,
    rows: matrixRows.map(row => rowFromDatabase(row, paperMap.get(row.paper_id))),
  }
}

async function matrixForProject(projectId: string, matrixId: string): Promise<MatrixRecord> {
  const matrix = await one<MatrixRecord>('SELECT * FROM research_status_matrices WHERE id=$1 AND project_id=$2', [matrixId, projectId])
  if (!matrix) throw new ApiError(404, 'research_status_matrix_not_found', '研究现状矩阵不存在或不属于当前项目。')
  return matrix
}

async function papersForProject(projectId: string, paperIds: string[]): Promise<PaperRecord[]> {
  const uniquePaperIds = unique(paperIds)
  const papers = await rows<PaperRecord>('SELECT id,project_id,title,doi,source_url,metadata,verified,confirmed FROM papers WHERE project_id=$1 AND id=ANY($2::uuid[])', [projectId, uniquePaperIds])
  if (papers.length !== uniquePaperIds.length) throw new ApiError(403, 'research_status_paper_scope', '研究现状矩阵只能使用当前项目的 Paper。')
  const unconfirmed = papers.filter(paper => paper.confirmed !== true)
  if (unconfirmed.length) throw new ApiError(409, 'research_status_paper_not_confirmed', `以下 Paper 尚未由用户确认：${unconfirmed.map(paper => paper.title).join('；')}`)
  return papers
}

async function evidenceForProject(projectId: string, evidenceIds: string[], paperIds: string[]): Promise<EvidenceRecord[]> {
  const uniqueEvidenceIds = unique(evidenceIds)
  const evidence = await rows<EvidenceRecord>('SELECT id,project_id,paper_id,claim,quote,locator,source_url FROM evidence WHERE project_id=$1 AND id=ANY($2::uuid[])', [projectId, uniqueEvidenceIds])
  if (evidence.length !== uniqueEvidenceIds.length) throw new ApiError(403, 'research_status_evidence_scope', '研究现状矩阵只能使用当前项目的 Evidence。')
  const paperSet = new Set(paperIds)
  if (evidence.some(item => item.paper_id !== null && !paperSet.has(item.paper_id))) throw new ApiError(409, 'research_status_evidence_paper_mismatch', 'Evidence 不属于矩阵行引用的 Paper。')
  if (evidence.some(item => !item.locator || !item.locator.trim())) throw new ApiError(409, 'research_status_locator_required', '只有带页码或章节定位的 Evidence 才能进入研究现状矩阵。')
  return evidence
}

async function claimReviewsForProject(projectId: string, claimReviewIds: string[], evidenceIds: string[]): Promise<ClaimReviewRecord[]> {
  const uniqueClaimReviewIds = unique(claimReviewIds)
  const reviews = await rows<ClaimReviewRecord>('SELECT id,project_id,claim,evidence_ids,status,decision_comment FROM claim_reviews WHERE project_id=$1 AND id=ANY($2::uuid[])', [projectId, uniqueClaimReviewIds])
  if (reviews.length !== uniqueClaimReviewIds.length) throw new ApiError(403, 'research_status_claim_review_scope', '研究现状矩阵只能使用当前项目的 ClaimReview。')
  if (reviews.some(review => review.status !== 'accepted')) throw new ApiError(409, 'research_status_claim_review_required', '只有已接受的 ClaimReview 才能支持研究现状矩阵。')
  const evidenceSet = new Set(evidenceIds)
  if (reviews.some(review => !jsonArray(review.evidence_ids).some(id => evidenceSet.has(id)))) throw new ApiError(409, 'research_status_claim_evidence_mismatch', 'ClaimReview 没有引用对应矩阵行的 Evidence。')
  return reviews
}

function validateRows(rowsInput: ResearchStatusMatrixRowRequest[]): void {
  const paperIds = rowsInput.map(row => row.paper_id)
  if (new Set(paperIds).size !== paperIds.length) throw new ApiError(422, 'research_status_duplicate_paper', '矩阵中每个 Paper 只能有一行。')
  for (const row of rowsInput) {
    if (new Set(row.evidence_ids).size !== row.evidence_ids.length) throw new ApiError(422, 'research_status_duplicate_evidence', '同一矩阵行不能重复引用 Evidence。')
    if (new Set(row.claim_review_ids).size !== row.claim_review_ids.length) throw new ApiError(422, 'research_status_duplicate_claim_review', '同一矩阵行不能重复引用 ClaimReview。')
  }
}

export async function createResearchStatusMatrix(projectId: string, input: ResearchStatusMatrixCreateRequest) {
  const project = await requireProject(projectId, true)
  validateRows(input.rows)
  const paperIds = input.rows.map(row => row.paper_id)
  const evidenceIds = input.rows.flatMap(row => row.evidence_ids)
  const claimReviewIds = input.rows.flatMap(row => row.claim_review_ids)
  const papers = await papersForProject(projectId, paperIds)
  const evidence = await evidenceForProject(projectId, evidenceIds, paperIds)
  const reviews = await claimReviewsForProject(projectId, claimReviewIds, evidenceIds)
  const evidenceMap = new Map(evidence.map(item => [item.id, item]))
  const reviewMap = new Map(reviews.map(item => [item.id, item]))
  const ideaVersion = input.idea_version ?? project.current_idea_version
  if (ideaVersion !== project.current_idea_version) throw new ApiError(409, 'research_status_idea_version_stale', '矩阵使用的 Idea 版本不是当前版本，请重新确认研究规格。')
  const matrixId = crypto.randomUUID()
  await database.query('INSERT INTO research_status_matrices(id,project_id,idea_version,status,created_by) VALUES ($1,$2,$3,$4,$5)', [matrixId, projectId, ideaVersion, 'ready', input.actor])
  for (const row of input.rows) {
    const rowEvidence = row.evidence_ids.map(id => evidenceMap.get(id)!).map(item => ({ id: item.id, locator: item.locator, source_url: item.source_url }))
    const rowReviews = row.claim_review_ids.map(id => reviewMap.get(id)!).map(item => ({ id: item.id, evidence_ids: jsonArray(item.evidence_ids) }))
    const provenance = {
      project_id: projectId,
      paper_id: row.paper_id,
      idea_version: ideaVersion,
      evidence: rowEvidence,
      claim_reviews: rowReviews,
      field_values: {
        theme: row.theme ? 'user_input' : 'unresolved',
        method: row.method ? 'user_input' : 'unresolved',
        year: row.year === null ? 'unresolved' : 'user_input',
        datasets: row.datasets.length ? 'user_input' : 'unresolved',
        metrics: row.metrics.length ? 'user_input' : 'unresolved',
        limitations: row.limitations ? 'user_input' : 'unresolved',
        code_availability: row.code_availability,
      },
    }
    await database.query(`INSERT INTO research_status_matrix_rows
      (id,project_id,matrix_id,paper_id,theme,method,year,datasets,metrics,limitations,code_availability,evidence_ids,claim_review_ids,evidence_status,provenance)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, [
      crypto.randomUUID(), projectId, matrixId, row.paper_id, row.theme, row.method, row.year,
      row.datasets, row.metrics, row.limitations, row.code_availability, row.evidence_ids, row.claim_review_ids,
      'claim_reviewed', provenance,
    ])
  }
  await audit('research_status.matrix_created', projectId, { matrix_id: matrixId, row_count: input.rows.length, idea_version: ideaVersion }, input.actor)
  return getResearchStatus(projectId, { matrix_id: matrixId })
}

async function matrixRowsForProject(projectId: string, matrixId: string, filter: ResearchStatusFilterRequest): Promise<MatrixRowRecord[]> {
  const clauses = ['project_id=$1', 'matrix_id=$2']
  const params: unknown[] = [projectId, matrixId]
  if (filter.theme) { params.push(filter.theme); clauses.push(`theme=$${params.length}`) }
  if (filter.method) { params.push(filter.method); clauses.push(`method=$${params.length}`) }
  if (filter.year !== null && filter.year !== undefined) { params.push(filter.year); clauses.push(`year=$${params.length}`) }
  return rows<MatrixRowRecord>(`SELECT * FROM research_status_matrix_rows WHERE ${clauses.join(' AND ')} ORDER BY year NULLS LAST,paper_id,id`, params)
}

async function graphForProject(projectId: string) {
  const candidates = await rows<Record<string, unknown>>(`SELECT id,provider,stable_id,title,paper_id,status,candidate FROM related_work_candidates WHERE project_id=$1 ORDER BY normalized_title,id`, [projectId])
  const papers = await rows<PaperRecord>('SELECT id,project_id,title,doi,source_url,metadata,verified,confirmed FROM papers WHERE project_id=$1 ORDER BY title,id', [projectId])
  const evidence = await rows<EvidenceRecord>('SELECT id,project_id,paper_id,claim,quote,locator,source_url FROM evidence WHERE project_id=$1 ORDER BY id', [projectId])
  const reviews = await rows<ClaimReviewRecord>('SELECT id,project_id,claim,evidence_ids,status,decision_comment FROM claim_reviews WHERE project_id=$1 ORDER BY id', [projectId])
  const citationEdges = await rows<Record<string, unknown>>(`SELECT id,source_candidate_id,target_candidate_id,provider,relation,ranking_score,ranking_reasons,discovery_depth
    FROM related_work_citation_edges WHERE project_id=$1 ORDER BY created_at,id`, [projectId])
  const nodes: GraphNode[] = []
  const nodeIds = new Set<string>()
  const addNode = (node: GraphNode) => { if (!nodeIds.has(node.id)) { nodeIds.add(node.id); nodes.push(node) } }
  const paperMap = new Map(papers.map(paper => [paper.id, paper]))
  for (const candidate of candidates) {
    const paperId = typeof candidate.paper_id === 'string' ? candidate.paper_id : null
    const paper = paperId ? paperMap.get(paperId) : null
    const candidateMetadata = metadataObject(candidate.candidate)
    const candidateSourceUrl = typeof candidateMetadata.source_url === 'string' ? candidateMetadata.source_url : null
    const paperMetadata = paper ? metadataObject(paper.metadata) : null
    addNode({
      id: paperId ? `paper:${paperId}` : `candidate:${String(candidate.id)}`,
      kind: paperId ? 'paper' : 'candidate',
      label: paper?.title || String(candidate.title),
      status: String(candidate.status || (paper?.confirmed ? 'confirmed' : 'candidate')),
      citation_count: paper ? (typeof paperMetadata?.citation_count === 'number' ? paperMetadata.citation_count : null) : (typeof candidateMetadata.citation_count === 'number' ? candidateMetadata.citation_count : null),
      source: {
        source_type: 'provider',
        source_id: String(candidate.id),
        provider: String(candidate.provider),
        stable_id: String(candidate.stable_id),
        ...(candidateSourceUrl ? { url: candidateSourceUrl } : {}),
      },
      permission_status: 'project_scoped',
      evidence_status: 'metadata_only',
    })
  }
  for (const paper of papers) {
    const metadata = metadataObject(paper.metadata)
    addNode({ id: `paper:${paper.id}`, kind: 'paper', label: paper.title, status: paper.confirmed ? 'confirmed' : 'unconfirmed', citation_count: typeof metadata.citation_count === 'number' ? metadata.citation_count : null, source: { source_type: 'paper', source_id: paper.id, url: paper.source_url }, permission_status: 'project_scoped', evidence_status: 'metadata_only' })
  }
  const edges: GraphEdge[] = []
  for (const edge of citationEdges) {
    const sourceCandidate = candidates.find(candidate => candidate.id === edge.source_candidate_id)
    const targetCandidate = candidates.find(candidate => candidate.id === edge.target_candidate_id)
    if (!sourceCandidate || !targetCandidate) continue
    const source = sourceCandidate.paper_id ? `paper:${sourceCandidate.paper_id}` : `candidate:${sourceCandidate.id}`
    const target = targetCandidate.paper_id ? `paper:${targetCandidate.paper_id}` : `candidate:${targetCandidate.id}`
    if (!nodeIds.has(source) || !nodeIds.has(target)) continue
    edges.push({ id: `citation:${String(edge.id)}`, source, target, relation: 'references', source_type: String(edge.provider), source_id: String(edge.id), permission_status: 'project_scoped', evidence_status: 'metadata_only' })
  }
  for (const item of evidence) {
    const evidenceStatus = item.locator ? 'page_quote' : 'metadata_only'
    addNode({ id: `evidence:${item.id}`, kind: 'evidence', label: item.claim, status: item.locator ? 'located' : 'unlocated', source: { source_type: 'evidence', source_id: item.id, url: item.source_url, locator: item.locator }, permission_status: 'project_scoped', evidence_status: evidenceStatus })
    if (item.paper_id && nodeIds.has(`paper:${item.paper_id}`)) edges.push({ id: `paper-evidence:${item.id}`, source: `paper:${item.paper_id}`, target: `evidence:${item.id}`, relation: 'has_evidence', source_type: 'evidence', source_id: item.id, permission_status: 'project_scoped', evidence_status: evidenceStatus })
  }
  for (const review of reviews) {
    const reviewEvidence = jsonArray(review.evidence_ids)
    const evidenceStatus = review.status === 'accepted' ? 'claim_reviewed' : 'page_quote'
    addNode({ id: `claim-review:${review.id}`, kind: 'claim_review', label: review.claim, status: review.status, source: { source_type: 'claim_review', source_id: review.id }, permission_status: 'project_scoped', evidence_status: evidenceStatus })
    for (const evidenceId of reviewEvidence) if (nodeIds.has(`evidence:${evidenceId}`)) edges.push({ id: `claim-evidence:${review.id}:${evidenceId}`, source: `claim-review:${review.id}`, target: `evidence:${evidenceId}`, relation: 'uses_evidence', source_type: 'claim_review', source_id: review.id, permission_status: 'project_scoped', evidence_status: evidenceStatus })
  }
  return { project_id: projectId, permission_status: 'project_scoped' as const, nodes, edges }
}

async function gapsForProject(projectId: string, matrixId?: string) {
  const gaps = await rows<GapCandidateRecord>(`SELECT * FROM research_status_gap_candidates WHERE project_id=$1${matrixId ? ' AND matrix_id=$2' : ''} ORDER BY created_at DESC,id`, matrixId ? [projectId, matrixId] : [projectId])
  return gaps.map(item => {
    const basis = metadataObject(item.basis)
    const normalizedBasis = {
      idea_version: item.idea_version,
      papers: Array.isArray(basis.papers) ? basis.papers : [],
      evidence: Array.isArray(basis.evidence) ? basis.evidence : [],
      claim_reviews: Array.isArray(basis.claim_reviews) ? basis.claim_reviews : [],
    }
    return {
      ...item,
      row_ids: jsonArray(item.row_ids),
      paper_ids: jsonArray(item.paper_ids),
      evidence_ids: jsonArray(item.evidence_ids),
      claim_review_ids: jsonArray(item.claim_review_ids),
      basis: normalizedBasis,
      evidence_status: item.evidence_status || 'candidate_requires_review',
    }
  })
}

export async function getResearchStatus(projectId: string, filter: ResearchStatusFilterRequest = {}) {
  await requireProject(projectId)
  const matrices = await rows<MatrixRecord>('SELECT * FROM research_status_matrices WHERE project_id=$1 ORDER BY created_at DESC,id', [projectId])
  const selected = filter.matrix_id ? await matrixForProject(projectId, filter.matrix_id) : matrices[0]
  const papers = await rows<PaperRecord>('SELECT id,project_id,title,doi,source_url,metadata,verified,confirmed FROM papers WHERE project_id=$1 ORDER BY title,id', [projectId])
  const matrix = selected ? matrixFromDatabase(selected, await matrixRowsForProject(projectId, selected.id, filter), papers) : null
  const graph = await graphForProject(projectId)
  return {
    project_id: projectId,
    permission_status: 'project_scoped' as const,
    status: matrix ? 'ready' : 'empty',
    matrix_status: matrix ? 'ready' : 'empty',
    graph_status: graph.nodes.length || graph.edges.length ? 'ready' : 'empty',
    matrix,
    matrices: matrices.map(item => ({ id: item.id, idea_version: item.idea_version, status: item.status, created_by: item.created_by, created_at: item.created_at, updated_at: item.updated_at })),
    gap_candidates: await gapsForProject(projectId, selected?.id),
    graph,
    limitations: matrix ? [] : ['尚未创建由定位 Evidence 和已接受 ClaimReview 支持的研究现状矩阵。'],
  }
}

export async function createResearchStatusGapCandidate(projectId: string, input: ResearchStatusGapCandidateRequest) {
  await requireProject(projectId, true)
  const matrix = await matrixForProject(projectId, input.matrix_id)
  const rowIds = unique(input.row_ids)
  const scopedRows = await rows<{ id: string; paper_id: string; evidence_ids: string[]; claim_review_ids: string[]; evidence_status: string }>(
    'SELECT id,paper_id,evidence_ids,claim_review_ids,evidence_status FROM research_status_matrix_rows WHERE project_id=$1 AND matrix_id=$2 AND id=ANY($3::uuid[])',
    [projectId, input.matrix_id, rowIds],
  )
  if (scopedRows.length !== rowIds.length) throw new ApiError(403, 'research_status_gap_row_scope', '研究空白候选只能引用当前项目矩阵中的行。')
  if (scopedRows.some(row => row.evidence_status !== 'claim_reviewed')) throw new ApiError(409, 'research_status_gap_evidence_required', '研究空白候选只能引用已完成 ClaimReview 的矩阵行。')
  const paperIds = unique(scopedRows.map(row => row.paper_id))
  const evidenceIds = unique(scopedRows.flatMap(row => jsonArray(row.evidence_ids)))
  const claimReviewIds = unique(scopedRows.flatMap(row => jsonArray(row.claim_review_ids)))
  const ideaVersion = input.idea_version ?? matrix.idea_version
  if (ideaVersion !== matrix.idea_version) throw new ApiError(409, 'research_status_gap_idea_version_stale', '候选使用的 Idea 版本不是矩阵版本，请重新确认研究规格。')
  const papers = await rows<CandidatePaperRecord>('SELECT id,title,doi,source_url FROM papers WHERE project_id=$1 AND id=ANY($2::uuid[])', [projectId, paperIds])
  const evidence = await rows<CandidateEvidenceRecord>('SELECT id,paper_id,claim,locator,source_url FROM evidence WHERE project_id=$1 AND id=ANY($2::uuid[])', [projectId, evidenceIds])
  const reviews = await rows<CandidateReviewRecord>('SELECT id,claim,evidence_ids FROM claim_reviews WHERE project_id=$1 AND id=ANY($2::uuid[])', [projectId, claimReviewIds])
  if (!paperIds.length || !evidenceIds.length || !claimReviewIds.length) throw new ApiError(409, 'research_status_gap_source_required', '待核验候选必须绑定 Paper、Evidence 与 ClaimReview 来源。')
  if (papers.length !== paperIds.length || evidence.length !== evidenceIds.length || reviews.length !== claimReviewIds.length) {
    throw new ApiError(403, 'research_status_gap_source_scope', '待核验候选的来源必须全部属于当前项目。')
  }
  const basis = {
    idea_version: ideaVersion,
    papers: papers.map(paper => ({ id: paper.id, title: paper.title, doi: paper.doi, source_url: paper.source_url })),
    evidence: evidence.map(item => ({ id: item.id, paper_id: item.paper_id, claim: item.claim, locator: item.locator, source_url: item.source_url })),
    claim_reviews: reviews.map(review => ({ id: review.id, claim: review.claim, evidence_ids: jsonArray(review.evidence_ids) })),
  }
  const id = crypto.randomUUID()
  await database.query(`INSERT INTO research_status_gap_candidates
    (id,project_id,matrix_id,candidate_type,statement,row_ids,paper_ids,evidence_ids,claim_review_ids,idea_version,basis,evidence_status,status,actor)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [
    id, projectId, input.matrix_id, input.candidate_type, input.statement, rowIds,
    paperIds, evidenceIds, claimReviewIds, ideaVersion, basis, 'candidate_requires_review', 'candidate', input.actor,
  ])
  await audit('research_status.gap_candidate_created', projectId, {
    candidate_id: id,
    matrix_id: input.matrix_id,
    candidate_type: input.candidate_type,
    row_ids: rowIds,
    paper_ids: paperIds,
    evidence_ids: evidenceIds,
    claim_review_ids: claimReviewIds,
    idea_version: ideaVersion,
  }, input.actor)
  return {
    candidate_id: id,
    status: 'candidate',
    evidence_status: 'candidate_requires_review',
    idea_version: ideaVersion,
    paper_ids: paperIds,
    evidence_ids: evidenceIds,
    claim_review_ids: claimReviewIds,
  }
}

export async function decideResearchStatusGapCandidate(projectId: string, candidateId: string, input: ResearchStatusGapDecisionRequest) {
  await requireProject(projectId, true)
  const candidate = await one<GapCandidateRecord>('SELECT * FROM research_status_gap_candidates WHERE id=$1 AND project_id=$2', [candidateId, projectId])
  if (!candidate) throw new ApiError(404, 'research_status_gap_candidate_not_found', '研究现状候选不存在或不属于当前项目。')
  const nextStatus = input.decision === 'reopened' ? 'candidate' : input.decision
  if (candidate.status !== 'candidate' && input.decision !== 'reopened') throw new ApiError(409, 'research_status_gap_already_decided', '该研究现状候选已经有终态决定。')
  if (nextStatus === 'candidate') {
    await database.query('UPDATE research_status_gap_candidates SET status=$2,decision_comment=$3,decided_at=NULL WHERE id=$1 AND project_id=$4', [candidateId, nextStatus, input.reason, projectId])
  } else {
    await database.query('UPDATE research_status_gap_candidates SET status=$2,decision_comment=$3,decided_at=NOW() WHERE id=$1 AND project_id=$4', [candidateId, nextStatus, input.reason, projectId])
  }
  await audit(`research_status.gap_candidate_${input.decision}`, projectId, { candidate_id: candidateId, reason: input.reason }, input.actor)
  return { candidate_id: candidateId, status: nextStatus, evidence_status: 'candidate_requires_review' }
}

function csvCell(value: unknown): string {
  const text = Array.isArray(value) ? value.join('; ') : value === null || value === undefined ? '' : String(value)
  return `"${text.replaceAll('"', '""')}"`
}

function exportRows(rowsToExport: Array<Record<string, unknown>>, format: ResearchStatusExportFormat): { contentType: string; extension: string; content: string } {
  if (format === 'json') return { contentType: 'application/json; charset=utf-8', extension: 'json', content: JSON.stringify(rowsToExport, null, 2) }
  if (format === 'csv') {
    const headers = ['paper_title', 'theme', 'method', 'year', 'datasets', 'metrics', 'limitations', 'code_availability', 'evidence_status', 'evidence_ids', 'claim_review_ids']
    const lines = [headers.join(',')]
    for (const row of rowsToExport) lines.push(headers.map(header => csvCell(row[header])).join(','))
    return { contentType: 'text/csv; charset=utf-8', extension: 'csv', content: `${lines.join('\n')}\n` }
  }
  const lines = ['# Research Status Matrix', '', '| Paper | Theme | Method | Year | Datasets | Metrics | Limitations | Code | Evidence |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |']
  for (const row of rowsToExport) lines.push(`| ${String(row.paper_title || '').replaceAll('|', '\\|')} | ${String(row.theme || 'unresolved').replaceAll('|', '\\|')} | ${String(row.method || 'unresolved').replaceAll('|', '\\|')} | ${String(row.year || 'unresolved')} | ${String(row.datasets || 'unresolved').replaceAll('|', '\\|')} | ${String(row.metrics || 'unresolved').replaceAll('|', '\\|')} | ${String(row.limitations || 'unresolved').replaceAll('|', '\\|')} | ${String(row.code_availability || 'unresolved')} | ${String(row.evidence_status || '')} |`)
  return { contentType: 'text/markdown; charset=utf-8', extension: 'md', content: `${lines.join('\n')}\n` }
}

export async function exportResearchStatus(projectId: string, matrixId: string | null, filter: ResearchStatusFilterRequest, format: ResearchStatusExportFormat) {
  const status = await getResearchStatus(projectId, { ...filter, ...(matrixId ? { matrix_id: matrixId } : {}) })
  if (!status.matrix) throw new ApiError(409, 'research_status_matrix_empty', '尚未创建可导出的研究现状矩阵。')
  const exportableRows = status.matrix.rows.map(row => ({
    paper_title: row.paper?.title || row.paper_id,
    theme: row.theme,
    method: row.method,
    year: row.year,
    datasets: row.datasets,
    metrics: row.metrics,
    limitations: row.limitations,
    code_availability: row.code_availability,
    evidence_status: row.evidence_status,
    evidence_ids: row.evidence_ids,
    claim_review_ids: row.claim_review_ids,
  }))
  return { ...exportRows(exportableRows, format), filename: `research-status-${status.matrix.id}.${exportRows(exportableRows, format).extension}` }
}
