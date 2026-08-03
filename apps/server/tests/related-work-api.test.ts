import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { app } from '../src/index.js'
import { database, migrate, rows } from '../src/database.js'

const projectId = crypto.randomUUID()
const otherProjectId = crypto.randomUUID()

async function requestJson(path: string, init: RequestInit = {}) {
  const response = await app.request(`http://research-os.test${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  })
  return { response, body: await response.json() as Record<string, unknown> }
}

describe('project-scoped related work API', () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch')

  beforeAll(async () => {
    await migrate()
    await database.query('INSERT INTO projects(id,slug,title) VALUES ($1,$2,$3),($4,$5,$6)', [
      projectId, `related-work-${projectId.slice(0, 8)}`, 'Related Work Test',
      otherProjectId, `related-work-other-${otherProjectId.slice(0, 8)}`, 'Other Related Work Test',
    ])
    const spec = {
      schema_version: '1.0',
      idea: {
        title: 'Related Work Test',
        research_question: 'How can citation networks be expanded reliably across sources?',
        domain: 'Research infrastructure',
        available_data: 'Public bibliographic metadata',
        ethics_and_compliance: 'No personal data involved',
      },
      feasibility: 'medium',
    }
    await database.query('INSERT INTO idea_versions(id,project_id,version,spec) VALUES ($1,$2,1,$3),($4,$5,1,$6)', [
      crypto.randomUUID(), projectId, spec,
      crypto.randomUUID(), otherProjectId, spec,
    ])
    fetchMock.mockImplementation(async input => {
      const url = String(input)
      if (url.includes('/works/') && url.includes('root')) {
        return new Response(JSON.stringify({ message: { reference: [{ DOI: '10.1000/child', 'article-title': 'Child Reference', year: '2023', key: 'child' }] } }), { status: 200 })
      }
      return new Response(JSON.stringify({ message: { items: [{ DOI: '10.1000/root', title: ['Root Paper'], author: [{ given: 'Ada', family: 'Lovelace' }], issued: { 'date-parts': [[2024]] }, URL: 'https://doi.org/10.1000/root' }] } }), { status: 200 })
    })
  })

  afterAll(async () => {
    fetchMock.mockRestore()
    await database.query('DELETE FROM related_work_request_cache WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM related_work_field_provenance WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM related_work_candidate_reviews WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM related_work_citation_edges WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM related_work_run_events WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM related_work_source_attempts WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM related_work_recursive_runs WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM related_work_seed_candidates WHERE seed_id IN (SELECT id FROM related_work_seeds WHERE project_id IN ($1,$2))', [projectId, otherProjectId])
    await database.query('DELETE FROM related_work_candidate_sources WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM related_work_candidates WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM related_work_seeds WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM papers WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM audit_events WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM proposals WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM idea_versions WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM projects WHERE id IN ($1,$2)', [projectId, otherProjectId])
  })

  it('resolves isolated seeds, creates an approval-gated recursive run, and persists citation edges', async () => {
    const first = await requestJson(`/api/projects/${projectId}/related-work/seeds`, {
      method: 'POST',
      body: JSON.stringify({ source_type: 'doi', doi: '10.1000/ROOT', providers: ['crossref'] }),
    })
    expect(first.response.status).toBe(201)
    expect(first.body.status).toBe('resolved')
    const seedId = String(first.body.seed_id)
    const detail = await requestJson(`/api/projects/${projectId}`)
    expect(detail.response.status).toBe(200)
    const detailAttempts = (detail.body.related_work_attempts as Array<Record<string, unknown>>) || []
    expect(detailAttempts.length).toBeGreaterThan(0)
    expect(detailAttempts[0]).toMatchObject({ provider: 'crossref', status: 'succeeded', result_count: 1 })
    expect(detailAttempts[0]?.request_url).toContain('api.crossref.org')

    const other = await requestJson(`/api/projects/${otherProjectId}/related-work/seeds`, {
      method: 'POST',
      body: JSON.stringify({ source_type: 'doi', doi: '10.1000/root', providers: ['crossref'] }),
    })
    expect(other.response.status).toBe(201)
    const otherSeedId = String(other.body.seed_id)
    const projectCandidates = await rows<{ count: string }>('SELECT COUNT(*)::text AS count FROM related_work_candidates WHERE project_id=$1', [projectId])
    const otherCandidates = await rows<{ count: string }>('SELECT COUNT(*)::text AS count FROM related_work_candidates WHERE project_id=$1', [otherProjectId])
    expect(projectCandidates[0]?.count).toBe('1')
    expect(otherCandidates[0]?.count).toBe('1')

    const crossScope = await requestJson(`/api/projects/${projectId}/related-work/recursive-plan`, {
      method: 'POST',
      body: JSON.stringify({ seed_ids: [otherSeedId], depth: 2, width: 2, max_total: 5, providers: ['crossref'], reason: 'cross project must fail' }),
    })
    expect(crossScope.response.status).toBe(404)
    expect(crossScope.body.code).toBe('related_work_seed_not_found')

    const plan = await requestJson(`/api/projects/${projectId}/related-work/recursive-plan`, {
      method: 'POST',
      body: JSON.stringify({ seed_ids: [seedId], depth: 2, width: 2, max_total: 5, providers: ['crossref'], reason: 'expand approved citation network' }),
    })
    expect(plan.response.status).toBe(201)
    const proposalId = String(plan.body.proposal_id)
    const pending = await rows<{ status: string; kind: string }>('SELECT status,kind FROM proposals WHERE id=$1 AND project_id=$2', [proposalId, projectId])
    expect(pending[0]).toEqual({ status: 'pending', kind: 'related_work_recursive' })

    const decision = await requestJson(`/api/proposals/${proposalId}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision: 'approved', actor: 'test-user' }),
    })
    expect(decision.response.status).toBe(200)
    expect(decision.body.related_work_run).toMatchObject({ status: 'queued' })
    const runId = String((decision.body.related_work_run as Record<string, unknown>).run_id)

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const run = await rows<{ status: string }>('SELECT status FROM related_work_recursive_runs WHERE id=$1', [runId])
      if (run[0]?.status && !['queued', 'running'].includes(run[0].status)) break
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    const completed = await rows<{ status: string; edge_count: number; failure_count: number }>('SELECT status,edge_count,failure_count FROM related_work_recursive_runs WHERE id=$1', [runId])
    expect(completed[0]?.status).toBe('completed')
    expect(completed[0]?.edge_count).toBe(1)
    expect(completed[0]?.failure_count).toBe(0)
    const edges = await rows<{ source_candidate_id: string; target_candidate_id: string }>('SELECT source_candidate_id,target_candidate_id FROM related_work_citation_edges WHERE run_id=$1', [runId])
    expect(edges).toHaveLength(1)
    expect(edges[0]?.source_candidate_id).not.toBe(edges[0]?.target_candidate_id)
  }, 30_000)

  it('records field provenance, enriches through an approved proposal, and confirms a candidate explicitly', async () => {
    const seed = await requestJson(`/api/projects/${projectId}/related-work/seeds`, {
      method: 'POST',
      body: JSON.stringify({ source_type: 'doi', doi: '10.1000/root', providers: ['crossref'] }),
    })
    expect(seed.response.status).toBe(201)
    const candidateId = String((seed.body.candidate_ids as string[])[0])
    const provenance = await rows<{ count: string }>('SELECT COUNT(*)::text AS count FROM related_work_field_provenance WHERE project_id=$1 AND candidate_id=$2', [projectId, candidateId])
    expect(Number(provenance[0]?.count)).toBeGreaterThan(0)

    const proposal = await requestJson(`/api/projects/${projectId}/related-work/candidate-enrichment`, {
      method: 'POST',
      body: JSON.stringify({ candidate_id: candidateId, fields: ['abstract', 'venue', 'doi'], providers: ['crossref'], reason: '补全候选的可审计字段来源' }),
    })
    expect(proposal.response.status).toBe(201)
    const proposalId = String(proposal.body.proposal_id)
    const enrichment = await requestJson(`/api/proposals/${proposalId}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision: 'approved', actor: 'test-user' }),
    })
    expect(enrichment.response.status).toBe(200)
    expect(enrichment.body.related_work_enrichment).toMatchObject({ candidate_id: candidateId, status: 'completed' })

    const decision = await requestJson(`/api/projects/${projectId}/related-work/candidates/${candidateId}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision: 'approved', reason: '确认 provider 元数据候选进入项目文献库', actor: 'test-user' }),
    })
    expect(decision.response.status).toBe(200)
    expect(decision.body.status).toBe('confirmed')
    const paper = await rows<{ id: string; metadata: Record<string, unknown> }>('SELECT id,metadata FROM papers WHERE project_id=$1 AND id=$2', [projectId, decision.body.paper_id])
    expect(paper).toHaveLength(1)
    const snapshot = paper[0]?.metadata.confirmed_field_snapshot as Array<Record<string, unknown>>
    expect(snapshot.length).toBeGreaterThan(0)
    expect(snapshot[0]).toEqual(expect.objectContaining({ field_name: expect.any(String), provider: 'crossref', source_type: 'provider', raw_value_hash: expect.any(String) }))
  }, 30_000)

  it('keeps user BibTeX as project-scoped provenance and allows selecting enrichment fields', async () => {
    const bibtex = '@article{root, title={Root Paper}, author={Lovelace, Ada}, year={2024}, doi={10.1000/root}}'
    const seed = await requestJson(`/api/projects/${projectId}/related-work/seeds`, {
      method: 'POST',
      body: JSON.stringify({ source_type: 'bibtex', bibtex, providers: ['crossref'] }),
    })
    expect(seed.response.status).toBe(201)
    const candidateId = String((seed.body.candidate_ids as string[])[0])
    const userBibtex = await rows<{ source_type: string; provider: string | null; normalized_value: string }>(
      "SELECT source_type,provider,normalized_value::text AS normalized_value FROM related_work_field_provenance WHERE project_id=$1 AND candidate_id=$2 AND field_name='bibtex' AND source_type='user_input'",
      [projectId, candidateId],
    )
    expect(userBibtex).toHaveLength(1)
    expect(userBibtex[0]).toMatchObject({ source_type: 'user_input', provider: null })
    expect(userBibtex[0]?.normalized_value).toContain('Root Paper')

    const enrichmentId = crypto.randomUUID()
    await database.query(`INSERT INTO related_work_field_provenance
      (id,project_id,candidate_id,field_name,provider,source_type,retrieved_at,locator,raw_value_hash,normalized_value,conflict_group)
      VALUES ($1,$2,$3,'institutions',NULL,'user_input',NOW(),'user fixture',$4,$5,$6)`, [
      enrichmentId, projectId, candidateId, 'fixture-institutions', JSON.stringify(['Analytical Engine Lab']), `${candidateId}:institutions`,
    ])
    const selected = await requestJson(`/api/projects/${projectId}/related-work/candidates/${candidateId}/fields/institutions/select`, {
      method: 'POST',
      body: JSON.stringify({ provenance_id: enrichmentId, actor: 'test-user' }),
    })
    expect(selected.response.status).toBe(200)
    const stored = await rows<{ candidate: Record<string, unknown> }>('SELECT candidate FROM related_work_candidates WHERE id=$1 AND project_id=$2', [candidateId, projectId])
    expect((stored[0]?.candidate.enrichment as Record<string, unknown>).institutions).toEqual(['Analytical Engine Lab'])
  })

  it('does not write an unrelated provider result during field enrichment', async () => {
    const candidateId = crypto.randomUUID()
    const candidate = {
      provider: 'crossref',
      stable_id: 'crossref:mismatch',
      title: 'A Completely Different Candidate',
      authors: [],
      year: 2020,
      venue: null,
      doi: null,
      abstract: null,
      pdf_url: null,
      html_url: 'https://example.test/mismatch',
      license: null,
      citation_count: null,
      open_access: null,
      source_url: 'https://example.test/mismatch',
      query: 'fixture',
      retrieved_at: new Date().toISOString(),
    }
    await database.query(`INSERT INTO related_work_candidates
      (id,project_id,provider,stable_id,normalized_title,year,title,candidate)
      VALUES ($1,$2,'crossref','crossref:mismatch',$3,2020,$4,$5)`, [candidateId, projectId, 'a completely different candidate', candidate.title, candidate])
    const proposal = await requestJson(`/api/projects/${projectId}/related-work/candidate-enrichment`, {
      method: 'POST',
      body: JSON.stringify({ candidate_id: candidateId, fields: ['abstract'], providers: ['crossref'], reason: '验证标题不匹配不会写入字段' }),
    })
    expect(proposal.response.status).toBe(201)
    const decision = await requestJson(`/api/proposals/${proposal.body.proposal_id}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision: 'approved', actor: 'test-user' }),
    })
    expect(decision.response.status).toBe(200)
    expect(decision.body.related_work_enrichment).toMatchObject({ status: 'no_match', candidate_id: candidateId })
    const sources = await rows<{ count: string }>('SELECT COUNT(*)::text AS count FROM related_work_candidate_sources WHERE project_id=$1 AND candidate_id=$2', [projectId, candidateId])
    expect(sources[0]?.count).toBe('0')
  })

  it('reuses the same project/provider/request cache entry for an identical seed query', async () => {
    const before = fetchMock.mock.calls.length
    const first = await requestJson(`/api/projects/${projectId}/related-work/seeds`, {
      method: 'POST',
      body: JSON.stringify({ source_type: 'title', title: 'Cache Reuse Fixture', providers: ['crossref'] }),
    })
    expect(first.response.status).toBe(201)
    const afterFirst = fetchMock.mock.calls.length
    expect(afterFirst).toBeGreaterThan(before)

    const second = await requestJson(`/api/projects/${projectId}/related-work/seeds`, {
      method: 'POST',
      body: JSON.stringify({ source_type: 'title', title: 'Cache Reuse Fixture', providers: ['crossref'] }),
    })
    expect(second.response.status).toBe(201)
    expect(fetchMock.mock.calls.length).toBe(afterFirst)
    const cache = await rows<{ status: string; hit_count: number }>(
      "SELECT status,hit_count FROM related_work_request_cache WHERE project_id=$1 AND provider='crossref' AND operation='search' ORDER BY created_at DESC,id LIMIT 1",
      [projectId],
    )
    expect(cache[0]).toMatchObject({ status: 'succeeded', hit_count: 1 })
  })
})
