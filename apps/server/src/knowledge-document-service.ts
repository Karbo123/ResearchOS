import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { relative, sep } from 'node:path'
import { assertKnowledgePathForKind, canonicalKnowledgePath, KNOWLEDGE_DOCUMENT_SCHEMA, type KnowledgeDocumentFrontMatter, type KnowledgeImpactPolicy, type KnowledgeSystemHealth } from './knowledge-document-contracts.js'
import { parseKnowledgeMarkdown, type ParsedKnowledgeDocument } from './knowledge-markdown-parser.js'
import { audit, database, one, rows } from './database.js'
import { gitBinary, pathInside } from './paths.js'
import { projectRoot } from './project-storage.js'
import { propagateLineageImpacts, syncKnowledgeDocumentLineageBatch } from './impact-service.js'

export class KnowledgeDocumentError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: 400 | 404 | 409 | 422 | 503 = 422) {
    super(message)
  }
}

export type KnowledgeDocumentRow = {
  project_id: string
  document_id: string
  relative_path: string
  kind: string
  schema_version: string
  author_status: string
  system_health: KnowledgeSystemHealth
  current_sha256: string
  current_git_commit: string | null
  git_dirty: boolean
  file_size_bytes: number
  file_mtime_ms: number
  active_index_generation: string | null
  metadata: Record<string, unknown>
  present: boolean
  created_at: string
  updated_at: string
}

export type ReconciledKnowledgeDocument = {
  row: KnowledgeDocumentRow
  parsed: ParsedKnowledgeDocument
  changed: boolean
  renamed: boolean
}

type ParsedCacheEntry = { parsed: ParsedKnowledgeDocument; bytes: number }
const parsedDocumentCache = new Map<string, ParsedCacheEntry>()
const MAX_PARSED_CACHE_ENTRIES = 2048
const MAX_PARSED_CACHE_BYTES = 32 * 1024 * 1024
let parsedDocumentCacheBytes = 0

type ObservedDocument = {
  relativePath: string
  absolutePath: string
  parsed: ParsedKnowledgeDocument
  size: number
  mtimeMs: number
  gitCommit: string | null
  gitDirty: boolean
}

function normalizeRelativePath(projectId: string, absolutePath: string): string {
  const root = projectRoot(projectId)
  const value = relative(root, absolutePath).split(sep).join('/')
  return canonicalKnowledgePath(value)
}

function assertNoSymlink(projectId: string, relativePath: string): string {
  const canonical = canonicalKnowledgePath(relativePath)
  const root = projectRoot(projectId)
  if (!existsSync(root)) throw new KnowledgeDocumentError('project_workspace_not_found', '项目工作区不存在。', 404)
  if (lstatSync(root).isSymbolicLink()) throw new KnowledgeDocumentError('knowledge_symlink_rejected', '项目知识目录不能位于符号链接中。')
  let current = root
  for (const part of canonical.split('/')) {
    current = pathInside(current, part)
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new KnowledgeDocumentError('knowledge_symlink_rejected', '知识文档路径不能包含符号链接。')
  }
  return pathInside(root, ...canonical.split('/'))
}

export function ensureKnowledgeDirectory(projectId: string): string {
  const root = projectRoot(projectId)
  if (!existsSync(root)) throw new KnowledgeDocumentError('project_workspace_not_found', '项目工作区不存在。', 404)
  const researchRoot = pathInside(root, 'research')
  if (existsSync(researchRoot) && lstatSync(researchRoot).isSymbolicLink()) throw new KnowledgeDocumentError('knowledge_symlink_rejected', 'research 目录不能是符号链接。')
  mkdirSync(researchRoot, { recursive: true })
  return researchRoot
}

