import { createHash } from 'node:crypto'
import { audit, database, one, rows } from './database.js'
import { extractMaterialChunks, type MaterialFile } from './material-indexer.js'
import { readKnowledgeDocument } from './knowledge-document-service.js'
import { applyMemoryRevocation, embeddingProfile, ingestProjectMemory, projectContainerTag, searchProjectMemory, supermemoryEnabled } from './supermemory-service.js'
import { projectEmbeddingSettings } from './project-embedding-settings.js'
import { knowledgeDocumentHealthAfterIndex } from './impact-service.js'

export class IndexingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: 409 | 413 | 422 | 503 = 422,
    public readonly details: Record<string, unknown> | null = null,
  ) {
    super(message)
  }
}

type KnowledgeGeneration = {
  id: string
  project_id: string
  document_id: string
  document_sha256: string
  status: 'pending' | 'active' | 'superseded' | 'failed'
  adapter: string
  embedding_fingerprint: string
  chunk_count: number
  failure_code: string | null
}

export type KnowledgeIndexEntry = {
  id: string
  generation_id: string
  project_id: string
  document_id: string
  chunk_key: string
  ordinal: number
  heading_path: string[]
  line_start: number
  line_end: number
  token_count: number
  content_sha256: string
  remote_document_id: string | null
  memory_link_id: string | null
  task_type: 'superrag'
  status: string
}

type KnowledgeDocumentLedger = {
  document_id: string
  current_sha256: string
  active_index_generation: string | null
  present: boolean
}

type ChunkMemoryLink = {
  id: string
  project_id: string
  source_type: string
  source_key: string | null
  status: string
  container_tag: string
  metadata: Record<string, unknown>
}

export type KnowledgeIndexRebuildConflict = {
  code: 'multiple_active_generations' | 'generation_in_progress' | 'memory_ingestion_in_progress' | 'cross_project_memory_link' | 'memory_link_reused'
  document_id?: string
  generation_ids?: string[]
  memory_link_id?: string
  entry_ids?: string[]
}

export type KnowledgeIndexRebuildFinding = {
  code: 'obsolete_generation' | 'orphan_memory_link' | 'missing_active_generation'
  document_id?: string
  generation_id?: string
  memory_link_id?: string
}

export type KnowledgeIndexRebuildPlan = {
  project_id: string
  plan_hash: string
  status: 'clean' | 'ready' | 'blocked'
  summary: {
    documents: number
    valid_active_generations: number
    cleanup_generations: number
    cleanup_memory_links: number
    orphan_memory_links: number
    reindex_documents: number
    conflicts: number
  }
  conflicts: KnowledgeIndexRebuildConflict[]
  findings: KnowledgeIndexRebuildFinding[]
  cleanup: {
    generation_ids: string[]
    entry_ids: string[]
    memory_link_ids: string[]
    orphan_memory_link_ids: string[]
  }
  reindex: Array<{ document_id: string; document_sha256: string }>
}

const KNOWLEDGE_ADAPTER = 'researchos_ast_superrag@1'

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function embeddingFingerprint(projectId: string): string {
  const settings = projectEmbeddingSettings(projectId)
  const profile = embeddingProfile(projectId)
  return sha256(JSON.stringify({
    provider: profile.provider,
    model: profile.model,
    dimensions: profile.dimensions,
    base_url: profile.base_url,
    pool_key: settings.pool_key,
    key_sha256: settings.key ? sha256(settings.key) : null,
  }))
}

async function enqueueKnowledgeReindexTask(projectId: string, documentId: string, documentSha256: string): Promise<string | null> {
  const taskId = crypto.randomUUID()
  const fingerprint = embeddingFingerprint(projectId)
  const idempotencyKey = `knowledge-reindex:${projectId}:${documentId}:${documentSha256}:${fingerprint}`
  const result = await database.query<{ id: string }>(
    `INSERT INTO tasks(id,project_id,kind,payload,max_attempts,idempotency_key)
     VALUES ($1,$2,'knowledge_reindex',$3,5,$4)
     ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE SET
       status='queued',payload=EXCLUDED.payload,attempts=0,max_attempts=EXCLUDED.max_attempts,
       next_attempt_at=NOW(),leased_until=NULL,lease_token=NULL,error=NULL,worker_id=NULL,heartbeat_until=NULL,updated_at=NOW()
     WHERE tasks.status IN ('succeeded','failed','cancelled')
     RETURNING id`,
    [taskId, projectId, { document_id: documentId }, idempotencyKey],
  )
  return result.rows[0]?.id ?? null
}

function knowledgeLocator(headingPath: string[], lineStart: number, lineEnd: number): string {
  const heading = headingPath.length ? headingPath.join(' > ') : 'document'
  return `${heading} (lines ${lineStart}-${lineEnd})`
}

