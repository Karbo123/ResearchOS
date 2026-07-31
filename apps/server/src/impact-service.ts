import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { pathInside, artifactsRoot } from './paths.js'
import { database, audit, one, rows } from './database.js'
import { ApiError } from './http.js'

export type LineageNodeType = 'idea_version' | 'paper' | 'evidence' | 'repository' | 'uploaded_file' | 'artifact' | 'experiment' | 'checkpoint' | 'git_commit' | 'data_version' | 'config'
export type LineageNode = { type: LineageNodeType; id: string }
export type LineageDependency = { downstream: LineageNode; upstream: LineageNode; relation: string }

const nodeTypes = new Set<LineageNodeType>(['idea_version', 'paper', 'evidence', 'repository', 'uploaded_file', 'artifact', 'experiment', 'checkpoint', 'git_commit', 'data_version', 'config'])

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableValue(item)]))
  return value
}

export function fingerprintValue(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')
}

function validateNode(node: LineageNode): void {
  if (!nodeTypes.has(node.type) || !/^[A-Za-z0-9_.:-]+$/.test(node.id)) throw new ApiError(422, 'lineage_node_invalid', '依赖谱系节点无效。')
}

export async function fingerprintNode(projectId: string, node: LineageNode): Promise<string> {
  validateNode(node)
  if (node.type === 'git_commit' || node.type === 'data_version' || node.type === 'config') return fingerprintValue({ type: node.type, id: node.id })
  const tables: Record<Exclude<LineageNodeType, 'git_commit' | 'data_version' | 'config'>, { table: string; columns: string }> = {
    idea_version: { table: 'idea_versions', columns: 'id,project_id,version,spec,change_reason,supersedes_id' },
    paper: { table: 'papers', columns: 'id,project_id,title,doi,source_url,metadata,bibtex,verified' },
    evidence: { table: 'evidence', columns: 'id,project_id,paper_id,claim,quote,locator,source_url,metadata' },
    repository: { table: 'repositories', columns: 'id,project_id,source_url,license_spdx,commit_or_tag,verified_official,metadata' },
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
    const upstreamFingerprint = await fingerprintNode(projectId, dependency.upstream)
    await database.query(`INSERT INTO lineage_dependencies(id,project_id,downstream_type,downstream_id,upstream_type,upstream_id,upstream_fingerprint,relation)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (project_id,downstream_type,downstream_id,upstream_type,upstream_id,relation)
      DO UPDATE SET upstream_fingerprint=$7,valid=TRUE,invalidated_reason=NULL,invalidated_at=NULL`, [crypto.randomUUID(), projectId, dependency.downstream.type, dependency.downstream.id, dependency.upstream.type, dependency.upstream.id, upstreamFingerprint, dependency.relation])
    registered.push({ ...dependency, upstream_fingerprint: upstreamFingerprint })
  }
  return registered
}

async function markMaterializedNodeInvalid(projectId: string, node: LineageNode, reason: string): Promise<void> {
  if (node.type === 'artifact') {
    const artifact = await one<Record<string, unknown>>('SELECT metadata FROM artifacts WHERE id=$1 AND project_id=$2', [node.id, projectId])
    if (artifact) await database.query('UPDATE artifacts SET valid=FALSE,metadata=$3 WHERE id=$1 AND project_id=$2', [node.id, projectId, { ...((artifact.metadata || {}) as Record<string, unknown>), lineage_invalidated: true, invalidation_reason: reason }])
  } else if (node.type === 'experiment') {
    await database.query("UPDATE experiments SET status='invalidated',error=$3,finished_at=COALESCE(finished_at,NOW()) WHERE id=$1 AND project_id=$2 AND status='succeeded'", [node.id, projectId, `dependency_invalidated:${reason}`])
  } else if (node.type === 'checkpoint') {
    await database.query('UPDATE checkpoints SET valid=FALSE,invalidated_reason=$3,invalidated_at=NOW() WHERE id=$1 AND project_id=$2', [node.id, projectId, reason])
  }
}

export async function invalidateFromNodes(projectId: string, changedNodes: LineageNode[], reason: string, actor = 'system'): Promise<{ invalidated_edges: number; invalidated_nodes: LineageNode[] }> {
  const queue = [...changedNodes]
  const visited = new Set<string>()
  const invalidatedNodes: LineageNode[] = []
  let invalidatedEdges = 0
  while (queue.length) {
    const upstream = queue.shift()!
    const upstreamKey = `${upstream.type}:${upstream.id}`
    if (visited.has(upstreamKey)) continue
    visited.add(upstreamKey)
    const edges = await rows<{ id: string; downstream_type: LineageNodeType; downstream_id: string }>('SELECT id,downstream_type,downstream_id FROM lineage_dependencies WHERE project_id=$1 AND upstream_type=$2 AND upstream_id=$3 AND valid=TRUE', [projectId, upstream.type, upstream.id])
    for (const edge of edges) {
      const downstream: LineageNode = { type: edge.downstream_type, id: edge.downstream_id }
      await database.query('UPDATE lineage_dependencies SET valid=FALSE,invalidated_reason=$2,invalidated_at=NOW() WHERE id=$1', [edge.id, reason])
      await markMaterializedNodeInvalid(projectId, downstream, reason)
      invalidatedNodes.push(downstream)
      invalidatedEdges += 1
      queue.push(downstream)
    }
  }
  if (invalidatedEdges) await audit('lineage.invalidated', projectId, { changed_nodes: changedNodes, reason, invalidated_edges: invalidatedEdges, invalidated_nodes: invalidatedNodes }, actor)
  return { invalidated_edges: invalidatedEdges, invalidated_nodes: invalidatedNodes }
}

export async function reconcileProjectLineage(projectId: string): Promise<{ stale_edges: number; invalidated_edges: number }> {
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
  return { stale_edges: stale.size, invalidated_edges: result.invalidated_edges }
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
    const artifactPath = pathInside(artifactsRoot, ...artifact.relative_path.split('/'))
    if (!existsSync(artifactPath) || lstatSync(artifactPath).isSymbolicLink()) throw new ApiError(409, 'checkpoint_artifact_missing', '检查点产物文件缺失或是链接文件。')
    const currentSha = createHash('sha256').update(readFileSync(artifactPath)).digest('hex')
    if (currentSha !== artifact.sha256) throw new ApiError(409, 'checkpoint_artifact_hash_mismatch', '检查点产物 SHA-256 已变化，不能恢复。')
  }
  return { checkpoint, sourceRun, artifacts }
}
