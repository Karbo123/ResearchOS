import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { app } from '../src/index.js'
import { buildContextPacket, contextPacketPrompt } from '../src/context-planner.js'
import { database, migrate, one } from '../src/database.js'
import { reconcileKnowledgeDocuments } from '../src/knowledge-document-service.js'
import { pathInside } from '../src/paths.js'
import { createProjectWorkspace } from '../src/project-service.js'
import { projectRoot } from '../src/project-storage.js'
import { testProjectSlug } from './test-project.js'

const fixtureRoot = resolve(import.meta.dirname, 'fixtures/memory-v2')
const fixtureProject = 'fixture-memory-1a2b'
const projectId = testProjectSlug('memory-context')
const otherProjectId = testProjectSlug('memory-foreign')
const sessionId = crypto.randomUUID()
const proposalId = crypto.randomUUID()

function fixture(name: string): string {
  return readFileSync(resolve(fixtureRoot, name), 'utf8').replaceAll(fixtureProject, projectId)
}

function writeProjectFile(relativePath: string, content: string): void {
  const absolutePath = pathInside(projectRoot(projectId), ...relativePath.split('/'))
  mkdirSync(resolve(absolutePath, '..'), { recursive: true })
  writeFileSync(absolutePath, content, 'utf8')
}

const emptySemanticSearch = async (scopedProjectId: string, query: string) => ({
  project_id: scopedProjectId,
  query,
  results: [] as Array<Record<string, unknown>>,
  filtered_stale_results: 0,
})

