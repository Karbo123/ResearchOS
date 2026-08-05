import { testProjectSlug } from './test-project.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../src/index.js'
import { database, migrate, rows } from '../src/database.js'

const projectId = testProjectSlug()
const otherProjectId = testProjectSlug()
const paperId = crypto.randomUUID()
const otherPaperId = crypto.randomUUID()
const evidenceId = crypto.randomUUID()
const reviewId = crypto.randomUUID()
const repositoryId = crypto.randomUUID()
const reproductionId = crypto.randomUUID()
const runId = crypto.randomUUID()
const failedRunId = crypto.randomUUID()
const artifactId = crypto.randomUUID()
const completedProposalId = crypto.randomUUID()
const failedProposalId = crypto.randomUUID()
const commit = 'a'.repeat(40)
const configFingerprint = 'b'.repeat(64)
const pdfSha256 = 'c'.repeat(64)

async function requestJson(path: string, init: RequestInit = {}) {
  const response = await app.request(`http://research-os.test${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  })
  return { response, body: await response.json() as Record<string, any> }
}

describe('project-scoped reproduction comparison', () => {
  beforeAll(async () => {
    await migrate()
    await database.query('INSERT INTO projects(id,slug,title) VALUES ($1,$2,$3),($4,$5,$6)', [
      projectId, `comparison-${projectId.slice(0, 8)}`, 'Comparison test',
      otherProjectId, `comparison-other-${otherProjectId.slice(0, 8)}`, 'Other comparison test',
    ])
    await database.query('INSERT INTO papers(id,project_id,title,doi,source_url,confirmed,metadata) VALUES ($1,$2,$3,$4,$5,TRUE,$6),($7,$8,$9,$10,$11,TRUE,$12)', [
      paperId, projectId, 'Pinned baseline paper', '10.1000/comparison', 'https://doi.org/10.1000/comparison', {},
      otherPaperId, otherProjectId, 'Other project paper', '10.1000/other-comparison', 'https://doi.org/10.1000/other-comparison', {},
    ])
    await database.query('INSERT INTO evidence(id,project_id,paper_id,claim,quote,locator,source_url,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [
      evidenceId, projectId, paperId, 'Reported accuracy', 'The paper reports accuracy 0.80 on the fixed dataset.', 'page 5, Table 2', 'https://example.org/comparison.pdf', { pdf_sha256: pdfSha256 },
    ])
    await database.query('INSERT INTO claim_reviews(id,project_id,claim,evidence_ids,status,reviewer) VALUES ($1,$2,$3,$4,\'accepted\',$5)', [reviewId, projectId, 'Reported accuracy', [evidenceId], 'test-reviewer'])
    await database.query('INSERT INTO repositories(id,project_id,paper_id,source_url,license_spdx,commit_or_tag,verified_official,metadata) VALUES ($1,$2,$3,$4,$5,$6,TRUE,$7)', [
      repositoryId, projectId, paperId, 'https://github.com/example/pinned', 'MIT', commit, {},
    ])
    await database.query('INSERT INTO reproductions(id,project_id,repository_id,status,source_commit,repository_relative_path,dependency_manifest,dependency_sha256,venv_relative_path,plan,dependency_report) VALUES ($1,$2,$3,\'ready\',$4,$5,$6,$7,$8,$9,$10)', [
      reproductionId, projectId, repositoryId, commit, 'experiment/reproductions/reproduction/source', 'requirements.txt', 'd'.repeat(64), 'experiment/reproductions/reproduction/.venv', { source_tree_sha256: 'e'.repeat(64), config_fingerprint: configFingerprint, timeout_seconds: 3600 }, {},
    ])
    await database.query('INSERT INTO artifacts(id,project_id,kind,name,relative_path,mime_type,sha256,valid,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,$8)', [
      artifactId, projectId, 'reproduction_output', 'metrics.json', `reproduction-runs/${runId}/metrics.json`, 'application/json', 'f'.repeat(64), { run_id: runId },
    ])
    await database.query('INSERT INTO proposals(id,project_id,kind,reason,summary) VALUES ($1,$2,$3,$4,$5),($6,$2,$7,$8,$9)', [
      completedProposalId, projectId, 'repository_reproduction_run', 'test fixture', 'completed reproduction fixture', failedProposalId, 'repository_reproduction_run', 'test fixture', 'failed reproduction fixture',
    ])
    await database.query('INSERT INTO reproduction_runs(id,project_id,reproduction_id,proposal_id,status,source_commit,entrypoint,random_seeds,config,run_relative_path,metrics,artifact_ids) VALUES ($1,$2,$3,$4,\'completed\',$5,$6,$7,$8,$9,$10,$11)', [
      runId, projectId, reproductionId, completedProposalId, commit, 'scripts/evaluate.py', [13, 37], { data_version: 'dataset-v1', datasets: ['fixed-set'], metric_definitions: { accuracy: 'top-1 accuracy' } }, `experiment/reproductions/${reproductionId}/runs/${runId}`, { per_seed: { '13': { accuracy: 0.84 }, '37': { accuracy: 0.86 } }, aggregate: { accuracy: { count: 2, mean: 0.85, population_std: 0.01, min: 0.84, max: 0.86 } } }, [artifactId],
    ])
    await database.query('INSERT INTO reproduction_runs(id,project_id,reproduction_id,proposal_id,status,source_commit,entrypoint,random_seeds,config,run_relative_path,metrics,artifact_ids,error) VALUES ($1,$2,$3,$4,\'failed\',$5,$6,$7,$8,$9,$10,$11,$12)', [
      failedRunId, projectId, reproductionId, failedProposalId, commit, 'scripts/evaluate.py', [13], {}, `experiment/reproductions/${reproductionId}/runs/${failedRunId}`, {}, [], 'reproduction_process_failed',
    ])
  })

  afterAll(async () => {
    await database.query('DELETE FROM research_comparison_candidates WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM research_comparisons WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM reproduction_runs WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM proposals WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM artifacts WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM reproductions WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM repositories WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM claim_reviews WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM evidence WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM papers WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM audit_events WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM projects WHERE id IN ($1,$2)', [projectId, otherProjectId])
  })

  it('computes deterministic metric differences and creates review-only signals', async () => {
    const created = await requestJson(`/api/projects/${projectId}/research-comparisons`, {
      method: 'POST',
      body: JSON.stringify({
        paper_id: paperId,
        reproduction_run_id: runId,
        evidence_ids: [evidenceId],
        paper_metrics: { accuracy: { value: 0.8, evidence_ids: [evidenceId], direction: 'higher_is_better', definition: 'top-1 accuracy' } },
        paper_context: { data_version: 'dataset-v1', datasets: ['fixed-set'], config_fingerprint: configFingerprint, seeds: [13, 37], metric_definitions: { accuracy: 'top-1 accuracy' } },
        reason: 'compare the pinned reproduction against the page-level reported metric',
      }),
    })
    expect(created.response.status).toBe(201)
    expect(created.body.status).toBe('comparable')
    expect(created.body.metric_comparisons.accuracy).toMatchObject({
      status: 'comparable',
      paper_value: 0.8,
      reproduction_mean: 0.85,
      reproduction_population_std: 0.01,
      reproduction_count: 2,
      reproduction_min: 0.84,
      reproduction_max: 0.86,
      delta: 0.04999999999999993,
      signal: 'potential_improvement',
      per_seed: { '13': 0.84, '37': 0.86 },
    })
    expect(created.body.metric_comparisons.accuracy.relative_delta).toBeCloseTo(0.0625, 12)
    expect(created.body.candidate_ids.length).toBe(2)

    const list = await requestJson(`/api/projects/${projectId}/research-comparisons`)
    expect(list.response.status).toBe(200)
    expect(list.body.permission_status).toBe('project_scoped')
    expect(list.body.comparisons[0].candidates).toHaveLength(2)
    const candidate = list.body.comparisons[0].candidates.find((item: Record<string, unknown>) => item.candidate_type === 'innovation')
    expect(candidate).toBeTruthy()

    const decision = await requestJson(`/api/projects/${projectId}/research-comparisons/${created.body.comparison_id}/candidates/${candidate.id}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision: 'accepted', reason: '保留为需要独立验证的潜在改善信号。' }),
    })
    expect(decision.response.status).toBe(200)
    expect(decision.body.status).toBe('accepted')
    expect(decision.body.evidence_status).toBe('comparison_requires_review')
    const difference = list.body.comparisons[0].candidates.find((item: Record<string, unknown>) => item.candidate_type === 'potential_improvement')
    expect(difference).toBeTruthy()
    const rejected = await requestJson(`/api/projects/${projectId}/research-comparisons/${created.body.comparison_id}/candidates/${difference.id}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision: 'rejected', reason: '差异需要新的等价条件后再审阅。' }),
    })
    expect(rejected.response.status).toBe(200)
    expect(rejected.body.status).toBe('rejected')
    const reopened = await requestJson(`/api/projects/${projectId}/research-comparisons/${created.body.comparison_id}/candidates/${difference.id}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision: 'reopened', reason: '补充条件后重新进入人工复核。' }),
    })
    expect(reopened.response.status).toBe(200)
    expect(reopened.body.status).toBe('candidate')
    const auditRows = await rows<{ action: string }>('SELECT action FROM audit_events WHERE project_id=$1 AND action LIKE \'research_comparison.%\' ORDER BY created_at,id', [projectId])
    expect(auditRows.map(row => row.action)).toContain('research_comparison.created')
    expect(auditRows.map(row => row.action)).toContain('research_comparison.candidate_accepted')
    expect(auditRows.map(row => row.action)).toContain('research_comparison.candidate_rejected')
    expect(auditRows.map(row => row.action)).toContain('research_comparison.candidate_reopened')
  })

  it('keeps failed or incomplete runs blocked and rejects cross-project papers', async () => {
    const crossProject = await requestJson(`/api/projects/${projectId}/research-comparisons`, {
      method: 'POST',
      body: JSON.stringify({
        paper_id: otherPaperId,
        reproduction_run_id: runId,
        evidence_ids: [evidenceId],
        paper_metrics: { accuracy: { value: 0.8, evidence_ids: [evidenceId], direction: 'higher_is_better' } },
        paper_context: { data_version: null, datasets: [], config_fingerprint: null, seeds: null, metric_definitions: {} },
        reason: 'cross project must be rejected',
      }),
    })
    expect(crossProject.response.status).toBe(404)
    expect(crossProject.body.code).toBe('research_comparison_paper_not_found')

    const blocked = await requestJson(`/api/projects/${projectId}/research-comparisons`, {
      method: 'POST',
      body: JSON.stringify({
        paper_id: paperId,
        reproduction_run_id: failedRunId,
        evidence_ids: [evidenceId],
        paper_metrics: { accuracy: { value: 0.8, evidence_ids: [evidenceId], direction: 'higher_is_better' } },
        paper_context: { data_version: null, datasets: [], config_fingerprint: null, seeds: null, metric_definitions: {} },
        reason: 'record the failed run without inventing a result',
      }),
    })
    expect(blocked.response.status).toBe(201)
    expect(blocked.body.status).toBe('blocked')
    expect(blocked.body.blocking_reasons).toEqual(expect.arrayContaining(['reproduction_run_failed', 'reproduction_artifacts_missing', 'reproduction_metrics_invalid']))
    const detail = await requestJson(`/api/projects/${projectId}/research-comparisons/${blocked.body.comparison_id}`)
    expect(detail.body.comparison.status).toBe('blocked')
    expect(detail.body.candidates.some((item: Record<string, unknown>) => item.candidate_type === 'comparability_gap')).toBe(true)

    const mismatch = await requestJson(`/api/projects/${projectId}/research-comparisons`, {
      method: 'POST',
      body: JSON.stringify({
        paper_id: paperId,
        reproduction_run_id: runId,
        evidence_ids: [evidenceId],
        paper_metrics: { accuracy: { value: 0.8, evidence_ids: [evidenceId], direction: 'higher_is_better', definition: 'top-1 accuracy' } },
        paper_context: { data_version: 'dataset-v2', datasets: ['fixed-set'], config_fingerprint: configFingerprint, seeds: [13, 37], metric_definitions: { accuracy: 'top-1 accuracy' } },
        reason: 'do not compare results across different data versions',
      }),
    })
    expect(mismatch.response.status).toBe(201)
    expect(mismatch.body.status).toBe('blocked')
    expect(mismatch.body.blocking_reasons).toContain('data_version_mismatch')
    expect(mismatch.body.metric_comparisons.accuracy.status).toBe('blocked')
  })
})
