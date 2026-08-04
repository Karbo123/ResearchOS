import { randomUUID } from 'node:crypto'
import { database, migrate, rows } from '../apps/server/src/database.js'
import { createResearchStatusMatrix } from '../apps/server/src/research-status/service.js'

const mode = process.argv[2] || 'seed'
const projectRef = process.argv[3] || process.env.RESEARCH_PROJECT_SLUG || 'uncertainty-based-d9a5'

const fixtureIds = {
  seed1: '10000000-0000-4000-8000-000000000001',
  seed2: '10000000-0000-4000-8000-000000000002',
  seed3: '10000000-0000-4000-8000-000000000003',
  candidate1: '20000000-0000-4000-8000-000000000001',
  candidate2: '20000000-0000-4000-8000-000000000002',
  candidate3: '20000000-0000-4000-8000-000000000003',
  candidate4: '20000000-0000-4000-8000-000000000004',
  paper: '30000000-0000-4000-8000-000000000001',
  evidence: '40000000-0000-4000-8000-000000000001',
  review: '50000000-0000-4000-8000-000000000001',
  proposal1: '60000000-0000-4000-8000-000000000001',
  proposal2: '60000000-0000-4000-8000-000000000002',
  proposal3: '60000000-0000-4000-8000-000000000003',
  run1: '70000000-0000-4000-8000-000000000001',
  run2: '70000000-0000-4000-8000-000000000002',
  run3: '70000000-0000-4000-8000-000000000003',
  repository: 'b0000000-0000-4000-8000-000000000001',
}

const candidateIds = Object.values(fixtureIds).filter(id => id.startsWith('2'))
const seedIds = [fixtureIds.seed1, fixtureIds.seed2, fixtureIds.seed3]
const runIds = [fixtureIds.run1, fixtureIds.run2, fixtureIds.run3]
const proposalIds = [fixtureIds.proposal1, fixtureIds.proposal2, fixtureIds.proposal3]

async function cleanup(projectId: string) {
  await database.query('DELETE FROM related_work_candidate_reviews WHERE project_id=$1 AND candidate_id=ANY($2::uuid[])', [projectId, candidateIds])
  await database.query('DELETE FROM related_work_field_provenance WHERE project_id=$1 AND candidate_id=ANY($2::uuid[])', [projectId, candidateIds])
  await database.query('DELETE FROM related_work_seed_candidates WHERE seed_id=ANY($1::uuid[])', [seedIds])
  await database.query('DELETE FROM related_work_citation_edges WHERE project_id=$1 AND (source_candidate_id=ANY($2::uuid[]) OR target_candidate_id=ANY($2::uuid[]))', [projectId, candidateIds])
  await database.query('DELETE FROM related_work_run_events WHERE project_id=$1 AND run_id=ANY($2::uuid[])', [projectId, runIds])
  await database.query('DELETE FROM related_work_source_attempts WHERE project_id=$1 AND (run_id=ANY($2::uuid[]) OR seed_id=ANY($3::uuid[]) OR parent_candidate_id=ANY($4::uuid[]))', [projectId, runIds, seedIds, candidateIds])
  await database.query('DELETE FROM related_work_recursive_runs WHERE project_id=$1 AND id=ANY($2::uuid[])', [projectId, runIds])
  await database.query('DELETE FROM proposals WHERE project_id=$1 AND id=ANY($2::uuid[])', [projectId, proposalIds])
  await database.query('DELETE FROM related_work_candidate_sources WHERE project_id=$1 AND candidate_id=ANY($2::uuid[])', [projectId, candidateIds])
  await database.query('DELETE FROM related_work_candidates WHERE project_id=$1 AND id=ANY($2::uuid[])', [projectId, candidateIds])
  await database.query('DELETE FROM related_work_seeds WHERE project_id=$1 AND id=ANY($2::uuid[])', [projectId, seedIds])
  await database.query('DELETE FROM repositories WHERE project_id=$1 AND id=$2', [projectId, fixtureIds.repository])

  const matrices = await rows<{ id: string }>('SELECT id FROM research_status_matrices WHERE project_id=$1 AND created_by=$2', [projectId, 'acceptance-fixture'])
  for (const matrix of matrices) {
    await database.query('DELETE FROM research_status_gap_candidates WHERE project_id=$1 AND matrix_id=$2', [projectId, matrix.id])
    await database.query('DELETE FROM research_status_matrix_rows WHERE project_id=$1 AND matrix_id=$2', [projectId, matrix.id])
    await database.query('DELETE FROM research_status_matrices WHERE project_id=$1 AND id=$2', [projectId, matrix.id])
  }

  await database.query('DELETE FROM claim_reviews WHERE project_id=$1 AND id=$2', [projectId, fixtureIds.review])
  await database.query('DELETE FROM evidence WHERE project_id=$1 AND id=$2', [projectId, fixtureIds.evidence])
  await database.query('DELETE FROM papers WHERE project_id=$1 AND id=$2', [projectId, fixtureIds.paper])
}

