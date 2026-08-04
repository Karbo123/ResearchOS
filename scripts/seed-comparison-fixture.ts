import { database, migrate, rows } from '../apps/server/src/database.js'
import { createResearchComparison } from '../apps/server/src/research-comparison/service.js'

const mode = process.argv[2] || 'seed'
const projectRef = process.argv[3] || process.env.RESEARCH_PROJECT_SLUG || 'uncertainty-based-d9a5'

const repositoryId = '11111111-1111-4111-8111-111111111111'
const reproductionId = '22222222-2222-4222-8222-222222222222'
const proposalId = '33333333-3333-4333-8333-333333333333'
const runId = '44444444-4444-4444-8444-444444444444'
const artifactId = '55555555-5555-4555-8555-555555555555'
const evidenceId = '66666666-6666-4666-8666-666666666666'
const reviewId = '77777777-7777-4777-8777-777777777777'
const commit = 'a'.repeat(40)
const configFingerprint = 'b'.repeat(64)
const pdfSha256 = 'c'.repeat(64)

async function cleanup(projectId: string) {
  const comparisonRows = await rows<{ id: string }>('SELECT id FROM research_comparisons WHERE project_id=$1 AND created_by=$2', [projectId, 'acceptance-fixture'])
  for (const comparison of comparisonRows) {
    await database.query('DELETE FROM research_comparison_candidates WHERE comparison_id=$1', [comparison.id])
  }
  await database.query('DELETE FROM research_comparisons WHERE project_id=$1 AND created_by=$2', [projectId, 'acceptance-fixture'])
  await database.query('DELETE FROM reproduction_runs WHERE id=$1', [runId])
  await database.query('DELETE FROM proposals WHERE id=$1', [proposalId])
  await database.query('DELETE FROM artifacts WHERE id=$1', [artifactId])
  await database.query('DELETE FROM reproductions WHERE id=$1', [reproductionId])
  await database.query('DELETE FROM repositories WHERE id=$1', [repositoryId])
  await database.query('DELETE FROM claim_reviews WHERE id=$1', [reviewId])
  await database.query('DELETE FROM evidence WHERE id=$1', [evidenceId])
  await database.query('DELETE FROM audit_events WHERE project_id=$1 AND action IN ($2,$3) AND details::text LIKE $4', [
    projectId,
    'research_comparison.created',
    'research_comparison.candidate_created',
    `%${comparisonRows[0]?.id || '00000000-0000-4000-8000-000000000000'}%`,
  ])
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

  const paper = await database.query<{ id: string }>('SELECT id FROM papers WHERE project_id=$1 AND confirmed=TRUE LIMIT 1', [projectId])
  if (!paper.rows[0]) throw new Error(`Project ${projectRef} has no confirmed paper`)
  const paperId = paper.rows[0].id

  await database.query(
    `INSERT INTO evidence(id,project_id,paper_id,claim,quote,locator,source_url,metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [evidenceId, projectId, paperId, 'Reported fixture accuracy', 'The paper reports accuracy 0.80 on the fixed dataset.', 'page 5, Table 2', 'https://example.org/comparison-fixture.pdf', { pdf_sha256: pdfSha256 }],
  )
  await database.query(
    'INSERT INTO claim_reviews(id,project_id,claim,evidence_ids,status,reviewer) VALUES ($1,$2,$3,$4,$5,$6)',
    [reviewId, projectId, 'Reported fixture accuracy', [evidenceId], 'accepted', 'acceptance-fixture'],
  )
  await database.query(
    `INSERT INTO repositories(id,project_id,paper_id,source_url,license_spdx,commit_or_tag,verified_official,metadata)
     VALUES ($1,$2,$3,$4,$5,$6,TRUE,$7)`,
    [repositoryId, projectId, paperId, 'https://github.com/example/comparison-fixture', 'MIT', commit, {}],
  )
  await database.query(
    `INSERT INTO reproductions(id,project_id,repository_id,status,source_commit,repository_relative_path,dependency_manifest,dependency_sha256,venv_relative_path,plan,dependency_report)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [reproductionId, projectId, repositoryId, 'ready', commit, 'experiment/reproductions/reproduction/source', 'requirements.txt', 'd'.repeat(64), 'experiment/reproductions/reproduction/.venv', { source_tree_sha256: 'e'.repeat(64), config_fingerprint: configFingerprint, timeout_seconds: 3600 }, {}],
  )
  await database.query(
    `INSERT INTO proposals(id,project_id,kind,reason,summary) VALUES ($1,$2,$3,$4,$5)`,
    [proposalId, projectId, 'repository_reproduction_run', 'acceptance fixture', 'completed reproduction fixture'],
  )
  await database.query(
    `INSERT INTO artifacts(id,project_id,kind,name,relative_path,mime_type,sha256,valid,metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,$8)`,
    [artifactId, projectId, 'reproduction_output', 'metrics.json', `reproduction-runs/${runId}/metrics.json`, 'application/json', 'f'.repeat(64), { run_id: runId }],
  )
  await database.query(
    `INSERT INTO reproduction_runs(id,project_id,reproduction_id,proposal_id,status,source_commit,entrypoint,random_seeds,config,run_relative_path,metrics,artifact_ids)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      runId,
      projectId,
      reproductionId,
      proposalId,
      'completed',
      commit,
      'scripts/evaluate.py',
      [13, 37],
      { data_version: 'fixture-v1', datasets: ['fixed-set'], metric_definitions: { accuracy: 'top-1 accuracy' } },
      `experiment/reproductions/${reproductionId}/runs/${runId}`,
      {
        per_seed: { '13': { accuracy: 0.84 }, '37': { accuracy: 0.86 } },
        aggregate: { accuracy: { count: 2, mean: 0.85, population_std: 0.01, min: 0.84, max: 0.86 } },
      },
      [artifactId],
    ],
  )

  const created = await createResearchComparison(projectId, {
    paper_id: paperId,
    reproduction_run_id: runId,
    evidence_ids: [evidenceId],
    paper_metrics: { accuracy: { value: 0.8, evidence_ids: [evidenceId], direction: 'higher_is_better', definition: 'top-1 accuracy' } },
    paper_context: {
      data_version: 'fixture-v1',
      datasets: ['fixed-set'],
      config_fingerprint: configFingerprint,
      seeds: [13, 37],
      metric_definitions: { accuracy: 'top-1 accuracy' },
    },
    reason: 'Browser acceptance fixture: compare the reported metric with a completed reproduction run.',
    actor: 'acceptance-fixture',
  })
  console.log(JSON.stringify({ status: 'seeded', project_id: projectId, project: project.rows[0].slug, paper_id: paperId, comparison_id: created.comparison_id }))
  await database.close()
}

void main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
