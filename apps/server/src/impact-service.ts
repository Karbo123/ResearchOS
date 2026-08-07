import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { pathInside, projectsRoot } from './paths.js'
import { projectFilePath } from './project-storage.js'
import { database, audit, one, rows } from './database.js'
import { ApiError } from './http.js'
import { knowledgeImpactPolicy, type KnowledgeImpactPolicy } from './knowledge-document-contracts.js'

export type LineageNodeType = 'idea_version' | 'paper' | 'evidence' | 'repository' | 'reproduction' | 'reproduction_run' | 'uploaded_file' | 'artifact' | 'experiment' | 'checkpoint' | 'git_commit' | 'data_version' | 'config' | 'knowledge_document'
export type LineageNode = { type: LineageNodeType; id: string }
export type LineageDependency = { downstream: LineageNode; upstream: LineageNode; relation: string; impact_policy?: KnowledgeImpactPolicy }

const nodeTypes = new Set<LineageNodeType>(['idea_version', 'paper', 'evidence', 'repository', 'reproduction', 'reproduction_run', 'uploaded_file', 'artifact', 'experiment', 'checkpoint', 'git_commit', 'data_version', 'config', 'knowledge_document'])
const DEFAULT_MAX_DEPTH = 20
const DEFAULT_MAX_NODES = 500

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableValue(item)]))
  return value
}

export function fingerprintValue(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')
}

function validateNode(node: LineageNode): void {
  if (!nodeTypes.has(node.type) || node.id.length > 255 || !/^[A-Za-z0-9_.:/-]+$/.test(node.id) || node.id.includes('..') || node.id.includes('//')) throw new ApiError(422, 'lineage_node_invalid', '依赖谱系节点无效。')
}

export async function fingerprintNode(projectId: string, node: LineageNode): Promise<string> {
  validateNode(node)
  if (node.type === 'git_commit' || node.type === 'data_version' || node.type === 'config') return fingerprintValue({ type: node.type, id: node.id })
  if (node.type === 'knowledge_document') {
    const record = await one<Record<string, unknown>>('SELECT project_id,document_id,kind,author_status,system_health,current_sha256,current_git_commit,present,metadata FROM knowledge_documents WHERE project_id=$1 AND document_id=$2 AND present=TRUE', [projectId, node.id])
    if (!record) throw new ApiError(404, 'lineage_node_not_found', '依赖谱系节点不存在或不属于当前项目。')
    return fingerprintValue(record)
  }
  const tables: Record<Exclude<LineageNodeType, 'git_commit' | 'data_version' | 'config' | 'knowledge_document'>, { table: string; columns: string }> = {
    idea_version: { table: 'idea_versions', columns: 'id,project_id,version,spec,change_reason,supersedes_id' },
    paper: { table: 'papers', columns: 'id,project_id,title,doi,source_url,metadata,bibtex,verified' },
    evidence: { table: 'evidence', columns: 'id,project_id,paper_id,claim,quote,locator,source_url,metadata' },
    repository: { table: 'repositories', columns: 'id,project_id,source_url,license_spdx,commit_or_tag,verified_official,metadata' },
    reproduction: { table: 'reproductions', columns: 'id,project_id,repository_id,status,source_commit,repository_relative_path,dependency_manifest,dependency_sha256,venv_relative_path,entrypoint,plan,dependency_report,error' },
    reproduction_run: { table: 'reproduction_runs', columns: 'id,project_id,reproduction_id,proposal_id,status,source_commit,entrypoint,random_seeds,config,run_relative_path,output_manifest,metrics,artifact_proposal_id,artifact_ids,error' },
    uploaded_file: { table: 'uploaded_files', columns: 'id,project_id,name,size_bytes,sha256,metadata' },
    artifact: { table: 'artifacts', columns: 'id,project_id,experiment_id,kind,name,relative_path,sha256,metadata,valid' },
    experiment: { table: 'experiments', columns: 'id,project_id,proposal_id,status,experiment_type,config,metrics,run_id,error' },
    checkpoint: { table: 'checkpoints', columns: 'id,project_id,stage,idea_version,git_commit,data_version,state,valid,invalidated_reason' },
  }
  const definition = tables[node.type]
  const record = await one<Record<string, unknown>>(`SELECT ${definition.columns} FROM ${definition.table} WHERE id=$1 AND project_id=$2`, [node.id, projectId])
  if (!record) throw new ApiError(404, 'lineage_node_not_found', '依赖谱系节点不存在或不属于当前项目。')
  return fingerprintValue(record)
}

