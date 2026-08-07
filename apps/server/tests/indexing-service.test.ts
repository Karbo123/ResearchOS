import { readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Supermemory } from 'supermemory'
import { database, migrate, one, rows } from '../src/database.js'
import { activeKnowledgeIndexEntries, executeKnowledgeIndexRebuild, IndexingError, indexKnowledgeDocument, knowledgeIndexRebuildPlan, queueKnowledgeReindex, resetKnowledgeIndexForEmbeddingChange, searchActiveKnowledge } from '../src/indexing-service.js'
import { reconcileKnowledgeDocuments } from '../src/knowledge-document-service.js'
import { pathInside } from '../src/paths.js'
import { projectEmbeddingSettings, removeProjectEmbeddingSettings } from '../src/project-embedding-settings.js'
import { createProjectWorkspace } from '../src/project-service.js'
import { projectRoot } from '../src/project-storage.js'
import { projectContainerTag } from '../src/supermemory-service.js'
import { testProjectSlug } from './test-project.js'
import { app } from '../src/index.js'

const fixturePath = resolve(import.meta.dirname, 'fixtures/memory-v2/idea-current.zh-CN.md')
const sourceProjectId = 'fixture-memory-1a2b'
const projectId = testProjectSlug('memory-index')
const relativePath = 'research/idea/current.md'
const savedEnv = new Map<string, string | undefined>()

function fixture(): string {
  return readFileSync(fixturePath, 'utf8').replaceAll(sourceProjectId, projectId)
}

function projectFile(): string {
  return pathInside(projectRoot(projectId), ...relativePath.split('/'))
}

