import { rmSync } from 'node:fs'
import { applyMemoryRevocation, supermemoryEnabled } from './supermemory-service.js'
import { audit, database, one, rows } from './database.js'
import { ApiError } from './http.js'
import { artifactsRoot, pathInside, projectsRoot } from './paths.js'
import { removeProjectEmbeddingSettings } from './project-embedding-settings.js'
import { removeProjectSettings } from './project-settings.js'
import { stopPoolInstance } from './supermemory-instance.js'
import { deleteProjectWorkflow } from './project-workflow/runtime-service.js'

type ProjectFile = { relative_path: string }

async function removeProjectRows(projectId: string): Promise<void> {
  await database.transaction(async transaction => {
    const statements = [
      'DELETE FROM research_comparison_candidates WHERE project_id=$1',
      'DELETE FROM research_comparisons WHERE project_id=$1',
      'DELETE FROM research_status_gap_candidates WHERE project_id=$1',
      'DELETE FROM research_status_matrix_rows WHERE project_id=$1',
      'DELETE FROM research_status_matrices WHERE project_id=$1',
      'DELETE FROM related_work_field_provenance WHERE project_id=$1',
      'DELETE FROM related_work_candidate_reviews WHERE project_id=$1',
      'DELETE FROM related_work_citation_edges WHERE project_id=$1',
      'DELETE FROM related_work_run_events WHERE project_id=$1',
      'DELETE FROM related_work_source_attempts WHERE project_id=$1',
      'DELETE FROM related_work_seed_candidates WHERE seed_id IN (SELECT id FROM related_work_seeds WHERE project_id=$1)',
      'DELETE FROM related_work_candidate_sources WHERE project_id=$1',
      'DELETE FROM related_work_recursive_runs WHERE project_id=$1',
      'DELETE FROM related_work_request_cache WHERE project_id=$1',
      'DELETE FROM related_work_candidates WHERE project_id=$1',
      'DELETE FROM related_work_seeds WHERE project_id=$1',
      'DELETE FROM knowledge_index_entries WHERE project_id=$1',
      'DELETE FROM knowledge_index_generations WHERE project_id=$1',
      'DELETE FROM knowledge_document_revisions WHERE project_id=$1',
      'DELETE FROM knowledge_documents WHERE project_id=$1',
      'DELETE FROM conversation_turns WHERE project_id=$1',
      'DELETE FROM context_manifests WHERE project_id=$1',
      'DELETE FROM lineage_impact_items WHERE project_id=$1',
      'DELETE FROM lineage_impact_reports WHERE project_id=$1',
      'DELETE FROM memory_links WHERE project_id=$1',
      'DELETE FROM artifact_dependencies WHERE project_id=$1',
      'DELETE FROM lineage_dependencies WHERE project_id=$1',
      'DELETE FROM artifacts WHERE project_id=$1',
      'DELETE FROM reproduction_runs WHERE project_id=$1',
      'DELETE FROM reproductions WHERE project_id=$1',
      'DELETE FROM claim_reviews WHERE project_id=$1',
      'DELETE FROM evidence WHERE project_id=$1',
      'DELETE FROM repositories WHERE project_id=$1',
      'DELETE FROM papers WHERE project_id=$1',
      'DELETE FROM experiments WHERE project_id=$1',
      'DELETE FROM human_feedback WHERE project_id=$1',
      'DELETE FROM reports WHERE project_id=$1',
      'DELETE FROM policies WHERE project_id=$1',
      'DELETE FROM checkpoints WHERE project_id=$1',
      'DELETE FROM tasks WHERE project_id=$1',
      'DELETE FROM proposals WHERE project_id=$1',
      'DELETE FROM idea_versions WHERE project_id=$1',
      'DELETE FROM messages WHERE session_id IN (SELECT id FROM conversation_sessions WHERE project_id=$1)',
      'DELETE FROM uploaded_files WHERE project_id=$1 OR session_id IN (SELECT id FROM conversation_sessions WHERE project_id=$1)',
      'DELETE FROM conversation_sessions WHERE project_id=$1',
      'DELETE FROM audit_events WHERE project_id=$1',
      'DELETE FROM projects WHERE id=$1',
    ]
    for (const statement of statements) await transaction.query(statement, [projectId])
  })
}

function removeFiles(files: ProjectFile[], projectId: string): void {
  const paths = new Set<string>([pathInside(projectsRoot, projectId)])
  for (const file of files) {
    const relativePath = file.relative_path.replaceAll('\\', '/').replace(/^\/+/, '')
    if (relativePath.startsWith('artifacts/')) continue
    paths.add(pathInside(artifactsRoot, ...relativePath.split('/')))
  }
  for (const filePath of paths) rmSync(filePath, { recursive: true, force: true })
}

export async function deleteProject(projectId: string, projectTitle: string, confirmation: string): Promise<{ project_id: string; deleted: true }> {
  const project = await one<{ id: string; title: string }>('SELECT id,title FROM projects WHERE id=$1', [projectId])
  if (!project) throw new ApiError(404, 'project_not_found', '项目不存在。')
  if (project.title !== projectTitle) throw new ApiError(422, 'project_delete_title_mismatch', '项目名称不匹配，删除已停止。')
  if (confirmation !== 'DELETE') throw new ApiError(422, 'project_delete_confirmation_required', '必须输入 DELETE 才能删除项目。')

  const [artifactFiles, uploadedFiles, memoryLinks] = await Promise.all([
    rows<ProjectFile>('SELECT relative_path FROM artifacts WHERE project_id=$1', [projectId]),
    rows<ProjectFile>('SELECT relative_path FROM uploaded_files WHERE project_id=$1', [projectId]),
    rows<{ id: string; status: string }>('SELECT id,status FROM memory_links WHERE project_id=$1', [projectId]),
  ])
  if (supermemoryEnabled()) {
    for (const link of memoryLinks) {
      if (link.status === 'active') await applyMemoryRevocation(projectId, link.id, 'delete', 'local-user')
    }
  }

  const settings = removeProjectEmbeddingSettings(projectId)
  removeProjectSettings(projectId)
  await removeProjectRows(projectId)
  await deleteProjectWorkflow(projectId)
  try {
    removeFiles([...artifactFiles, ...uploadedFiles], projectId)
  } catch (error) {
    throw new ApiError(500, 'project_delete_cleanup_failed', error instanceof Error ? error.message : '项目文件清理失败。')
  }
  for (const poolKey of settings.released_pool_keys) await stopPoolInstance(poolKey)
  return { project_id: projectId, deleted: true }
}
