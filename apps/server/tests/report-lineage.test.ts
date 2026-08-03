import { beforeAll, describe, expect, it } from 'vitest'
import { database, migrate } from '../src/database.js'
import { projectDetail } from '../src/project-service.js'

async function cleanup(projectIds: string[]) {
  const placeholders = projectIds.map((_, index) => `$${index + 1}`).join(',')
  await database.query(`DELETE FROM reports WHERE project_id IN (${placeholders})`, projectIds)
  await database.query(`DELETE FROM artifacts WHERE project_id IN (${placeholders})`, projectIds)
  await database.query(`DELETE FROM experiments WHERE project_id IN (${placeholders})`, projectIds)
  await database.query(`DELETE FROM evidence WHERE project_id IN (${placeholders})`, projectIds)
  await database.query(`DELETE FROM papers WHERE project_id IN (${placeholders})`, projectIds)
  await database.query(`DELETE FROM proposals WHERE project_id IN (${placeholders})`, projectIds)
  await database.query(`DELETE FROM audit_events WHERE project_id IN (${placeholders})`, projectIds)
  await database.query(`DELETE FROM projects WHERE id IN (${placeholders})`, projectIds)
}

async function insertProject(projectId: string, slug: string) {
  await database.query('INSERT INTO projects(id,slug,title) VALUES ($1,$2,$3)', [projectId, slug, `Report lineage ${slug}`])
}