export async function registerLineageDependencies(projectId: string, dependencies: LineageDependency[]): Promise<Array<LineageDependency & { upstream_fingerprint: string }>> {
  const registered: Array<LineageDependency & { upstream_fingerprint: string }> = []
  for (const dependency of dependencies) {
    validateNode(dependency.downstream)
    validateNode(dependency.upstream)
    if (dependency.downstream.type === dependency.upstream.type && dependency.downstream.id === dependency.upstream.id) throw new ApiError(422, 'lineage_self_dependency', '依赖谱系不能包含自依赖。')
    const impactPolicy = dependency.impact_policy ? knowledgeImpactPolicy.parse(dependency.impact_policy) : null
    const upstreamFingerprint = await fingerprintNode(projectId, dependency.upstream)
    await database.query(`INSERT INTO lineage_dependencies(id,project_id,downstream_type,downstream_id,upstream_type,upstream_id,upstream_fingerprint,relation,impact_policy)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (project_id,downstream_type,downstream_id,upstream_type,upstream_id,relation)
      DO UPDATE SET upstream_fingerprint=$7,impact_policy=$9,valid=TRUE,invalidated_reason=NULL,invalidated_at=NULL`, [crypto.randomUUID(), projectId, dependency.downstream.type, dependency.downstream.id, dependency.upstream.type, dependency.upstream.id, upstreamFingerprint, dependency.relation, impactPolicy])
    registered.push({ ...dependency, ...(impactPolicy ? { impact_policy: impactPolicy } : {}), upstream_fingerprint: upstreamFingerprint })
  }
  return registered
}

const dependencyEntityTypes: Partial<Record<string, LineageNodeType>> = {
  idea_version: 'idea_version',
  paper: 'paper',
  evidence: 'evidence',
  repository: 'repository',
  reproduction: 'reproduction',
  reproduction_run: 'reproduction_run',
  uploaded_file: 'uploaded_file',
  artifact: 'artifact',
  experiment: 'experiment',
  checkpoint: 'checkpoint',
  git_commit: 'git_commit',
  data_version: 'data_version',
  config: 'config',
}

async function resolveDeclaredDependency(projectId: string, declaredId: string): Promise<LineageNode> {
  const document = await one<{ document_id: string }>('SELECT document_id FROM knowledge_documents WHERE project_id=$1 AND document_id=$2 AND present=TRUE', [projectId, declaredId])
  if (document) return { type: 'knowledge_document', id: document.document_id }
  const separator = declaredId.indexOf(':')
  const namespace = separator > 0 ? declaredId.slice(0, separator) : ''
  const entityId = separator > 0 ? declaredId.slice(separator + 1) : ''
  const nodeType = dependencyEntityTypes[namespace]
  if (!nodeType || !entityId) throw new ApiError(422, 'knowledge_dependency_target_invalid', `知识依赖 ${declaredId} 不是已登记知识文档或受支持的项目实体引用。`)
  const node = { type: nodeType, id: entityId } as LineageNode
  await fingerprintNode(projectId, node)
  return node
}

export async function syncKnowledgeDocumentLineage(projectId: string, documentId: string, dependencies: Array<{ id: string; relation: string; impact: KnowledgeImpactPolicy }>): Promise<{ registered: number; unresolved: Array<{ id: string; code: string; impact: KnowledgeImpactPolicy }> }> {
  const downstream: LineageNode = { type: 'knowledge_document', id: documentId }
  await fingerprintNode(projectId, downstream)
  const resolved: LineageDependency[] = []
  const unresolved: Array<{ id: string; code: string; impact: KnowledgeImpactPolicy }> = []
  for (const dependency of dependencies) {
    try {
      resolved.push({ downstream, upstream: await resolveDeclaredDependency(projectId, dependency.id), relation: dependency.relation, impact_policy: dependency.impact })
    } catch (error) {
      const code = error instanceof ApiError ? error.code : 'knowledge_dependency_resolution_failed'
      unresolved.push({ id: dependency.id, code, impact: dependency.impact })
    }
  }
  const keys = new Set(resolved.map(dependency => `${dependency.upstream.type}\u0000${dependency.upstream.id}\u0000${dependency.relation}`))
  const existing = await rows<{ id: string; upstream_type: LineageNodeType; upstream_id: string; relation: string }>("SELECT id,upstream_type,upstream_id,relation FROM lineage_dependencies WHERE project_id=$1 AND downstream_type='knowledge_document' AND downstream_id=$2", [projectId, documentId])
  for (const edge of existing) {
    if (!keys.has(`${edge.upstream_type}\u0000${edge.upstream_id}\u0000${edge.relation}`)) await database.query('DELETE FROM lineage_dependencies WHERE id=$1 AND project_id=$2', [edge.id, projectId])
  }
  if (resolved.length) await registerLineageDependencies(projectId, resolved)
  const row = await one<{ metadata: Record<string, unknown>; active_index_generation: string | null; system_health: string }>('SELECT metadata,active_index_generation,system_health FROM knowledge_documents WHERE project_id=$1 AND document_id=$2', [projectId, documentId])
  if (row) {
    const metadata = { ...(row.metadata || {}), unresolved_dependencies: unresolved }
    let health = row.system_health
    if (unresolved.some(item => item.impact === 'evidence_blocked')) health = 'blocked'
    else if (unresolved.length && row.system_health === 'current') health = 'stale'
    else if (row.system_health === 'blocked') health = row.active_index_generation ? await knowledgeDocumentHealthAfterIndex(projectId, documentId) : 'index_stale'
    await database.query('UPDATE knowledge_documents SET metadata=$3,system_health=$4,updated_at=NOW() WHERE project_id=$1 AND document_id=$2', [projectId, documentId, metadata, health])
  }
  if (unresolved.length) await audit('knowledge.dependencies_blocked', projectId, { document_id: documentId, unresolved })
  return { registered: resolved.length, unresolved }
}