async function markGenerationFailed(projectId: string, documentId: string, generationId: string, documentSha: string, error: unknown): Promise<void> {
  const code = error instanceof IndexingError ? error.code : error instanceof Error ? error.message.slice(0, 120) : 'knowledge_index_failed'
  await database.transaction(async transaction => {
    await transaction.query("UPDATE knowledge_index_generations SET status='failed',failure_code=$2,completed_at=NOW() WHERE id=$1", [generationId, code])
    await transaction.query("UPDATE knowledge_index_entries SET status='failed',last_error=$2 WHERE generation_id=$1 AND status='pending'", [generationId, code])
    await transaction.query("UPDATE knowledge_documents SET system_health='index_failed',updated_at=NOW() WHERE project_id=$1 AND document_id=$2 AND current_sha256=$3", [projectId, documentId, documentSha])
  })
  await audit('knowledge.index_failed', projectId, { document_id: documentId, generation_id: generationId, document_sha256: documentSha, failure_code: code })
}

async function retireGenerationRemoteEntries(projectId: string, generationId: string): Promise<{ deleted: number; failed: number }> {
  const entries = await rows<KnowledgeIndexEntry>('SELECT * FROM knowledge_index_entries WHERE project_id=$1 AND generation_id=$2', [projectId, generationId])
  let deleted = 0
  let failed = 0
  for (const entry of entries) {
    if (!entry.memory_link_id) continue
    try {
      await applyMemoryRevocation(projectId, entry.memory_link_id, 'delete', 'memory-v2-indexer')
      await database.query("UPDATE knowledge_index_entries SET status='remote_deleted',deleted_at=NOW(),last_error=NULL WHERE id=$1", [entry.id])
      deleted += 1
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 200) : 'remote_delete_failed'
      await database.query("UPDATE knowledge_index_entries SET status='delete_failed',delete_attempts=delete_attempts+1,last_error=$2 WHERE id=$1", [entry.id, message])
      failed += 1
    }
  }
  return { deleted, failed }
}

export async function resetKnowledgeIndexForEmbeddingChange(projectId: string): Promise<{ generations: number; remote_deleted: number; delete_failed: number }> {
  const generations = await rows<{ id: string }>("SELECT id FROM knowledge_index_generations WHERE project_id=$1 AND status IN ('active','superseded','failed') AND EXISTS (SELECT 1 FROM knowledge_index_entries e WHERE e.generation_id=knowledge_index_generations.id AND e.status IN ('active','delete_failed'))", [projectId])
  await database.transaction(async transaction => {
    await transaction.query("UPDATE knowledge_index_generations SET status='superseded',superseded_at=COALESCE(superseded_at,NOW()) WHERE project_id=$1 AND status='active'", [projectId])
    await transaction.query("UPDATE knowledge_documents SET active_index_generation=NULL,system_health='index_stale',updated_at=NOW() WHERE project_id=$1 AND present=TRUE", [projectId])
  })
  let remoteDeleted = 0
  let deleteFailed = 0
  if (supermemoryEnabled()) {
    for (const generation of generations) {
      const result = await retireGenerationRemoteEntries(projectId, generation.id)
      remoteDeleted += result.deleted
      deleteFailed += result.failed
    }
  } else {
    const entries = await rows<{ id: string }>("SELECT e.id FROM knowledge_index_entries e JOIN knowledge_index_generations g ON g.id=e.generation_id WHERE g.project_id=$1 AND g.status='superseded' AND e.status IN ('active','delete_failed')", [projectId])
    for (const entry of entries) {
      await database.query("UPDATE knowledge_index_entries SET status='remote_deleted',deleted_at=NOW(),last_error=NULL WHERE id=$1", [entry.id])
      remoteDeleted += 1
    }
  }
  await audit('knowledge.embedding_reset_prepared', projectId, { generations: generations.length, remote_deleted: remoteDeleted, remote_delete_failed: deleteFailed })
  return { generations: generations.length, remote_deleted: remoteDeleted, delete_failed: deleteFailed }
}

export async function queueKnowledgeReindex(projectId: string): Promise<{ queued: number; document_ids: string[] }> {
  const documents = await rows<{ document_id: string; current_sha256: string }>("SELECT document_id,current_sha256 FROM knowledge_documents WHERE project_id=$1 AND present=TRUE", [projectId])
  let queued = 0
  for (const document of documents) {
    if (await enqueueKnowledgeReindexTask(projectId, document.document_id, document.current_sha256)) queued += 1
  }
  await audit('knowledge.reindex_queued', projectId, { document_count: documents.length, queued })
  return { queued, document_ids: documents.map(document => document.document_id) }
}