describe('report source lineage validation', () => {
  beforeAll(async () => {
    await migrate()
  }, 60_000)

  it('marks reports without a source snapshot as legacy_unverified', async () => {
    const projectId = crypto.randomUUID()
    try {
      await insertProject(projectId, `report-legacy-${projectId.slice(0, 8)}`)
      const reportId = crypto.randomUUID()
      await database.query('INSERT INTO reports(id,project_id,period,content,status,source_snapshot) VALUES ($1,$2,$3,$4,$5,$6)', [reportId, projectId, 'daily', '# legacy', 'valid', {}])

      const detail = await projectDetail(projectId)
      expect(detail.reports).toHaveLength(1)
      expect(detail.reports[0]).toMatchObject({ status: 'legacy_unverified', blocking_reason: 'report_source_snapshot_missing' })
    } finally {
      await cleanup([projectId])
    }
  })

  it('keeps a report valid when every declared source belongs to the project', async () => {
    const projectId = crypto.randomUUID()
    const paperId = crypto.randomUUID()
    const evidenceId = crypto.randomUUID()
    const proposalId = crypto.randomUUID()
    const experimentId = crypto.randomUUID()
    const artifactId = crypto.randomUUID()
    try {
      await insertProject(projectId, `report-valid-${projectId.slice(0, 8)}`)
      await database.query('INSERT INTO papers(id,project_id,title,source_url) VALUES ($1,$2,$3,$4)', [paperId, projectId, 'Valid source', 'https://example.test/paper.pdf'])
      await database.query('INSERT INTO evidence(id,project_id,paper_id,claim,quote,locator,source_url) VALUES ($1,$2,$3,$4,$5,$6,$7)', [evidenceId, projectId, paperId, 'claim', 'quote', 'page 1', 'https://example.test/paper.pdf'])
      await database.query('INSERT INTO proposals(id,project_id,kind,reason,summary,status) VALUES ($1,$2,$3,$4,$5,$6)', [proposalId, projectId, 'report_source', 'test', 'test', 'approved'])
      await database.query('INSERT INTO experiments(id,project_id,proposal_id,experiment_type,status) VALUES ($1,$2,$3,$4,$5)', [experimentId, projectId, proposalId, 'topic_specific', 'succeeded'])
      await database.query('INSERT INTO artifacts(id,project_id,experiment_id,kind,name,relative_path,mime_type,sha256,valid) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [artifactId, projectId, experimentId, 'experiment_output', 'metrics.json', `runs/${experimentId}/metrics.json`, 'application/json', 'a'.repeat(64), true])
      const reportId = crypto.randomUUID()
      await database.query('INSERT INTO reports(id,project_id,period,content,source_snapshot) VALUES ($1,$2,$3,$4,$5)', [reportId, projectId, 'daily', '# valid', {
        project_id: projectId,
        paper_ids: [paperId],
        evidence_ids: [evidenceId],
        experiment_ids: [experimentId],
        artifact_ids: [artifactId],
        proposal_ids: [proposalId],
      }])

      const detail = await projectDetail(projectId)
      expect(detail.reports[0]).toMatchObject({ status: 'valid', blocking_reason: null, missing_source_ids: [] })
    } finally {
      await cleanup([projectId])
    }
  })

  it('blocks a report when an upstream artifact is invalid', async () => {
    const projectId = crypto.randomUUID()
    const artifactId = crypto.randomUUID()
    try {
      await insertProject(projectId, `report-invalid-artifact-${projectId.slice(0, 8)}`)
      await database.query('INSERT INTO artifacts(id,project_id,kind,name,relative_path,mime_type,sha256,valid) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [artifactId, projectId, 'experiment_output', 'metrics.json', `runs/${artifactId}/metrics.json`, 'application/json', 'b'.repeat(64), false])
      const reportId = crypto.randomUUID()
      await database.query('INSERT INTO reports(id,project_id,period,content,source_snapshot) VALUES ($1,$2,$3,$4,$5)', [reportId, projectId, 'weekly', '# blocked', {
        project_id: projectId,
        paper_ids: [],
        evidence_ids: [],
        experiment_ids: [],
        artifact_ids: [artifactId],
        proposal_ids: [],
      }])

      const detail = await projectDetail(projectId)
      expect(detail.reports[0]).toMatchObject({ status: 'blocked', blocking_reason: 'report_source_missing_or_invalid' })
      expect(detail.reports[0].missing_source_ids).toContain(`artifact:${artifactId}`)
    } finally {
      await cleanup([projectId])
    }
  })

  it('blocks cross-project source IDs and mismatched snapshot scopes', async () => {
    const projectId = crypto.randomUUID()
    const otherProjectId = crypto.randomUUID()
    const otherPaperId = crypto.randomUUID()
    try {
      await insertProject(projectId, `report-scope-${projectId.slice(0, 8)}`)
      await insertProject(otherProjectId, `report-other-${otherProjectId.slice(0, 8)}`)
      await database.query('INSERT INTO papers(id,project_id,title,source_url) VALUES ($1,$2,$3,$4)', [otherPaperId, otherProjectId, 'Other project source', 'https://example.test/other.pdf'])
      const crossProjectReportId = crypto.randomUUID()
      const mismatchedScopeReportId = crypto.randomUUID()
      const emptySources = { paper_ids: [], evidence_ids: [], experiment_ids: [], artifact_ids: [], proposal_ids: [] }
      await database.query('INSERT INTO reports(id,project_id,period,content,source_snapshot) VALUES ($1,$2,$3,$4,$5),($6,$2,$3,$7,$8)', [
        crossProjectReportId, projectId, 'daily', '# cross project', { project_id: projectId, ...emptySources, paper_ids: [otherPaperId] },
        mismatchedScopeReportId, '# mismatched scope', { project_id: otherProjectId, ...emptySources },
      ])

      const reports = (await projectDetail(projectId)).reports as Array<Record<string, any>>
      expect(reports.find(report => report.id === crossProjectReportId)).toMatchObject({ status: 'blocked', blocking_reason: 'report_source_missing_or_invalid' })
      expect(reports.find(report => report.id === crossProjectReportId)?.missing_source_ids).toContain(`paper:${otherPaperId}`)
      expect(reports.find(report => report.id === mismatchedScopeReportId)).toMatchObject({ status: 'blocked', blocking_reason: 'report_source_project_mismatch' })
    } finally {
      await cleanup([projectId, otherProjectId])
    }
  })
})
