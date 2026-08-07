import { testProjectSlug } from './test-project.js'
import { createHash } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { projectArtifactPath } from '../src/project-storage.js'
import { database, migrate } from '../src/database.js'
import { assertCheckpointRecoverable, createLineageImpactProposal, fingerprintValue, invalidateFromNodes, listLineageImpactReports, registerLineageDependencies, reconcileProjectLineage } from '../src/impact-service.js'

async function insertKnowledgeDocument(projectId: string, documentId: string, kind: string, sha: string) {
  await database.query(`INSERT INTO knowledge_documents(
    project_id,document_id,relative_path,kind,schema_version,author_status,system_health,current_sha256,git_dirty,file_size_bytes,file_mtime_ms,metadata,present
  ) VALUES ($1,$2,$3,$4,$5,'confirmed','current',$6,FALSE,10,1,$7,TRUE)`, [projectId, documentId, `research/${documentId.replaceAll(':', '/')}.md`, kind, 'researchos/knowledge-document@1', sha, { title: documentId, depends_on: [] }])
}

describe('semantic lineage invalidation', () => {
  it('propagates an Idea change through experiments, artifacts, and checkpoints', async () => {
    await migrate()
    const projectId = testProjectSlug()
    const ideaId = crypto.randomUUID()
    const proposalId = crypto.randomUUID()
    const experimentId = crypto.randomUUID()
    const artifactId = crypto.randomUUID()
    const checkpointId = crypto.randomUUID()
    try {
      await database.query('INSERT INTO projects(id,slug,title) VALUES ($1,$2,$3)', [projectId, `lineage-${projectId.slice(0, 8)}`, 'Lineage test'])
      await database.query('INSERT INTO idea_versions(id,project_id,version,spec) VALUES ($1,$2,$3,$4)', [ideaId, projectId, 1, { idea: { title: 'before' } }])
      await database.query('INSERT INTO proposals(id,project_id,kind,reason,summary,status) VALUES ($1,$2,$3,$4,$5,$6)', [proposalId, projectId, 'experiment_plan', 'test reason', 'test plan', 'approved'])
      await database.query('INSERT INTO experiments(id,project_id,proposal_id,experiment_type,status,config,metrics,run_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [experimentId, projectId, proposalId, 'topic_specific', 'succeeded', {}, { accuracy: 0.5 }, experimentId])
      await database.query('INSERT INTO artifacts(id,project_id,experiment_id,kind,name,relative_path,mime_type,sha256,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [artifactId, projectId, experimentId, 'experiment_output', 'metrics.json', `runs/${experimentId}/metrics.json`, 'application/json', fingerprintValue('file'), {}])
      await database.query('INSERT INTO checkpoints(id,project_id,stage,idea_version,state) VALUES ($1,$2,$3,$4,$5)', [checkpointId, projectId, 'experiment_succeeded', 1, { source_run_id: experimentId, artifact_ids: [artifactId] }])
      await registerLineageDependencies(projectId, [
        { downstream: { type: 'experiment', id: experimentId }, upstream: { type: 'idea_version', id: ideaId }, relation: 'experiment_input' },
        { downstream: { type: 'artifact', id: artifactId }, upstream: { type: 'experiment', id: experimentId }, relation: 'generated_from' },
        { downstream: { type: 'checkpoint', id: checkpointId }, upstream: { type: 'experiment', id: experimentId }, relation: 'checkpoint_source_run' },
      ])
      const result = await invalidateFromNodes(projectId, [{ type: 'idea_version', id: ideaId }], 'idea_revision_test', 'test')
      expect(result.invalidated_edges).toBe(3)
      expect((await database.query<{ status: string }>('SELECT status FROM experiments WHERE id=$1', [experimentId])).rows[0]?.status).toBe('invalidated')
      expect((await database.query<{ valid: boolean }>('SELECT valid FROM artifacts WHERE id=$1', [artifactId])).rows[0]?.valid).toBe(false)
      expect((await database.query<{ valid: boolean }>('SELECT valid FROM checkpoints WHERE id=$1', [checkpointId])).rows[0]?.valid).toBe(false)
    } finally {
      await database.query('DELETE FROM lineage_dependencies WHERE project_id=$1', [projectId])
      await database.query('DELETE FROM audit_events WHERE project_id=$1', [projectId])
      await database.query('DELETE FROM checkpoints WHERE id=$1', [checkpointId])
      await database.query('DELETE FROM artifacts WHERE id=$1', [artifactId])
      await database.query('DELETE FROM experiments WHERE id=$1', [experimentId])
      await database.query('DELETE FROM proposals WHERE id=$1', [proposalId])
      await database.query('DELETE FROM idea_versions WHERE id=$1', [ideaId])
      await database.query('DELETE FROM projects WHERE id=$1', [projectId])
    }
  }, 30_000)

  it('detects an upstream fingerprint drift and invalidates the dependent edge', async () => {
    await migrate()
    const projectId = testProjectSlug()
    const ideaId = crypto.randomUUID()
    const proposalId = crypto.randomUUID()
    const artifactId = crypto.randomUUID()
    try {
      await database.query('INSERT INTO projects(id,slug,title) VALUES ($1,$2,$3)', [projectId, `drift-${projectId.slice(0, 8)}`, 'Drift test'])
      await database.query('INSERT INTO idea_versions(id,project_id,version,spec) VALUES ($1,$2,$3,$4)', [ideaId, projectId, 1, { idea: { title: 'before' } }])
      await database.query('INSERT INTO proposals(id,project_id,kind,reason,summary,status) VALUES ($1,$2,$3,$4,$5,$6)', [proposalId, projectId, 'experiment_plan', 'test reason', 'test plan', 'approved'])
      await database.query('INSERT INTO artifacts(id,project_id,kind,name,relative_path,mime_type,sha256,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [artifactId, projectId, 'experiment_output', 'result.json', `runs/${artifactId}/result.json`, 'application/json', fingerprintValue('file'), {}])
      await registerLineageDependencies(projectId, [{ downstream: { type: 'artifact', id: artifactId }, upstream: { type: 'idea_version', id: ideaId }, relation: 'artifact_input' }])
      await database.query('UPDATE idea_versions SET spec=$2 WHERE id=$1', [ideaId, { idea: { title: 'after' } }])
      const result = await reconcileProjectLineage(projectId)
      expect(result.stale_edges).toBe(1)
      expect((await database.query<{ valid: boolean }>('SELECT valid FROM artifacts WHERE id=$1', [artifactId])).rows[0]?.valid).toBe(false)
    } finally {
      await database.query('DELETE FROM lineage_dependencies WHERE project_id=$1', [projectId])
      await database.query('DELETE FROM audit_events WHERE project_id=$1', [projectId])
      await database.query('DELETE FROM artifacts WHERE id=$1', [artifactId])
      await database.query('DELETE FROM proposals WHERE id=$1', [proposalId])
      await database.query('DELETE FROM idea_versions WHERE id=$1', [ideaId])
      await database.query('DELETE FROM projects WHERE id=$1', [projectId])
    }
  })

  it('rejects checkpoint recovery after an artifact file hash changes', async () => {
    await migrate()
    const projectId = testProjectSlug()
    const ideaId = crypto.randomUUID()
    const proposalId = crypto.randomUUID()
    const experimentId = crypto.randomUUID()
    const artifactId = crypto.randomUUID()
    const checkpointId = crypto.randomUUID()
    const runDirectory = projectArtifactPath(projectId, `runs/${experimentId}`)
    const artifactRelativePath = `artifacts/runs/${experimentId}/metrics.json`
    const artifactPath = join(runDirectory, 'metrics.json')
    try {
      mkdirSync(runDirectory, { recursive: true })
      const original = Buffer.from('{"accuracy":0.5}\n')
      writeFileSync(artifactPath, original)
      await database.query('INSERT INTO projects(id,slug,title) VALUES ($1,$2,$3)', [projectId, `recovery-${projectId.slice(0, 8)}`, 'Recovery test'])
      await database.query('INSERT INTO idea_versions(id,project_id,version,spec) VALUES ($1,$2,$3,$4)', [ideaId, projectId, 1, { idea: { title: 'recovery' } }])
      await database.query('INSERT INTO proposals(id,project_id,kind,reason,summary,status) VALUES ($1,$2,$3,$4,$5,$6)', [proposalId, projectId, 'experiment_plan', 'test reason', 'test plan', 'approved'])
      await database.query('INSERT INTO experiments(id,project_id,proposal_id,experiment_type,status,config,metrics,run_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [experimentId, projectId, proposalId, 'topic_specific', 'succeeded', {}, { accuracy: 0.5 }, experimentId])
      await database.query('INSERT INTO artifacts(id,project_id,experiment_id,kind,name,relative_path,mime_type,sha256,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [artifactId, projectId, experimentId, 'experiment_output', 'metrics.json', artifactRelativePath, 'application/json', createHash('sha256').update(original).digest('hex'), {}])
      await database.query('INSERT INTO checkpoints(id,project_id,stage,idea_version,state) VALUES ($1,$2,$3,$4,$5)', [checkpointId, projectId, 'experiment_succeeded', 1, { source_run_id: experimentId, artifact_ids: [artifactId] }])
      const valid = await assertCheckpointRecoverable(projectId, checkpointId)
      expect(valid.artifacts).toHaveLength(1)
      writeFileSync(artifactPath, Buffer.from('{"accuracy":0.9}\n'))
      await expect(assertCheckpointRecoverable(projectId, checkpointId)).rejects.toMatchObject({ code: 'checkpoint_artifact_hash_mismatch' })
    } finally {
      await database.query('DELETE FROM lineage_dependencies WHERE project_id=$1', [projectId])
      await database.query('DELETE FROM audit_events WHERE project_id=$1', [projectId])
      await database.query('DELETE FROM checkpoints WHERE id=$1', [checkpointId])
      await database.query('DELETE FROM artifacts WHERE id=$1', [artifactId])
      await database.query('DELETE FROM experiments WHERE id=$1', [experimentId])
      await database.query('DELETE FROM proposals WHERE id=$1', [proposalId])
      await database.query('DELETE FROM idea_versions WHERE id=$1', [ideaId])
      await database.query('DELETE FROM projects WHERE id=$1', [projectId])
      rmSync(runDirectory, { recursive: true, force: true })
    }
  })

  it('propagates typed knowledge impacts with a cycle limit and creates an idempotent review Proposal', async () => {
    await migrate()
    const projectId = testProjectSlug('impact-policy')
    const ideaId = 'idea:current'
    const planId = 'experiment:method-plan'
    const resultId = 'experiment:method-result'
    try {
      await database.query('INSERT INTO projects(id,slug,title) VALUES ($1,$1,$2)', [projectId, 'Typed impact test'])
      await insertKnowledgeDocument(projectId, ideaId, 'idea', fingerprintValue('idea-v1'))
      await insertKnowledgeDocument(projectId, planId, 'experiment_plan', fingerprintValue('plan-v1'))
      await insertKnowledgeDocument(projectId, resultId, 'run_result', fingerprintValue('result-v1'))
      await registerLineageDependencies(projectId, [
        { downstream: { type: 'knowledge_document', id: planId }, upstream: { type: 'knowledge_document', id: ideaId }, relation: 'tests', impact_policy: 'review_required' },
        { downstream: { type: 'knowledge_document', id: resultId }, upstream: { type: 'knowledge_document', id: planId }, relation: 'executes', impact_policy: 'rerun_required' },
        { downstream: { type: 'knowledge_document', id: ideaId }, upstream: { type: 'knowledge_document', id: resultId }, relation: 'informs', impact_policy: 'notify' },
      ])
      await database.query('UPDATE knowledge_documents SET current_sha256=$3 WHERE project_id=$1 AND document_id=$2', [projectId, ideaId, fingerprintValue('idea-v2')])
      const reconciled = await reconcileProjectLineage(projectId)
      expect(reconciled).toMatchObject({ stale_edges: 1, invalidated_edges: 3 })

      const reports = await listLineageImpactReports(projectId)
      expect(reports[0]?.summary).toMatchObject({ impact_items: 3, cycle_count: 1, truncated: false })
      expect(reports[0]?.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ node_id: planId, policy: 'review_required', status: 'open' }),
        expect.objectContaining({ node_id: resultId, policy: 'rerun_required', status: 'open' }),
        expect.objectContaining({ node_id: ideaId, policy: 'notify', status: 'open' }),
      ]))
      expect((await database.query<{ system_health: string }>('SELECT system_health FROM knowledge_documents WHERE project_id=$1 AND document_id=$2', [projectId, planId])).rows[0]?.system_health).toBe('stale')
      const resultImpact = reports[0]!.items.find(item => item.node_id === resultId)!
      const proposal = await createLineageImpactProposal(projectId, resultImpact.id, 'test-user')
      const repeated = await createLineageImpactProposal(projectId, resultImpact.id, 'test-user')
      expect(repeated.proposal_id).toBe(proposal.proposal_id)
      expect(await database.query('SELECT id FROM experiments WHERE project_id=$1', [projectId])).toMatchObject({ rows: [] })
    } finally {
      await database.query('DELETE FROM lineage_impact_items WHERE project_id=$1', [projectId])
      await database.query('DELETE FROM lineage_impact_reports WHERE project_id=$1', [projectId])
      await database.query('DELETE FROM lineage_dependencies WHERE project_id=$1', [projectId])
      await database.query('DELETE FROM proposals WHERE project_id=$1', [projectId])
      await database.query('DELETE FROM knowledge_documents WHERE project_id=$1', [projectId])
      await database.query('DELETE FROM audit_events WHERE project_id=$1', [projectId])
      await database.query('DELETE FROM projects WHERE id=$1', [projectId])
    }
  })

  it('keeps a completed experiment as historical fact when a rerun impact is raised', async () => {
    await migrate()
    const projectId = testProjectSlug('impact-history')
    const documentId = 'experiment:benchmark-protocol'
    const proposalId = crypto.randomUUID()
    const experimentId = crypto.randomUUID()
    try {
      await database.query('INSERT INTO projects(id,slug,title) VALUES ($1,$1,$2)', [projectId, 'Historical experiment impact test'])
      await insertKnowledgeDocument(projectId, documentId, 'benchmark_protocol', fingerprintValue('protocol-v1'))
      await database.query("INSERT INTO proposals(id,project_id,kind,reason,summary,status) VALUES ($1,$2,'experiment_plan','test reason','historical run','approved')", [proposalId, projectId])
      await database.query("INSERT INTO experiments(id,project_id,proposal_id,status,experiment_type,config,metrics,run_id) VALUES ($1,$2,$3,'succeeded','topic_specific',$4,$5,$6)", [experimentId, projectId, proposalId, {}, { accuracy: 0.91 }, experimentId])
      await registerLineageDependencies(projectId, [{ downstream: { type: 'experiment', id: experimentId }, upstream: { type: 'knowledge_document', id: documentId }, relation: 'follows_protocol', impact_policy: 'rerun_required' }])
      const result = await invalidateFromNodes(projectId, [{ type: 'knowledge_document', id: documentId }], 'protocol_changed', 'test')
      expect(result).toMatchObject({ invalidated_edges: 1, impact_items: 1 })
      expect((await database.query<{ status: string; metrics: Record<string, number> }>('SELECT status,metrics FROM experiments WHERE id=$1', [experimentId])).rows[0]).toMatchObject({ status: 'succeeded', metrics: { accuracy: 0.91 } })
    } finally {
      await database.query('DELETE FROM lineage_impact_items WHERE project_id=$1', [projectId])
      await database.query('DELETE FROM lineage_impact_reports WHERE project_id=$1', [projectId])
      await database.query('DELETE FROM lineage_dependencies WHERE project_id=$1', [projectId])
      await database.query('DELETE FROM experiments WHERE project_id=$1', [projectId])
      await database.query('DELETE FROM proposals WHERE project_id=$1', [projectId])
      await database.query('DELETE FROM knowledge_documents WHERE project_id=$1', [projectId])
      await database.query('DELETE FROM audit_events WHERE project_id=$1', [projectId])
      await database.query('DELETE FROM projects WHERE id=$1', [projectId])
    }
  })
})