export async function queueKnowledgeDocumentReindex(projectId: string, documentId: string): Promise<{ queued: boolean; task_id: string | null }> {
  const document = await one<{ current_sha256: string }>(
    'SELECT current_sha256 FROM knowledge_documents WHERE project_id=$1 AND document_id=$2 AND present=TRUE',
    [projectId, documentId],
  )
  if (!document) throw new IndexingError('knowledge_document_not_found', '知识文档不存在，不能排队索引。', 422)
  const taskId = await enqueueKnowledgeReindexTask(projectId, documentId, document.current_sha256)
  const queued = taskId !== null
  await audit('knowledge.document_reindex_queued', projectId, {
    document_id: documentId,
    document_sha256: document.current_sha256,
    queued,
    task_id: taskId,
  })
  return { queued, task_id: taskId }
}

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

function planHash(value: Omit<KnowledgeIndexRebuildPlan, 'plan_hash'>): string {
  return sha256(JSON.stringify(value))
}

export async function knowledgeIndexRebuildPlan(projectId: string): Promise<KnowledgeIndexRebuildPlan> {
  const [documents, generations, entries, links, associations] = await Promise.all([
    rows<KnowledgeDocumentLedger>('SELECT document_id,current_sha256,active_index_generation,present FROM knowledge_documents WHERE project_id=$1 ORDER BY document_id', [projectId]),
    rows<KnowledgeGeneration>('SELECT * FROM knowledge_index_generations WHERE project_id=$1 ORDER BY document_id,created_at,id', [projectId]),
    rows<KnowledgeIndexEntry>('SELECT * FROM knowledge_index_entries WHERE project_id=$1 ORDER BY document_id,generation_id,ordinal,id', [projectId]),
    rows<ChunkMemoryLink>("SELECT id,project_id,source_type,source_key,status,container_tag,metadata FROM memory_links WHERE project_id=$1 AND source_type='knowledge_document_chunk' ORDER BY id", [projectId]),
    rows<{ entry_id: string; memory_link_id: string; link_project_id: string; link_source_type: string }>(
      `SELECT e.id AS entry_id,e.memory_link_id,ml.project_id AS link_project_id,ml.source_type AS link_source_type
       FROM knowledge_index_entries e JOIN memory_links ml ON ml.id=e.memory_link_id
       WHERE e.project_id=$1 AND e.memory_link_id IS NOT NULL ORDER BY e.id`,
      [projectId],
    ),
  ])
  const fingerprint = embeddingFingerprint(projectId)
  const expectedContainer = projectContainerTag(projectId)
  const documentById = new Map(documents.map(document => [document.document_id, document]))
  const entriesByGeneration = new Map<string, KnowledgeIndexEntry[]>()
  const linkById = new Map(links.map(link => [link.id, link]))
  const entryIdsByLink = new Map<string, string[]>()
  const conflicts: KnowledgeIndexRebuildConflict[] = []
  const findings: KnowledgeIndexRebuildFinding[] = []
  const cleanupGenerationIds = new Set<string>()
  const cleanupEntryIds = new Set<string>()
  const cleanupMemoryLinkIds = new Set<string>()
  const orphanMemoryLinkIds = new Set<string>()
  const validActiveGenerationIds = new Set<string>()

  for (const entry of entries) {
    const generationEntries = entriesByGeneration.get(entry.generation_id) ?? []
    generationEntries.push(entry)
    entriesByGeneration.set(entry.generation_id, generationEntries)
    if (entry.memory_link_id) {
      const linkEntries = entryIdsByLink.get(entry.memory_link_id) ?? []
      linkEntries.push(entry.id)
      entryIdsByLink.set(entry.memory_link_id, linkEntries)
    }
  }
  for (const association of associations) {
    if (association.link_project_id !== projectId || association.link_source_type !== 'knowledge_document_chunk') {
      conflicts.push({ code: 'cross_project_memory_link', memory_link_id: association.memory_link_id, entry_ids: [association.entry_id] })
    }
  }
  for (const [memoryLinkId, entryIds] of entryIdsByLink) {
    if (entryIds.length > 1) conflicts.push({ code: 'memory_link_reused', memory_link_id: memoryLinkId, entry_ids: sorted(entryIds) })
  }
  for (const link of links) {
    const metadataProjectId = typeof link.metadata?.project_id === 'string' ? link.metadata.project_id : null
    if (link.container_tag !== expectedContainer || (metadataProjectId !== null && metadataProjectId !== projectId)) {
      conflicts.push({ code: 'cross_project_memory_link', memory_link_id: link.id })
    }
    if (link.status === 'pending') conflicts.push({ code: 'memory_ingestion_in_progress', memory_link_id: link.id })
  }

  for (const document of documents) {
    const active = generations.filter(generation => generation.document_id === document.document_id && generation.status === 'active')
    if (active.length > 1) {
      conflicts.push({ code: 'multiple_active_generations', document_id: document.document_id, generation_ids: sorted(active.map(generation => generation.id)) })
      continue
    }
    const generation = active[0]
    if (!generation) continue
    const generationEntries = entriesByGeneration.get(generation.id) ?? []
    const entriesComplete = generation.chunk_count > 0
      && generationEntries.length === generation.chunk_count
      && generationEntries.every(entry => {
        if (entry.status !== 'active' || !entry.memory_link_id) return false
        const link = linkById.get(entry.memory_link_id)
        if (!link || link.status !== 'active') return false
        return link.metadata?.knowledge_index_generation === generation.id
          && link.metadata?.knowledge_chunk_key === entry.chunk_key
      })
    const valid = document.present
      && document.active_index_generation === generation.id
      && document.current_sha256 === generation.document_sha256
      && generation.adapter === KNOWLEDGE_ADAPTER
      && generation.embedding_fingerprint === fingerprint
      && entriesComplete
    if (valid) validActiveGenerationIds.add(generation.id)
    else {
      cleanupGenerationIds.add(generation.id)
      findings.push({ code: 'obsolete_generation', document_id: document.document_id, generation_id: generation.id })
    }
  }

  for (const generation of generations) {
    if (generation.status === 'pending') {
      conflicts.push({ code: 'generation_in_progress', document_id: generation.document_id, generation_ids: [generation.id] })
      continue
    }
    if (generation.status === 'active' && !validActiveGenerationIds.has(generation.id)) cleanupGenerationIds.add(generation.id)
    if (generation.status === 'superseded' || generation.status === 'failed') {
      const hasRemoteResidue = (entriesByGeneration.get(generation.id) ?? []).some(entry => {
        const link = entry.memory_link_id ? linkById.get(entry.memory_link_id) : null
        return entry.status === 'active' || entry.status === 'delete_failed' || link?.status === 'active' || link?.status === 'revoked'
      })
      if (hasRemoteResidue) {
        cleanupGenerationIds.add(generation.id)
        findings.push({ code: 'obsolete_generation', document_id: generation.document_id, generation_id: generation.id })
      }
    }
  }

  for (const generationId of cleanupGenerationIds) {
    for (const entry of entriesByGeneration.get(generationId) ?? []) {
      if (entry.status === 'active' || entry.status === 'delete_failed' || entry.status === 'pending') cleanupEntryIds.add(entry.id)
      if (!entry.memory_link_id) continue
      const link = linkById.get(entry.memory_link_id)
      if (link?.status === 'active' || link?.status === 'revoked') cleanupMemoryLinkIds.add(link.id)
    }
  }
  for (const link of links) {
    if ((link.status === 'active' || link.status === 'revoked') && !entryIdsByLink.has(link.id)) {
      orphanMemoryLinkIds.add(link.id)
      cleanupMemoryLinkIds.add(link.id)
      findings.push({ code: 'orphan_memory_link', memory_link_id: link.id })
    }
  }

  const reindex = documents
    .filter(document => document.present && !generations.some(generation => generation.document_id === document.document_id && validActiveGenerationIds.has(generation.id)))
    .map(document => ({ document_id: document.document_id, document_sha256: document.current_sha256 }))
  for (const document of reindex) findings.push({ code: 'missing_active_generation', document_id: document.document_id })

  const normalizedConflicts = conflicts
    .map(conflict => ({ ...conflict, ...(conflict.generation_ids ? { generation_ids: sorted(conflict.generation_ids) } : {}), ...(conflict.entry_ids ? { entry_ids: sorted(conflict.entry_ids) } : {}) }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
  const normalizedFindings = findings
    .filter((finding, index, all) => all.findIndex(candidate => JSON.stringify(candidate) === JSON.stringify(finding)) === index)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
  const cleanup = {
    generation_ids: sorted(cleanupGenerationIds),
    entry_ids: sorted(cleanupEntryIds),
    memory_link_ids: sorted(cleanupMemoryLinkIds),
    orphan_memory_link_ids: sorted(orphanMemoryLinkIds),
  }
  const status = normalizedConflicts.length > 0
    ? 'blocked' as const
    : cleanup.generation_ids.length > 0 || cleanup.memory_link_ids.length > 0 || reindex.length > 0
      ? 'ready' as const
      : 'clean' as const
  const withoutHash: Omit<KnowledgeIndexRebuildPlan, 'plan_hash'> = {
    project_id: projectId,
    status,
    summary: {
      documents: documents.length,
      valid_active_generations: validActiveGenerationIds.size,
      cleanup_generations: cleanup.generation_ids.length,
      cleanup_memory_links: cleanup.memory_link_ids.length,
      orphan_memory_links: cleanup.orphan_memory_link_ids.length,
      reindex_documents: reindex.length,
      conflicts: normalizedConflicts.length,
    },
    conflicts: normalizedConflicts,
    findings: normalizedFindings,
    cleanup,
    reindex,
  }
  return { ...withoutHash, plan_hash: planHash(withoutHash) }
}

export async function executeKnowledgeIndexRebuild(projectId: string, expectedPlanHash: string): Promise<{
  project_id: string
  plan_hash: string
  status: 'clean' | 'completed' | 'queued'
  remote_deleted: number
  queued: number
  document_ids: string[]
}> {
  const plan = await knowledgeIndexRebuildPlan(projectId)
  if (plan.plan_hash !== expectedPlanHash) {
    throw new IndexingError('knowledge_rebuild_plan_changed', '知识索引状态已变化，请重新读取 rebuild plan 后再执行。', 409, { current_plan: plan })
  }
  if (plan.conflicts.length > 0) {
    throw new IndexingError('knowledge_rebuild_conflict', '知识索引存在并发或项目隔离冲突，未执行任何清理。', 409, { plan })
  }
  if (plan.status === 'clean') {
    await audit('knowledge.rebuild_noop', projectId, { plan_hash: plan.plan_hash })
    return { project_id: projectId, plan_hash: plan.plan_hash, status: 'clean', remote_deleted: 0, queued: 0, document_ids: [] }
  }
  if (!supermemoryEnabled() && (plan.cleanup.memory_link_ids.length > 0 || plan.reindex.length > 0)) {
    throw new IndexingError('supermemory_not_configured', 'Supermemory 未启用，不能验证远端清理或排队重建。', 503, { plan })
  }

  const deleteFailures: Array<{ memory_link_id: string; error: string }> = []
  let remoteDeleted = 0
  for (const memoryLinkId of plan.cleanup.memory_link_ids) {
    try {
      await applyMemoryRevocation(projectId, memoryLinkId, 'delete', 'memory-v2-rebuild')
      await database.query("UPDATE knowledge_index_entries SET status='remote_deleted',deleted_at=NOW(),last_error=NULL WHERE project_id=$1 AND memory_link_id=$2", [projectId, memoryLinkId])
      remoteDeleted += 1
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 200) : 'remote_delete_failed'
      await database.query("UPDATE knowledge_index_entries SET status='delete_failed',delete_attempts=delete_attempts+1,last_error=$3 WHERE project_id=$1 AND memory_link_id=$2", [projectId, memoryLinkId, message])
      deleteFailures.push({ memory_link_id: memoryLinkId, error: message })
    }
  }
  if (deleteFailures.length > 0) {
    await audit('knowledge.rebuild_cleanup_failed', projectId, { plan_hash: plan.plan_hash, remote_deleted: remoteDeleted, failures: deleteFailures })
    throw new IndexingError('knowledge_rebuild_cleanup_failed', '旧知识索引未能全部从 Supermemory 删除，因此没有排队重建。', 503, {
      plan_hash: plan.plan_hash,
      remote_deleted: remoteDeleted,
      delete_failures: deleteFailures,
    })
  }

  const pending = await one<{ count: number }>("SELECT COUNT(*)::integer AS count FROM knowledge_index_generations WHERE project_id=$1 AND status='pending'", [projectId])
  const currentDocuments = await rows<{ document_id: string; current_sha256: string; present: boolean }>(
    'SELECT document_id,current_sha256,present FROM knowledge_documents WHERE project_id=$1 AND document_id=ANY($2::text[]) ORDER BY document_id',
    [projectId, plan.reindex.map(document => document.document_id)],
  )
  const currentById = new Map(currentDocuments.map(document => [document.document_id, document]))
  const changedDocuments = plan.reindex.filter(document => {
    const current = currentById.get(document.document_id)
    return !current?.present || current.current_sha256 !== document.document_sha256
  })
  if ((pending?.count ?? 0) > 0 || changedDocuments.length > 0) {
    throw new IndexingError('knowledge_rebuild_state_changed', '远端清理后知识文档或索引状态发生变化，未排队重建；请重新读取计划。', 409, {
      pending_generations: pending?.count ?? 0,
      changed_document_ids: changedDocuments.map(document => document.document_id),
    })
  }

  await database.transaction(async transaction => {
    for (const entryId of plan.cleanup.entry_ids) {
      await transaction.query("UPDATE knowledge_index_entries SET status='remote_deleted',deleted_at=COALESCE(deleted_at,NOW()),last_error=NULL WHERE id=$1 AND project_id=$2", [entryId, projectId])
    }
    for (const generationId of plan.cleanup.generation_ids) {
      await transaction.query("UPDATE knowledge_index_generations SET status='superseded',superseded_at=COALESCE(superseded_at,NOW()) WHERE id=$1 AND project_id=$2 AND status='active'", [generationId, projectId])
    }
    for (const document of plan.reindex) {
      await transaction.query("UPDATE knowledge_documents SET active_index_generation=NULL,system_health='index_stale',updated_at=NOW() WHERE project_id=$1 AND document_id=$2 AND current_sha256=$3", [projectId, document.document_id, document.document_sha256])
    }
  })

  let queued = 0
  for (const document of plan.reindex) {
    if (await enqueueKnowledgeReindexTask(projectId, document.document_id, document.document_sha256)) queued += 1
  }
  await audit('knowledge.rebuild_queued', projectId, {
    plan_hash: plan.plan_hash,
    remote_deleted: remoteDeleted,
    cleanup_generation_ids: plan.cleanup.generation_ids,
    document_ids: plan.reindex.map(document => document.document_id),
    queued,
  })
  return {
    project_id: projectId,
    plan_hash: plan.plan_hash,
    status: plan.reindex.length > 0 ? 'queued' : 'completed',
    remote_deleted: remoteDeleted,
    queued,
    document_ids: plan.reindex.map(document => document.document_id),
  }
}

export async function indexKnowledgeDocument(projectId: string, documentId: string): Promise<{
  generation: KnowledgeGeneration
  idempotent: boolean
  retired: { generations: number; remote_deleted: number; delete_failed: number }
}> {
  if (!supermemoryEnabled()) throw new IndexingError('supermemory_not_configured', 'Supermemory 未启用，不能建立知识文档语义索引。', 503)
  const document = await readKnowledgeDocument(projectId, documentId)
  if (!document.parsed.chunks.length) throw new IndexingError('knowledge_document_empty', '知识文档正文为空，不能建立语义索引。')
  const fingerprint = embeddingFingerprint(projectId)
  const existing = await one<KnowledgeGeneration>(
    'SELECT * FROM knowledge_index_generations WHERE project_id=$1 AND document_id=$2 AND document_sha256=$3 AND adapter=$4 AND embedding_fingerprint=$5 ORDER BY created_at DESC LIMIT 1',
    [projectId, documentId, document.row.current_sha256, KNOWLEDGE_ADAPTER, fingerprint],
  )
  if (existing?.status === 'active') return { generation: existing, idempotent: true, retired: { generations: 0, remote_deleted: 0, delete_failed: 0 } }
  if (existing?.status === 'pending') throw new IndexingError('knowledge_index_in_progress', '该知识文档正在建立索引。', 409)

  const generationId = existing?.id ?? crypto.randomUUID()
  if (existing) {
    await database.transaction(async transaction => {
      await transaction.query("UPDATE knowledge_index_generations SET status='pending',failure_code=NULL,chunk_count=0,started_at=NOW(),completed_at=NULL,superseded_at=NULL WHERE id=$1", [generationId])
      await transaction.query("UPDATE knowledge_index_entries SET status='pending',last_error=NULL WHERE generation_id=$1", [generationId])
    })
  } else {
    await database.query(`INSERT INTO knowledge_index_generations(id,project_id,document_id,document_sha256,status,adapter,embedding_fingerprint,chunk_count)
      VALUES ($1,$2,$3,$4,'pending',$5,$6,0)`, [generationId, projectId, documentId, document.row.current_sha256, KNOWLEDGE_ADAPTER, fingerprint])
  }
  await database.query("UPDATE knowledge_documents SET system_health='indexing',updated_at=NOW() WHERE project_id=$1 AND document_id=$2 AND current_sha256=$3", [projectId, documentId, document.row.current_sha256])

  try {
    for (const chunk of document.parsed.chunks) {
      const entryId = crypto.randomUUID()
      const sourceKey = `${documentId}:${document.row.current_sha256}:${chunk.chunk_key}`
      await database.query(`INSERT INTO knowledge_index_entries(
        id,generation_id,project_id,document_id,chunk_key,ordinal,heading_path,line_start,line_end,token_count,content_sha256,task_type,status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'superrag','pending')
      ON CONFLICT(generation_id,chunk_key) DO UPDATE SET ordinal=EXCLUDED.ordinal,heading_path=EXCLUDED.heading_path,line_start=EXCLUDED.line_start,line_end=EXCLUDED.line_end,token_count=EXCLUDED.token_count,content_sha256=EXCLUDED.content_sha256,status='pending',last_error=NULL`, [
        entryId, generationId, projectId, documentId, chunk.chunk_key, chunk.ordinal, chunk.heading_path,
        chunk.line_start, chunk.line_end, chunk.token_count, chunk.content_sha256,
      ])
      const ingested = await ingestProjectMemory(projectId, {
        source_type: 'knowledge_document_chunk', source_id: null, source_key: sourceKey, artifact_id: null, uploaded_file_id: null,
        content: chunk.content, source_url: null, quote: null,
        locator: knowledgeLocator(chunk.heading_path, chunk.line_start, chunk.line_end),
        metadata: {
          knowledge_document_id: documentId,
          knowledge_document_kind: document.row.kind,
          knowledge_document_sha256: document.row.current_sha256,
          knowledge_index_generation: generationId,
          knowledge_chunk_key: chunk.chunk_key,
          heading_path: chunk.heading_path,
          line_start: chunk.line_start,
          line_end: chunk.line_end,
          author_status: document.row.author_status,
          evidence_status: 'knowledge_summary_requires_source_gate',
        },
        task_type: 'superrag', idempotency_key: `knowledge-index:${sourceKey}`,
      })
      if (!ingested.link) throw new IndexingError('knowledge_index_remote_link_missing', 'Supermemory 返回后缺少本地关联记录。')
      await database.query("UPDATE knowledge_index_entries SET remote_document_id=$2,memory_link_id=$3,status='active',last_error=NULL WHERE generation_id=$1 AND chunk_key=$4", [generationId, ingested.link.supermemory_id, ingested.link.id, chunk.chunk_key])
    }

    const current = await one<{ current_sha256: string }>('SELECT current_sha256 FROM knowledge_documents WHERE project_id=$1 AND document_id=$2 AND present=TRUE', [projectId, documentId])
    if (current?.current_sha256 !== document.row.current_sha256) throw new IndexingError('knowledge_document_changed_during_index', '知识文档在索引期间发生变化，新代次不会激活。', 409)
    const oldGenerations = await rows<{ id: string }>("SELECT id FROM knowledge_index_generations WHERE project_id=$1 AND document_id=$2 AND status='active' AND id<>$3", [projectId, documentId, generationId])
    const postIndexHealth = await knowledgeDocumentHealthAfterIndex(projectId, documentId)
    await database.transaction(async transaction => {
      await transaction.query("UPDATE knowledge_index_generations SET status='superseded',superseded_at=NOW() WHERE project_id=$1 AND document_id=$2 AND status='active' AND id<>$3", [projectId, documentId, generationId])
      await transaction.query("UPDATE knowledge_index_generations SET status='active',chunk_count=$2,failure_code=NULL,completed_at=NOW() WHERE id=$1", [generationId, document.parsed.chunks.length])
      await transaction.query('UPDATE knowledge_documents SET active_index_generation=$3,system_health=$5,updated_at=NOW() WHERE project_id=$1 AND document_id=$2 AND current_sha256=$4', [projectId, documentId, generationId, document.row.current_sha256, postIndexHealth])
    })

    let remoteDeleted = 0
    let deleteFailed = 0
    for (const generation of oldGenerations) {
      const retired = await retireGenerationRemoteEntries(projectId, generation.id)
      remoteDeleted += retired.deleted
      deleteFailed += retired.failed
    }
    await audit('knowledge.index_activated', projectId, {
      document_id: documentId, document_sha256: document.row.current_sha256, generation_id: generationId,
      chunk_count: document.parsed.chunks.length, superseded_generation_ids: oldGenerations.map(item => item.id),
      remote_deleted: remoteDeleted, remote_delete_failed: deleteFailed,
    })
    const generation = await one<KnowledgeGeneration>('SELECT * FROM knowledge_index_generations WHERE id=$1', [generationId])
    if (!generation) throw new Error('knowledge_generation_missing_after_activation')
    return { generation, idempotent: false, retired: { generations: oldGenerations.length, remote_deleted: remoteDeleted, delete_failed: deleteFailed } }
  } catch (error) {
    await markGenerationFailed(projectId, documentId, generationId, document.row.current_sha256, error)
    throw error
  }
}

export async function reconcileKnowledgeRemoteDeletes(projectId: string): Promise<{ generations: number; remote_deleted: number; delete_failed: number }> {
  const generations = await rows<{ id: string }>("SELECT DISTINCT g.id FROM knowledge_index_generations g JOIN knowledge_index_entries e ON e.generation_id=g.id WHERE g.project_id=$1 AND g.status IN ('superseded','failed') AND e.status IN ('active','delete_failed')", [projectId])
  let remoteDeleted = 0
  let deleteFailed = 0
  for (const generation of generations) {
    const result = await retireGenerationRemoteEntries(projectId, generation.id)
    remoteDeleted += result.deleted
    deleteFailed += result.failed
  }
  await audit('knowledge.remote_delete_reconciled', projectId, { generations: generations.length, remote_deleted: remoteDeleted, delete_failed: deleteFailed })
  return { generations: generations.length, remote_deleted: remoteDeleted, delete_failed: deleteFailed }
}

export async function activeKnowledgeIndexEntries(projectId: string): Promise<KnowledgeIndexEntry[]> {
  return rows<KnowledgeIndexEntry>(`SELECT e.* FROM knowledge_index_entries e
    JOIN knowledge_index_generations g ON g.id=e.generation_id
    JOIN knowledge_documents d ON d.project_id=e.project_id AND d.document_id=e.document_id
    WHERE e.project_id=$1 AND e.status='active' AND g.status='active' AND d.present=TRUE
      AND d.active_index_generation=g.id AND d.current_sha256=g.document_sha256
      AND d.author_status NOT IN ('superseded','archived')`, [projectId])
}

export async function searchActiveKnowledge(projectId: string, query: string, limit = 8): Promise<{
  project_id: string
  query: string
  results: Array<Record<string, unknown>>
  filtered_stale_results: number
}> {
  const entries = await activeKnowledgeIndexEntries(projectId)
  const documentCount = await one<{ count: number }>("SELECT COUNT(*)::integer AS count FROM knowledge_documents WHERE project_id=$1 AND present=TRUE AND author_status NOT IN ('superseded','archived')", [projectId])
  if (!entries.length) {
    if ((documentCount?.count ?? 0) > 0) throw new IndexingError('knowledge_active_index_unavailable', '当前知识文档没有可用的 active 索引代次。', 503)
    return { project_id: projectId, query, results: [], filtered_stale_results: 0 }
  }
  const allowedMetadataKeys = new Set(entries.map(entry => `${entry.generation_id}:${entry.chunk_key}`))
  const allowedRemoteIds = new Set(entries.map(entry => entry.remote_document_id).filter((id): id is string => Boolean(id)))
  const remote = await searchProjectMemory(projectId, query, Math.min(20, Math.max(limit, limit * 4)), 'hybrid')
  const filtered = remote.results.filter(result => {
    const metadata = (result.metadata || {}) as Record<string, unknown>
    const key = `${String(metadata.knowledge_index_generation || '')}:${String(metadata.knowledge_chunk_key || '')}`
    return allowedMetadataKeys.has(key) || allowedRemoteIds.has(String(result.id || ''))
  })
  return {
    project_id: projectId,
    query,
    results: filtered.slice(0, limit).map(result => ({ ...result, evidence_level: 'derived_knowledge_candidate', active_generation_verified: true })),
    filtered_stale_results: remote.results.length - filtered.length,
  }
}

export async function indexUploadedMaterial(projectId: string, uploadedFileId: string, taskId: string): Promise<{ indexed: number; parse_status: string }> {
  if (!supermemoryEnabled()) throw new IndexingError('supermemory_not_configured', 'Supermemory 未启用，不能索引上传材料。', 503)
  const file = await one<Record<string, unknown>>('SELECT * FROM uploaded_files WHERE id=$1 AND project_id=$2', [uploadedFileId, projectId])
  if (!file) throw new IndexingError('uploaded_file_not_found', '上传材料不存在。')
  const extracted = await extractMaterialChunks(file as MaterialFile)
  let indexed = 0
  if (extracted.raw_upload) {
    await ingestProjectMemory(projectId, {
      source_type: 'artifact', source_id: null, source_key: `upload:${uploadedFileId}:raw`, artifact_id: null, uploaded_file_id: uploadedFileId,
      content: null, source_url: null, quote: null, locator: null,
      metadata: { task_id: taskId, parse_status: extracted.parse_status, evidence_status: 'untrusted_uploaded_material' },
      task_type: 'superrag', idempotency_key: `material-index:${uploadedFileId}:raw`,
    })
    indexed += 1
  }
  for (const chunk of extracted.chunks) {
    await ingestProjectMemory(projectId, {
      source_type: 'artifact', source_id: null, source_key: `upload:${uploadedFileId}:chunk:${chunk.content_sha256}`, artifact_id: null, uploaded_file_id: uploadedFileId,
      content: chunk.content, source_url: null, quote: chunk.content, locator: chunk.locator,
      metadata: { task_id: taskId, chunk_index: chunk.index, parse_status: extracted.parse_status, content_sha256: chunk.content_sha256, evidence_status: 'untrusted_uploaded_material' },
      task_type: 'superrag', idempotency_key: `material-index:${uploadedFileId}:chunk:${chunk.content_sha256}`,
    })
    indexed += 1
  }
  await database.query('UPDATE uploaded_files SET metadata=$2 WHERE id=$1 AND project_id=$3', [uploadedFileId, { ...((file.metadata || {}) as Record<string, unknown>), semantic_index_status: 'active', semantic_index_task_id: taskId, semantic_indexed_items: indexed, parse_status: extracted.parse_status }, projectId])
  return { indexed, parse_status: extracted.parse_status }
}