describe('Memory v2 context planner', () => {
  beforeAll(async () => {
    await migrate()
    await database.query('INSERT INTO projects(id,slug,title) VALUES ($1,$1,$2),($3,$3,$4)', [projectId, 'Context planner test', otherProjectId, 'Foreign context project'])
    await createProjectWorkspace(projectId, projectId, {})
    writeProjectFile('research/idea/current.md', fixture('idea-current.zh-CN.md'))
    writeProjectFile('research/related-work/papers/geometric-sampling.md', fixture('paper-summary.en.md'))
    writeProjectFile('research/writing/section-briefs/introduction.md', `---
schema: researchos/knowledge-document@1
project_id: ${projectId}
id: writing:introduction
kind: writing_brief
title: Introduction writing brief
status: confirmed
depends_on: []
workspace_scopes:
  - paper:introduction
artifact_ids: []
evidence_ids: []
---

# Introduction writing brief

## Confirmed scope

Use confirmedneedle only and preserve evidence boundaries.
`)
    writeProjectFile('research/related-work/papers/confirmed-introduction.md', fixture('paper-summary.en.md')
      .replace('id: paper:geometric-sampling-2024', 'id: paper:confirmed-introduction')
      .replace('title: Geometry-aware Sampling for Point Clouds', 'title: Confirmed introduction source')
      .replace('status: draft', 'status: confirmed')
      .replace('  - related-work:literature\n  - paper:related-work', '  - paper:introduction')
      .replace('encoder pretraining', 'confirmedneedle encoder pretraining'))
    writeProjectFile('research/related-work/papers/draft-introduction.md', fixture('paper-summary.en.md')
      .replace('id: paper:geometric-sampling-2024', 'id: paper:draft-introduction')
      .replace('title: Geometry-aware Sampling for Point Clouds', 'title: Draft introduction source')
      .replace('  - related-work:literature\n  - paper:related-work', '  - paper:introduction')
      .replace('encoder pretraining', 'draftneedle encoder pretraining'))
    const longBody = Array.from({ length: 32 }, (_, index) => `## Budget section ${index + 1}\n\nbudgettoken ${'controlled context evidence '.repeat(220)}`).join('\n\n')
    writeProjectFile('research/related-work/papers/long-budget.md', fixture('paper-summary.en.md')
      .replace('id: paper:geometric-sampling-2024', 'id: paper:long-budget')
      .replace('title: Geometry-aware Sampling for Point Clouds', 'title: Long context budget fixture')
      .replace(/# Geometry-aware Sampling for Point Clouds[\s\S]*$/, `# Long context budget fixture\n\n${longBody}\n`))
    await reconcileKnowledgeDocuments(projectId, 'test')
    await database.query('INSERT INTO conversation_sessions(id,project_id,phase,draft,scope) VALUES ($1,$2,$3,$4,$5)', [sessionId, projectId, 'supervising', {}, 'overview/idea'])
    await database.query('INSERT INTO messages(id,session_id,role,content,metadata) VALUES ($1,$2,$3,$4,$5)', [crypto.randomUUID(), sessionId, 'user', 'Earlier scoped discussion', {}])
    await database.query('INSERT INTO proposals(id,project_id,kind,status,reason,summary,payload) VALUES ($1,$2,$3,$4,$5,$6,$7)', [proposalId, projectId, 'idea_revision', 'pending', 'Review the sampling assumption', 'Approve the revised sampling assumption', {}])
  })

  afterAll(async () => {
    await database.query('DELETE FROM context_manifests WHERE project_id=ANY($1::varchar[])', [[projectId, otherProjectId]])
    await database.query('DELETE FROM messages WHERE session_id=$1', [sessionId])
    await database.query('DELETE FROM conversation_sessions WHERE id=$1', [sessionId])
    await database.query('DELETE FROM proposals WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM knowledge_index_entries WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM knowledge_index_generations WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM knowledge_document_revisions WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM knowledge_documents WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM audit_events WHERE project_id=ANY($1::varchar[])', [[projectId, otherProjectId]])
    await database.query('DELETE FROM projects WHERE id=ANY($1::varchar[])', [[projectId, otherProjectId]])
    rmSync(projectRoot(projectId), { recursive: true, force: true })
  })

  it('reads required documents directly and persists a body-free provenance manifest', async () => {
    const packet = await buildContextPacket({ project_id: projectId, purpose: 'project_chat', workspace_area: 'overview', workspace_tab: 'idea', workspace_scope: 'overview/idea', query: 'How should we refine the plan?', session_id: sessionId }, { semanticSearch: emptySemanticSearch })
    expect(packet.status).toBe('complete')
    expect(packet.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'document', content: expect.stringContaining('Core hypothesis'), provenance: expect.objectContaining({ document_id: 'idea:current' }) }),
      expect.objectContaining({ kind: 'conversation', content: expect.stringContaining('Earlier scoped discussion') }),
      expect.objectContaining({ kind: 'decision', provenance: expect.objectContaining({ entity_id: proposalId, entity_type: 'proposal' }) }),
    ]))
    expect(packet.included_tokens).toBeLessThanOrEqual(packet.plan.token_budget - packet.plan.output_reserve)
    expect(contextPacketPrompt(packet)).toContain(`manifest_id="${packet.manifest_id}"`)

    const manifest = await one<Record<string, unknown>>('SELECT * FROM context_manifests WHERE id=$1 AND project_id=$2', [packet.manifest_id, projectId])
    expect(manifest).toMatchObject({ purpose: 'project_chat', workspace_scope: 'overview/idea', status: 'complete' })
    expect(JSON.stringify(manifest)).not.toContain('Core hypothesis')
    expect(JSON.stringify(manifest?.source_refs)).toContain('idea:current')
    expect(await one<{ version: string }>('SELECT version FROM schema_migrations WHERE version=$1', ['0020-memory-v2-context'])).toEqual({ version: '0020-memory-v2-context' })

    const response = await app.request(`/api/projects/${projectId}/context-manifests/${packet.manifest_id}`)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ id: packet.manifest_id, project_id: projectId })
    const crossProject = await app.request(`/api/projects/${otherProjectId}/context-manifests/${packet.manifest_id}`)
    expect(crossProject.status).toBe(404)
  })

  it('selects complete semantic sections for an over-budget document without truncating its tail', async () => {
    const packet = await buildContextPacket({ project_id: projectId, purpose: 'literature', workspace_area: 'related_work', workspace_tab: 'literature', workspace_scope: 'related_work/literature', query: 'budgettoken', requested_document_ids: ['paper:long-budget'], search_mode: 'bm25' })
    const blocks = packet.blocks.filter(block => block.provenance.document_id === 'paper:long-budget')
    expect(blocks.length).toBeGreaterThan(1)
    expect(blocks.every(block => block.kind === 'section')).toBe(true)
    expect(packet.excluded).toContainEqual(expect.objectContaining({ kind: 'document_section_selection', id: 'paper:long-budget' }))
    expect(packet.included_tokens).toBeLessThanOrEqual(packet.plan.token_budget - packet.plan.output_reserve)
  })

  it('uses project-scoped local keyword search when BM25 mode is explicit', async () => {
    const semanticSearch = vi.fn(emptySemanticSearch)
    const packet = await buildContextPacket({ project_id: projectId, purpose: 'literature', workspace_area: 'related_work', workspace_tab: 'literature', workspace_scope: 'related_work/literature', query: 'encoder pretraining', search_mode: 'bm25' }, { semanticSearch })
    expect(semanticSearch).not.toHaveBeenCalled()
    expect(packet.search).toMatchObject({ mode: 'bm25', attempted: true })
    expect(packet.search.local_result_count).toBeGreaterThan(0)
    expect(packet.blocks.some(block => block.provenance.document_id === 'paper:geometric-sampling-2024')).toBe(true)
  })

  it('rejects stale or cross-project semantic candidates before reading local content', async () => {
    const row = await one<{ current_sha256: string }>('SELECT current_sha256 FROM knowledge_documents WHERE project_id=$1 AND document_id=$2', [projectId, 'paper:geometric-sampling-2024'])
    const activeGeneration = crypto.randomUUID()
    await database.query('UPDATE knowledge_documents SET active_index_generation=$3 WHERE project_id=$1 AND document_id=$2', [projectId, 'paper:geometric-sampling-2024', activeGeneration])
    const packet = await buildContextPacket({ project_id: projectId, purpose: 'literature', workspace_area: 'related_work', workspace_tab: 'literature', workspace_scope: 'related_work/literature', query: 'semantic-only-needle', search_mode: 'semantic' }, { semanticSearch: async () => ({ project_id: projectId, query: 'semantic-only-needle', filtered_stale_results: 0, results: [{ id: 'stale-result', metadata: { project_id: otherProjectId, knowledge_document_id: 'paper:geometric-sampling-2024', knowledge_document_sha256: row!.current_sha256, knowledge_index_generation: 'stale-generation', knowledge_chunk_key: 'stale-chunk' } }] }) })
    expect(packet.blocks.some(block => block.provenance.document_id === 'paper:geometric-sampling-2024')).toBe(false)
    expect(packet.excluded).toContainEqual(expect.objectContaining({ kind: 'search_candidate_stale', id: 'paper:geometric-sampling-2024' }))
  })

  it('builds paper-section context from the requested writing brief and confirmed knowledge only', async () => {
    const packet = await buildContextPacket({ project_id: projectId, purpose: 'paper_section', workspace_area: 'paper', workspace_tab: 'introduction', workspace_scope: 'paper/introduction', query: 'confirmedneedle draftneedle', requested_document_ids: ['writing:introduction'], search_mode: 'bm25' })
    expect(packet.blocks.some(block => block.provenance.document_id === 'writing:introduction')).toBe(true)
    expect(packet.blocks.some(block => block.provenance.document_id === 'paper:confirmed-introduction')).toBe(true)
    expect(packet.blocks.some(block => block.provenance.document_id === 'paper:draft-introduction')).toBe(false)
    expect(packet.blocks.filter(block => block.provenance.document_id).every(block => block.provenance.author_status === 'confirmed')).toBe(true)
  })
})
