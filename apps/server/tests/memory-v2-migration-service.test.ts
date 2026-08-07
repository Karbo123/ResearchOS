import { existsSync, readFileSync, rmSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseKnowledgeMarkdown } from '../src/knowledge-markdown-parser.js'
import { applyApprovedKnowledgeDocumentPatch, proposedKnowledgeSource } from '../src/knowledge-document-proposal-service.js'
import { createMemoryV2MigrationProposals, memoryV2MigrationPreview } from '../src/memory-v2-migration-service.js'
import { database, migrate, one } from '../src/database.js'
import { pathInside } from '../src/paths.js'
import { createProjectWorkspace } from '../src/project-service.js'
import { projectRoot } from '../src/project-storage.js'
import { testProjectSlug } from './test-project.js'

const projectId = testProjectSlug('memory-migrate')
const ideaVersionId = crypto.randomUUID()
const paperId = crypto.randomUUID()
const evidenceId = crypto.randomUUID()
const experimentProposalId = crypto.randomUUID()
const experimentId = crypto.randomUUID()
const artifactId = crypto.randomUUID()
const ideaSpec = {
  schema_version: '1.0',
  idea: {
    title: 'Deterministic memory migration',
    research_question: 'Can controlled project records become reviewable Markdown without model guesses?',
    hypotheses: ['A deterministic draft preserves provenance.'],
  },
}