type KnowledgeLineageInput = {
  document_id: string
  dependencies: Array<{ id: string; relation: string; impact: KnowledgeImpactPolicy }>
}

type KnowledgeLineageResult = {
  document_id: string
  registered: number
  unresolved: Array<{ id: string; code: string; impact: KnowledgeImpactPolicy }>
}

const bulkFingerprintDefinitions: Record<string, { table: string; columns: string }> = {
  idea_version: { table: 'idea_versions', columns: 'id,project_id,version,spec,change_reason,supersedes_id' },
  paper: { table: 'papers', columns: 'id,project_id,title,doi,source_url,metadata,bibtex,verified' },
  evidence: { table: 'evidence', columns: 'id,project_id,paper_id,claim,quote,locator,source_url,metadata' },
  repository: { table: 'repositories', columns: 'id,project_id,source_url,license_spdx,commit_or_tag,verified_official,metadata' },
  reproduction: { table: 'reproductions', columns: 'id,project_id,repository_id,status,source_commit,repository_relative_path,dependency_manifest,dependency_sha256,venv_relative_path,entrypoint,plan,dependency_report,error' },
  reproduction_run: { table: 'reproduction_runs', columns: 'id,project_id,reproduction_id,proposal_id,status,source_commit,entrypoint,random_seeds,config,run_relative_path,output_manifest,metrics,artifact_proposal_id,artifact_ids,error' },
  uploaded_file: { table: 'uploaded_files', columns: 'id,project_id,name,size_bytes,sha256,metadata' },
  artifact: { table: 'artifacts', columns: 'id,project_id,experiment_id,kind,name,relative_path,sha256,metadata,valid' },
  experiment: { table: 'experiments', columns: 'id,project_id,proposal_id,status,experiment_type,config,metrics,run_id,error' },
  checkpoint: { table: 'checkpoints', columns: 'id,project_id,stage,idea_version,git_commit,data_version,state,valid,invalidated_reason' },
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function knowledgeDocumentFingerprintRecord(row: Record<string, unknown>): Record<string, unknown> {
  return {
    project_id: row.project_id,
    document_id: row.document_id,
    kind: row.kind,
    author_status: row.author_status,
    system_health: row.system_health,
    current_sha256: row.current_sha256,
    current_git_commit: row.current_git_commit,
    present: row.present,
    metadata: row.metadata,
  }
}

/**
 * Reconcile many Markdown front matters in one database pass. The public
 * single-document path remains intentionally simple; the watcher/migration
 * path uses this batch form so a large project does not perform thousands of
 * independent PGlite round trips for unchanged dependency edges.
 */
export async function syncKnowledgeDocumentLineageBatch(projectId: string, inputs: KnowledgeLineageInput[]): Promise<KnowledgeLineageResult[]> {
  if (!inputs.length) return []
  const documentIds = [...new Set(inputs.map(input => input.document_id))]
  for (const documentId of documentIds) validateNode({ type: 'knowledge_document', id: documentId })
  const documents = await rows<Record<string, unknown>>(
    'SELECT project_id,document_id,kind,author_status,system_health,current_sha256,current_git_commit,present,metadata,active_index_generation FROM knowledge_documents WHERE project_id=$1 AND document_id=ANY($2::text[]) AND present=TRUE',
    [projectId, documentIds],
  )
  const documentById = new Map(documents.map(document => [String(document.document_id), document]))
  if (documentById.size !== documentIds.length) throw new ApiError(404, 'lineage_node_not_found', '知识文档不存在或不属于当前项目。')

  const dependencyEntityTypes: Partial<Record<string, LineageNodeType>> = {
    idea_version: 'idea_version', paper: 'paper', evidence: 'evidence', repository: 'repository',
    reproduction: 'reproduction', reproduction_run: 'reproduction_run', uploaded_file: 'uploaded_file',
    artifact: 'artifact', experiment: 'experiment', checkpoint: 'checkpoint',
    git_commit: 'git_commit', data_version: 'data_version', config: 'config',
  }
  const resolvedByDeclaration = new Map<string, { node: LineageNode; fingerprint: string }>()
  const declarations = new Set<string>()
  for (const input of inputs) for (const dependency of input.dependencies) declarations.add(dependency.id)
  const documentDeclarations = [...declarations]
    .map(value => value.startsWith('knowledge_document:') || value.startsWith('document:') ? value.slice(value.indexOf(':') + 1) : value)
    .filter(value => value.includes(':'))
  const referencedDocumentIds = [...new Set(documentDeclarations)]
  const referencedDocuments = referencedDocumentIds.length
    ? await rows<Record<string, unknown>>('SELECT project_id,document_id,kind,author_status,system_health,current_sha256,current_git_commit,present,metadata,active_index_generation FROM knowledge_documents WHERE project_id=$1 AND document_id=ANY($2::text[]) AND present=TRUE', [projectId, referencedDocumentIds])
    : []
  const allDocumentsById = new Map([...documents, ...referencedDocuments].map(document => [String(document.document_id), document]))
  for (const declaration of declarations) {
    const directDocument = allDocumentsById.get(declaration)
    if (directDocument) {
      resolvedByDeclaration.set(declaration, { node: { type: 'knowledge_document', id: declaration }, fingerprint: fingerprintValue(knowledgeDocumentFingerprintRecord(directDocument)) })
      continue
    }
    const separator = declaration.indexOf(':')
    const namespace = separator > 0 ? declaration.slice(0, separator) : ''
    const entityId = separator > 0 ? declaration.slice(separator + 1) : ''
    if (allDocumentsById.has(entityId) && (namespace === 'knowledge_document' || namespace === 'document')) {
      const referenced = allDocumentsById.get(entityId)!
      resolvedByDeclaration.set(declaration, { node: { type: 'knowledge_document', id: entityId }, fingerprint: fingerprintValue(knowledgeDocumentFingerprintRecord(referenced)) })
      continue
    }
    const nodeType = dependencyEntityTypes[namespace]
    if (!nodeType) continue
    if (nodeType === 'git_commit' || nodeType === 'data_version' || nodeType === 'config') {
      resolvedByDeclaration.set(declaration, { node: { type: nodeType, id: entityId }, fingerprint: fingerprintValue({ type: nodeType, id: entityId }) })
    }
  }

  const idsByType = new Map<string, Set<string>>()
  for (const declaration of declarations) {
    const separator = declaration.indexOf(':')
    const nodeType = separator > 0 ? dependencyEntityTypes[declaration.slice(0, separator)] : undefined
    const entityId = separator > 0 ? declaration.slice(separator + 1) : ''
    if (!nodeType || ['git_commit', 'data_version', 'config'].includes(nodeType) || !entityId || !isUuid(entityId)) continue
    const ids = idsByType.get(nodeType) ?? new Set<string>()
    ids.add(entityId)
    idsByType.set(nodeType, ids)
  }
  for (const [nodeType, ids] of idsByType) {
    const definition = bulkFingerprintDefinitions[nodeType]
    if (!definition) continue
    const found = await rows<Record<string, unknown>>(`SELECT ${definition.columns} FROM ${definition.table} WHERE project_id=$1 AND id=ANY($2::uuid[])`, [projectId, [...ids]])
    const foundById = new Map(found.map(row => [String(row.id), row]))
    for (const id of ids) {
      const row = foundById.get(id)
      if (row) resolvedByDeclaration.set(`${nodeType}:${id}`, { node: { type: nodeType as LineageNodeType, id }, fingerprint: fingerprintValue(row) })
    }
  }

  const existing = await rows<{ id: string; downstream_id: string; upstream_type: LineageNodeType; upstream_id: string; relation: string }>(
    "SELECT id,downstream_id,upstream_type,upstream_id,relation FROM lineage_dependencies WHERE project_id=$1 AND downstream_type='knowledge_document' AND downstream_id=ANY($2::text[])",
    [projectId, documentIds],
  )
  const existingByDocument = new Map<string, typeof existing>()
  for (const edge of existing) {
    const list = existingByDocument.get(edge.downstream_id) ?? []
    list.push(edge)
    existingByDocument.set(edge.downstream_id, list)
  }
  const resolvedEdges: Array<{ input: KnowledgeLineageInput; dependency: { id: string; relation: string; impact: KnowledgeImpactPolicy }; upstream: LineageNode; fingerprint: string }> = []
  const results: KnowledgeLineageResult[] = []
  const unresolvedByDocument = new Map<string, Array<{ id: string; code: string; impact: KnowledgeImpactPolicy }>>()
  for (const input of inputs) {
    const unresolved: Array<{ id: string; code: string; impact: KnowledgeImpactPolicy }> = []
    const keys = new Set<string>()
    for (const dependency of input.dependencies) {
      const resolved = resolvedByDeclaration.get(dependency.id)
      const separator = dependency.id.indexOf(':')
      const namespace = separator > 0 ? dependency.id.slice(0, separator) : ''
      const entityId = separator > 0 ? dependency.id.slice(separator + 1) : ''
      if (!resolved && (!namespace || !entityId || !dependencyEntityTypes[namespace])) {
        unresolved.push({ id: dependency.id, code: 'knowledge_dependency_target_invalid', impact: dependency.impact })
        continue
      }
      if (!resolved) {
        unresolved.push({ id: dependency.id, code: 'lineage_node_not_found', impact: dependency.impact })
        continue
      }
      if (resolved.node.type === 'knowledge_document' && resolved.node.id === input.document_id) throw new ApiError(422, 'lineage_self_dependency', '依赖谱系不能包含自依赖。')
      const key = `${resolved.node.type}\u0000${resolved.node.id}\u0000${dependency.relation}`
      if (keys.has(key)) continue
      keys.add(key)
      resolvedEdges.push({ input, dependency, upstream: resolved.node, fingerprint: resolved.fingerprint })
    }
    unresolvedByDocument.set(input.document_id, unresolved)
    results.push({ document_id: input.document_id, registered: input.dependencies.length - unresolved.length, unresolved })
  }

  const obsoleteEdgeIds: string[] = []
  for (const input of inputs) {
    const desired = new Set(resolvedEdges
      .filter(edge => edge.input.document_id === input.document_id)
      .map(edge => `${edge.upstream.type}\u0000${edge.upstream.id}\u0000${edge.dependency.relation}`))
    for (const edge of existingByDocument.get(input.document_id) ?? []) {
      if (!desired.has(`${edge.upstream_type}\u0000${edge.upstream_id}\u0000${edge.relation}`)) obsoleteEdgeIds.push(edge.id)
    }
  }

  await database.transaction(async transaction => {
    if (obsoleteEdgeIds.length) await transaction.query('DELETE FROM lineage_dependencies WHERE project_id=$1 AND id=ANY($2::uuid[])', [projectId, obsoleteEdgeIds])
    const edges = resolvedEdges.map(edge => ({
      id: crypto.randomUUID(),
      project_id: projectId,
      downstream_id: edge.input.document_id,
      upstream_type: edge.upstream.type,
      upstream_id: edge.upstream.id,
      upstream_fingerprint: edge.fingerprint,
      relation: edge.dependency.relation,
      impact_policy: edge.dependency.impact,
    }))
    for (let offset = 0; offset < edges.length; offset += 400) {
      const chunk = edges.slice(offset, offset + 400)
      await transaction.query(`INSERT INTO lineage_dependencies(
          id,project_id,downstream_type,downstream_id,upstream_type,upstream_id,upstream_fingerprint,relation,impact_policy
        ) SELECT id,project_id,'knowledge_document',downstream_id,upstream_type,upstream_id,upstream_fingerprint,relation,impact_policy
        FROM jsonb_to_recordset($1::jsonb) AS edge(
          id UUID,project_id TEXT,downstream_id TEXT,upstream_type TEXT,upstream_id TEXT,upstream_fingerprint TEXT,relation TEXT,impact_policy TEXT
        )
        ON CONFLICT(project_id,downstream_type,downstream_id,upstream_type,upstream_id,relation) DO UPDATE SET
          upstream_fingerprint=EXCLUDED.upstream_fingerprint,impact_policy=EXCLUDED.impact_policy,valid=TRUE,invalidated_reason=NULL,invalidated_at=NULL`, [JSON.stringify(chunk)])
    }
    const metadataUpdates = inputs.map(input => {
      const row = documentById.get(input.document_id)!
      const unresolved = unresolvedByDocument.get(input.document_id) ?? []
      const metadata = { ...((row.metadata || {}) as Record<string, unknown>), unresolved_dependencies: unresolved }
      let health = String(row.system_health)
      if (unresolved.some(item => item.impact === 'evidence_blocked')) health = 'blocked'
      else if (unresolved.length && health === 'current') health = 'stale'
      else if (health === 'blocked' && row.active_index_generation) health = 'stale'
      return { document_id: input.document_id, metadata, system_health: health }
    })
    await transaction.query(`UPDATE knowledge_documents AS document
      SET metadata=updates.metadata,system_health=updates.system_health,updated_at=NOW()
      FROM jsonb_to_recordset($2::jsonb) AS updates(document_id TEXT,metadata JSONB,system_health TEXT)
      WHERE document.project_id=$1 AND document.document_id=updates.document_id`, [projectId, JSON.stringify(metadataUpdates)])
  })
  const blocked = results.filter(result => result.unresolved.length)
  if (blocked.length) await audit('knowledge.dependencies_batch_blocked', projectId, { documents: blocked })
  return results
}

async function markMaterializedNodeInvalid(projectId: string, node: LineageNode, reason: string): Promise<void> {
  if (node.type === 'artifact') {
    const artifact = await one<Record<string, unknown>>('SELECT metadata FROM artifacts WHERE id=$1 AND project_id=$2', [node.id, projectId])
    if (artifact) await database.query('UPDATE artifacts SET valid=FALSE,metadata=$3 WHERE id=$1 AND project_id=$2', [node.id, projectId, { ...((artifact.metadata || {}) as Record<string, unknown>), lineage_invalidated: true, invalidation_reason: reason }])
  } else if (node.type === 'experiment') {
    await database.query("UPDATE experiments SET status='invalidated',error=$3,finished_at=COALESCE(finished_at,NOW()) WHERE id=$1 AND project_id=$2 AND status='succeeded'", [node.id, projectId, `dependency_invalidated:${reason}`])
  } else if (node.type === 'checkpoint') {
    await database.query('UPDATE checkpoints SET valid=FALSE,invalidated_reason=$3,invalidated_at=NOW() WHERE id=$1 AND project_id=$2', [node.id, projectId, reason])
  } else if (node.type === 'reproduction') {
    await database.query("UPDATE reproductions SET status='invalidated',error=$3,updated_at=NOW() WHERE id=$1 AND project_id=$2 AND status IN ('source_downloaded','dependency_installing','dependency_failed','ready')", [node.id, projectId, `dependency_invalidated:${reason}`])
  } else if (node.type === 'reproduction_run') {
    await database.query("UPDATE reproduction_runs SET status='invalidated',error=$3,finished_at=COALESCE(finished_at,NOW()) WHERE id=$1 AND project_id=$2 AND status IN ('queued','running','awaiting_artifact_approval')", [node.id, projectId, `dependency_invalidated:${reason}`])
  }
}

type ImpactEdgeRow = {
  id: string
  downstream_type: LineageNodeType
  downstream_id: string
  relation: string
  impact_policy: string | null
}

export type LineageImpactItem = {
  id: string
  report_id: string
  project_id: string
  node_type: LineageNodeType
  node_id: string
  policy: KnowledgeImpactPolicy
  status: string
  relation: string
  reason: string
  path: LineageNode[]
  depth: number
  proposal_id: string | null
  created_at: string
}

export type LineageImpactReport = {
  id: string
  project_id: string
  reason: string
  actor: string
  changed_nodes: LineageNode[]
  status: string
  summary: Record<string, unknown>
  created_at: string
  resolved_at: string | null
  items: LineageImpactItem[]
}

async function applyImpactPolicy(projectId: string, node: LineageNode, policy: KnowledgeImpactPolicy): Promise<void> {
  if (node.type !== 'knowledge_document' || policy === 'notify') return
  if (policy === 'evidence_blocked') {
    await database.query("UPDATE knowledge_documents SET system_health='blocked',updated_at=NOW() WHERE project_id=$1 AND document_id=$2 AND present=TRUE", [projectId, node.id])
    return
  }
  await database.query("UPDATE knowledge_documents SET system_health=CASE WHEN system_health='blocked' THEN system_health WHEN system_health IN ('indexing','index_stale','index_failed') THEN system_health ELSE 'stale' END,updated_at=NOW() WHERE project_id=$1 AND document_id=$2 AND present=TRUE", [projectId, node.id])
}

export async function knowledgeDocumentHealthAfterIndex(projectId: string, documentId: string): Promise<'current' | 'stale' | 'blocked'> {
  const document = await one<{ metadata: Record<string, unknown> }>('SELECT metadata FROM knowledge_documents WHERE project_id=$1 AND document_id=$2 AND present=TRUE', [projectId, documentId])
  const unresolved = Array.isArray(document?.metadata?.unresolved_dependencies) ? document.metadata.unresolved_dependencies as Array<Record<string, unknown>> : []
  if (unresolved.some(item => item.impact === 'evidence_blocked')) return 'blocked'
  const impacts = await rows<{ policy: string }>("SELECT policy FROM lineage_impact_items WHERE project_id=$1 AND node_type='knowledge_document' AND node_id=$2 AND status='open'", [projectId, documentId])
  if (impacts.some(item => item.policy === 'evidence_blocked')) return 'blocked'
  return unresolved.length || impacts.some(item => item.policy !== 'notify') ? 'stale' : 'current'
}

export async function propagateLineageImpacts(
  projectId: string,
  changedNodes: LineageNode[],
  reason: string,
  actor = 'system',
  options: { maxDepth?: number; maxNodes?: number } = {},
): Promise<{ report_id: string; impact_items: number; invalidated_edges: number; invalidated_nodes: LineageNode[]; cycle_count: number; truncated: boolean }> {
  for (const node of changedNodes) validateNode(node)
  const maxDepth = Math.min(100, Math.max(1, options.maxDepth ?? DEFAULT_MAX_DEPTH))
  const maxNodes = Math.min(5_000, Math.max(1, options.maxNodes ?? DEFAULT_MAX_NODES))
  const reportId = crypto.randomUUID()
  await database.query('INSERT INTO lineage_impact_reports(id,project_id,reason,actor,changed_nodes) VALUES ($1,$2,$3,$4,$5)', [reportId, projectId, reason, actor, changedNodes])
  const queue = changedNodes.map(node => ({ node, path: [node], depth: 0 }))
  const traversedEdges = new Set<string>()
  const seenNodes = new Set(changedNodes.map(node => `${node.type}:${node.id}`))
  const invalidatedNodes: LineageNode[] = []
  let invalidatedEdges = 0
  let impactItems = 0
  let cycleCount = 0
  let truncated = false
  const policyCounts: Partial<Record<KnowledgeImpactPolicy, number>> = {}
  while (queue.length && !truncated) {
    const current = queue.shift()!
    if (current.depth >= maxDepth) {
      truncated = true
      break
    }
    const edges = await rows<ImpactEdgeRow>('SELECT id,downstream_type,downstream_id,relation,impact_policy FROM lineage_dependencies WHERE project_id=$1 AND upstream_type=$2 AND upstream_id=$3 AND valid=TRUE ORDER BY created_at,id', [projectId, current.node.type, current.node.id])
    for (const edge of edges) {
      if (traversedEdges.has(edge.id)) continue
      traversedEdges.add(edge.id)
      const downstream: LineageNode = { type: edge.downstream_type, id: edge.downstream_id }
      validateNode(downstream)
      const downstreamKey = `${downstream.type}:${downstream.id}`
      const nextPath = [...current.path, downstream]
      await database.query('UPDATE lineage_dependencies SET valid=FALSE,invalidated_reason=$2,invalidated_at=NOW() WHERE id=$1', [edge.id, reason])
      invalidatedEdges += 1
      const parsedPolicy = edge.impact_policy ? knowledgeImpactPolicy.safeParse(edge.impact_policy) : null
      if (parsedPolicy?.success) {
        const itemId = crypto.randomUUID()
        const inserted = await database.query<{ id: string }>(`INSERT INTO lineage_impact_items(id,report_id,project_id,node_type,node_id,policy,relation,reason,path,depth)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          ON CONFLICT(report_id,node_type,node_id,policy) DO NOTHING RETURNING id`, [itemId, reportId, projectId, downstream.type, downstream.id, parsedPolicy.data, edge.relation, reason, nextPath, current.depth + 1])
        if (inserted.rows.length) {
          impactItems += 1
          policyCounts[parsedPolicy.data] = (policyCounts[parsedPolicy.data] || 0) + 1
          await applyImpactPolicy(projectId, downstream, parsedPolicy.data)
        }
      } else {
        await markMaterializedNodeInvalid(projectId, downstream, reason)
        invalidatedNodes.push(downstream)
      }
      if (current.path.some(node => node.type === downstream.type && node.id === downstream.id)) {
        cycleCount += 1
        continue
      }
      if (!seenNodes.has(downstreamKey)) {
        seenNodes.add(downstreamKey)
        if (seenNodes.size > maxNodes) {
          truncated = true
          break
        }
      }
      queue.push({ node: downstream, path: nextPath, depth: current.depth + 1 })
    }
  }
  const summary = { impact_items: impactItems, invalidated_edges: invalidatedEdges, legacy_invalidated_nodes: invalidatedNodes.length, policy_counts: policyCounts, cycle_count: cycleCount, truncated, max_depth: maxDepth, max_nodes: maxNodes }
  await database.query("UPDATE lineage_impact_reports SET status=$2,summary=$3 WHERE id=$1", [reportId, impactItems || invalidatedEdges ? 'open' : 'empty', summary])
  await audit('lineage.impact_propagated', projectId, { report_id: reportId, changed_nodes: changedNodes, reason, ...summary }, actor)
  return { report_id: reportId, impact_items: impactItems, invalidated_edges: invalidatedEdges, invalidated_nodes: invalidatedNodes, cycle_count: cycleCount, truncated }
}

export async function invalidateFromNodes(projectId: string, changedNodes: LineageNode[], reason: string, actor = 'system'): Promise<{ invalidated_edges: number; invalidated_nodes: LineageNode[]; report_id?: string; impact_items?: number }> {
  const result = await propagateLineageImpacts(projectId, changedNodes, reason, actor)
  return { invalidated_edges: result.invalidated_edges, invalidated_nodes: result.invalidated_nodes, report_id: result.report_id, impact_items: result.impact_items }
}

export async function reconcileProjectLineage(projectId: string): Promise<{ stale_edges: number; invalidated_edges: number; impact_report_id?: string }> {
  const edges = await rows<{ id: string; upstream_type: LineageNodeType; upstream_id: string; upstream_fingerprint: string }>('SELECT id,upstream_type,upstream_id,upstream_fingerprint FROM lineage_dependencies WHERE project_id=$1 AND valid=TRUE', [projectId])
  const stale = new Map<string, LineageNode>()
  for (const edge of edges) {
    try {
      const current = await fingerprintNode(projectId, { type: edge.upstream_type, id: edge.upstream_id })
      if (current !== edge.upstream_fingerprint) stale.set(`${edge.upstream_type}:${edge.upstream_id}`, { type: edge.upstream_type, id: edge.upstream_id })
    } catch (error) {
      if (error instanceof ApiError && error.code === 'lineage_node_not_found') stale.set(`${edge.upstream_type}:${edge.upstream_id}`, { type: edge.upstream_type, id: edge.upstream_id })
      else throw error
    }
  }
  const result = stale.size ? await invalidateFromNodes(projectId, [...stale.values()], 'upstream_fingerprint_changed') : { invalidated_edges: 0, invalidated_nodes: [] }
  return { stale_edges: stale.size, invalidated_edges: result.invalidated_edges, ...(result.report_id ? { impact_report_id: result.report_id } : {}) }
}

export async function listLineageImpactReports(projectId: string, limit = 20): Promise<LineageImpactReport[]> {
  const reports = await rows<Omit<LineageImpactReport, 'items'>>('SELECT * FROM lineage_impact_reports WHERE project_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2', [projectId, Math.min(100, Math.max(1, limit))])
  if (!reports.length) return []
  const reportIds = reports.map(report => report.id)
  const items = await rows<LineageImpactItem>('SELECT * FROM lineage_impact_items WHERE project_id=$1 AND report_id=ANY($2::uuid[]) ORDER BY depth,created_at,id', [projectId, reportIds])
  return reports.map(report => ({ ...report, items: items.filter(item => item.report_id === report.id) }))
}

export async function createLineageImpactProposal(projectId: string, impactItemId: string, actor = 'local-user'): Promise<{ proposal_id: string; impact_item_id: string; status: 'pending' }> {
  const item = await one<LineageImpactItem>('SELECT * FROM lineage_impact_items WHERE id=$1 AND project_id=$2', [impactItemId, projectId])
  if (!item) throw new ApiError(404, 'lineage_impact_not_found', '影响项不存在或不属于当前项目。')
  if (item.proposal_id) {
    const existing = await one<{ id: string; status: string }>('SELECT id,status FROM proposals WHERE id=$1 AND project_id=$2', [item.proposal_id, projectId])
    if (existing) return { proposal_id: existing.id, impact_item_id: item.id, status: 'pending' }
  }
  if (item.status !== 'open') throw new ApiError(409, 'lineage_impact_not_open', '影响项已经处理。')
  const proposalId = crypto.randomUUID()
  const summary = `Review ${item.node_type}:${item.node_id} after ${item.policy} impact`
  await database.transaction(async transaction => {
    await transaction.query('INSERT INTO proposals(id,project_id,kind,reason,summary,impact,payload) VALUES ($1,$2,$3,$4,$5,$6,$7)', [proposalId, projectId, 'diagnostic_suggestion', item.reason, summary, { impact_item_id: item.id, impact_report_id: item.report_id, policy: item.policy, path: item.path }, { impact_item_id: item.id, target: { type: item.node_type, id: item.node_id }, required_action: item.policy, automatic_execution: false }])
    await transaction.query("UPDATE lineage_impact_items SET proposal_id=$2,status='proposal_created' WHERE id=$1 AND project_id=$3 AND status='open'", [item.id, proposalId, projectId])
  })
  await audit('lineage.impact_proposal_created', projectId, { proposal_id: proposalId, impact_item_id: item.id, report_id: item.report_id, policy: item.policy, target: { type: item.node_type, id: item.node_id }, automatic_execution: false }, actor)
  return { proposal_id: proposalId, impact_item_id: item.id, status: 'pending' }
}

export async function assertCheckpointRecoverable(projectId: string, checkpointId: string): Promise<{ checkpoint: Record<string, unknown>; sourceRun: Record<string, unknown>; artifacts: Array<Record<string, unknown>> }> {
  await reconcileProjectLineage(projectId)
  const checkpoint = await one<Record<string, unknown>>('SELECT * FROM checkpoints WHERE id=$1 AND project_id=$2', [checkpointId, projectId])
  if (!checkpoint) throw new ApiError(404, 'checkpoint_not_found', '检查点不存在。')
  if (checkpoint.valid === false) throw new ApiError(409, 'checkpoint_invalidated', '检查点依赖已经失效，不能恢复。')
  if (typeof checkpoint.git_commit === 'string' && !/^[0-9a-f]{40}$/i.test(checkpoint.git_commit)) throw new ApiError(409, 'checkpoint_git_invalid', '检查点 Git 基线无效，不能恢复。')
  const state = (checkpoint.state || {}) as Record<string, unknown>
  const sourceRunId = typeof state.source_run_id === 'string' ? state.source_run_id : ''
  if (!sourceRunId) throw new ApiError(422, 'checkpoint_source_missing', '检查点缺少来源运行。')
  const sourceRun = await one<Record<string, unknown>>('SELECT * FROM experiments WHERE id=$1 AND project_id=$2', [sourceRunId, projectId])
  if (!sourceRun || sourceRun.status !== 'succeeded') throw new ApiError(409, 'checkpoint_source_invalid', '检查点来源运行不是成功状态。')
  const artifactIds = Array.isArray(state.artifact_ids) ? state.artifact_ids.filter(value => typeof value === 'string') as string[] : []
  const artifacts = artifactIds.length ? await rows<Record<string, unknown>>('SELECT * FROM artifacts WHERE project_id=$1 AND id = ANY($2::uuid[])', [projectId, artifactIds]) : []
  if (artifacts.length !== artifactIds.length || artifacts.some(artifact => artifact.valid !== true)) throw new ApiError(409, 'checkpoint_artifacts_invalid', '检查点依赖的产物缺失或已失效。')
  for (const artifact of artifacts) {
    if (typeof artifact.relative_path !== 'string' || typeof artifact.sha256 !== 'string') throw new ApiError(409, 'checkpoint_artifact_metadata_invalid', '检查点产物缺少完整哈希谱系。')
    const artifactPath = projectFilePath(projectId, artifact.relative_path)
    if (!existsSync(artifactPath) || lstatSync(artifactPath).isSymbolicLink()) throw new ApiError(409, 'checkpoint_artifact_missing', '检查点产物文件缺失或是链接文件。')
    const currentSha = createHash('sha256').update(readFileSync(artifactPath)).digest('hex')
    if (currentSha !== artifact.sha256) throw new ApiError(409, 'checkpoint_artifact_hash_mismatch', '检查点产物 SHA-256 已变化，不能恢复。')
  }
  return { checkpoint, sourceRun, artifacts }
}