describe('Memory v2 generation replacement', () => {
  let add: ReturnType<typeof vi.spyOn>
  let post: ReturnType<typeof vi.spyOn>
  let remove: ReturnType<typeof vi.spyOn>

  beforeAll(async () => {
    for (const key of ['SUPERMEMORY_ENABLED', 'SUPERMEMORY_API_KEY', 'SUPERMEMORY_BASE_URL']) savedEnv.set(key, process.env[key])
    process.env.SUPERMEMORY_ENABLED = 'true'
    process.env.SUPERMEMORY_API_KEY = 'test-only-memory-v2-key'
    process.env.SUPERMEMORY_BASE_URL = 'http://127.0.0.1:6767'
    await migrate()
    await database.query('INSERT INTO projects(id,slug,title) VALUES ($1,$1,$2)', [projectId, 'Memory index test'])
    await createProjectWorkspace(projectId, projectId, {})
    mkdirSync(resolve(projectFile(), '..'), { recursive: true })
    writeFileSync(projectFile(), fixture(), 'utf8')
    await reconcileKnowledgeDocuments(projectId, 'test')
    add = vi.spyOn(Supermemory.prototype, 'add').mockImplementation(async input => ({ id: `remote-${String(input.customId).slice(-12)}`, status: 'done' }) as never)
    post = vi.spyOn(Supermemory.prototype, 'post').mockResolvedValue({ total: 0, results: [] } as never)
    remove = vi.spyOn(Supermemory.prototype, 'delete').mockResolvedValue({ id: 'deleted', status: 'done' } as never)
  }, 60_000)

  afterAll(async () => {
    add?.mockRestore()
    post?.mockRestore()
    remove?.mockRestore()
    await database.query('DELETE FROM knowledge_index_entries WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM knowledge_index_generations WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM knowledge_document_revisions WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM knowledge_documents WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM memory_links WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM tasks WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM audit_events WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM projects WHERE id=$1', [projectId])
    removeProjectEmbeddingSettings(projectId)
    rmSync(projectRoot(projectId), { recursive: true, force: true })
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }, 60_000)

  it('does not create a generation when Supermemory is unavailable', async () => {
    const apiKey = process.env.SUPERMEMORY_API_KEY
    process.env.SUPERMEMORY_ENABLED = 'false'
    delete process.env.SUPERMEMORY_API_KEY
    try {
      await expect(indexKnowledgeDocument(projectId, 'idea:current')).rejects.toMatchObject<Partial<IndexingError>>({ code: 'supermemory_not_configured', status: 503 })
      expect(await one<{ count: number }>('SELECT COUNT(*)::integer AS count FROM knowledge_index_generations WHERE project_id=$1', [projectId])).toEqual({ count: 0 })
      expect(await one<{ count: number }>('SELECT COUNT(*)::integer AS count FROM memory_links WHERE project_id=$1', [projectId])).toEqual({ count: 0 })
    } finally {
      process.env.SUPERMEMORY_ENABLED = 'true'
      if (apiKey === undefined) delete process.env.SUPERMEMORY_API_KEY
      else process.env.SUPERMEMORY_API_KEY = apiKey
    }
  })

  it('activates a complete generation and is idempotent for the same document hash', async () => {
    const first = await indexKnowledgeDocument(projectId, 'idea:current')
    expect(first.idempotent).toBe(false)
    expect(first.generation.status).toBe('active')
    expect(first.generation.chunk_count).toBeGreaterThan(0)
    expect(await activeKnowledgeIndexEntries(projectId)).toHaveLength(first.generation.chunk_count)
    const addCount = add.mock.calls.length
    const retry = await indexKnowledgeDocument(projectId, 'idea:current')
    expect(retry.idempotent).toBe(true)
    expect(add.mock.calls.length).toBe(addCount)
    const document = await one<{ system_health: string; active_index_generation: string }>('SELECT system_health,active_index_generation FROM knowledge_documents WHERE project_id=$1 AND document_id=$2', [projectId, 'idea:current'])
    expect(document).toMatchObject({ system_health: 'current', active_index_generation: first.generation.id })
  })

  it('keeps a partially ingested generation out of the active allowlist and can retry it', async () => {
    const source = readFileSync(projectFile(), 'utf8')
    const additionalSection = `## Partial ingestion section\n\n${'controlled-token '.repeat(500)}`
    writeFileSync(projectFile(), `${source}\n\n${additionalSection}\n`, 'utf8')
    await reconcileKnowledgeDocuments(projectId, 'poller')
    add.mockReset()
    add.mockImplementation(async input => ({ id: `remote-${String(input.customId).slice(-12)}`, status: 'done' }) as never)
    add
      .mockResolvedValueOnce({ id: 'remote-partial-first', status: 'done' } as never)
      .mockRejectedValueOnce(new Error('simulated partial chunk failure'))

    await expect(indexKnowledgeDocument(projectId, 'idea:current')).rejects.toThrow('simulated partial chunk failure')
    const failed = await one<{ id: string; status: string; failure_code: string }>("SELECT id,status,failure_code FROM knowledge_index_generations WHERE project_id=$1 AND document_id=$2 AND status='failed' ORDER BY created_at DESC LIMIT 1", [projectId, 'idea:current'])
    expect(failed).toMatchObject({ status: 'failed', failure_code: 'simulated partial chunk failure' })
    expect((await activeKnowledgeIndexEntries(projectId)).some(entry => entry.generation_id === failed?.id)).toBe(false)
    expect(await one<{ active_index_generation: string | null; system_health: string }>('SELECT active_index_generation,system_health FROM knowledge_documents WHERE project_id=$1 AND document_id=$2', [projectId, 'idea:current'])).toEqual({ active_index_generation: null, system_health: 'index_failed' })
    expect(await one<{ count: number }>("SELECT COUNT(*)::integer AS count FROM knowledge_index_entries WHERE generation_id=$1 AND status='active'", [failed?.id])).toMatchObject({ count: 1 })

    const recovered = await indexKnowledgeDocument(projectId, 'idea:current')
    expect(recovered.generation.id).toBe(failed?.id)
    expect(recovered.generation.status).toBe('active')
    expect((await activeKnowledgeIndexEntries(projectId)).every(entry => entry.generation_id === recovered.generation.id)).toBe(true)
  })

  it('does not expose superseded chunks after a document edit', async () => {
    const previous = await one<{ active_index_generation: string }>('SELECT active_index_generation FROM knowledge_documents WHERE project_id=$1 AND document_id=$2', [projectId, 'idea:current'])
    const oldGeneration = previous!.active_index_generation
    const source = readFileSync(projectFile(), 'utf8')
    writeFileSync(projectFile(), `${source}\n\n## Revision\n\nThis text creates a new immutable document generation.\n`, 'utf8')
    await reconcileKnowledgeDocuments(projectId, 'poller')
    const result = await indexKnowledgeDocument(projectId, 'idea:current')
    expect(result.generation.id).not.toBe(oldGeneration)
    const statuses = await rows<{ id: string; status: string }>('SELECT id,status FROM knowledge_index_generations WHERE project_id=$1 AND document_id=$2 ORDER BY created_at', [projectId, 'idea:current'])
    expect(statuses.filter(row => row.status === 'active')).toEqual([expect.objectContaining({ id: result.generation.id })])
    expect(statuses.find(row => row.id === oldGeneration)?.status).toBe('superseded')
    const oldEntries = await rows<{ status: string }>('SELECT status FROM knowledge_index_entries WHERE generation_id=$1', [oldGeneration])
    expect(oldEntries.every(entry => entry.status === 'remote_deleted')).toBe(true)
    expect(await activeKnowledgeIndexEntries(projectId)).toEqual(expect.arrayContaining([expect.objectContaining({ generation_id: result.generation.id })]))
    const deletedLinks = await one<{ count: number }>("SELECT COUNT(*)::integer AS count FROM memory_links WHERE project_id=$1 AND status='deleted'", [projectId])
    expect(deletedLinks?.count).toBeGreaterThan(0)
  })

  it('keeps the new generation active when remote cleanup fails', async () => {
    remove.mockReset()
    remove.mockResolvedValue({ id: 'deleted', status: 'done' } as never)
    remove.mockRejectedValueOnce(new Error('remote delete unavailable'))
    const source = readFileSync(projectFile(), 'utf8')
    writeFileSync(projectFile(), `${source}\n\n## Another revision\n\nA second generation tests delete failure visibility.\n`, 'utf8')
    await reconcileKnowledgeDocuments(projectId, 'poller')
    const result = await indexKnowledgeDocument(projectId, 'idea:current')
    expect(result.retired.delete_failed).toBeGreaterThan(0)
    const failed = await one<{ status: string; last_error: string }>("SELECT e.status,e.last_error FROM knowledge_index_entries e JOIN knowledge_index_generations g ON g.id=e.generation_id WHERE g.status='superseded' AND e.status='delete_failed' LIMIT 1", [])
    expect(failed).toMatchObject({ status: 'delete_failed', last_error: 'remote delete unavailable' })
    expect((await activeKnowledgeIndexEntries(projectId)).every(entry => entry.generation_id === result.generation.id)).toBe(true)
  })

  it('filters remote search results through the local active allowlist', async () => {
    const entries = await activeKnowledgeIndexEntries(projectId)
    const active = entries[0]!
    post.mockResolvedValueOnce({ total: 2, results: [
      { id: active.remote_document_id, memory: 'new content', metadata: { knowledge_index_generation: active.generation_id, knowledge_chunk_key: active.chunk_key } },
      { id: 'stale-remote-id', memory: 'old content', metadata: { knowledge_index_generation: 'old-generation', knowledge_chunk_key: 'old-chunk' } },
    ] } as never)
    const result = await searchActiveKnowledge(projectId, 'geometry', 8)
    expect(result.results).toHaveLength(1)
    expect(result.results[0]).toMatchObject({ memory: 'new content', active_generation_verified: true })
    expect(result.filtered_stale_results).toBe(1)
  })

  it('enforces one active generation per project document at the database boundary', async () => {
    await expect(database.query(
      `INSERT INTO knowledge_index_generations(id,project_id,document_id,document_sha256,status,adapter,embedding_fingerprint,chunk_count)
       VALUES ($1,$2,$3,$4,'active',$5,$6,1)`,
      [crypto.randomUUID(), projectId, 'idea:current', 'b'.repeat(64), 'constraint-test@1', 'c'.repeat(64)],
    )).rejects.toThrow()
    const active = await one<{ count: number }>("SELECT COUNT(*)::integer AS count FROM knowledge_index_generations WHERE project_id=$1 AND document_id=$2 AND status='active'", [projectId, 'idea:current'])
    expect(active).toMatchObject({ count: 1 })
  })

  it('builds a read-only blocked plan while a generation is in progress', async () => {
    const pendingId = crypto.randomUUID()
    await database.query(
      `INSERT INTO knowledge_index_generations(id,project_id,document_id,document_sha256,status,adapter,embedding_fingerprint,chunk_count)
       VALUES ($1,$2,$3,$4,'pending',$5,$6,0)`,
      [pendingId, projectId, 'idea:current', 'd'.repeat(64), 'pending-test@1', 'e'.repeat(64)],
    )
    const tasksBefore = await one<{ count: number }>('SELECT COUNT(*)::integer AS count FROM tasks WHERE project_id=$1', [projectId])
    const plan = await knowledgeIndexRebuildPlan(projectId)
    expect(plan.status).toBe('blocked')
    expect(plan.conflicts).toContainEqual(expect.objectContaining({ code: 'generation_in_progress', document_id: 'idea:current', generation_ids: [pendingId] }))
    await expect(executeKnowledgeIndexRebuild(projectId, plan.plan_hash)).rejects.toMatchObject<Partial<IndexingError>>({ code: 'knowledge_rebuild_conflict', status: 409 })
    expect(await one<{ status: string }>('SELECT status FROM knowledge_index_generations WHERE id=$1', [pendingId])).toMatchObject({ status: 'pending' })
    expect(await one<{ count: number }>('SELECT COUNT(*)::integer AS count FROM tasks WHERE project_id=$1', [projectId])).toEqual(tasksBefore)
    await database.query('DELETE FROM knowledge_index_generations WHERE id=$1', [pendingId])
  })

  it('blocks a rebuild that references another project memory link without deleting or queuing', async () => {
    const otherProjectId = testProjectSlug('memory-foreign')
    const foreignLinkId = crypto.randomUUID()
    const entry = (await activeKnowledgeIndexEntries(projectId))[0]!
    const originalLinkId = entry.memory_link_id
    await database.query('INSERT INTO projects(id,slug,title) VALUES ($1,$1,$2)', [otherProjectId, 'Foreign memory index test'])
    await database.query(
      `INSERT INTO memory_links(id,project_id,source_type,source_key,content_sha256,custom_id,supermemory_id,container_tag,task_type,status,metadata)
       VALUES ($1,$2,'knowledge_document_chunk',$3,$4,$5,$6,$7,'superrag','active',$8)`,
      [foreignLinkId, otherProjectId, `foreign:${foreignLinkId}`, 'f'.repeat(64), `foreign-${foreignLinkId}`, `remote-foreign-${foreignLinkId}`, projectContainerTag(otherProjectId), { project_id: otherProjectId }],
    )
    await database.query('UPDATE knowledge_index_entries SET memory_link_id=$2 WHERE id=$1', [entry.id, foreignLinkId])
    const deleteCalls = remove.mock.calls.length
    const tasksBefore = await one<{ count: number }>('SELECT COUNT(*)::integer AS count FROM tasks WHERE project_id=$1', [projectId])
    try {
      const plan = await knowledgeIndexRebuildPlan(projectId)
      expect(plan.status).toBe('blocked')
      expect(plan.conflicts).toContainEqual(expect.objectContaining({ code: 'cross_project_memory_link', memory_link_id: foreignLinkId, entry_ids: [entry.id] }))
      await expect(executeKnowledgeIndexRebuild(projectId, plan.plan_hash)).rejects.toMatchObject<Partial<IndexingError>>({ code: 'knowledge_rebuild_conflict', status: 409 })
      expect(remove.mock.calls.length).toBe(deleteCalls)
      expect(await one<{ status: string }>('SELECT status FROM memory_links WHERE id=$1 AND project_id=$2', [foreignLinkId, otherProjectId])).toEqual({ status: 'active' })
      expect(await one<{ count: number }>('SELECT COUNT(*)::integer AS count FROM tasks WHERE project_id=$1', [projectId])).toEqual(tasksBefore)
    } finally {
      await database.query('UPDATE knowledge_index_entries SET memory_link_id=$2 WHERE id=$1', [entry.id, originalLinkId])
      await database.query('DELETE FROM memory_links WHERE id=$1 AND project_id=$2', [foreignLinkId, otherProjectId])
      await database.query('DELETE FROM projects WHERE id=$1', [otherProjectId])
    }
  })

  it('does not queue a rebuild when remote deletion fails, then completes on explicit retry', async () => {
    const orphanLinkId = crypto.randomUUID()
    await database.query(
      `INSERT INTO memory_links(id,project_id,source_type,source_id,source_key,content_sha256,custom_id,supermemory_id,container_tag,task_type,status,metadata)
       VALUES ($1,$2,'knowledge_document_chunk',NULL,$3,$4,$5,$6,$7,'superrag','active',$8)`,
      [orphanLinkId, projectId, 'orphan:legacy:chunk', 'f'.repeat(64), `orphan-${orphanLinkId}`, `remote-orphan-${orphanLinkId}`, `research-os-project-${projectId}`, { project_id: projectId, knowledge_document_id: 'idea:current' }],
    )
    const tasksBefore = await one<{ count: number }>('SELECT COUNT(*)::integer AS count FROM tasks WHERE project_id=$1', [projectId])
    const plan = await knowledgeIndexRebuildPlan(projectId)
    expect(plan.status).toBe('ready')
    expect(plan.cleanup.orphan_memory_link_ids).toContain(orphanLinkId)
    expect(plan.reindex).toEqual([])
    remove.mockReset()
    remove.mockRejectedValue(new Error('simulated rebuild delete failure'))
    await expect(executeKnowledgeIndexRebuild(projectId, plan.plan_hash)).rejects.toMatchObject<Partial<IndexingError>>({ code: 'knowledge_rebuild_cleanup_failed', status: 503 })
    expect(await one<{ status: string }>('SELECT status FROM memory_links WHERE id=$1', [orphanLinkId])).toMatchObject({ status: 'active' })
    expect(await one<{ count: number }>('SELECT COUNT(*)::integer AS count FROM tasks WHERE project_id=$1', [projectId])).toEqual(tasksBefore)

    remove.mockReset()
    remove.mockResolvedValue({ id: 'deleted', status: 'done' } as never)
    const retryPlan = await knowledgeIndexRebuildPlan(projectId)
    const result = await executeKnowledgeIndexRebuild(projectId, retryPlan.plan_hash)
    expect(result).toMatchObject({ status: 'completed', queued: 0, document_ids: [] })
    expect(result.remote_deleted).toBeGreaterThan(0)
    expect(await one<{ status: string }>('SELECT status FROM memory_links WHERE id=$1', [orphanLinkId])).toMatchObject({ status: 'deleted' })
    expect(await one<{ count: number }>('SELECT COUNT(*)::integer AS count FROM tasks WHERE project_id=$1', [projectId])).toEqual(tasksBefore)
    expect((await knowledgeIndexRebuildPlan(projectId)).status).toBe('clean')
  })

  it('does not switch embedding settings or queue work until old remote entries are fully deleted', async () => {
    const previousSettings = projectEmbeddingSettings(projectId)
    const tasksBefore = await one<{ count: number }>('SELECT COUNT(*)::integer AS count FROM tasks WHERE project_id=$1', [projectId])
    const requestBody = {
      mode: 'custom', provider: 'local', model: 'Xenova/bge-m3-failure-test', dimensions: 1024,
      base_url: '', key: '', use_proxy: false, reset_data: true,
    }
    remove.mockReset()
    remove.mockResolvedValue({ id: 'deleted', status: 'done' } as never)
    remove.mockRejectedValueOnce(new Error('simulated embedding cleanup failure'))
    const failedResponse = await app.request(`/api/projects/${projectId}/embedding-settings`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(requestBody),
    })
    expect(failedResponse.status).toBe(503)
    await expect(failedResponse.json()).resolves.toMatchObject({ code: 'embedding_reindex_cleanup_failed' })
    expect(projectEmbeddingSettings(projectId)).toEqual(previousSettings)
    expect(await one<{ count: number }>('SELECT COUNT(*)::integer AS count FROM tasks WHERE project_id=$1', [projectId])).toEqual(tasksBefore)
    expect(await activeKnowledgeIndexEntries(projectId)).toHaveLength(0)
    const document = await one<{ system_health: string; active_index_generation: string | null }>('SELECT system_health,active_index_generation FROM knowledge_documents WHERE project_id=$1 AND document_id=$2', [projectId, 'idea:current'])
    expect(document).toMatchObject({ system_health: 'index_stale', active_index_generation: null })

    const retryResponse = await app.request(`/api/projects/${projectId}/embedding-settings`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(requestBody),
    })
    expect(retryResponse.status).toBe(200)
    const retryBody = await retryResponse.json() as { mode: string; model: string; embedding_reset: { delete_failed: number }; knowledge_reindex: { queued: number; document_ids: string[] } }
    expect(retryBody).toMatchObject({ mode: 'custom', model: requestBody.model, embedding_reset: { delete_failed: 0 } })
    expect(retryBody.knowledge_reindex.document_ids).toContain('idea:current')
    expect(retryBody.knowledge_reindex.queued).toBeGreaterThan(0)
    expect(projectEmbeddingSettings(projectId).model).toBe(requestBody.model)
    expect(await one<{ count: number }>("SELECT COUNT(*)::integer AS count FROM tasks WHERE project_id=$1 AND kind='knowledge_reindex'", [projectId])).toMatchObject({ count: retryBody.knowledge_reindex.queued })
    await database.query("UPDATE tasks SET status='succeeded' WHERE project_id=$1 AND kind='knowledge_reindex'", [projectId])
    const repeated = await queueKnowledgeReindex(projectId)
    expect(repeated.queued).toBe(retryBody.knowledge_reindex.queued)
    expect(await one<{ count: number }>("SELECT COUNT(*)::integer AS count FROM tasks WHERE project_id=$1 AND kind='knowledge_reindex' AND status='queued'", [projectId])).toMatchObject({ count: retryBody.knowledge_reindex.queued })
  })
})
