import { existsSync } from 'node:fs'
import { audit, database, rows } from './database.js'
import { pathInside, artifactsRoot, runtimeRoot } from './paths.js'
import { isProjectUuidReference } from './project-slug.js'
import { moveIntoProject, projectArtifactPath, projectArtifactRelativePath } from './project-storage.js'

type FileRow = { id: string; project_id: string; relative_path: string; session_id?: string | null }

function legacyPath(relativePath: string): string {
  return pathInside(artifactsRoot, ...relativePath.replaceAll('\\', '/').replace(/^\/+/, '').split('/'))
}

async function migrateRows(table: 'artifacts' | 'uploaded_files'): Promise<{ migrated: number; cleanupPending: number }> {
  const sessionColumn = table === 'uploaded_files' ? ',session_id' : ''
  const files = await rows<FileRow>(`SELECT id,project_id,relative_path${sessionColumn} FROM ${table} WHERE project_id IS NOT NULL`)
  const aliases = await rows<{ slug: string; project_id: string }>('SELECT slug,project_id FROM project_slug_aliases')
  const aliasByProject = new Map<string, string[]>()
  for (const alias of aliases) {
    if (isProjectUuidReference(alias.slug)) continue
    const current = aliasByProject.get(alias.project_id) || []
    current.push(alias.slug)
    aliasByProject.set(alias.project_id, current)
  }
  let migrated = 0
  let cleanupPending = 0
  for (const file of files) {
    const current = file.relative_path.replaceAll('\\', '/').replace(/^\/+/, '')
    const legacyRelative = current.startsWith('artifacts/') ? current.slice('artifacts/'.length) : current
    const legacyPrefix = (aliasByProject.get(file.project_id) || []).find(alias => legacyRelative.startsWith(`${alias}/`))
    const withoutProjectPrefix = legacyPrefix
      ? legacyRelative.slice(legacyPrefix.length + 1)
      : legacyRelative.startsWith(`${file.project_id}/`)
        ? legacyRelative.slice(file.project_id.length + 1)
        : legacyRelative
    const targetRelative = projectArtifactRelativePath(withoutProjectPrefix)
    const target = projectArtifactPath(file.project_id, targetRelative)
    const source = current.startsWith('staging/') && file.session_id
      ? pathInside(runtimeRoot, ...current.split('/'))
      : legacyPath(current.startsWith('artifacts/') ? current.slice('artifacts/'.length) : current)
    if (!existsSync(target) && source && existsSync(source)) {
      moveIntoProject(file.project_id, source, targetRelative)
      migrated += 1
      if (existsSync(source)) cleanupPending += 1
    }
    if (file.relative_path !== targetRelative && existsSync(target)) {
      await database.query(`UPDATE ${table} SET relative_path=$2 WHERE id=$1`, [file.id, targetRelative])
      migrated += 1
    }
  }
  return { migrated, cleanupPending }
}

export async function migrateProjectArtifactFiles(): Promise<void> {
  const artifactResult = await migrateRows('artifacts')
  const uploadResult = await migrateRows('uploaded_files')
  const migrated = artifactResult.migrated + uploadResult.migrated
  const cleanupPending = artifactResult.cleanupPending + uploadResult.cleanupPending
  if (migrated || cleanupPending) await audit('project.artifact_files_migrated', null, { migrated, cleanup_pending: cleanupPending })
}
