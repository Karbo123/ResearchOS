import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../src/index.js'
import { database, migrate, rows } from '../src/database.js'

const projectId = crypto.randomUUID()
const otherProjectId = crypto.randomUUID()
const graphOnlyProjectId = crypto.randomUUID()
const paperId = crypto.randomUUID()
const secondPaperId = crypto.randomUUID()
const otherPaperId = crypto.randomUUID()
const evidenceId = crypto.randomUUID()
const secondEvidenceId = crypto.randomUUID()
const otherEvidenceId = crypto.randomUUID()
const reviewId = crypto.randomUUID()
const secondReviewId = crypto.randomUUID()
const otherReviewId = crypto.randomUUID()

async function request(path: string, init: RequestInit = {}) {
  return app.request(`http://research-os.test${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  })
}

async function json(path: string, init: RequestInit = {}) {
  const response = await request(path, init)
  return { response, body: await response.json() as Record<string, any> }
}

describe('project-scoped research status matrix and citation graph', () => {
  beforeAll(async () => {
    await migrate()
    await database.query('INSERT INTO projects(id,slug,title,current_idea_version) VALUES ($1,$2,$3,1),($4,$5,$6,1),($7,$8,$9,1)', [
      projectId, `research-status-${projectId.slice(0, 8)}`, 'Research Status Test',
      otherProjectId, `research-status-other-${otherProjectId.slice(0, 8)}`, 'Other Research Status Test',
      graphOnlyProjectId, `research-status-graph-only-${graphOnlyProjectId.slice(0, 8)}`, 'Graph Only Research Status Test',
    ])
    await database.query(`INSERT INTO papers(id,project_id,title,doi,source_url,metadata,verified,confirmed) VALUES
      ($1,$3,'Confirmed Paper','10.1000/confirmed','https://doi.org/10.1000/confirmed',$5,TRUE,TRUE),
      ($2,$3,'Earlier Confirmed Paper','10.1000/earlier','https://doi.org/10.1000/earlier',$6,TRUE,TRUE),
      ($7,$4,'Other Paper','10.1000/other','https://doi.org/10.1000/other',$8,TRUE,TRUE)`, [
      paperId, secondPaperId, projectId, otherProjectId, { year: 2024, citation_count: 120 }, { year: 2023, citation_count: 40 }, otherPaperId, { year: 2022, citation_count: 8 },
    ])
    await database.query(`INSERT INTO evidence(id,project_id,paper_id,claim,quote,locator,source_url) VALUES
      ($1,$3,$5,'bounded claim','A page-level quote.','page 4','https://example.org/confirmed.pdf'),
      ($2,$3,$6,'earlier claim','An earlier page-level quote.','page 2','https://example.org/earlier.pdf'),
      ($7,$4,$8,'other claim','Another page-level quote.','section 2','https://example.org/other.pdf')`, [
      evidenceId, secondEvidenceId, projectId, otherProjectId, paperId, secondPaperId, otherEvidenceId, otherPaperId,
    ])
    await database.query(`INSERT INTO claim_reviews(id,project_id,claim,evidence_ids,status,reviewer,decision_comment) VALUES
      ($1,$3,'bounded claim',$5,'accepted','test-user','Reviewed quote.'),
      ($2,$3,'earlier claim',$6,'accepted','test-user','Reviewed earlier quote.'),
      ($7,$4,'other claim',$8,'accepted','test-user','Other project review.')`, [
      reviewId, secondReviewId, projectId, otherProjectId, [evidenceId], [secondEvidenceId], otherReviewId, [otherEvidenceId],
    ])
  })

  afterAll(async () => {
    await database.query('DELETE FROM research_status_gap_candidates WHERE project_id IN ($1,$2,$3)', [projectId, otherProjectId, graphOnlyProjectId])
    await database.query('DELETE FROM research_status_matrix_rows WHERE project_id IN ($1,$2,$3)', [projectId, otherProjectId, graphOnlyProjectId])
    await database.query('DELETE FROM research_status_matrices WHERE project_id IN ($1,$2,$3)', [projectId, otherProjectId, graphOnlyProjectId])
    await database.query('DELETE FROM related_work_citation_edges WHERE project_id IN ($1,$2,$3)', [projectId, otherProjectId, graphOnlyProjectId])
    await database.query('DELETE FROM related_work_candidates WHERE project_id IN ($1,$2,$3)', [projectId, otherProjectId, graphOnlyProjectId])
    await database.query('DELETE FROM claim_reviews WHERE project_id IN ($1,$2,$3)', [projectId, otherProjectId, graphOnlyProjectId])
    await database.query('DELETE FROM evidence WHERE project_id IN ($1,$2,$3)', [projectId, otherProjectId, graphOnlyProjectId])
    await database.query('DELETE FROM papers WHERE project_id IN ($1,$2,$3)', [projectId, otherProjectId, graphOnlyProjectId])
    await database.query('DELETE FROM audit_events WHERE project_id IN ($1,$2,$3)', [projectId, otherProjectId, graphOnlyProjectId])
    await database.query('DELETE FROM projects WHERE id IN ($1,$2,$3)', [projectId, otherProjectId, graphOnlyProjectId])
  })

  it('creates a matrix only from confirmed papers, located evidence, and accepted claim reviews', async () => {
    const created = await json(`/api/projects/${projectId}/research-status/matrices`, {
      method: 'POST',
      body: JSON.stringify({
        rows: [{
          paper_id: paperId,
          theme: 'efficient adaptation',
          method: 'parameter-efficient tuning',
          year: 2024,
          datasets: ['ImageNet-1K'],
          metrics: ['top-1 accuracy'],
          limitations: null,
          code_availability: 'unresolved',
          evidence_ids: [evidenceId],
          claim_review_ids: [reviewId],
        }],
      }),
    })
    expect(created.response.status).toBe(201)
    expect(created.body.status).toBe('ready')
    expect(created.body.permission_status).toBe('project_scoped')
    expect(created.body.matrix.rows[0]).toMatchObject({ paper_id: paperId, evidence_status: 'claim_reviewed', theme: 'efficient adaptation' })
    expect(created.body.matrix.rows[0].provenance.evidence[0]).toMatchObject({ id: evidenceId, locator: 'page 4' })

    const filtered = await json(`/api/projects/${projectId}/research-status?theme=efficient%20adaptation&year=2024`)
    expect(filtered.response.status).toBe(200)
    expect(filtered.body.matrix.rows).toHaveLength(1)

    const exported = await request(`/api/projects/${projectId}/research-status/export?format=csv`)
    expect(exported.status).toBe(200)
    expect(exported.headers.get('content-type')).toContain('text/csv')
    expect(await exported.text()).toContain('Confirmed Paper')
  })

  it('reports graph state independently from matrix state', async () => {
    const candidateId = crypto.randomUUID()
    await database.query(`INSERT INTO related_work_candidates(id,project_id,provider,stable_id,normalized_title,title,status,candidate)
      VALUES ($1,$2,'crossref','crossref:graph-only','graph-only paper','Graph-only Paper','candidate',$3)`, [candidateId, graphOnlyProjectId, { source_url: 'https://doi.org/10.1000/graph-only' }])
    const response = await json(`/api/projects/${graphOnlyProjectId}/research-status`)
    expect(response.body.status).toBe('empty')
    expect(response.body.matrix_status).toBe('empty')
    expect(response.body.graph_status).toBe('ready')
    expect(response.body.graph.nodes).toHaveLength(1)
    await database.query('DELETE FROM related_work_candidates WHERE id=$1', [candidateId])
  })

  it('rejects a paper from another project and evidence without a locator', async () => {
    const crossScope = await json(`/api/projects/${projectId}/research-status/matrices`, {
      method: 'POST',
      body: JSON.stringify({ rows: [{ paper_id: otherPaperId, evidence_ids: [otherEvidenceId], claim_review_ids: [otherReviewId] }] }),
    })
    expect(crossScope.response.status).toBe(403)
    expect(crossScope.body.code).toBe('research_status_paper_scope')

    const noLocatorEvidenceId = crypto.randomUUID()
    const noLocatorReviewId = crypto.randomUUID()
    await database.query('INSERT INTO evidence(id,project_id,paper_id,claim,quote,locator,source_url) VALUES ($1,$2,$3,$4,$5,NULL,$6)', [noLocatorEvidenceId, projectId, paperId, 'unlocated', 'No page anchor.', 'https://example.org/unlocated.pdf'])
    await database.query('INSERT INTO claim_reviews(id,project_id,claim,evidence_ids,status) VALUES ($1,$2,$3,$4,\'accepted\')', [noLocatorReviewId, projectId, 'unlocated', [noLocatorEvidenceId]])
    const noLocator = await json(`/api/projects/${projectId}/research-status/matrices`, {
      method: 'POST',
      body: JSON.stringify({ rows: [{ paper_id: paperId, evidence_ids: [noLocatorEvidenceId], claim_review_ids: [noLocatorReviewId] }] }),
    })
    expect(noLocator.response.status).toBe(409)
    expect(noLocator.body.code).toBe('research_status_locator_required')
    await database.query('DELETE FROM claim_reviews WHERE id=$1', [noLocatorReviewId])
    await database.query('DELETE FROM evidence WHERE id=$1', [noLocatorEvidenceId])
  })

  it('rejects pending or rejected claim reviews and returns rows in stable order', async () => {
    const pendingReviewId = crypto.randomUUID()
    const rejectedReviewId = crypto.randomUUID()
    await database.query(`INSERT INTO claim_reviews(id,project_id,claim,evidence_ids,status,reviewer,decision_comment) VALUES
      ($1,$2,'pending claim',$3,'pending','test-user',NULL),
      ($4,$2,'rejected claim',$5,'rejected','test-user','Needs a better locator.')`, [
      pendingReviewId, projectId, [evidenceId], rejectedReviewId, [secondEvidenceId],
    ])

    const pending = await json(`/api/projects/${projectId}/research-status/matrices`, {
      method: 'POST',
      body: JSON.stringify({ rows: [{ paper_id: paperId, evidence_ids: [evidenceId], claim_review_ids: [pendingReviewId] }] }),
    })
    expect(pending.response.status).toBe(409)
    expect(pending.body.code).toBe('research_status_claim_review_required')

    const rejected = await json(`/api/projects/${projectId}/research-status/matrices`, {
      method: 'POST',
      body: JSON.stringify({ rows: [{ paper_id: secondPaperId, evidence_ids: [secondEvidenceId], claim_review_ids: [rejectedReviewId] }] }),
    })
    expect(rejected.response.status).toBe(409)
    expect(rejected.body.code).toBe('research_status_claim_review_required')

    const graph = await json(`/api/projects/${projectId}/research-status`)
    expect(graph.body.graph.nodes.find((node: Record<string, unknown>) => node.id === `claim-review:${pendingReviewId}`)).toMatchObject({ status: 'pending', evidence_status: 'page_quote' })
    expect(graph.body.graph.nodes.find((node: Record<string, unknown>) => node.id === `claim-review:${rejectedReviewId}`)).toMatchObject({ status: 'rejected', evidence_status: 'page_quote' })

    const ordered = await json(`/api/projects/${projectId}/research-status/matrices`, {
      method: 'POST',
      body: JSON.stringify({ rows: [
        { paper_id: paperId, year: 2024, evidence_ids: [evidenceId], claim_review_ids: [reviewId] },
        { paper_id: secondPaperId, year: 2023, evidence_ids: [secondEvidenceId], claim_review_ids: [secondReviewId] },
      ] }),
    })
    expect(ordered.response.status).toBe(201)
    expect(ordered.body.matrix.rows.map((row: Record<string, unknown>) => row.paper.title)).toEqual([
      'Earlier Confirmed Paper',
      'Confirmed Paper',
    ])
  })

  it('projects only explicit graph relations and keeps gap candidates auditable', async () => {
    const matrix = await json(`/api/projects/${projectId}/research-status`)
    const matrixId = String(matrix.body.matrix.id)
    const rowId = String(matrix.body.matrix.rows[0].id)
    const candidateId = crypto.randomUUID()
    const targetCandidateId = crypto.randomUUID()
    await database.query(`INSERT INTO related_work_candidates(id,project_id,provider,stable_id,normalized_title,title,paper_id,status,candidate)
      VALUES ($1,$3,'crossref','crossref:confirmed','confirmed paper',$4,$5,'confirmed',$6),
             ($2,$3,'crossref','crossref:target','target paper', 'Target Paper',NULL,'candidate',$7)`, [
      candidateId, targetCandidateId, projectId, 'Confirmed Paper', paperId,
      { source_url: 'https://doi.org/10.1000/confirmed' }, { source_url: 'https://doi.org/10.1000/target' },
    ])
    await database.query(`INSERT INTO related_work_citation_edges(id,project_id,source_candidate_id,target_candidate_id,provider,relation,ranking_reasons)
      VALUES ($1,$2,$3,$4,'crossref','references',$5)`, [crypto.randomUUID(), projectId, candidateId, targetCandidateId, ['explicit_provider_reference']])
    const graph = await json(`/api/projects/${projectId}/research-status`)
    expect(graph.body.graph.permission_status).toBe('project_scoped')
    expect(graph.body.graph.nodes.every((node: Record<string, unknown>) => node.permission_status === 'project_scoped')).toBe(true)
    expect(graph.body.graph.edges.some((edge: Record<string, unknown>) => edge.relation === 'references' && edge.evidence_status === 'metadata_only')).toBe(true)
    expect(graph.body.graph.nodes.some((node: Record<string, unknown>) => node.id === `paper:${otherPaperId}`)).toBe(false)
    expect(graph.body.graph.nodes.find((node: Record<string, unknown>) => node.id === `paper:${paperId}`)).toMatchObject({ citation_count: 120 })
    expect(graph.body.graph.nodes.find((node: Record<string, unknown>) => node.id === `paper:${secondPaperId}`)).toMatchObject({ citation_count: 40 })

    const gap = await json(`/api/projects/${projectId}/research-status/gap-candidates`, {
      method: 'POST',
      body: JSON.stringify({ matrix_id: matrixId, candidate_type: 'gap', statement: 'A candidate gap requiring additional comparison.', row_ids: [rowId] }),
    })
    expect(gap.response.status).toBe(201)
    expect(gap.body.evidence_status).toBe('candidate_requires_review')
    const decided = await json(`/api/projects/${projectId}/research-status/gap-candidates/${gap.body.candidate_id}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision: 'accepted', reason: 'Accept as a follow-up candidate, not a conclusion.' }),
    })
    expect(decided.response.status).toBe(200)
    expect(decided.body.status).toBe('accepted')
    const auditRows = await rows<{ action: string }>('SELECT action FROM audit_events WHERE project_id=$1 AND action LIKE \'research_status.gap_candidate_%\' ORDER BY created_at', [projectId])
    expect(auditRows.map(row => row.action)).toEqual(['research_status.gap_candidate_created', 'research_status.gap_candidate_accepted'])
  })

  it('binds innovation, boundary, counterexample, and open-question candidates to Paper/Evidence/Claim/IdeaVersion', async () => {
    const matrix = await json(`/api/projects/${projectId}/research-status`)
    const matrixId = String(matrix.body.matrix.id)
    const row = matrix.body.matrix.rows.find((item: Record<string, unknown>) => item.paper_id === paperId)
    const rowId = String(row.id)
    const candidateTypes = ['innovation', 'boundary', 'counterexample', 'open_question']
    for (const candidateType of candidateTypes) {
      const created = await json(`/api/projects/${projectId}/research-status/gap-candidates`, {
        method: 'POST',
        body: JSON.stringify({
          matrix_id: matrixId,
          candidate_type: candidateType,
          statement: `A sourced ${candidateType} candidate requiring review.`,
          row_ids: [rowId],
          idea_version: 1,
        }),
      })
      expect(created.response.status).toBe(201)
      expect(created.body).toMatchObject({
        status: 'candidate',
        idea_version: 1,
        paper_ids: [paperId],
        evidence_ids: [evidenceId],
        claim_review_ids: [reviewId],
      })
    }
    const refreshed = await json(`/api/projects/${projectId}/research-status`)
    const candidates = refreshed.body.gap_candidates.filter((candidate: Record<string, unknown>) => candidateTypes.includes(String(candidate.candidate_type)))
    expect(candidates).toHaveLength(4)
    for (const candidate of candidates) {
      expect(candidate.basis.papers).toContainEqual(expect.objectContaining({ id: paperId, title: 'Confirmed Paper' }))
      expect(candidate.basis.evidence).toContainEqual(expect.objectContaining({ id: evidenceId, locator: 'page 4' }))
      expect(candidate.basis.claim_reviews).toContainEqual(expect.objectContaining({ id: reviewId, claim: 'bounded claim' }))
    }

    const stale = await json(`/api/projects/${projectId}/research-status/gap-candidates`, {
      method: 'POST',
      body: JSON.stringify({ matrix_id: matrixId, candidate_type: 'innovation', statement: 'A stale Idea version must be rejected.', row_ids: [rowId], idea_version: 99 }),
    })
    expect(stale.response.status).toBe(409)
    expect(stale.body.code).toBe('research_status_gap_idea_version_stale')

    const noRows = await json(`/api/projects/${projectId}/research-status/gap-candidates`, {
      method: 'POST',
      body: JSON.stringify({ matrix_id: matrixId, candidate_type: 'innovation', statement: 'A candidate without rows must be rejected.', row_ids: [] }),
    })
    expect(noRows.response.status).toBe(422)
  })
})