function discoverMarkdownFiles(projectId: string): string[] {
  const researchRoot = ensureKnowledgeDirectory(projectId)
  const files: string[] = []
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = pathInside(directory, entry.name)
      if (entry.isSymbolicLink()) throw new KnowledgeDocumentError('knowledge_symlink_rejected', 'research 目录中不能包含符号链接。')
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) continue
        visit(entryPath)
      } else if (entry.isFile() && entry.name.endsWith('.md')) files.push(normalizeRelativePath(projectId, entryPath))
    }
  }
  visit(researchRoot)
  return files.sort()
}

function gitMetadataForPaths(projectId: string, relativePaths: string[]): Map<string, { commit: string | null; dirty: boolean }> {
  const cwd = projectRoot(projectId)
  const requested = new Set(relativePaths)
  const commits = new Map<string, string>()
  try {
    const history = execFileSync(gitBinary(), ['log', '--no-renames', '--format=@@%H', '--name-only', '--', 'research'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024 })
    let currentCommit: string | null = null
    for (const line of history.split(/\r?\n/)) {
      if (line.startsWith('@@')) {
        currentCommit = line.slice(2).trim() || null
        continue
      }
      const path = line.trim()
      if (currentCommit && requested.has(path) && !commits.has(path)) commits.set(path, currentCommit)
    }
  } catch { /* An untracked research tree has no Git history yet. */ }
  const dirty = new Set<string>()
  const status = execFileSync(gitBinary(), ['status', '--porcelain=v1', '--untracked-files=all', '--', 'research'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 })
  for (const line of status.split(/\r?\n/)) {
    if (line.length < 4) continue
    const path = line.slice(3).split(' -> ').at(-1)?.trim() || ''
    if (requested.has(path)) dirty.add(path)
  }
  return new Map(relativePaths.map(path => [path, { commit: commits.get(path) ?? null, dirty: dirty.has(path) }]))
}

function parsedCachePrefix(projectId: string, relativePath: string): string {
  return `${projectId}\u0000${relativePath}\u0000`
}

function cacheParsedDocument(projectId: string, relativePath: string, source: string, sha256: string, parsed?: ParsedKnowledgeDocument): ParsedKnowledgeDocument {
  const prefix = parsedCachePrefix(projectId, relativePath)
  const key = `${prefix}${sha256}`
  const cached = parsedDocumentCache.get(key)
  if (cached) {
    parsedDocumentCache.delete(key)
    parsedDocumentCache.set(key, cached)
    return cached.parsed
  }
  const value = parsed ?? parseKnowledgeMarkdown(source, projectId, relativePath)
  for (const [existingKey, entry] of parsedDocumentCache) {
    if (!existingKey.startsWith(prefix)) continue
    parsedDocumentCache.delete(existingKey)
    parsedDocumentCacheBytes -= entry.bytes
  }
  const entry = { parsed: value, bytes: Buffer.byteLength(source, 'utf8') }
  parsedDocumentCache.set(key, entry)
  parsedDocumentCacheBytes += entry.bytes
  while (parsedDocumentCache.size > MAX_PARSED_CACHE_ENTRIES || parsedDocumentCacheBytes > MAX_PARSED_CACHE_BYTES) {
    const oldestKey = parsedDocumentCache.keys().next().value as string | undefined
    if (!oldestKey) break
    const oldest = parsedDocumentCache.get(oldestKey)
    parsedDocumentCache.delete(oldestKey)
    parsedDocumentCacheBytes -= oldest?.bytes ?? 0
  }
  return value
}