describe('Memory v2 controlled-source migration', () => {
  beforeAll(async () => {
    await migrate()
    await database.query('INSERT INTO projects(id,slug,title,current_idea_version) VALUES ($1,$1,$2,1)', [projectId, 'Deterministic memory migration'])
    await createProjectWorkspace(projectId, projectId, ideaSpec)
    await database.query('INSERT INTO idea_versions(id,project_id,version,spec,change_reason) VALUES ($1,$2,1,$3,$4)', [ideaVersionId, projectId, ideaSpec, 'migration fixture'])
    await database.query('INSERT INTO papers(id,project_id,title,doi,source_url,metadata,bibtex,verified,confirmed) VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,TRUE)', [paperId, projectId, 'Controlled Retrieval for Research Memory', '10.1000/memory-migration', 'https://example.org/paper', { provider: 'test-provider', year: 2026, abstract: 'This registered abstract describes controlled retrieval without claiming full-text verification.' }, '@article{controlled2026,title={Controlled Retrieval for Research Memory}}'])
    await database.query('INSERT INTO evidence(id,project_id,paper_id,claim,quote,locator,source_url) VALUES ($1,$2,$3,$4,$5,$6,$7)', [evidenceId, projectId, paperId, 'The paper records a bounded retrieval protocol.', 'The retrieval protocol is bounded by a project-scoped source manifest.', 'page 3, section 2', 'https://example.org/paper.pdf'])
    await database.query('INSERT INTO proposals(id,project_id,kind,reason,summary,payload,status) VALUES ($1,$2,$3,$4,$5,$6,\'approved\')', [experimentProposalId, projectId, 'experiment', 'fixture experiment', 'fixture experiment', {}])
    await database.query("INSERT INTO experiments(id,project_id,proposal_id,status,experiment_type,config,metrics,run_id,finished_at) VALUES ($1,$2,$3,'succeeded',$4,$5,$6,$7,NOW())", [experimentId, projectId, experimentProposalId, 'retrieval-ablation', { dataset: 'fixture-set', seed: 7 }, { accuracy: 0.91, latency_ms: 42 }, 'run-controlled-001'])
    await database.query('INSERT INTO artifacts(id,project_id,experiment_id,kind,name,relative_path,mime_type,sha256,valid) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE)', [artifactId, projectId, experimentId, 'metrics', 'metrics.json', `projects/${projectId}/artifacts/metrics.json`, 'application/json', 'a'.repeat(64)])
  }, 30_000)

  afterAll(async () => {
    await database.query('DELETE FROM tasks WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM lineage_impact_items WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM lineage_impact_reports WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM lineage_dependencies WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM knowledge_index_entries WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM knowledge_index_generations WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM knowledge_document_revisions WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM knowledge_documents WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM artifacts WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM experiments WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM proposals WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM evidence WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM papers WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM idea_versions WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM audit_events WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM projects WHERE id=$1', [projectId])
    rmSync(projectRoot(projectId), { recursive: true, force: true })
  })

  it('previews deterministic draft candidates without writing research documents', async () => {
    const preview = await memoryV2MigrationPreview(projectId)
    expect(preview.summary).toMatchObject({ total: 4, ready: 4, blocked: 0, idea: 1, papers: 1, experiment_plans: 1, run_results: 1 })
    expect(preview.candidates.every(candidate => candidate.proposed_sha256?.match(/^[a-f0-9]{64}$/))).toBe(true)
    expect(existsSync(pathInside(projectRoot(projectId), 'research', 'idea', 'current.md'))).toBe(false)
    expect(readFileSync(pathInside(projectRoot(projectId), 'idea.json'), 'utf8')).toBe(`${JSON.stringify(ideaSpec, null, 2)}\n`)
  })

  it('creates one idempotent Proposal at a time and preserves idea.json after approval', async () => {
    const before = readFileSync(pathInside(projectRoot(projectId), 'idea.json'), 'utf8')
    const created = await createMemoryV2MigrationProposals(projectId, ['idea:current'])
    const repeated = await createMemoryV2MigrationProposals(projectId, ['idea:current'])
    expect(repeated.proposals[0]).toEqual({ candidate_id: 'idea:current', proposal_id: created.proposals[0]?.proposal_id, idempotent: true })
    expect(existsSync(pathInside(projectRoot(projectId), 'research', 'idea', 'current.md'))).toBe(false)
    const proposal = await one<{ payload: Record<string, unknown> }>('SELECT payload FROM proposals WHERE id=$1', [created.proposals[0]?.proposal_id])
    const source = proposedKnowledgeSource(proposal!.payload)
    const parsed = parseKnowledgeMarkdown(source, projectId, 'research/idea/current.md')
    expect(parsed.frontmatter).toMatchObject({ id: 'idea:current', kind: 'idea', status: 'draft' })
    expect(source).toContain('no model completed or reinterpreted missing fields')

    await applyApprovedKnowledgeDocumentPatch(projectId, proposal!.payload, 'migration-test')
    expect(readFileSync(pathInside(projectRoot(projectId), 'idea.json'), 'utf8')).toBe(before)
    expect(existsSync(pathInside(projectRoot(projectId), 'research', 'idea', 'current.md'))).toBe(true)
    expect((await memoryV2MigrationPreview(projectId)).candidates.some(candidate => candidate.document_id === 'idea:current')).toBe(false)
  }, 15_000)

  it('binds Paper/Evidence and Experiment/Artifact candidates without inventing findings', async () => {
    const preview = await memoryV2MigrationPreview(projectId)
    const paper = preview.candidates.find(candidate => candidate.document_kind === 'paper_summary')!
    const run = preview.candidates.find(candidate => candidate.document_kind === 'run_result')!
    const paperProposal = await createMemoryV2MigrationProposals(projectId, [paper.candidate_id])
    const runProposal = await createMemoryV2MigrationProposals(projectId, [run.candidate_id])
    const paperRow = await one<{ payload: Record<string, unknown> }>('SELECT payload FROM proposals WHERE id=$1', [paperProposal.proposals[0]?.proposal_id])
    const runRow = await one<{ payload: Record<string, unknown> }>('SELECT payload FROM proposals WHERE id=$1', [runProposal.proposals[0]?.proposal_id])
    const paperSource = proposedKnowledgeSource(paperRow!.payload)
    const runSource = proposedKnowledgeSource(runRow!.payload)
    const parsedPaper = parseKnowledgeMarkdown(paperSource, projectId, paper.relative_path)
    const parsedRun = parseKnowledgeMarkdown(runSource, projectId, run.relative_path)
    expect(parsedPaper.frontmatter).toMatchObject({ status: 'draft', paper_id: paperId, evidence_ids: [evidenceId], read_scope: 'partial' })
    expect(parsedPaper.frontmatter.depends_on).toEqual(expect.arrayContaining([expect.objectContaining({ id: `evidence:${evidenceId}`, impact: 'evidence_blocked' })]))
    expect(paperSource).toContain('page 3, section 2')
    expect(parsedRun.frontmatter).toMatchObject({ status: 'draft', experiment_id: experimentId, artifact_ids: [artifactId] })
    expect(runSource).toContain('"accuracy": 0.91')
    expect(runSource).toContain('"latency_ms": 42')
    expect(runSource).toContain('No explanation of the result was generated during migration')
  }, 15_000)
})
