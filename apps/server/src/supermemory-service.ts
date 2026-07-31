import { createHash } from 'node:crypto'
import { createReadStream, lstatSync } from 'node:fs'
import { Supermemory } from 'supermemory'
import { z } from 'zod'
import { audit, database, one, rows } from './database.js'
import { memoryIngestRequest } from './contracts.js'
import { artifactsRoot, pathInside } from './paths.js'

const PROJECT_TAG_PREFIX = 'research-os-project-'
const MAX_ARTIFACT_BYTES = 100 * 1024 * 1024
const allowedArtifactTypes = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'])
export type MemoryIngestRequest = z.infer<typeof memoryIngestRequest>

export class SupermemoryConfigurationError extends Error {
  readonly code = 'supermemory_not_configured'
  readonly status = 503
  constructor(message = 'Supermemory 未配置 API key，无法执行项目语义记忆操作。') {
    super(message)
    this.name = 'SupermemoryConfigurationError'
  }
}

export class SupermemoryArtifactError extends Error {
  readonly status: 400 | 404 | 409 | 413 | 415 | 422 | 500 | 503
  readonly code: string
  constructor(code: string, message: string, status: 400 | 404 | 409 | 413 | 415 | 422 | 500 | 503 = 422) {
    super(message)
    this.name = 'SupermemoryArtifactError'
    this.code = code
    this.status = status
  }
}

type FlatMetadata = Record<string, string | number | boolean | string[]>
export type MemoryLink = {
  id: string
  project_id: string
  source_type: string
  source_id: string | null
  artifact_id: string | null
  uploaded_file_id: string | null
  content_sha256: string
  custom_id: string
  supermemory_id: string
  container_tag: string
  task_type: string
  status: string
  metadata: Record<string, unknown>
  created_at: string
  revoked_at: string | null
  deleted_at: string | null
}

function config() {
  const apiKey = process.env.SUPERMEMORY_API_KEY?.trim()
  if (!apiKey) throw new SupermemoryConfigurationError()
  return { apiKey, baseURL: process.env.SUPERMEMORY_BASE_URL || undefined }
}

function api(): Supermemory {
  const settings = config()
  const timeout = Number(process.env.SUPERMEMORY_TIMEOUT_MS || process.env.SUPERMEMORY_TIMEOUT_SECONDS || 30000)
  return new Supermemory({ apiKey: settings.apiKey, baseURL: settings.baseURL, timeout, maxRetries: 0 })
}

function enabled(): boolean {
  return process.env.SUPERMEMORY_ENABLED === 'true' || Boolean(process.env.SUPERMEMORY_API_KEY?.trim())
}

export function supermemoryEnabled(): boolean {
  return enabled()
}

export function projectContainerTag(projectId: string): string {
  return `${PROJECT_TAG_PREFIX}${projectId}`
}

export function memoryStatus() {
  return {
    enabled: enabled(),
    key_configured: Boolean(process.env.SUPERMEMORY_API_KEY?.trim()),
    base_url: process.env.SUPERMEMORY_BASE_URL || 'https://api.supermemory.ai',
    scope: 'project_container_tag',
  }
}