async function main() {
  await migrate()
  const project = await database.query<{ id: string; slug: string; title: string }>(
    'SELECT id,slug,title FROM projects WHERE id::text=$1 OR slug=$1',
    [projectRef],
  )
  if (!project.rows[0]) throw new Error(`Project not found: ${projectRef}`)
  const projectId = project.rows[0].id
  await cleanup(projectId)
  if (mode === 'clean') {
    console.log(JSON.stringify({ status: 'cleaned', project_id: projectId, project: project.rows[0].slug }))
    await database.close()
    return
  }
  if (mode !== 'seed') throw new Error(`Unknown mode: ${mode}; expected seed or clean`)

  const commit = 'a'.repeat(40)
  const now = new Date().toISOString()
  const startedAt = new Date(Date.now() - 60_000).toISOString()
  const finishedAt = now

  await database.query(
    `INSERT INTO papers(id,project_id,title,doi,source_url,metadata,verified,confirmed)
     VALUES ($1,$2,$3,$4,$5,$6,TRUE,TRUE)`,
    [
      fixtureIds.paper,
      projectId,
      'Fixture Related Work Paper',
      '10.1000/fixture-paper',
      'https://example.org/fixture-paper',
      JSON.stringify({
        authors: [{ name: 'Ada Fixture' }, { name: 'Ben Sample' }],
        year: 2023,
        venue: 'Fixture Conference',
        source_provider: 'crossref',
        citation_count: 120,
      }),
    ],
  )
  await database.query(
    `INSERT INTO evidence(id,project_id,paper_id,claim,quote,locator,source_url,metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      fixtureIds.evidence,
      projectId,
      fixtureIds.paper,
      'Fixture paper reports stable accuracy across seeds.',
      'The proposed method keeps accuracy stable across the fixed seeds.',
      'page 5, Table 2',
      'https://example.org/fixture-paper.pdf',
      JSON.stringify({ pdf_sha256: 'c'.repeat(64) }),
    ],
  )
  await database.query(
    `INSERT INTO claim_reviews(id,project_id,claim,evidence_ids,status,reviewer)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      fixtureIds.review,
      projectId,
      'Fixture paper reports stable accuracy across seeds.',
      JSON.stringify([fixtureIds.evidence]),
      'accepted',
      'acceptance-fixture',
    ],
  )
  await database.query(
    `INSERT INTO repositories(id,project_id,paper_id,source_url,license_spdx,commit_or_tag,verified_official,metadata)
     VALUES ($1,$2,$3,$4,$5,$6,TRUE,$7)`,
    [
      fixtureIds.repository,
      projectId,
      fixtureIds.paper,
      'https://github.com/example/related-work-fixture',
      'MIT',
      commit,
      JSON.stringify({
        paper_title: 'Fixture Related Work Paper',
        paper_doi: '10.1000/fixture-paper',
        verification: { license_status: 'known_spdx', match: { method: 'paper_repository_dual_source' } },
      }),
    ],
  )

  await database.query(
    `INSERT INTO related_work_seeds(id,project_id,source_type,raw_input,input_summary,normalized_doi,normalized_title,year,status,created_by,resolved_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      fixtureIds.seed1, projectId, 'doi', JSON.stringify({ doi: '10.1000/fixture-seed' }), '10.1000/fixture-seed',
      '10.1000/fixture-seed', 'Fixture Seed Paper', 2022, 'resolved', 'acceptance-fixture', now,
    ],
  )
  await database.query(
    `INSERT INTO related_work_seeds(id,project_id,source_type,raw_input,input_summary,normalized_title,year,status,created_by,resolved_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      fixtureIds.seed2, projectId, 'title', JSON.stringify({ title: 'Fixture Title Seed' }), 'Fixture Title Seed',
      'Fixture Title Seed', 2021, 'resolved', 'acceptance-fixture', now,
    ],
  )
  await database.query(
    `INSERT INTO related_work_seeds(id,project_id,source_type,raw_input,input_summary,status,created_by,resolved_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      fixtureIds.seed3, projectId, 'url', JSON.stringify({ url: 'https://example.org/fixture-seed' }), 'https://example.org/fixture-seed',
      'partial', 'acceptance-fixture', now,
    ],
  )

  const candidateRows = [
    {
      id: fixtureIds.candidate1,
      provider: 'crossref',
      stable_id: 'fixture-candidate-1',
      doi: '10.1000/fixture-candidate-1',
      title: 'Robust Fixture Candidate',
      year: 2022,
      status: 'candidate',
      depth: 1,
      paper_id: null,
    },
    {
      id: fixtureIds.candidate2,
      provider: 'openalex',
      stable_id: 'fixture-candidate-2',
      doi: null,
      title: 'Rejected Fixture Candidate',
      year: 2021,
      status: 'rejected',
      depth: 1,
      paper_id: null,
    },
    {
      id: fixtureIds.candidate3,
      provider: 'semantic_scholar',
      stable_id: 'fixture-candidate-3',
      doi: '10.1000/fixture-candidate-3',
      title: 'Conflict Fixture Candidate',
      year: 2024,
      status: 'candidate',
      depth: 2,
      paper_id: null,
    },
    {
      id: fixtureIds.candidate4,
      provider: 'crossref',
      stable_id: 'fixture-candidate-4',
      doi: '10.1000/fixture-paper',
      title: 'Fixture Related Work Paper',
      year: 2023,
      status: 'confirmed',
      depth: 0,
      paper_id: fixtureIds.paper,
    },
  ]
  for (const candidate of candidateRows) {
    await database.query(
      `INSERT INTO related_work_candidates(id,project_id,provider,stable_id,normalized_doi,normalized_title,year,title,paper_id,status,discovery_depth,candidate,first_run_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        candidate.id,
        projectId,
        candidate.provider,
        candidate.stable_id,
        candidate.doi,
        candidate.title.toLowerCase(),
        candidate.year,
        candidate.title,
        candidate.paper_id,
        candidate.status,
        candidate.depth,
        JSON.stringify({
          provider: candidate.provider,
          stable_id: candidate.stable_id,
          title: candidate.title,
          authors: [{ name: 'Ada Fixture' }, { name: 'Ben Sample' }],
          year: candidate.year,
          doi: candidate.doi,
          venue: 'Fixture Conference',
          abstract: 'Fixture abstract used only for browser acceptance.',
          citation_count: candidate.year === 2024 ? 30 : 120,
          source_url: `https://example.org/${candidate.stable_id}`,
          retrieved_at: now,
        }),
        candidate.id === fixtureIds.candidate4 ? fixtureIds.run1 : null,
      ],
    )
    await database.query(
      `INSERT INTO related_work_candidate_sources(id,project_id,candidate_id,provider,stable_id,candidate,retrieved_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        randomUUID(), projectId, candidate.id, candidate.provider, candidate.stable_id,
        JSON.stringify({ provider: candidate.provider, stable_id: candidate.stable_id, title: candidate.title }),
        now,
      ],
    )
  }
  await database.query(
    `INSERT INTO related_work_candidate_sources(id,project_id,candidate_id,provider,stable_id,candidate,retrieved_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      randomUUID(), projectId, fixtureIds.candidate3, 'openalex', 'fixture-candidate-3-openalex',
      JSON.stringify({ provider: 'openalex', stable_id: 'fixture-candidate-3-openalex', title: 'Conflict Fixture Candidate' }),
      now,
    ],
  )

  await database.query(
    `INSERT INTO related_work_seed_candidates(seed_id,candidate_id,provider,match_method)
     VALUES ($1,$2,$3,$4),($5,$6,$7,$8),($9,$10,$11,$12),($13,$14,$15,$16),($17,$18,$19,$20)`,
    [
      fixtureIds.seed1, fixtureIds.candidate1, 'crossref', 'doi',
      fixtureIds.seed1, fixtureIds.candidate4, 'crossref', 'doi',
      fixtureIds.seed2, fixtureIds.candidate1, 'openalex', 'provider_stable_id',
      fixtureIds.seed2, fixtureIds.candidate2, 'openalex', 'title_year',
      fixtureIds.seed3, fixtureIds.candidate3, 'semantic_scholar', 'provider_stable_id',
    ],
  )

  for (const proposal of [
    { id: fixtureIds.proposal1, runId: fixtureIds.run1 },
    { id: fixtureIds.proposal2, runId: fixtureIds.run2 },
    { id: fixtureIds.proposal3, runId: fixtureIds.run3 },
  ]) {
    await database.query(
      `INSERT INTO proposals(id,project_id,kind,status,reason,summary,payload)
       VALUES ($1,$2,'related_work_recursive','approved','acceptance fixture',$3,$4)`,
      [proposal.id, projectId, `Related work run fixture ${proposal.runId.slice(0, 8)}`, JSON.stringify({ seed_ids: seedIds, depth: 2, width: 5, max_total: 30 })],
    )
  }

  const runs = [
    {
      id: fixtureIds.run1,
      proposalId: fixtureIds.proposal1,
      status: 'completed',
      cancelRequested: false,
      discovered: 3,
      edges: 3,
      failures: 1,
      error: null,
      startedAt,
      finishedAt,
    },
    {
      id: fixtureIds.run2,
      proposalId: fixtureIds.proposal2,
      status: 'failed',
      cancelRequested: false,
      discovered: 0,
      edges: 0,
      failures: 2,
      error: 'Fixture provider timed out; no silent fallback was used.',
      startedAt,
      finishedAt,
    },
    {
      id: fixtureIds.run3,
      proposalId: fixtureIds.proposal3,
      status: 'cancelled',
      cancelRequested: true,
      discovered: 1,
      edges: 1,
      failures: 1,
      error: null,
      startedAt,
      finishedAt,
    },
  ]
  for (const run of runs) {
    await database.query(
      `INSERT INTO related_work_recursive_runs
       (id,project_id,proposal_id,seed_ids,providers,depth,width,max_total,status,cancel_requested,discovered_count,edge_count,failure_count,error,started_at,finished_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        run.id, projectId, run.proposalId, JSON.stringify(seedIds), JSON.stringify(['crossref', 'openalex', 'semantic_scholar']),
        2, 5, 30, run.status, run.cancelRequested, run.discovered, run.edges, run.failures, run.error, run.startedAt, run.finishedAt,
      ],
    )
  }

  const runEvents = [
    {
      id: randomUUID(), runId: fixtureIds.run1, eventType: 'started', level: null,
      payload: { actor: 'acceptance-fixture', depth: 2, width: 5, max_total: 30, providers: ['crossref', 'openalex', 'semantic_scholar'] },
    },
    {
      id: randomUUID(), runId: fixtureIds.run1, eventType: 'progress', level: 1,
      payload: { provider: 'crossref', total_count: 2, provider_failures: 0 },
    },
    {
      id: randomUUID(), runId: fixtureIds.run1, eventType: 'progress', level: 2,
      payload: { provider: 'openalex', total_count: 3, provider_failures: 1 },
    },
    {
      id: randomUUID(), runId: fixtureIds.run1, eventType: 'finished', level: null,
      payload: { status: 'completed', discovered_count: 3, edge_count: 3, failure_count: 1, truncated: false, cancelled: false },
    },
    {
      id: randomUUID(), runId: fixtureIds.run2, eventType: 'started', level: null,
      payload: { actor: 'acceptance-fixture', depth: 2, width: 5, max_total: 30, providers: ['crossref', 'openalex'] },
    },
    {
      id: randomUUID(), runId: fixtureIds.run2, eventType: 'failed', level: null,
      payload: { message: 'Fixture provider timed out; no silent fallback was used.' },
    },
    {
      id: randomUUID(), runId: fixtureIds.run3, eventType: 'started', level: null,
      payload: { actor: 'acceptance-fixture', depth: 1, width: 3, max_total: 10, providers: ['semantic_scholar'] },
    },
    {
      id: randomUUID(), runId: fixtureIds.run3, eventType: 'cancel_requested', level: null,
      payload: { reason: 'Browser acceptance fixture' },
    },
    {
      id: randomUUID(), runId: fixtureIds.run3, eventType: 'finished', level: null,
      payload: { status: 'cancelled', discovered_count: 1, edge_count: 1, failure_count: 1, truncated: false, cancelled: true },
    },
  ]
  for (const event of runEvents) {
    await database.query(
      `INSERT INTO related_work_run_events(id,project_id,run_id,event_type,level,payload)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [event.id, projectId, event.runId, event.eventType, event.level, JSON.stringify(event.payload)],
    )
  }

  const attempts = [
    {
      id: randomUUID(), seedId: fixtureIds.seed1, runId: fixtureIds.run1, parentCandidateId: fixtureIds.candidate1,
      provider: 'crossref', query: '10.1000/fixture-seed', requestUrl: 'https://api.crossref.org/works?filter=doi:10.1000/fixture-seed',
      status: 'succeeded', httpStatus: 200, resultCount: 3, failure: null,
    },
    {
      id: randomUUID(), seedId: fixtureIds.seed1, runId: fixtureIds.run1, parentCandidateId: fixtureIds.candidate1,
      provider: 'openalex', query: '10.1000/fixture-seed', requestUrl: 'https://api.openalex.org/works?filter=doi:10.1000/fixture-seed',
      status: 'succeeded', httpStatus: 200, resultCount: 0, failure: null,
    },
    {
      id: randomUUID(), seedId: fixtureIds.seed2, runId: fixtureIds.run1, parentCandidateId: fixtureIds.candidate2,
      provider: 'semantic_scholar', query: 'Fixture Title Seed', requestUrl: 'https://api.semanticscholar.org/graph/v1/paper/search?query=Fixture%20Title%20Seed',
      status: 'partial', httpStatus: 200, resultCount: 1, failure: null,
    },
    {
      id: randomUUID(), seedId: fixtureIds.seed2, runId: fixtureIds.run1, parentCandidateId: fixtureIds.candidate2,
      provider: 'crossref', query: 'Fixture Title Seed', requestUrl: 'https://api.crossref.org/works?query=Fixture%20Title%20Seed',
      status: 'rate_limited', httpStatus: 429, resultCount: 0,
      failure: { code: 'rate_limited', message: 'Fixture rate limit', retryable: true, http_status: 429 },
    },
    {
      id: randomUUID(), seedId: fixtureIds.seed3, runId: fixtureIds.run2, parentCandidateId: fixtureIds.candidate3,
      provider: 'openalex', query: 'Fixture URL Seed', requestUrl: 'https://api.openalex.org/works?search=Fixture%20URL%20Seed',
      status: 'timed_out', httpStatus: null, resultCount: 0,
      failure: { code: 'timeout', message: 'Fixture timeout', retryable: true },
    },
    {
      id: randomUUID(), seedId: fixtureIds.seed3, runId: fixtureIds.run2, parentCandidateId: fixtureIds.candidate3,
      provider: 'semantic_scholar', query: 'Fixture URL Seed', requestUrl: 'https://api.semanticscholar.org/graph/v1/paper/search?query=Fixture%20URL%20Seed',
      status: 'invalid_response', httpStatus: 200, resultCount: 0,
      failure: { code: 'invalid_response', message: 'Fixture invalid response', retryable: false },
    },
    {
      id: randomUUID(), seedId: fixtureIds.seed3, runId: fixtureIds.run2, parentCandidateId: fixtureIds.candidate3,
      provider: 'dblp', query: 'Fixture URL Seed', requestUrl: 'https://dblp.org/search/publ/api',
      status: 'unsupported', httpStatus: null, resultCount: 0,
      failure: { code: 'unsupported', message: 'DBLP does not support citation recursion', retryable: false },
    },
    {
      id: randomUUID(), seedId: fixtureIds.seed3, runId: fixtureIds.run3, parentCandidateId: fixtureIds.candidate3,
      provider: 'semantic_scholar', query: 'Fixture URL Seed', requestUrl: 'https://api.semanticscholar.org/graph/v1/paper/search?query=Fixture%20URL%20Seed',
      status: 'cancelled', httpStatus: null, resultCount: 0,
      failure: { code: 'cancelled', message: 'Fixture cancellation', retryable: false },
    },
  ]
  for (const attempt of attempts) {
    await database.query(
      `INSERT INTO related_work_source_attempts
       (id,project_id,seed_id,run_id,parent_candidate_id,provider,query,request_url,started_at,finished_at,status,http_status,result_count,failure)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        attempt.id, projectId, attempt.seedId, attempt.runId, attempt.parentCandidateId, attempt.provider, attempt.query,
        attempt.requestUrl, startedAt, finishedAt, attempt.status, attempt.httpStatus, attempt.resultCount, attempt.failure,
      ],
    )
  }

  const edges = [
    {
      id: randomUUID(), runId: fixtureIds.run1, source: fixtureIds.candidate1, target: fixtureIds.candidate4,
      provider: 'crossref', relation: 'references', score: 120, reasons: ['citation_count:120'], depth: 1,
    },
    {
      id: randomUUID(), runId: fixtureIds.run1, source: fixtureIds.candidate1, target: fixtureIds.candidate3,
      provider: 'openalex', relation: 'references', score: 30, reasons: ['citation_count:30'], depth: 2,
    },
    {
      id: randomUUID(), runId: fixtureIds.run3, source: fixtureIds.candidate4, target: fixtureIds.candidate3,
      provider: 'semantic_scholar', relation: 'references', score: 10, reasons: ['citation_count:10'], depth: 2,
    },
  ]
  for (const edge of edges) {
    await database.query(
      `INSERT INTO related_work_citation_edges
       (id,project_id,run_id,source_candidate_id,target_candidate_id,provider,relation,ranking_score,ranking_reasons,discovery_depth)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [edge.id, projectId, edge.runId, edge.source, edge.target, edge.provider, edge.relation, edge.score, JSON.stringify(edge.reasons), edge.depth],
    )
  }

  const hash = (value: string) => {
    let result = 'f'.repeat(64)
    for (let index = 0; index < value.length; index += 1) {
      result = `${result.slice(0, index % 64)}${(value.charCodeAt(index) % 10).toString()}${result.slice((index % 64) + 1)}`
    }
    return result
  }
  const provenanceRows = [
    {
      id: randomUUID(), candidateId: fixtureIds.candidate1, fieldName: 'title', provider: 'crossref', sourceType: 'provider',
      stableId: 'fixture-candidate-1', attemptId: null, artifactId: null, locator: 'https://api.crossref.org/works/10.1000/fixture-candidate-1',
      hash: hash('Robust Fixture Candidate'), value: 'Robust Fixture Candidate', status: 'selected', conflictGroup: `${fixtureIds.candidate1}:title`,
    },
    {
      id: randomUUID(), candidateId: fixtureIds.candidate3, fieldName: 'title', provider: 'crossref', sourceType: 'provider',
      stableId: 'fixture-candidate-3', attemptId: null, artifactId: null, locator: 'https://api.crossref.org/works/10.1000/fixture-candidate-3',
      hash: hash('Conflict Fixture Candidate'), value: 'Conflict Fixture Candidate', status: 'observed', conflictGroup: `${fixtureIds.candidate3}:title`,
    },
    {
      id: randomUUID(), candidateId: fixtureIds.candidate3, fieldName: 'title', provider: 'openalex', sourceType: 'provider',
      stableId: 'fixture-candidate-3-openalex', attemptId: null, artifactId: null, locator: 'https://api.openalex.org/works/fixture-candidate-3',
      hash: hash('Conflict Fixture Candidate revised'), value: 'Conflict Fixture Candidate revised', status: 'conflict', conflictGroup: `${fixtureIds.candidate3}:title`,
    },
    {
      id: randomUUID(), candidateId: fixtureIds.candidate3, fieldName: 'title', provider: null, sourceType: 'user_input',
      stableId: null, attemptId: null, artifactId: null, locator: `seed:${fixtureIds.seed2}:title`,
      hash: hash('Conflict Fixture Candidate (manual)'), value: 'Conflict Fixture Candidate (manual)', status: 'conflict', conflictGroup: `${fixtureIds.candidate3}:title`,
    },
    {
      id: randomUUID(), candidateId: fixtureIds.candidate3, fieldName: 'authors', provider: 'crossref', sourceType: 'provider',
      stableId: 'fixture-candidate-3', attemptId: null, artifactId: null, locator: 'https://api.crossref.org/works/10.1000/fixture-candidate-3',
      hash: hash('Ada Fixture;Ben Sample'), value: ['Ada Fixture', 'Ben Sample'], status: 'selected', conflictGroup: `${fixtureIds.candidate3}:authors`,
    },
    {
      id: randomUUID(), candidateId: fixtureIds.candidate3, fieldName: 'year', provider: null, sourceType: 'user_input',
      stableId: null, attemptId: null, artifactId: null, locator: `seed:${fixtureIds.seed2}:year`,
      hash: hash('2024'), value: 2024, status: 'observed', conflictGroup: `${fixtureIds.candidate3}:year`,
    },
  ]
  for (const row of provenanceRows) {
    await database.query(
      `INSERT INTO related_work_field_provenance
       (id,project_id,candidate_id,field_name,provider,source_type,stable_id,source_attempt_id,artifact_id,retrieved_at,locator,raw_value_hash,normalized_value,status,conflict_group)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        row.id, projectId, row.candidateId, row.fieldName, row.provider, row.sourceType, row.stableId, row.attemptId, row.artifactId,
        now, row.locator, row.hash, JSON.stringify(row.value), row.status, row.conflictGroup,
      ],
    )
  }

  await database.query(
    `INSERT INTO related_work_candidate_reviews(id,project_id,candidate_id,decision,reason,actor)
     VALUES ($1,$2,$3,$4,$5,$6),($7,$8,$9,$10,$11,$12)`,
    [
      randomUUID(), projectId, fixtureIds.candidate2, 'rejected', 'Fixture rejection for browser acceptance', 'acceptance-fixture',
      randomUUID(), projectId, fixtureIds.candidate4, 'approved', 'Fixture confirmation for browser acceptance', 'acceptance-fixture',
    ],
  )

  const status = await createResearchStatusMatrix(projectId, {
    rows: [{
      paper_id: fixtureIds.paper,
      theme: 'fixture uncertainty theme',
      method: 'fixture confidence method',
      year: 2023,
      datasets: ['fixture-data'],
      metrics: ['accuracy'],
      limitations: 'Fixture limitation used only for acceptance.',
      code_availability: 'official_repository',
      evidence_ids: [fixtureIds.evidence],
      claim_review_ids: [fixtureIds.review],
    }],
    actor: 'acceptance-fixture',
  })

  console.log(JSON.stringify({
    status: 'seeded',
    project_id: projectId,
    project: project.rows[0].slug,
    paper_id: fixtureIds.paper,
    matrix_id: status.matrix?.id,
    candidates: candidateIds.length,
    runs: runIds.length,
    attempts: attempts.length,
    edges: edges.length,
  }))
  await database.close()
}

void main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
