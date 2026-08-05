import { testProjectSlug } from './test-project.js'
import { createHash } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { projectArtifactPath } from '../src/project-storage.js'
import { database, migrate } from '../src/database.js'
import { assertCheckpointRecoverable, fingerprintValue, invalidateFromNodes, registerLineageDependencies, reconcileProjectLineage } from '../src/impact-service.js'

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
})