function observeDocument(projectId: string, relativePath: string, git: { commit: string | null; dirty: boolean }): ObservedDocument {
  const absolutePath = assertNoSymlink(projectId, relativePath)
  if (!existsSync(absolutePath) || !lstatSync(absolutePath).isFile()) throw new KnowledgeDocumentError('knowledge_document_not_found', '知识文档不存在。', 404)
  const source = readFileSync(absolutePath, 'utf8')
  const documentSha256 = createHash('sha256').update(source).digest('hex')
  let parsed: ParsedKnowledgeDocument
  try {
    parsed = cacheParsedDocument(projectId, relativePath, source, documentSha256)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'knowledge_document_invalid'
    throw new KnowledgeDocumentError(message.split(':')[0] || 'knowledge_document_invalid', `知识文档 ${relativePath} 未通过校验：${message}`)
  }
  assertKnowledgePathForKind(relativePath, parsed.frontmatter.kind)
  const stat = statSync(absolutePath)
  return { relativePath, absolutePath, parsed, size: stat.size, mtimeMs: stat.mtimeMs, gitCommit: git.commit, gitDirty: git.dirty }
}

function documentMetadata(parsed: ParsedKnowledgeDocument): Record<string, unknown> {
  return {
    depends_on: parsed.frontmatter.depends_on,
    workspace_scopes: parsed.frontmatter.workspace_scopes,
    paper_id: parsed.frontmatter.paper_id ?? null,
    experiment_id: parsed.frontmatter.experiment_id ?? null,
    run_id: parsed.frontmatter.run_id ?? null,
    artifact_ids: parsed.frontmatter.artifact_ids,
    evidence_ids: parsed.frontmatter.evidence_ids,
    read_scope: parsed.frontmatter.read_scope ?? null,
    title: parsed.frontmatter.title,
    headings: parsed.headings,
  }
}

function cachedParsedDocument(row: KnowledgeDocumentRow, source: string): ParsedKnowledgeDocument {
  return cacheParsedDocument(row.project_id, row.relative_path, source, row.current_sha256)
}

async function declaredAndBoundDependencies(projectId: string, frontmatter: KnowledgeDocumentFrontMatter, latestIdeaId?: string | null): Promise<Array<{ id: string; relation: string; impact: KnowledgeImpactPolicy }>> {
  const dependencies = [...frontmatter.depends_on]
  if (frontmatter.kind === 'idea') {
    const ideaId = latestIdeaId === undefined
      ? (await one<{ id: string }>('SELECT id FROM idea_versions WHERE project_id=$1 ORDER BY version DESC LIMIT 1', [projectId]))?.id
      : latestIdeaId
    if (ideaId) dependencies.push({ id: `idea_version:${ideaId}`, relation: 'represents', impact: 'review_required' })
  }
  if (frontmatter.paper_id) dependencies.push({ id: `paper:${frontmatter.paper_id}`, relation: 'summarizes', impact: 'review_required' })
  if (frontmatter.experiment_id && ['run_result', 'experiment_synthesis'].includes(frontmatter.kind)) dependencies.push({ id: `experiment:${frontmatter.experiment_id}`, relation: 'summarizes', impact: 'rerun_required' })
  for (const evidenceId of frontmatter.evidence_ids) dependencies.push({ id: `evidence:${evidenceId}`, relation: 'supported_by', impact: 'evidence_blocked' })
  for (const artifactId of frontmatter.artifact_ids) dependencies.push({ id: `artifact:${artifactId}`, relation: 'references_artifact', impact: 'evidence_blocked' })
  const unique = new Map<string, { id: string; relation: string; impact: KnowledgeImpactPolicy }>()
  for (const dependency of dependencies) unique.set(`${dependency.id}\u0000${dependency.relation}`, dependency)
  return [...unique.values()]
}

