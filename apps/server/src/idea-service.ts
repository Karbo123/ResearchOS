import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { database, one } from './database.js'
import { ApiError } from './http.js'
import { invalidateFromNodes } from './impact-service.js'
import { gitBinary, pathInside, projectsRoot } from './paths.js'

const revisionFields = new Set(['title', 'research_question', 'domain', 'available_data', 'ethics_and_compliance'])

export async function applyApprovedIdeaRevision(projectId: string, payload: Record<string, unknown>, actor: string) {
  const field = typeof payload.field === 'string' ? payload.field : ''
  const value = typeof payload.value === 'string' ? payload.value.trim() : ''
  if (!revisionFields.has(field) || !value) throw new ApiError(422, 'idea_revision_invalid', 'Idea 修改字段不在允许范围内或内容为空。')
  const current = await one<{ id: string; version: number; spec: Record<string, unknown> }>('SELECT id,version,spec FROM idea_versions WHERE project_id=$1 ORDER BY version DESC LIMIT 1', [projectId])
  if (!current) throw new ApiError(409, 'idea_version_missing', '项目没有可修改的 Idea 版本。')
  const nextSpec = structuredClone(current.spec)
  const idea = (nextSpec.idea || {}) as Record<string, unknown>
  idea[field] = value
  nextSpec.idea = idea
  const nextVersion = current.version + 1
  const workspace = pathInside(projectsRoot, projectId)
  const ideaPath = pathInside(workspace, 'idea.json')
  const previousFile = existsSync(ideaPath) ? readFileSync(ideaPath) : null
  const newVersionId = crypto.randomUUID()
  try {
    await database.transaction(async transaction => {
      await transaction.query('INSERT INTO idea_versions(id,project_id,version,spec,change_reason,supersedes_id) VALUES ($1,$2,$3,$4,$5,$6)', [newVersionId, projectId, nextVersion, nextSpec, `Approved revision of ${field}`, current.id])
      await transaction.query('UPDATE projects SET current_idea_version=$2,updated_at=NOW() WHERE id=$1', [projectId, nextVersion])
    })
    writeFileSync(ideaPath, `${JSON.stringify(nextSpec, null, 2)}\n`, 'utf8')
    execFileSync(gitBinary(), ['add', '--', 'idea.json'], { cwd: workspace, stdio: 'ignore' })
    execFileSync(gitBinary(), ['-c', 'user.name=Research OS', '-c', 'user.email=local@research-os.invalid', 'commit', '--only', '-m', `chore: revise approved idea ${nextVersion}`, '--', 'idea.json'], { cwd: workspace, stdio: 'ignore' })
    const gitAfter = execFileSync(gitBinary(), ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).trim()
    const invalidation = await invalidateFromNodes(projectId, [{ type: 'idea_version', id: current.id }], `idea_version_superseded:${nextVersion}`, actor)
    return { idea_version: nextVersion, idea_version_id: newVersionId, previous_idea_version: current.version, git_commit: gitAfter, invalidation }
  } catch (error) {
    if (previousFile === null) rmSync(ideaPath, { force: true })
    else writeFileSync(ideaPath, previousFile)
    try { await database.query('DELETE FROM idea_versions WHERE id=$1', [newVersionId]); await database.query('UPDATE projects SET current_idea_version=$2 WHERE id=$1', [projectId, current.version]) } catch { /* Preserve original error. */ }
    throw error
  }
}
