import { rows } from './database.js'
import type { LineageNodeType } from './impact-service.js'
import type { KnowledgeDocumentRow } from './knowledge-document-service.js'

type LineageEdgeRow = {
  id: string
  downstream_type: LineageNodeType
  downstream_id: string
  upstream_type: LineageNodeType
  upstream_id: string
  relation: string
  impact_policy: string | null
  valid: boolean
  invalidated_reason: string | null
}

export type KnowledgeGraphNode = {
  id: string
  node_type: LineageNodeType
  entity_id: string
  label: string
  category: 'knowledge_document' | 'entity' | 'version'
  status: string
  kind: string | null
  locator: string
  document_sha256: string | null
  author_status: string | null
  system_health: string | null
  permission: 'project_scoped'
  metadata: Record<string, unknown>
}

export type KnowledgeGraphEdge = {
  id: string
  source: string
  target: string
  relation: string
  impact_policy: string | null
  valid: boolean
  invalidated_reason: string | null
}

const MAX_GRAPH_NODES = 500

function nodeKey(type: LineageNodeType, id: string): string {
  return `${type}::${id}`
}

function compactId(value: string): string {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-5)}` : value
}

type EntityDescriptor = { table: string; select: string; label: (row: Record<string, unknown>) => string; status?: (row: Record<string, unknown>) => string }

const entityDescriptors: Partial<Record<LineageNodeType, EntityDescriptor>> = {
  idea_version: { table: 'idea_versions', select: 'id::text AS id,version,change_reason', label: row => `Idea v${String(row.version || '?')}`, status: () => 'versioned' },
  paper: { table: 'papers', select: 'id::text AS id,title,confirmed,verified,doi,source_url', label: row => String(row.title || 'Paper'), status: row => row.confirmed ? 'confirmed' : row.verified ? 'metadata_verified' : 'candidate' },
  evidence: { table: 'evidence', select: 'id::text AS id,claim,locator,source_url', label: row => String(row.claim || 'Evidence'), status: row => row.locator ? 'located' : 'unresolved' },
  repository: { table: 'repositories', select: 'id::text AS id,source_url,verified_official', label: row => String(row.source_url || 'Repository'), status: row => row.verified_official ? 'verified' : 'candidate' },
  reproduction: { table: 'reproductions', select: 'id::text AS id,status,repository_relative_path', label: row => String(row.repository_relative_path || `Reproduction ${compactId(String(row.id))}`), status: row => String(row.status || 'unknown') },
  reproduction_run: { table: 'reproduction_runs', select: 'id::text AS id,status,run_relative_path', label: row => String(row.run_relative_path || `Reproduction run ${compactId(String(row.id))}`), status: row => String(row.status || 'unknown') },
  uploaded_file: { table: 'uploaded_files', select: 'id::text AS id,name,relative_path', label: row => String(row.name || 'Uploaded file'), status: () => 'registered' },
  artifact: { table: 'artifacts', select: 'id::text AS id,name,kind,relative_path,sha256,valid', label: row => String(row.name || 'Artifact'), status: row => row.valid ? 'valid' : 'invalid' },
  experiment: { table: 'experiments', select: 'id::text AS id,experiment_type,status,run_id', label: row => `${String(row.experiment_type || 'Experiment')} · ${compactId(String(row.run_id || row.id))}`, status: row => String(row.status || 'unknown') },
  checkpoint: { table: 'checkpoints', select: 'id::text AS id,stage,valid', label: row => `${String(row.stage || 'Checkpoint')} · ${compactId(String(row.id))}`, status: row => row.valid === false ? 'invalid' : 'valid' },
}

async function entityRows(projectId: string, type: LineageNodeType, ids: string[]): Promise<Map<string, Record<string, unknown>>> {
  const descriptor = entityDescriptors[type]
  if (!descriptor || !ids.length) return new Map()
  const records = await rows<Record<string, unknown>>(`SELECT ${descriptor.select} FROM ${descriptor.table} WHERE project_id=$1 AND id::text=ANY($2::text[])`, [projectId, ids])
  return new Map(records.map(record => [String(record.id), record]))
}

export async function projectKnowledgeGraph(projectId: string): Promise<{
  project_id: string
  graph_status: 'ready' | 'empty'
  nodes: KnowledgeGraphNode[]
  edges: KnowledgeGraphEdge[]
  truncated: boolean
}> {
  const documents = await rows<KnowledgeDocumentRow>('SELECT * FROM knowledge_documents WHERE project_id=$1 AND present=TRUE ORDER BY relative_path,document_id', [projectId])
  const edgeRows = await rows<LineageEdgeRow>('SELECT id,downstream_type,downstream_id,upstream_type,upstream_id,relation,impact_policy,valid,invalidated_reason FROM lineage_dependencies WHERE project_id=$1 ORDER BY created_at,id', [projectId])
  const connected = new Set(documents.map(document => nodeKey('knowledge_document', document.document_id)))
  let changed = true
  while (changed) {
    changed = false
    for (const edge of edgeRows) {
      const source = nodeKey(edge.upstream_type, edge.upstream_id)
      const target = nodeKey(edge.downstream_type, edge.downstream_id)
      if (!connected.has(source) && !connected.has(target)) continue
      if (!connected.has(source)) { connected.add(source); changed = true }
      if (!connected.has(target)) { connected.add(target); changed = true }
    }
  }
  const sortedKeys = [...connected].sort((left, right) => {
    const leftDocument = left.startsWith('knowledge_document::') ? 0 : 1
    const rightDocument = right.startsWith('knowledge_document::') ? 0 : 1
    return leftDocument - rightDocument || left.localeCompare(right)
  })
  const truncated = sortedKeys.length > MAX_GRAPH_NODES
  const included = new Set(sortedKeys.slice(0, MAX_GRAPH_NODES))
  const idsByType = new Map<LineageNodeType, string[]>()
  for (const key of included) {
    const separator = key.indexOf('::')
    const type = key.slice(0, separator) as LineageNodeType
    const id = key.slice(separator + 2)
    idsByType.set(type, [...(idsByType.get(type) || []), id])
  }
  const recordsByType = new Map<LineageNodeType, Map<string, Record<string, unknown>>>()
  await Promise.all([...idsByType.entries()].map(async ([type, ids]) => recordsByType.set(type, await entityRows(projectId, type, ids))))
  const documentsById = new Map(documents.map(document => [document.document_id, document]))
  const nodes: KnowledgeGraphNode[] = [...included].map(key => {
    const separator = key.indexOf('::')
    const type = key.slice(0, separator) as LineageNodeType
    const id = key.slice(separator + 2)
    if (type === 'knowledge_document') {
      const document = documentsById.get(id)
      return {
        id: key,
        node_type: type,
        entity_id: id,
        label: String(document?.metadata?.title || id),
        category: 'knowledge_document',
        status: document?.system_health || 'missing',
        kind: document?.kind || null,
        locator: document?.relative_path || `knowledge_document:${id}`,
        document_sha256: document?.current_sha256 || null,
        author_status: document?.author_status || null,
        system_health: document?.system_health || null,
        permission: 'project_scoped',
        metadata: { active_index_generation: document?.active_index_generation || null, git_dirty: document?.git_dirty || false },
      }
    }
    const record = recordsByType.get(type)?.get(id)
    const descriptor = entityDescriptors[type]
    const label = record && descriptor ? descriptor.label(record) : `${type}:${compactId(id)}`
    return {
      id: key,
      node_type: type,
      entity_id: id,
      label,
      category: ['git_commit', 'data_version', 'config', 'idea_version'].includes(type) ? 'version' : 'entity',
      status: record && descriptor?.status ? descriptor.status(record) : record ? 'registered' : ['git_commit', 'data_version', 'config'].includes(type) ? 'fingerprint' : 'missing',
      kind: type,
      locator: `${type}:${id}`,
      document_sha256: null,
      author_status: null,
      system_health: null,
      permission: 'project_scoped',
      metadata: record ? Object.fromEntries(Object.entries(record).filter(([name]) => name !== 'id')) : {},
    }
  })
  const edges = edgeRows
    .map(edge => ({ id: edge.id, source: nodeKey(edge.upstream_type, edge.upstream_id), target: nodeKey(edge.downstream_type, edge.downstream_id), relation: edge.relation, impact_policy: edge.impact_policy, valid: edge.valid, invalidated_reason: edge.invalidated_reason }))
    .filter(edge => included.has(edge.source) && included.has(edge.target))
  return { project_id: projectId, graph_status: nodes.length ? 'ready' : 'empty', nodes, edges, truncated }
}
