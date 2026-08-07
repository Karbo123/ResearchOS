import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { database, migrate, one } from '../src/database.js'
import { KnowledgeDocumentError, knowledgeFilesystemChanged, listKnowledgeDocuments, readKnowledgeDocument, reconcileKnowledgeDocuments } from '../src/knowledge-document-service.js'
import { app } from '../src/index.js'
import { pathInside } from '../src/paths.js'
import { createProjectWorkspace } from '../src/project-service.js'
import { projectRoot } from '../src/project-storage.js'
import { testProjectSlug } from './test-project.js'

const fixtureRoot = resolve(import.meta.dirname, 'fixtures/memory-v2')
const projectId = testProjectSlug('memory-registry')
const ideaPath = 'research/idea/current.md'
const originalFixtureProject = 'fixture-memory-1a2b'

function fixture(name: string): string {
  return readFileSync(resolve(fixtureRoot, name), 'utf8').replaceAll(originalFixtureProject, projectId)
}

function writeProjectFile(relativePath: string, content: string): void {
  const absolutePath = pathInside(projectRoot(projectId), ...relativePath.split('/'))
  mkdirSync(resolve(absolutePath, '..'), { recursive: true })
  writeFileSync(absolutePath, content, 'utf8')
}

describe('Memory v2 document registry', () => {
  beforeAll(async () => {
    await migrate()
    await database.query('INSERT INTO projects(id,slug,title) VALUES ($1,$1,$2)', [projectId, 'Memory registry test'])
    await createProjectWorkspace(projectId, projectId, {})
    writeProjectFile(ideaPath, fixture('idea-current.zh-CN.md'))
  })

  afterAll(async () => {
    await database.query('DELETE FROM lineage_impact_items WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM lineage_impact_reports WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM lineage_dependencies WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM knowledge_index_entries WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM knowledge_index_generations WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM knowledge_document_revisions WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM knowledge_documents WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM audit_events WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM projects WHERE id=$1', [projectId])
    rmSync(projectRoot(projectId), { recursive: true, force: true })
  })

  it('registers a document revision without storing the Markdown body in SQL', async () => {
    const result = await reconcileKnowledgeDocuments(projectId, 'test')
    expect(result.documents).toHaveLength(1)
    expect(result.documents[0]).toMatchObject({ changed: true, renamed: false, row: { document_id: 'idea:current', relative_path: ideaPath, system_health: 'index_stale' } })
    const revision = await one<{ frontmatter: Record<string, unknown> }>(
      'SELECT frontmatter FROM knowledge_document_revisions WHERE project_id=$1 AND document_id=$2',
      [projectId, 'idea:current'],
    )
    expect(revision?.frontmatter).toMatchObject({ id: 'idea:current', kind: 'idea' })
    const revisionCount = await one<{ count: number }>('SELECT COUNT(*)::integer AS count FROM knowledge_document_revisions WHERE project_id=$1 AND document_id=$2', [projectId, 'idea:current'])
    expect(revisionCount?.count).toBe(1)
    const columns = await database.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name='knowledge_document_revisions'")
    expect(columns.rows.map(row => row.column_name)).not.toContain('content')
  })

  it('is idempotent for an unchanged hash', async () => {
    const result = await reconcileKnowledgeDocuments(projectId, 'test')
    expect(result.documents[0]?.changed).toBe(false)
    const count = await one<{ count: number }>('SELECT COUNT(*)::integer AS count FROM knowledge_document_revisions WHERE project_id=$1 AND document_id=$2', [projectId, 'idea:current'])
    expect(count?.count).toBe(1)
  })

  it('uses mtime and size as a fast poll signal and exposes project-scoped APIs', async () => {
    const registered = await listKnowledgeDocuments(projectId, true)
    expect(knowledgeFilesystemChanged(projectId, registered)).toBe(false)
    const source = readFileSync(pathInside(projectRoot(projectId), ...ideaPath.split('/')), 'utf8')
    writeProjectFile(ideaPath, `${source}\n<!-- poll change -->\n`)
    expect(knowledgeFilesystemChanged(projectId, registered)).toBe(true)
    await reconcileKnowledgeDocuments(projectId, 'poller')
    expect(knowledgeFilesystemChanged(projectId, await listKnowledgeDocuments(projectId, true))).toBe(false)

    const listResponse = await app.request(`/api/projects/${projectId}/knowledge/documents`)
    expect(listResponse.status).toBe(200)
    await expect(listResponse.json()).resolves.toMatchObject({ project_id: projectId, documents: [expect.objectContaining({ document_id: 'idea:current' })] })
    const readResponse = await app.request(`/api/projects/${projectId}/knowledge/documents/${encodeURIComponent('idea:current')}`)
    expect(readResponse.status).toBe(200)
    await expect(readResponse.json()).resolves.toMatchObject({ row: { project_id: projectId, document_id: 'idea:current' }, source: expect.stringContaining('Core hypothesis') })
  })

  it('keeps document identity and revision history across a file rename', async () => {
    const decisionPath = 'research/idea/decisions/sampling-policy.md'
    const decisionSource = fixture('idea-current.zh-CN.md')
      .replace('id: idea:current', 'id: decision:sampling-policy')
      .replace('kind: idea', 'kind: decision')
      .replace('title: 稀疏点云主动学习方案', 'title: Sampling policy decision')
    writeProjectFile('research/idea/decisions/original-name.md', decisionSource)
    await reconcileKnowledgeDocuments(projectId, 'test')
    renameSync(
      pathInside(projectRoot(projectId), 'research', 'idea', 'decisions', 'original-name.md'),
      pathInside(projectRoot(projectId), ...decisionPath.split('/')),
    )
    const result = await reconcileKnowledgeDocuments(projectId, 'test')
    const renamed = result.documents.find(item => item.row.document_id === 'decision:sampling-policy')
    expect(renamed).toMatchObject({ changed: false, renamed: true, row: { relative_path: decisionPath } })
    const count = await one<{ count: number }>('SELECT COUNT(*)::integer AS count FROM knowledge_document_revisions WHERE project_id=$1 AND document_id=$2', [projectId, 'decision:sampling-policy'])
    expect(count?.count).toBe(1)
  })

  it('rejects duplicate IDs before mutating the registry', async () => {
    const duplicatePath = pathInside(projectRoot(projectId), 'research', 'idea', 'decisions', 'duplicate.md')
    writeFileSync(duplicatePath, fixture('idea-current.zh-CN.md').replace('kind: idea', 'kind: decision'), 'utf8')
    await expect(reconcileKnowledgeDocuments(projectId, 'test')).rejects.toMatchObject({ code: 'knowledge_document_id_duplicate' })
    unlinkSync(duplicatePath)
  })

  it('rejects symlinks and never follows them during discovery', async () => {
    const target = pathInside(projectRoot(projectId), ...ideaPath.split('/'))
    const link = pathInside(projectRoot(projectId), 'research', 'idea', 'decisions', 'linked.md')
    symlinkSync(target, link)
    await expect(reconcileKnowledgeDocuments(projectId, 'test')).rejects.toEqual(expect.objectContaining<Partial<KnowledgeDocumentError>>({ code: 'knowledge_symlink_rejected' }))
    unlinkSync(link)
  })

  it('marks disappeared documents blocked and excludes them from default reads', async () => {
    const decisionPath = pathInside(projectRoot(projectId), 'research', 'idea', 'decisions', 'sampling-policy.md')
    unlinkSync(decisionPath)
    const result = await reconcileKnowledgeDocuments(projectId, 'test')
    expect(result.missing_document_ids).toContain('decision:sampling-policy')
    expect(await listKnowledgeDocuments(projectId)).toHaveLength(1)
    const all = await listKnowledgeDocuments(projectId, true)
    expect(all.find(row => row.document_id === 'decision:sampling-policy')).toMatchObject({ present: false, system_health: 'blocked' })
  })

  it('detects an external edit before returning stale registered content', async () => {
    const before = await readKnowledgeDocument(projectId, 'idea:current')
    expect(before.source).toContain('Core hypothesis')
    const absolutePath = pathInside(projectRoot(projectId), ...ideaPath.split('/'))
    writeFileSync(absolutePath, before.source.replace('## Open questions', '## Revised open questions'), 'utf8')
    await expect(readKnowledgeDocument(projectId, 'idea:current')).rejects.toMatchObject({ code: 'knowledge_document_reconcile_required' })
    const reconciled = await reconcileKnowledgeDocuments(projectId, 'poller')
    expect(reconciled.documents.find(item => item.row.document_id === 'idea:current')?.changed).toBe(true)
    expect((await readKnowledgeDocument(projectId, 'idea:current')).source).toContain('## Revised open questions')
  })

  it('syncs front matter dependencies into the authoritative lineage graph', async () => {
    const planPath = 'research/experiments/method/method-ablation/plan.md'
    writeProjectFile(planPath, fixture('experiment-plan.md'))
    await reconcileKnowledgeDocuments(projectId, 'test')
    const edge = await one<{ downstream_type: string; downstream_id: string; upstream_type: string; upstream_id: string; impact_policy: string }>(`SELECT downstream_type,downstream_id,upstream_type,upstream_id,impact_policy
      FROM lineage_dependencies WHERE project_id=$1 AND downstream_type='knowledge_document' AND downstream_id=$2 AND upstream_type='knowledge_document' AND upstream_id=$3`, [projectId, 'experiment:method-ablation/plan', 'idea:current'])
    expect(edge).toMatchObject({ downstream_type: 'knowledge_document', downstream_id: 'experiment:method-ablation/plan', upstream_type: 'knowledge_document', upstream_id: 'idea:current', impact_policy: 'review_required' })
    const plan = await one<{ metadata: Record<string, unknown> }>('SELECT metadata FROM knowledge_documents WHERE project_id=$1 AND document_id=$2', [projectId, 'experiment:method-ablation/plan'])
    expect(plan?.metadata.unresolved_dependencies).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'experiment:benchmark-protocol', impact: 'rerun_required' })]))
    unlinkSync(pathInside(projectRoot(projectId), ...planPath.split('/')))
    await reconcileKnowledgeDocuments(projectId, 'test')
    expect(await one('SELECT id FROM lineage_dependencies WHERE project_id=$1 AND downstream_type=$2 AND downstream_id=$3', [projectId, 'knowledge_document', 'experiment:method-ablation/plan'])).toBeNull()
  })

  it('records the Memory v2 schema migration and initializes a tracked research root', async () => {
    const marker = await one<{ version: string }>('SELECT version FROM schema_migrations WHERE version=$1', ['0019-memory-v2'])
    expect(marker?.version).toBe('0019-memory-v2')
    expect(existsSync(pathInside(projectRoot(projectId), 'research', '.gitkeep'))).toBe(true)
  })
})