function sha256(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

function customId(projectId: string, contentSha256: string): string {
  return `research-os-memory-${projectId.replaceAll('-', '')}-${contentSha256}`.slice(0, 100)
}

function sanitizeResult(item: Record<string, unknown>, link?: MemoryLink | null) {
  return {
    id: item.id,
    memory: item.memory || item.chunk || null,
    similarity: item.similarity ?? null,
    metadata: item.metadata || {},
    documents: item.documents || [],
    context: item.context || { parents: [], children: [], related: [] },
    updated_at: item.updatedAt || null,
    source_status: 'supermemory_candidate_requires_evidence_review',
    local_memory_link_id: link?.id ?? null,
    source_type: link?.source_type ?? null,
    source_id: link?.source_id ?? null,
    artifact_id: link?.artifact_id ?? null,
    uploaded_file_id: link?.uploaded_file_id ?? null,
    evidence_status: link?.metadata?.evidence_status ?? 'semantic_candidate',
  }
}

export async function searchProjectMemory(projectId: string, query: string, limit: number, searchMode: 'memories' | 'hybrid' | 'documents' = 'hybrid') {
  const response = await api().search({ q: query, containerTag: projectContainerTag(projectId), searchMode, include: { relatedMemories: true, documents: true, summaries: true }, limit: Math.min(20, Math.max(1, limit)) })
  const links = await rows<MemoryLink>('SELECT * FROM memory_links WHERE project_id=$1 AND status IN (\'active\',\'revoked\')', [projectId])
  const byRemoteId = new Map(links.map(link => [link.supermemory_id, link]))
  return { project_id: projectId, query, search_mode: searchMode, total: response.total, results: response.results.map(item => sanitizeResult(item as unknown as Record<string, unknown>, byRemoteId.get(String(item.id)))) }
}

export async function memoryGraph(projectId: string, query: string, limit: number) {
  const result = await searchProjectMemory(projectId, query, limit, 'memories')
  const nodes = new Map<string, { id: string; label: string; kind: string; metadata: Record<string, unknown> }>()
  const edges: Array<{ id: string; source: string; target: string; relation: string }> = []
  for (const item of result.results) {
    const rootId = String(item.id)
    nodes.set(rootId, { id: rootId, label: String(item.memory || '未命名记忆').slice(0, 240), kind: 'memory', metadata: item.metadata as Record<string, unknown> })
    const context = item.context as { parents?: Array<Record<string, unknown>>; children?: Array<Record<string, unknown>>; related?: Array<Record<string, unknown>> }
    for (const [key, relation] of [['parents', 'parent'], ['children', 'child'], ['related', 'related']] as const) {
      for (const [index, related] of (context[key] || []).entries()) {
        const relatedId = `${rootId}:${key}:${index}`
        nodes.set(relatedId, { id: relatedId, label: String(related.memory || '相关记忆').slice(0, 240), kind: key, metadata: (related.metadata || {}) as Record<string, unknown> })
        edges.push({ id: `${rootId}-${relatedId}`, source: key === 'parents' ? relatedId : rootId, target: key === 'parents' ? rootId : relatedId, relation })
      }
    }
  }
  return { project_id: projectId, query, nodes: [...nodes.values()], edges, source: 'supermemory_graph_context', evidence_status: 'semantic_candidates_not_scientific_evidence' }
}

function metadataFor(input: MemoryIngestRequest, projectId: string, contentSha256: string, artifact?: Record<string, unknown>): FlatMetadata {
  const metadata: FlatMetadata = {
    source: 'research-os',
    project_id: projectId,
    source_type: input.source_type,
    content_sha256: contentSha256,
    evidence_status: 'semantic_candidate_requires_review',
    ...input.metadata,
  }
  if (input.source_id) metadata.source_id = input.source_id
  if (input.source_url) metadata.source_url = input.source_url
  if (input.quote) metadata.quote = input.quote
  if (input.locator) metadata.locator = input.locator
  if (artifact) {
    const uploaded = artifact.size_bytes !== undefined
    metadata[uploaded ? 'uploaded_file_id' : 'artifact_id'] = String(artifact.id)
    metadata.artifact_sha256 = String(artifact.sha256)
    metadata.artifact_name = String(artifact.name)
    metadata.mime_type = String(artifact.mime_type)
  }
  return metadata
}

function artifactPath(artifact: Record<string, unknown>): string {
  const relativePath = String(artifact.relative_path || '')
  if (!relativePath || !artifact.id) throw new SupermemoryArtifactError('artifact_path_invalid', 'Artifact 路径无效。')
  const path = pathInside(artifactsRoot, relativePath)
  const stat = lstatSync(path, { throwIfNoEntry: false })
  if (!stat) throw new SupermemoryArtifactError('artifact_not_found', 'Artifact 文件不存在。', 404)
  if (stat.isSymbolicLink() || !stat.isFile()) throw new SupermemoryArtifactError('artifact_not_regular_file', 'Artifact 必须是普通文件。')
  if (stat.size > MAX_ARTIFACT_BYTES) throw new SupermemoryArtifactError('artifact_too_large', 'Artifact 超过 Supermemory 摄取大小限制。', 413)
  if (!allowedArtifactTypes.has(String(artifact.mime_type))) throw new SupermemoryArtifactError('artifact_type_unsupported', '仅允许 PDF 和受控图片 Artifact 摄取。', 415)
  return path
}

export async function ingestProjectMemory(projectId: string, input: MemoryIngestRequest) {
  const artifact = input.artifact_id
    ? await one<Record<string, unknown>>('SELECT * FROM artifacts WHERE id=$1 AND project_id=$2 AND valid=TRUE', [input.artifact_id, projectId])
    : null
  const uploadedFile = input.uploaded_file_id
    ? await one<Record<string, unknown>>('SELECT * FROM uploaded_files WHERE id=$1 AND project_id=$2', [input.uploaded_file_id, projectId])
    : null
  if (input.artifact_id && !artifact) throw new SupermemoryArtifactError('artifact_not_found', '当前项目中不存在可摄取的 Artifact。', 404)
  if (input.uploaded_file_id && !uploadedFile) throw new SupermemoryArtifactError('uploaded_file_not_found', '当前项目中不存在可摄取的上传文件。', 404)
  const sourceFile = artifact || uploadedFile
  const contentSha256 = input.content ? sha256(input.content) : sourceFile ? String(sourceFile.sha256) : sha256(String(input.content))
  const existing = await one<MemoryLink>('SELECT * FROM memory_links WHERE project_id=$1 AND source_type=$2 AND source_id IS NOT DISTINCT FROM $3 AND content_sha256=$4 ORDER BY created_at DESC LIMIT 1', [projectId, input.source_type, input.source_id ?? null, contentSha256])
  if (existing?.status === 'active' || existing?.status === 'revoked') return { link: existing, idempotent: true }
  if (existing?.status === 'pending') throw new SupermemoryArtifactError('memory_ingestion_in_progress', '相同语义内容正在摄取，请稍后重试。', 409)

  const linkId = existing?.id || crypto.randomUUID()
  const tag = projectContainerTag(projectId)
  const remoteCustomId = customId(projectId, contentSha256)
  const metadata = metadataFor(input, projectId, contentSha256, sourceFile || undefined)
  if (existing) {
    await database.query('UPDATE memory_links SET custom_id=$2,supermemory_id=$3,container_tag=$4,task_type=$5,metadata=$6,status=\'pending\',revoked_at=NULL,deleted_at=NULL WHERE id=$1', [linkId, remoteCustomId, `pending-${linkId}`, tag, input.task_type, metadata])
  } else {
    await database.query('INSERT INTO memory_links(id,project_id,source_type,source_id,artifact_id,uploaded_file_id,content_sha256,custom_id,supermemory_id,container_tag,task_type,status,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,\'pending\',$12)', [linkId, projectId, input.source_type, input.source_id ?? null, input.artifact_id ?? null, input.uploaded_file_id ?? null, contentSha256, remoteCustomId, `pending-${linkId}`, tag, input.task_type, metadata])
  }
  try {
    const remote = sourceFile && !input.content
      ? await api().documents.uploadFile({ file: createReadStream(artifactPath(sourceFile)), containerTag: tag, filepath: `research-os/artifacts/${sourceFile.id}/${sourceFile.name}`, fileType: String(sourceFile.mime_type), metadata: JSON.stringify(metadata) })
      : await api().add({ content: String(input.content), containerTag: tag, customId: remoteCustomId, entityContext: `Research OS project ${projectId} semantic memory; candidates require evidence review.`, metadata, taskType: input.task_type })
    const remoteId = String(remote.id)
    await database.query('UPDATE memory_links SET supermemory_id=$2,status=\'active\' WHERE id=$1', [linkId, remoteId])
    await audit('memory.ingested', projectId, { memory_link_id: linkId, supermemory_id: remoteId, source_type: input.source_type, artifact_id: input.artifact_id ?? null })
    const link = await one<MemoryLink>('SELECT * FROM memory_links WHERE id=$1', [linkId])
    return { link, idempotent: false, remote_status: remote.status }
  } catch (error) {
    await database.query('UPDATE memory_links SET status=\'failed\',metadata=$2 WHERE id=$1', [linkId, { ...metadata, failure_code: 'supermemory_request_failed' }])
    throw error
  }
}

export async function listProjectMemoryLinks(projectId: string): Promise<MemoryLink[]> {
  return rows<MemoryLink>('SELECT * FROM memory_links WHERE project_id=$1 ORDER BY created_at DESC', [projectId])
}

export async function ingestConversationMemory(projectId: string, sessionId: string) {
  const messages = await rows<{ id: string; role: string; content: string; created_at: string }>(
    'SELECT id,role,content,created_at FROM messages WHERE session_id=$1 ORDER BY created_at,id',
    [sessionId],
  )
  const links = []
  for (const message of messages) {
    links.push(await ingestProjectMemory(projectId, {
      source_type: 'idea_message',
      source_id: message.id,
      artifact_id: null,
      uploaded_file_id: null,
      content: `${message.role}: ${message.content}`,
      source_url: null,
      quote: null,
      locator: null,
      metadata: { session_id: sessionId, role: message.role, created_at: message.created_at },
      task_type: 'memory',
      idempotency_key: `idea-message:${message.id}`,
    }))
  }
  return { project_id: projectId, session_id: sessionId, ingested: links.length, links }
}

export async function applyMemoryRevocation(projectId: string, linkId: string, operation: 'forget' | 'delete', actor: string) {
  const link = await one<MemoryLink>('SELECT * FROM memory_links WHERE id=$1 AND project_id=$2', [linkId, projectId])
  if (!link) throw new SupermemoryArtifactError('memory_link_not_found', '项目语义记忆关联不存在。', 404)
  if (link.status === 'revoked' || link.status === 'deleted') return { link, idempotent: true }
  if (link.status !== 'active') throw new SupermemoryArtifactError('memory_link_not_active', '只有 active 语义记忆可以撤销或删除。', 409)
  if (operation === 'forget') await api().memories.forget({ containerTag: projectContainerTag(projectId), id: link.supermemory_id, reason: 'Research OS approved memory revocation' })
  else await api().documents.delete(link.supermemory_id)
  const status = operation === 'forget' ? 'revoked' : 'deleted'
  await database.query(`UPDATE memory_links SET status=$2,${operation === 'forget' ? 'revoked_at' : 'deleted_at'}=NOW() WHERE id=$1`, [linkId, status])
  await audit(`memory.${operation}`, projectId, { memory_link_id: linkId, supermemory_id: link.supermemory_id }, actor)
  return { link: await one<MemoryLink>('SELECT * FROM memory_links WHERE id=$1', [linkId]), idempotent: false }
}