export async function reconcileKnowledgeDocuments(
  projectId: string,
  observedSource: 'api' | 'poller' | 'startup' | 'test' = 'startup',
): Promise<{ documents: ReconciledKnowledgeDocument[]; missing_document_ids: string[] }> {
  const project = await one<{ id: string }>('SELECT id FROM projects WHERE id=$1', [projectId])
  if (!project) throw new KnowledgeDocumentError('project_not_found', '项目不存在。', 404)
  const relativePaths = discoverMarkdownFiles(projectId)
  const gitByPath = gitMetadataForPaths(projectId, relativePaths)
  const observations = relativePaths.map(relativePath => observeDocument(projectId, relativePath, gitByPath.get(relativePath) ?? { commit: null, dirty: true }))
  const ids = new Set<string>()
  for (const observed of observations) {
    const id = observed.parsed.frontmatter.id
    if (ids.has(id)) throw new KnowledgeDocumentError('knowledge_document_id_duplicate', `项目中存在重复知识文档 ID：${id}`, 409)
    ids.add(id)
  }

  const existing = await rows<KnowledgeDocumentRow>('SELECT * FROM knowledge_documents WHERE project_id=$1', [projectId])
  const byId = new Map(existing.map(row => [row.document_id, row]))
  const byPath = new Map(existing.map(row => [row.relative_path, row]))
  for (const observed of observations) {
    const id = observed.parsed.frontmatter.id
    const pathOwner = byPath.get(observed.relativePath)
    if (pathOwner && pathOwner.document_id !== id) {
      throw new KnowledgeDocumentError('knowledge_document_path_conflict', `路径 ${observed.relativePath} 已绑定到另一个知识文档 ID。`, 409)
    }
  }

  const seenIds = observations.map(item => item.parsed.frontmatter.id)
  const upserts = observations.map(observed => {
    const frontmatter = observed.parsed.frontmatter
    const previous = byId.get(frontmatter.id)
    const changed = previous?.current_sha256 !== observed.parsed.document_sha256
    const nextHealth: KnowledgeSystemHealth = changed || !previous?.active_index_generation ? 'index_stale' : previous.system_health
    return {
      project_id: projectId,
      document_id: frontmatter.id,
      relative_path: observed.relativePath,
      kind: frontmatter.kind,
      schema_version: KNOWLEDGE_DOCUMENT_SCHEMA,
      author_status: frontmatter.status,
      system_health: nextHealth,
      current_sha256: observed.parsed.document_sha256,
      current_git_commit: observed.gitCommit,
      git_dirty: observed.gitDirty,
      file_size_bytes: observed.size,
      file_mtime_ms: observed.mtimeMs,
      metadata: documentMetadata(observed.parsed),
    }
  })
  const revisions = observations.flatMap(observed => {
    const frontmatter = observed.parsed.frontmatter
    const previous = byId.get(frontmatter.id)
    if (previous?.current_sha256 === observed.parsed.document_sha256) return []
    return [{
      id: crypto.randomUUID(),
      project_id: projectId,
      document_id: frontmatter.id,
      content_sha256: observed.parsed.document_sha256,
      body_sha256: observed.parsed.body_sha256,
      git_commit: observed.gitCommit,
      git_dirty: observed.gitDirty,
      file_size_bytes: observed.size,
      frontmatter,
      parser_version: observed.parsed.parser_version,
      observed_source: observedSource,
    }]
  })
  await database.transaction(async transaction => {
    if (upserts.length) {
      await transaction.query(`INSERT INTO knowledge_documents(
        project_id,document_id,relative_path,kind,schema_version,author_status,system_health,current_sha256,current_git_commit,git_dirty,file_size_bytes,file_mtime_ms,metadata,present,last_seen_at,missing_since
      ) SELECT project_id,document_id,relative_path,kind,schema_version,author_status,system_health,current_sha256,current_git_commit,git_dirty,file_size_bytes,file_mtime_ms,metadata,TRUE,NOW(),NULL
      FROM jsonb_to_recordset($1::jsonb) AS item(
        project_id TEXT,document_id TEXT,relative_path TEXT,kind TEXT,schema_version TEXT,author_status TEXT,system_health TEXT,current_sha256 TEXT,
        current_git_commit TEXT,git_dirty BOOLEAN,file_size_bytes BIGINT,file_mtime_ms DOUBLE PRECISION,metadata JSONB
      )
      ON CONFLICT(project_id,document_id) DO UPDATE SET
        relative_path=EXCLUDED.relative_path,kind=EXCLUDED.kind,schema_version=EXCLUDED.schema_version,author_status=EXCLUDED.author_status,
        system_health=EXCLUDED.system_health,current_sha256=EXCLUDED.current_sha256,current_git_commit=EXCLUDED.current_git_commit,
        git_dirty=EXCLUDED.git_dirty,file_size_bytes=EXCLUDED.file_size_bytes,file_mtime_ms=EXCLUDED.file_mtime_ms,
        metadata=EXCLUDED.metadata,active_index_generation=CASE WHEN knowledge_documents.current_sha256 IS DISTINCT FROM EXCLUDED.current_sha256 THEN NULL ELSE knowledge_documents.active_index_generation END,
        present=TRUE,last_seen_at=NOW(),missing_since=NULL,updated_at=NOW()`, [JSON.stringify(upserts)])
    }
    if (revisions.length) {
      await transaction.query(`INSERT INTO knowledge_document_revisions(
        id,project_id,document_id,content_sha256,body_sha256,git_commit,git_dirty,file_size_bytes,frontmatter,parser_version,observed_source
      ) SELECT id,project_id,document_id,content_sha256,body_sha256,git_commit,git_dirty,file_size_bytes,frontmatter,parser_version,observed_source
      FROM jsonb_to_recordset($1::jsonb) AS item(
        id UUID,project_id TEXT,document_id TEXT,content_sha256 TEXT,body_sha256 TEXT,git_commit TEXT,git_dirty BOOLEAN,file_size_bytes BIGINT,
        frontmatter JSONB,parser_version TEXT,observed_source TEXT
      ) ON CONFLICT(project_id,document_id,content_sha256) DO NOTHING`, [JSON.stringify(revisions)])
    }
    if (seenIds.length) {
      await transaction.query(`UPDATE knowledge_documents SET present=FALSE,system_health='blocked',missing_since=COALESCE(missing_since,NOW()),updated_at=NOW()
        WHERE project_id=$1 AND NOT (document_id = ANY($2::varchar[])) AND present=TRUE`, [projectId, seenIds])
    } else {
      await transaction.query("UPDATE knowledge_documents SET present=FALSE,system_health='blocked',missing_since=COALESCE(missing_since,NOW()),updated_at=NOW() WHERE project_id=$1 AND present=TRUE", [projectId])
    }
  })

  const latestIdeaId = (await one<{ id: string }>('SELECT id FROM idea_versions WHERE project_id=$1 ORDER BY version DESC LIMIT 1', [projectId]))?.id ?? null
  const lineageInputs = observations
    .filter(observed => {
      const previous = byId.get(observed.parsed.frontmatter.id)
      return !previous || previous.current_sha256 !== observed.parsed.document_sha256 || previous.relative_path !== observed.relativePath || !previous.present
    })
    .map(observed => ({ document_id: observed.parsed.frontmatter.id, dependencies: declaredAndBoundDependencies(projectId, observed.parsed.frontmatter, latestIdeaId) }))
  const resolvedLineageInputs = await Promise.all(lineageInputs.map(async input => ({ document_id: input.document_id, dependencies: await input.dependencies })))
  await syncKnowledgeDocumentLineageBatch(projectId, resolvedLineageInputs)
  const changedNodes = observations
    .filter(observed => {
      const previous = byId.get(observed.parsed.frontmatter.id)
      return Boolean(previous && previous.current_sha256 !== observed.parsed.document_sha256)
    })
    .map(observed => ({ type: 'knowledge_document' as const, id: observed.parsed.frontmatter.id }))
  const missingNodes = existing
    .filter(row => row.present && !ids.has(row.document_id))
    .map(row => ({ type: 'knowledge_document' as const, id: row.document_id }))
  for (const missing of missingNodes) {
    await database.query("DELETE FROM lineage_dependencies WHERE project_id=$1 AND downstream_type='knowledge_document' AND downstream_id=$2", [projectId, missing.id])
  }
  if (changedNodes.length || missingNodes.length) {
    await propagateLineageImpacts(projectId, [...changedNodes, ...missingNodes], observedSource === 'poller' ? 'knowledge_external_edit' : 'knowledge_document_changed', observedSource)
  }

  const currentRows = await rows<KnowledgeDocumentRow>('SELECT * FROM knowledge_documents WHERE project_id=$1 AND document_id=ANY($2::text[])', [projectId, seenIds])
  const currentById = new Map(currentRows.map(row => [row.document_id, row]))
  const reconciled: ReconciledKnowledgeDocument[] = observations.map(observed => {
    const row = currentById.get(observed.parsed.frontmatter.id)
    if (!row) throw new Error('knowledge_reconcile_row_missing')
    const previous = byId.get(row.document_id)
    return { row, parsed: observed.parsed, changed: previous?.current_sha256 !== row.current_sha256, renamed: Boolean(previous && previous.relative_path !== row.relative_path) }
  })
  const missingDocumentIds = existing.filter(row => !ids.has(row.document_id) && row.present).map(row => row.document_id)
  await audit('knowledge.documents_reconciled', projectId, {
    observed_source: observedSource,
    document_count: reconciled.length,
    changed_document_ids: reconciled.filter(item => item.changed).map(item => item.row.document_id),
    renamed_document_ids: reconciled.filter(item => item.renamed).map(item => item.row.document_id),
    missing_document_ids: missingDocumentIds,
  })
  return { documents: reconciled, missing_document_ids: missingDocumentIds }
}

