import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { relative } from 'node:path'
import { audit, database } from './database.js'
import { ApiError } from './http.js'
import { artifactsRoot, pathInside, projectsRoot } from './paths.js'
import { archiveSha256, downloadArchive, projectRepositoryRoot, repositoryDirectoryName, safeExtractArchive, type RepositoryIdentity, parseRepositoryUrl } from './repository-service.js'
import { registerLineageDependencies } from './impact-service.js'

type RepositoryRecord = {
  id: string
  project_id: string
  source_url: string
  license_spdx: string | null
  commit_or_tag: string | null
  verified_official: boolean
  metadata: Record<string, unknown>
}

export type RepositoryInstallResult = {
  repository_id: string
  artifact_id: string
  archive_sha256: string
  extracted_files: number
  uncompressed_bytes: number
  project_git_commit: string
  relative_path: string
}

function repositoryIdentity(sourceUrl: string): RepositoryIdentity { return parseRepositoryUrl(sourceUrl) }

function runGit(projectRoot: string, args: string[]): string {
  try {
    return execFileSync('git.exe', args, { cwd: projectRoot, windowsHide: true, encoding: 'utf8' }).trim()
  } catch {
    throw new ApiError(502, 'repository_git_operation_failed', '项目 Git 操作失败，仓库归档未完成。')
  }
}

export async function installRepositoryArchive(repository: RepositoryRecord, actor: string, commit: string): Promise<RepositoryInstallResult> {
  const identity = repositoryIdentity(repository.source_url)
  const directoryName = repositoryDirectoryName(repository.source_url, commit)
  const repositoryRoot = projectRepositoryRoot(repository.project_id)
  const targetDirectory = pathInside(repositoryRoot, directoryName)
  if (existsSync(targetDirectory)) throw new ApiError(409, 'repository_already_downloaded', '该固定 commit 已经下载到项目工作区。')

  const archiveDirectory = pathInside(artifactsRoot, 'repositories', repository.project_id)
  const archiveRelativePath = `repositories/${repository.project_id}/${directoryName}.tar.gz`
  const archivePath = pathInside(artifactsRoot, ...archiveRelativePath.split('/'))
  const temporaryDirectory = pathInside(repositoryRoot, `.tmp-${crypto.randomUUID()}`)
  const archive = await downloadArchive(repository.source_url, commit)
  const archiveSha256Value = archiveSha256(archive.bytes)
  const artifactId = crypto.randomUUID()
  let databaseRecorded = false
  let committed = false
  let extracted = false
  let projectGitCommit = ''

  try {
    mkdirSync(archiveDirectory, { recursive: true })
    writeFileSync(archivePath, archive.bytes, { flag: 'wx' })
    const extraction = await safeExtractArchive(archive.bytes, temporaryDirectory)
    renameSync(temporaryDirectory, targetDirectory)
    extracted = true

    await database.transaction(async transaction => {
      await transaction.query('INSERT INTO artifacts(id,project_id,kind,name,relative_path,mime_type,sha256,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [artifactId, repository.project_id, 'source_repository_archive', `${directoryName}.tar.gz`, archiveRelativePath, 'application/gzip', archiveSha256Value, { repository_id: repository.id, source_url: repository.source_url, commit, resolved_url: archive.resolvedUrl, evidence_status: 'fixed_commit_archive' }])
      await transaction.query('INSERT INTO artifact_dependencies(id,project_id,artifact_id,upstream_type,upstream_id,relation) VALUES ($1,$2,$3,$4,$5,$6)', [crypto.randomUUID(), repository.project_id, artifactId, 'repository', repository.id, 'downloaded_from_fixed_commit'])
      await transaction.query('UPDATE repositories SET metadata=$2,retrieved_at=NOW() WHERE id=$1', [repository.id, { ...repository.metadata, download: { artifact_id: artifactId, relative_path: `code/repositories/${directoryName}`, archive_relative_path: archiveRelativePath, commit, sha256: archiveSha256Value } }])
    })
    databaseRecorded = true
    await registerLineageDependencies(repository.project_id, [{ downstream: { type: 'artifact', id: artifactId }, upstream: { type: 'repository', id: repository.id }, relation: 'repository_archive' }])

    const projectRoot = pathInside(projectsRoot, repository.project_id)
    const relativePath = relative(projectRoot, targetDirectory).replaceAll('\\', '/')
    runGit(projectRoot, ['add', '--', relativePath])
    runGit(projectRoot, ['-c', 'user.name=Research OS', '-c', 'user.email=local@research-os.invalid', 'commit', '--only', '-m', `chore: add verified repository ${identity.path}@${commit.slice(0, 12)}`, '--', relativePath])
    committed = true
    projectGitCommit = runGit(projectRoot, ['rev-parse', 'HEAD'])

    await database.query('UPDATE artifacts SET metadata=$2 WHERE id=$1', [artifactId, { repository_id: repository.id, source_url: repository.source_url, commit, resolved_url: archive.resolvedUrl, evidence_status: 'fixed_commit_archive', project_git_commit: projectGitCommit, extracted_files: extraction.extracted_files, uncompressed_bytes: extraction.uncompressed_bytes }])
    await database.query('UPDATE repositories SET metadata=$2,retrieved_at=NOW() WHERE id=$1', [repository.id, { ...repository.metadata, download: { artifact_id: artifactId, relative_path: `code/repositories/${directoryName}`, archive_relative_path: archiveRelativePath, commit, sha256: archiveSha256Value, project_git_commit: projectGitCommit, extracted_files: extraction.extracted_files, uncompressed_bytes: extraction.uncompressed_bytes } }])
    await audit('repository.downloaded', repository.project_id, { repository_id: repository.id, artifact_id: artifactId, commit, archive_sha256: archiveSha256Value, project_git_commit: projectGitCommit }, actor)
    return { repository_id: repository.id, artifact_id: artifactId, archive_sha256: archiveSha256Value, extracted_files: extraction.extracted_files, uncompressed_bytes: extraction.uncompressed_bytes, project_git_commit: projectGitCommit, relative_path: `code/repositories/${directoryName}` }
  } catch (error) {
    rmSync(temporaryDirectory, { recursive: true, force: true })
    if (extracted && !committed) rmSync(targetDirectory, { recursive: true, force: true })
    if (!committed && databaseRecorded) {
      try {
        await database.query('DELETE FROM artifact_dependencies WHERE artifact_id=$1', [artifactId])
        await database.query('DELETE FROM artifacts WHERE id=$1', [artifactId])
        await database.query('UPDATE repositories SET metadata=$2 WHERE id=$1', [repository.id, repository.metadata])
      } catch { /* Preserve the original structured failure. */ }
    }
    if (!committed) rmSync(archivePath, { force: true })
    throw error
  }
}