export async function listKnowledgeDocuments(projectId: string, includeMissing = false): Promise<KnowledgeDocumentRow[]> {
  return rows<KnowledgeDocumentRow>(
    `SELECT * FROM knowledge_documents WHERE project_id=$1${includeMissing ? '' : ' AND present=TRUE'} ORDER BY kind,relative_path`,
    [projectId],
  )
}

export function knowledgeFilesystemChanged(projectId: string, registered: KnowledgeDocumentRow[]): boolean {
  const paths = discoverMarkdownFiles(projectId)
  const byPath = new Map(registered.map(row => [row.relative_path, row]))
  const seen = new Set<string>()
  for (const relativePath of paths) {
    const row = byPath.get(relativePath)
    const absolutePath = assertNoSymlink(projectId, relativePath)
    const stat = statSync(absolutePath)
    seen.add(relativePath)
    if (!row || !row.present || row.file_size_bytes !== stat.size || Math.abs(row.file_mtime_ms - stat.mtimeMs) > 0.01) return true
  }
  return registered.some(row => row.present && !seen.has(row.relative_path))
}

export async function readKnowledgeDocument(projectId: string, documentId: string): Promise<{ row: KnowledgeDocumentRow; source: string; parsed: ParsedKnowledgeDocument }> {
  const row = await one<KnowledgeDocumentRow>('SELECT * FROM knowledge_documents WHERE project_id=$1 AND document_id=$2 AND present=TRUE', [projectId, documentId])
  if (!row) throw new KnowledgeDocumentError('knowledge_document_not_found', '知识文档不存在。', 404)
  return readRegisteredKnowledgeDocument(row)
}

export function readRegisteredKnowledgeDocument(row: KnowledgeDocumentRow): { row: KnowledgeDocumentRow; source: string; parsed: ParsedKnowledgeDocument } {
  const absolutePath = assertNoSymlink(row.project_id, row.relative_path)
  const source = readFileSync(absolutePath, 'utf8')
  const currentSha = createHash('sha256').update(source).digest('hex')
  if (currentSha !== row.current_sha256) throw new KnowledgeDocumentError('knowledge_document_reconcile_required', '知识文档已在外部修改，请先完成对账。', 409)
  return { row, source, parsed: cachedParsedDocument(row, source) }
}
