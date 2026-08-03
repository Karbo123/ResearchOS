import { createHash } from 'node:crypto'
import { appendFileSync, copyFileSync, createReadStream, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { basename, relative, resolve } from 'node:path'
import { audit, database, one } from './database.js'
import { ApiError } from './http.js'
import { artifactMimeType } from './metrics-service.js'
import { pathInside, projectsRoot } from './paths.js'
import { projectArtifactPath, projectArtifactRelativePath } from './project-storage.js'
import { registerLineageDependencies } from './impact-service.js'
import { archiveSha256, downloadArchive, repositoryDirectoryName, safeExtractArchive } from './repository-service.js'

const relativePathPattern = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/
const dependencyManifestPattern = /^(?:requirements(?:-[A-Za-z0-9_.-]+)?\.txt|requirements\/[A-Za-z0-9_.-]+\.txt)$/
const entrypointPattern = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.py$/
const maxLogBytes = 5 * 1024 * 1024
const maxOutputFiles = 500
const maxOutputBytes = 500 * 1024 * 1024

type ReproductionRecord = {
  id: string
  project_id: string
  repository_id: string
  status: string
  source_commit: string
  repository_relative_path: string
  dependency_manifest: string
  dependency_sha256: string
  venv_relative_path: string
  entrypoint: string | null
  plan: Record<string, unknown>
  dependency_report: Record<string, unknown>
  error: string | null
}

type ReproductionRunRecord = {
  id: string
  project_id: string
  reproduction_id: string
  proposal_id: string
  status: string
  source_commit: string
  entrypoint: string
  random_seeds: number[]
  config: Record<string, unknown>
  run_relative_path: string
  output_manifest: OutputManifestEntry[]
  metrics: Record<string, unknown>
  artifact_proposal_id: string | null
}

type OutputManifestEntry = {
  path: string
  sha256: string
  size_bytes: number
  mime_type: string
}

type RepositoryDownloadRecord = {
  id: string
  project_id: string
  source_url: string
  license_spdx: string | null
  commit_or_tag: string | null
  verified_official: boolean
  metadata: Record<string, unknown>
}

type ChildResult = { exit_code: number | null; timed_out: boolean }

function reproductionRoot(projectId: string, reproductionId: string): string {
  return pathInside(projectsRoot, projectId, 'experiment', 'reproductions', reproductionId)
}

function reproductionRunRoot(projectId: string, reproductionId: string, runId: string): string {
  return pathInside(reproductionRoot(projectId, reproductionId), 'runs', runId)
}

export function reproductionRelativeRoot(reproductionId: string): string {
  return `experiment/reproductions/${reproductionId}`
}

export function validateReproductionRelativePath(value: string, field = 'path'): string {
  if (!relativePathPattern.test(value) || value.includes('..') || value.includes('\\') || value.startsWith('.')) {
    throw new ApiError(422, 'reproduction_path_invalid', `${field} 必须是受控的 POSIX 相对路径。`)
  }
  return value
}

function validateEntrypoint(value: string): string {
  validateReproductionRelativePath(value, 'entrypoint')
  if (!entrypointPattern.test(value)) throw new ApiError(422, 'reproduction_entrypoint_invalid', '复现入口必须是受控目录内的 Python 文件。')
  return value
}

export function validateDependencyManifestPath(value: string): string {
  validateReproductionRelativePath(value, 'dependency_manifest')
  if (!dependencyManifestPattern.test(value)) throw new ApiError(422, 'reproduction_dependency_manifest_invalid', '只允许使用受控的 requirements*.txt 依赖清单。')
  return value
}

function regularFile(path: string, code: string): void {
  if (!existsSync(path)) throw new ApiError(404, code, '复现所需文件不存在。')
  const info = lstatSync(path)
  if (info.isSymbolicLink() || !info.isFile()) throw new ApiError(422, 'reproduction_regular_file_required', '复现入口和依赖清单必须是普通文件。')
}

function assertTreeWithoutLinks(root: string): void {
  if (!existsSync(root)) throw new ApiError(404, 'reproduction_source_missing', '复现源码目录不存在。')
  const rootInfo = lstatSync(root)
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new ApiError(422, 'reproduction_source_invalid', '复现源码目录必须是普通目录。')
  for (const name of readdirSync(root)) {
    const child = pathInside(root, name)
    const info = lstatSync(child)
    if (info.isSymbolicLink()) throw new ApiError(422, 'reproduction_symlink_forbidden', '复现源码和产物目录不能包含符号链接。')
    if (info.isDirectory()) assertTreeWithoutLinks(child)
  }
}

function copyTree(source: string, destination: string): void {
  assertTreeWithoutLinks(source)
  mkdirSync(destination, { recursive: true })
  for (const name of readdirSync(source)) {
    const sourcePath = pathInside(source, name)
    const destinationPath = pathInside(destination, name)
    const info = lstatSync(sourcePath)
    if (info.isSymbolicLink()) throw new ApiError(422, 'reproduction_symlink_forbidden', '复现源码不能包含符号链接。')
    if (info.isDirectory()) copyTree(sourcePath, destinationPath)
    else if (info.isFile()) copyFileSync(sourcePath, destinationPath)
    else throw new ApiError(422, 'reproduction_special_file_forbidden', '复现源码不能包含特殊文件。')
  }
}

function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

async function hashTree(root: string): Promise<string> {
  const hash = createHash('sha256')
  async function visit(current: string): Promise<void> {
    const names = readdirSync(current).sort((left, right) => left.localeCompare(right))
    for (const name of names) {
      const path = pathInside(current, name)
      const info = lstatSync(path)
      const relativePath = relative(root, path).replaceAll('\\', '/')
      if (info.isSymbolicLink()) throw new ApiError(422, 'reproduction_symlink_forbidden', '复现源码不能包含符号链接。')
      if (info.isDirectory()) {
        hash.update(`dir:${relativePath}\n`)
        await visit(path)
      } else if (info.isFile()) {
        hash.update(`file:${relativePath}:${info.size}\n`)
        const stream = createReadStream(path)
        for await (const chunk of stream) hash.update(chunk as Buffer)
      } else {
        throw new ApiError(422, 'reproduction_special_file_forbidden', '复现源码不能包含特殊文件。')
      }
    }
  }
  await visit(root)
  return hash.digest('hex')
}

export async function fingerprintReproductionSource(root: string): Promise<string> {
  assertTreeWithoutLinks(root)
  return hashTree(root)
}

function safeEnvironment(venvPath: string): NodeJS.ProcessEnv {
  const venvBin = resolve(venvPath, 'bin')
  return {
    PATH: `${venvBin}:${process.env.PATH || ''}`,
    PYTHONNOUSERSITE: '1',
    PYTHONDONTWRITEBYTECODE: '1',
    LC_ALL: 'C.UTF-8',
  }
}

function appendBounded(path: string, chunk: Buffer, current: { bytes: number }): void {
  if (current.bytes >= maxLogBytes) return
  const bounded = chunk.subarray(0, maxLogBytes - current.bytes)
  current.bytes += bounded.length
  appendFileSync(path, bounded)
}

async function terminateTree(pid: number | undefined): Promise<void> {
  if (!pid) return
  try { process.kill(-pid, 'SIGKILL') }
  catch { /* The process tree has already exited. */ }
}

async function runFixedProcess(executable: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; logPath: string; timeoutSeconds: number }): Promise<ChildResult> {
  if (process.platform !== 'linux') throw new ApiError(501, 'linux_runner_required', '复现监督器只支持 WSL2/Linux 运行。')
  const logState = { bytes: 0 }
  const child = spawn(executable, args, { cwd: options.cwd, env: options.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout?.on('data', chunk => appendBounded(options.logPath, Buffer.from(chunk), logState))
  child.stderr?.on('data', chunk => appendBounded(options.logPath, Buffer.from(chunk), logState))
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    void terminateTree(child.pid)
  }, options.timeoutSeconds * 1000)
  return await new Promise<ChildResult>((resolvePromise, rejectPromise) => {
    child.once('error', error => {
      clearTimeout(timeout)
      rejectPromise(new ApiError(502, 'reproduction_process_spawn_failed', error instanceof Error ? error.message : '复现进程启动失败。'))
    })
    child.once('exit', exitCode => {
      clearTimeout(timeout)
      resolvePromise({ exit_code: exitCode, timed_out: timedOut })
    })
  })
}

function validateRequirementsContent(content: string): void {
  for (const [lineNumber, rawLine] of content.split(/\r?\n/).entries()) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('-') || line.includes('://') || line.includes('git+') || line.includes('\\') || line.startsWith('.') || line.startsWith('/')) {
      throw new ApiError(422, 'reproduction_dependency_line_forbidden', `依赖清单第 ${lineNumber + 1} 行包含不允许的索引、路径或 VCS 安装方式。`)
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*(?:\[[A-Za-z0-9_,.-]+\])?(?:\s*(?:===|==|~=|!=|>=|<=|>|<)\s*[A-Za-z0-9*+!~<>=._-]+)?(?:\s*;\s*[A-Za-z0-9 _.-]+)?$/.test(line)) {
      throw new ApiError(422, 'reproduction_dependency_line_invalid', `依赖清单第 ${lineNumber + 1} 行不是受控的包规格。`)
    }
  }
}

function sourcePathFor(reproduction: ReproductionRecord): string {
  return pathInside(projectsRoot, reproduction.project_id, ...reproduction.repository_relative_path.split('/'))
}

function venvPathFor(reproduction: ReproductionRecord): string {
  return pathInside(projectsRoot, reproduction.project_id, ...reproduction.venv_relative_path.split('/'))
}

function runPathFor(run: ReproductionRunRecord): string {
  return pathInside(projectsRoot, run.project_id, ...run.run_relative_path.split('/'))
}

async function loadReproduction(projectId: string, reproductionId: string): Promise<ReproductionRecord> {
  const reproduction = await one<ReproductionRecord>('SELECT * FROM reproductions WHERE id=$1 AND project_id=$2', [reproductionId, projectId])
  if (!reproduction) throw new ApiError(404, 'reproduction_not_found', '复现记录不存在或不属于当前项目。')
  return reproduction
}

export async function downloadRepositoryForReproduction(repository: RepositoryDownloadRecord, actor: string, commit: string): Promise<{
  repository_id: string
  reproduction_id: string
  archive_artifact_id: string
  archive_sha256: string
  source_relative_path: string
  source_commit: string
}> {
  const existing = await one<{ id: string }>('SELECT id FROM reproductions WHERE project_id=$1 AND repository_id=$2 AND source_commit=$3', [repository.project_id, repository.id, commit])
  if (existing) throw new ApiError(409, 'repository_already_downloaded', '该固定 commit 已经下载到当前项目的复现区。')
  const reproductionId = crypto.randomUUID()
  const root = reproductionRoot(repository.project_id, reproductionId)
  const temporaryRoot = pathInside(projectsRoot, repository.project_id, 'experiment', 'reproductions', `.tmp-${reproductionId}`)
  const sourceRoot = pathInside(root, 'source')
  const directoryName = repositoryDirectoryName(repository.source_url, commit)
  const archiveRelativePath = projectArtifactRelativePath(`repositories/${directoryName}-${reproductionId.slice(0, 8)}.tar.gz`)
  const archivePath = projectArtifactPath(repository.project_id, archiveRelativePath)
  const archive = await downloadArchive(repository.source_url, commit)
  const archiveHash = archiveSha256(archive.bytes)
  let inserted = false
  let archiveArtifactId: string | null = null
  try {
    mkdirSync(pathInside(projectsRoot, repository.project_id, 'experiment', 'reproductions'), { recursive: true })
    mkdirSync(pathInside(archivePath, '..'), { recursive: true })
    writeFileSync(archivePath, archive.bytes, { flag: 'wx' })
    const extraction = await safeExtractArchive(archive.bytes, pathInside(temporaryRoot, 'source'))
    assertTreeWithoutLinks(pathInside(temporaryRoot, 'source'))
    renameSync(temporaryRoot, root)
    const sourceTreeSha256 = await hashTree(sourceRoot)
    archiveArtifactId = crypto.randomUUID()
    await database.transaction(async transaction => {
      await transaction.query('INSERT INTO reproductions(id,project_id,repository_id,status,source_commit,repository_relative_path,dependency_manifest,dependency_sha256,venv_relative_path,plan,dependency_report) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [
        reproductionId, repository.project_id, repository.id, 'source_downloaded', commit,
        `${reproductionRelativeRoot(reproductionId)}/source`, '', '', `${reproductionRelativeRoot(reproductionId)}/.venv`,
        { source_tree_sha256: sourceTreeSha256, archive_sha256: archiveHash, archive_relative_path: archiveRelativePath, resolved_url: archive.resolvedUrl, extracted_files: extraction.extracted_files, uncompressed_bytes: extraction.uncompressed_bytes }, {},
      ])
      await transaction.query('INSERT INTO artifacts(id,project_id,kind,name,relative_path,mime_type,sha256,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [
        archiveArtifactId, repository.project_id, 'source_repository_archive', `${directoryName}-${reproductionId.slice(0, 8)}.tar.gz`, archiveRelativePath, 'application/gzip', archiveHash,
        { repository_id: repository.id, reproduction_id: reproductionId, source_url: repository.source_url, commit, resolved_url: archive.resolvedUrl, evidence_status: 'fixed_commit_archive', extracted_files: extraction.extracted_files, uncompressed_bytes: extraction.uncompressed_bytes },
      ])
      await transaction.query('INSERT INTO artifact_dependencies(id,project_id,artifact_id,upstream_type,upstream_id,relation) VALUES ($1,$2,$3,$4,$5,$6)', [crypto.randomUUID(), repository.project_id, archiveArtifactId, 'repository', repository.id, 'downloaded_from_fixed_commit'])
      await transaction.query('UPDATE repositories SET metadata=$2,retrieved_at=NOW() WHERE id=$1', [repository.id, {
        ...repository.metadata,
        download: { reproduction_id: reproductionId, archive_artifact_id: archiveArtifactId, source_relative_path: `${reproductionRelativeRoot(reproductionId)}/source`, archive_relative_path: archiveRelativePath, commit, sha256: archiveHash, source_tree_sha256: sourceTreeSha256 },
      }])
    })
    inserted = true
    await registerLineageDependencies(repository.project_id, [
      { downstream: { type: 'reproduction', id: reproductionId }, upstream: { type: 'repository', id: repository.id }, relation: 'reproduction_source_repository' },
      { downstream: { type: 'artifact', id: archiveArtifactId }, upstream: { type: 'repository', id: repository.id }, relation: 'repository_archive' },
    ])
    await audit('repository.reproduction_downloaded', repository.project_id, { repository_id: repository.id, reproduction_id: reproductionId, archive_artifact_id: archiveArtifactId, commit, archive_sha256: archiveHash, source_tree_sha256: sourceTreeSha256 }, actor)
    return { repository_id: repository.id, reproduction_id: reproductionId, archive_artifact_id: archiveArtifactId, archive_sha256: archiveHash, source_relative_path: `${reproductionRelativeRoot(reproductionId)}/source`, source_commit: commit }
  } catch (error) {
    if (inserted) {
      await database.query('DELETE FROM lineage_dependencies WHERE project_id=$1 AND downstream_id=$2', [repository.project_id, reproductionId]).catch(() => undefined)
      if (archiveArtifactId) {
        await database.query('DELETE FROM artifact_dependencies WHERE artifact_id=$1', [archiveArtifactId]).catch(() => undefined)
        await database.query('DELETE FROM artifacts WHERE id=$1 AND project_id=$2', [archiveArtifactId, repository.project_id]).catch(() => undefined)
      }
      await database.query('DELETE FROM reproductions WHERE id=$1 AND project_id=$2', [reproductionId, repository.project_id]).catch(() => undefined)
    }
    rmSync(temporaryRoot, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
    rmSync(archivePath, { force: true })
    throw error
  }
}

export async function createDependencyInstallProposal(projectId: string, reproductionId: string, dependencyManifest: string, reason: string): Promise<{ proposal_id: string; dependency_sha256: string; source_commit: string }> {
  const reproduction = await loadReproduction(projectId, reproductionId)
  if (!['source_downloaded', 'dependency_failed'].includes(reproduction.status)) throw new ApiError(409, 'reproduction_dependency_state_invalid', '当前复现状态不能重新申请依赖安装。')
  const manifest = validateDependencyManifestPath(dependencyManifest)
  const sourceRoot = sourcePathFor(reproduction)
  assertTreeWithoutLinks(sourceRoot)
  const manifestPath = pathInside(sourceRoot, ...manifest.split('/'))
  regularFile(manifestPath, 'reproduction_dependency_manifest_missing')
  const content = readFileSync(manifestPath, 'utf8')
  validateRequirementsContent(content)
  const dependencySha256 = hashFile(manifestPath)
  const existing = await one<{ id: string }>("SELECT id FROM proposals WHERE project_id=$1 AND kind='repository_dependency_install' AND status='pending' AND payload->>'reproduction_id'=$2", [projectId, reproductionId])
  if (existing) throw new ApiError(409, 'reproduction_dependency_proposal_exists', '该复现已经有待审批的依赖安装 Proposal。')
  const proposalId = crypto.randomUUID()
  await database.query('INSERT INTO proposals(id,project_id,kind,reason,summary,impact,payload) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
    proposalId, projectId, 'repository_dependency_install', reason, 'Install the fixed reproduction dependency manifest',
    { reproduction_id: reproductionId, source_commit: reproduction.source_commit, dependency_manifest: manifest, dependency_sha256: dependencySha256 },
    { reproduction_id: reproductionId, dependency_manifest: manifest, dependency_sha256: dependencySha256, source_commit: reproduction.source_commit },
  ])
  await audit('proposal.created', projectId, { proposal_id: proposalId, kind: 'repository_dependency_install', reproduction_id: reproductionId, dependency_sha256: dependencySha256 }, 'local-user')
  return { proposal_id: proposalId, dependency_sha256: dependencySha256, source_commit: reproduction.source_commit }
}

export async function installReproductionDependencies(projectId: string, reproductionId: string, dependencyManifest: string, expectedSha256: string, actor: string): Promise<{ reproduction_id: string; status: string; venv_relative_path: string; dependency_sha256: string }> {
  const reproduction = await loadReproduction(projectId, reproductionId)
  const manifest = validateDependencyManifestPath(dependencyManifest)
  if (!/^[0-9a-f]{64}$/.test(expectedSha256)) throw new ApiError(422, 'reproduction_dependency_hash_invalid', '依赖清单哈希无效。')
  if (reproduction.source_commit !== String(reproduction.plan.source_commit || reproduction.source_commit)) throw new ApiError(409, 'reproduction_source_commit_mismatch', '复现源码 commit 与记录不一致。')
  const sourceRoot = sourcePathFor(reproduction)
  assertTreeWithoutLinks(sourceRoot)
  const manifestPath = pathInside(sourceRoot, ...manifest.split('/'))
  regularFile(manifestPath, 'reproduction_dependency_manifest_missing')
  const content = readFileSync(manifestPath, 'utf8')
  validateRequirementsContent(content)
  const dependencySha256 = hashFile(manifestPath)
  if (dependencySha256 !== expectedSha256) throw new ApiError(409, 'reproduction_dependency_hash_mismatch', '依赖清单内容已变化，不能安装。')
  const root = reproductionRoot(projectId, reproductionId)
  const venv = venvPathFor(reproduction)
  const python = pathInside(venv, 'bin', 'python')
  const logPath = pathInside(root, 'dependency-install.log')
  try {
    await database.query("UPDATE reproductions SET status='dependency_installing',dependency_manifest=$2,dependency_sha256=$3,error=NULL,updated_at=NOW() WHERE id=$1 AND project_id=$4", [reproductionId, manifest, dependencySha256, projectId])
    if (existsSync(venv)) {
      const info = lstatSync(venv)
      if (info.isSymbolicLink() || !info.isDirectory()) throw new ApiError(422, 'reproduction_venv_invalid', '复现 .venv 必须是普通目录。')
    } else {
      mkdirSync(root, { recursive: true })
      const created = await runFixedProcess('python3', ['-m', 'venv', venv], { cwd: sourceRoot, env: safeEnvironment(venv), logPath, timeoutSeconds: 1800 })
      if (created.timed_out) throw new ApiError(504, 'reproduction_venv_timeout', '创建复现 .venv 超时。')
      if (created.exit_code !== 0 || !existsSync(python)) throw new ApiError(502, 'reproduction_venv_creation_failed', '创建复现 .venv 失败。')
    }
    const installed = await runFixedProcess(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '--no-cache-dir', '-r', manifestPath], { cwd: sourceRoot, env: safeEnvironment(venv), logPath, timeoutSeconds: 3600 })
    if (installed.timed_out) throw new ApiError(504, 'reproduction_dependency_timeout', '复现依赖安装超时。')
    if (installed.exit_code !== 0) throw new ApiError(502, 'reproduction_dependency_install_failed', '复现依赖安装进程失败。')
    const report = { dependency_manifest: manifest, dependency_sha256: dependencySha256, venv_relative_path: reproduction.venv_relative_path, log_relative_path: `${reproductionRelativeRoot(reproductionId)}/dependency-install.log`, installed_at: new Date().toISOString() }
    await database.query("UPDATE reproductions SET status='ready',dependency_report=$2,error=NULL,updated_at=NOW() WHERE id=$1 AND project_id=$3", [reproductionId, report, projectId])
    await audit('repository.reproduction_dependencies_installed', projectId, { reproduction_id: reproductionId, dependency_manifest: manifest, dependency_sha256: dependencySha256 }, actor)
    return { reproduction_id: reproductionId, status: 'ready', venv_relative_path: reproduction.venv_relative_path, dependency_sha256: dependencySha256 }
  } catch (error) {
    const code = error instanceof ApiError ? error.code : error instanceof Error ? error.message : 'reproduction_dependency_install_failed'
    await database.query("UPDATE reproductions SET status='dependency_failed',error=$2,updated_at=NOW() WHERE id=$1 AND project_id=$3", [reproductionId, code, projectId]).catch(() => undefined)
    await audit('repository.reproduction_dependencies_failed', projectId, { reproduction_id: reproductionId, code }, actor).catch(() => undefined)
    throw error
  }
}

export async function createRunProposal(projectId: string, reproductionId: string, input: { entrypoint: string; random_seeds: number[]; config: Record<string, unknown>; timeout_seconds: number; reason: string }): Promise<{ proposal_id: string; source_commit: string }> {
  const reproduction = await loadReproduction(projectId, reproductionId)
  if (reproduction.status !== 'ready') throw new ApiError(409, 'reproduction_not_ready', '复现依赖尚未安装成功，不能创建运行 Proposal。')
  const entrypoint = validateEntrypoint(input.entrypoint)
  const sourceRoot = sourcePathFor(reproduction)
  assertTreeWithoutLinks(sourceRoot)
  regularFile(pathInside(sourceRoot, ...entrypoint.split('/')), 'reproduction_entrypoint_missing')
  const venv = venvPathFor(reproduction)
  regularFile(pathInside(venv, 'bin', 'python'), 'reproduction_venv_python_missing')
  const sourceTreeSha256 = await hashTree(sourceRoot)
  if (sourceTreeSha256 !== reproduction.plan.source_tree_sha256) throw new ApiError(409, 'reproduction_source_changed', '复现源码在下载后发生变化，必须重新下载固定 commit。')
  const existing = await one<{ id: string }>("SELECT id FROM proposals WHERE project_id=$1 AND kind='repository_reproduction_run' AND status IN ('pending','approved') AND payload->>'reproduction_id'=$2", [projectId, reproductionId])
  if (existing) throw new ApiError(409, 'reproduction_run_proposal_exists', '该复现已经有待处理或已批准的运行 Proposal。')
  const proposalId = crypto.randomUUID()
  await database.query('INSERT INTO proposals(id,project_id,kind,reason,summary,impact,payload) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
    proposalId, projectId, 'repository_reproduction_run', input.reason, 'Run the pinned reproduction entrypoint with approved seeds and configuration',
    { reproduction_id: reproductionId, source_commit: reproduction.source_commit, entrypoint, random_seeds: input.random_seeds, config: input.config, timeout_seconds: input.timeout_seconds },
    { reproduction_id: reproductionId, source_commit: reproduction.source_commit, entrypoint, random_seeds: input.random_seeds, config: input.config, timeout_seconds: input.timeout_seconds },
  ])
  await audit('proposal.created', projectId, { proposal_id: proposalId, kind: 'repository_reproduction_run', reproduction_id: reproductionId, source_commit: reproduction.source_commit, entrypoint, random_seeds: input.random_seeds }, 'local-user')
  return { proposal_id: proposalId, source_commit: reproduction.source_commit }
}

export async function queueReproductionRun(projectId: string, proposalId: string, payload: Record<string, unknown>): Promise<{ run_id: string; task_id: string; status: string }> {
  const reproductionId = String(payload.reproduction_id || '')
  const reproduction = await loadReproduction(projectId, reproductionId)
  if (reproduction.status !== 'ready') throw new ApiError(409, 'reproduction_not_ready', '复现依赖尚未安装成功，不能运行。')
  const entrypoint = validateEntrypoint(String(payload.entrypoint || ''))
  const seeds = Array.isArray(payload.random_seeds) && payload.random_seeds.every(value => Number.isInteger(value)) ? payload.random_seeds as number[] : []
  if (!seeds.length || seeds.length > 10 || new Set(seeds).size !== seeds.length) throw new ApiError(422, 'reproduction_seeds_invalid', '复现运行必须包含 1 到 10 个互不重复的固定整数 seed。')
  const config = payload.config && typeof payload.config === 'object' && !Array.isArray(payload.config) ? payload.config as Record<string, unknown> : {}
  const timeoutSeconds = Number(payload.timeout_seconds || 3600)
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 86_400) throw new ApiError(422, 'reproduction_timeout_invalid', '复现超时必须在 1 到 86400 秒之间。')
  const sourceRoot = sourcePathFor(reproduction)
  assertTreeWithoutLinks(sourceRoot)
  const sourceTreeSha256 = await hashTree(sourceRoot)
  if (sourceTreeSha256 !== reproduction.plan.source_tree_sha256) throw new ApiError(409, 'reproduction_source_changed', '复现源码在审批后发生变化，不能运行。')
  const runId = crypto.randomUUID()
  const runRelativePath = `${reproductionRelativeRoot(reproductionId)}/runs/${runId}`
  await database.query('INSERT INTO reproduction_runs(id,project_id,reproduction_id,proposal_id,status,source_commit,entrypoint,random_seeds,config,run_relative_path) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [runId, projectId, reproductionId, proposalId, 'queued', reproduction.source_commit, entrypoint, seeds, config, runRelativePath])
  const taskId = crypto.randomUUID()
  await database.query('INSERT INTO tasks(id,project_id,kind,payload,max_attempts,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6)', [taskId, projectId, 'repository_reproduction_run', { reproduction_run_id: runId, timeout_seconds: timeoutSeconds }, 1, `repository-reproduction-run:${runId}`])
  await database.query('UPDATE reproductions SET entrypoint=$2,plan=$3,error=NULL,updated_at=NOW() WHERE id=$1 AND project_id=$4', [reproductionId, entrypoint, { ...reproduction.plan, last_run_id: runId, timeout_seconds: timeoutSeconds, config_fingerprint: createHash('sha256').update(JSON.stringify(config)).digest('hex') }, projectId])
  return { run_id: runId, task_id: taskId, status: 'queued' }
}

function finiteMetrics(path: string): Record<string, number> {
  regularFile(path, 'reproduction_metrics_missing')
  let value: unknown
  try { value = JSON.parse(readFileSync(path, 'utf8')) } catch { throw new ApiError(422, 'reproduction_metrics_invalid_json', '复现 metrics.json 不是有效 JSON。') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(422, 'reproduction_metrics_invalid', '复现 metrics.json 必须是数值对象。')
  const result: Record<string, number> = {}
  for (const [key, item] of Object.entries(value)) {
    if (!/^[A-Za-z0-9_.-]{1,120}$/.test(key) || typeof item !== 'number' || !Number.isFinite(item)) throw new ApiError(422, 'reproduction_metrics_invalid', '复现 metrics.json 只能包含有限数值字段。')
    result[key] = item
  }
  if (!Object.keys(result).length) throw new ApiError(422, 'reproduction_metrics_empty', '复现 metrics.json 不能是空对象。')
  return result
}

function objectJson(path: string, code: string): Record<string, unknown> {
  regularFile(path, code)
  let value: unknown
  try { value = JSON.parse(readFileSync(path, 'utf8')) } catch { throw new ApiError(422, `${code}_invalid_json`, '复现 checkpoint.json 不是有效 JSON。') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(422, `${code}_invalid`, '复现 checkpoint.json 必须是对象。')
  return value as Record<string, unknown>
}

function aggregateMetrics(perSeed: Record<string, Record<string, number>>): Record<string, unknown> {
  const keys = [...new Set(Object.values(perSeed).flatMap(metrics => Object.keys(metrics)))].sort()
  const aggregate: Record<string, Record<string, number>> = {}
  for (const key of keys) {
    const values = Object.values(perSeed).map(metrics => metrics[key]).filter((value): value is number => typeof value === 'number')
    if (!values.length) continue
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    const populationStd = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length)
    aggregate[key] = { count: values.length, mean, population_std: populationStd, min: Math.min(...values), max: Math.max(...values) }
  }
  return { per_seed: perSeed, aggregate }
}

function collectFiles(root: string, current = root, result: OutputManifestEntry[] = []): OutputManifestEntry[] {
  if (!existsSync(root)) return result
  for (const name of readdirSync(current)) {
    const path = pathInside(current, name)
    const info = lstatSync(path)
    if (info.isSymbolicLink()) throw new ApiError(422, 'reproduction_output_symlink_forbidden', '复现输出不能包含符号链接。')
    if (info.isDirectory()) collectFiles(root, path, result)
    else if (info.isFile()) {
      const size = statSync(path).size
      if (size > maxOutputBytes) throw new ApiError(422, 'reproduction_output_too_large', '单个复现输出超过大小限制。')
      const relativePath = relative(root, path).replaceAll('\\', '/')
      result.push({ path: relativePath, sha256: hashFile(path), size_bytes: size, mime_type: artifactMimeType(basename(path)) })
      if (result.length > maxOutputFiles) throw new ApiError(422, 'reproduction_output_file_limit', '复现输出文件数量超过限制。')
    } else throw new ApiError(422, 'reproduction_output_special_file', '复现输出不能包含特殊文件。')
  }
  return result
}

export async function executeQueuedReproductionRun(runId: string): Promise<void> {
  const run = await one<ReproductionRunRecord>('SELECT * FROM reproduction_runs WHERE id=$1', [runId])
  if (!run) throw new ApiError(404, 'reproduction_run_not_found', '复现运行不存在。')
  const reproduction = await loadReproduction(run.project_id, run.reproduction_id)
  const root = runPathFor(run)
  const resultsRoot = pathInside(root, 'results')
  const logPath = pathInside(root, 'run.log')
  try {
    if (reproduction.status !== 'ready') throw new ApiError(409, 'reproduction_not_ready', '复现依赖环境不是 ready 状态。')
    if (run.source_commit !== reproduction.source_commit) throw new ApiError(409, 'reproduction_source_commit_mismatch', '复现运行的固定 commit 已变化。')
    const sourceRoot = sourcePathFor(reproduction)
    assertTreeWithoutLinks(sourceRoot)
    const currentTreeSha256 = await hashTree(sourceRoot)
    if (currentTreeSha256 !== reproduction.plan.source_tree_sha256) throw new ApiError(409, 'reproduction_source_changed', '复现源码在运行前发生变化。')
    validateEntrypoint(run.entrypoint)
    const venv = venvPathFor(reproduction)
    const python = pathInside(venv, 'bin', 'python')
    regularFile(python, 'reproduction_venv_python_missing')
    mkdirSync(root, { recursive: true })
    writeFileSync(logPath, '')
    writeFileSync(pathInside(root, 'plan.json'), `${JSON.stringify({ project_id: run.project_id, reproduction_id: run.reproduction_id, run_id: run.id, source_commit: run.source_commit, entrypoint: run.entrypoint, random_seeds: run.random_seeds, config: run.config }, null, 2)}\n`)
    await database.query("UPDATE reproduction_runs SET status='running',started_at=NOW(),error=NULL WHERE id=$1", [runId])
    const perSeed: Record<string, Record<string, number>> = {}
    const checkpoints: Record<string, Record<string, unknown>> = {}
    for (const seed of run.random_seeds) {
      const seedName = `seed-${seed}`
      const workspace = pathInside(root, 'workspaces', seedName)
      const output = pathInside(resultsRoot, seedName)
      copyTree(sourcePathFor(reproduction), workspace)
      mkdirSync(output, { recursive: true })
      const planPath = pathInside(root, 'plan.json')
      const result = await runFixedProcess(python, [pathInside(workspace, ...run.entrypoint.split('/'))], {
        cwd: workspace,
        env: { ...safeEnvironment(venv), RESEARCH_OS_PLAN_FILE: planPath, RESEARCH_OS_OUTPUT_DIR: output, RESEARCH_OS_SEED: String(seed) },
        logPath,
        timeoutSeconds: Number(reproduction.plan.timeout_seconds || 3600),
      })
      if (result.timed_out) throw new ApiError(504, 'reproduction_run_timeout', `复现 seed ${seed} 超时。`)
      if (result.exit_code !== 0) throw new ApiError(502, 'reproduction_process_failed', `复现 seed ${seed} 进程失败。`)
      perSeed[String(seed)] = finiteMetrics(pathInside(output, 'metrics.json'))
      checkpoints[String(seed)] = objectJson(pathInside(output, 'checkpoint.json'), 'reproduction_checkpoint')
    }
    const metrics = aggregateMetrics(perSeed)
    writeFileSync(pathInside(root, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`)
    writeFileSync(pathInside(root, 'checkpoint.json'), `${JSON.stringify({ source_commit: run.source_commit, checkpoints }, null, 2)}\n`)
    const manifest = collectFiles(root).filter(entry => !entry.path.startsWith('workspaces/'))
    await database.query("UPDATE reproduction_runs SET status='awaiting_artifact_approval',output_manifest=$2,metrics=$3,finished_at=NOW() WHERE id=$1", [runId, manifest, metrics])
    const artifactProposalId = crypto.randomUUID()
    await database.query('INSERT INTO proposals(id,project_id,kind,reason,summary,impact,payload) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
      artifactProposalId, run.project_id, 'repository_artifact_write', 'Register outputs from an approved reproduction run', 'Register verified reproduction outputs as controlled Artifacts',
      { reproduction_run_id: runId, source_commit: run.source_commit, output_count: manifest.length },
      { reproduction_run_id: runId, output_manifest: manifest },
    ])
    await database.query('UPDATE reproduction_runs SET artifact_proposal_id=$2 WHERE id=$1', [runId, artifactProposalId])
    await audit('repository.reproduction_succeeded_waiting_artifact', run.project_id, { reproduction_run_id: runId, artifact_proposal_id: artifactProposalId, output_count: manifest.length }, 'system')
  } catch (error) {
    const code = error instanceof ApiError ? error.code : error instanceof Error ? error.message : 'reproduction_run_failed'
    await database.query("UPDATE reproduction_runs SET status='failed',error=$2,finished_at=NOW() WHERE id=$1", [runId, code]).catch(() => undefined)
    await audit('repository.reproduction_failed', run.project_id, { reproduction_run_id: runId, code }, 'system').catch(() => undefined)
    throw error
  }
}

export async function finalizeReproductionArtifacts(projectId: string, proposalId: string, actor: string): Promise<{ reproduction_run_id: string; artifact_ids: string[] }> {
  const proposal = await one<{ payload: Record<string, unknown> }>('SELECT payload FROM proposals WHERE id=$1 AND project_id=$2 AND kind=$3', [proposalId, projectId, 'repository_artifact_write'])
  if (!proposal) throw new ApiError(404, 'reproduction_artifact_proposal_not_found', '复现产物 Proposal 不存在。')
  const runId = String(proposal.payload.reproduction_run_id || '')
  const run = await one<ReproductionRunRecord>('SELECT * FROM reproduction_runs WHERE id=$1 AND project_id=$2', [runId, projectId])
  if (!run) throw new ApiError(404, 'reproduction_run_not_found', '复现运行不存在。')
  if (run.status !== 'awaiting_artifact_approval') throw new ApiError(409, 'reproduction_artifact_state_invalid', '该复现运行当前不等待产物登记。')
  const manifest = run.output_manifest
  const runRoot = runPathFor(run)
  const destinationRelativeRoot = projectArtifactRelativePath(`reproduction-runs/${run.id}`)
  const destinationRoot = projectArtifactPath(projectId, destinationRelativeRoot)
  const artifactIds: string[] = []
  let total = 0
  try {
    for (const entry of manifest) {
      validateReproductionRelativePath(entry.path, 'output_manifest.path')
      if (entry.path.startsWith('workspaces/')) throw new ApiError(422, 'reproduction_workspace_artifact_forbidden', '不能把复现源码工作副本登记为 Artifact。')
      const source = pathInside(runRoot, ...entry.path.split('/'))
      regularFile(source, 'reproduction_output_missing')
      const info = statSync(source)
      total += info.size
      if (total > maxOutputBytes) throw new ApiError(422, 'reproduction_output_total_too_large', '复现输出总大小超过限制。')
      const currentSha256 = hashFile(source)
      if (currentSha256 !== entry.sha256 || info.size !== entry.size_bytes) throw new ApiError(409, 'reproduction_output_hash_mismatch', '复现输出在审批前发生变化，不能登记。')
      const destination = pathInside(destinationRoot, ...entry.path.split('/'))
      mkdirSync(resolve(destination, '..'), { recursive: true })
      copyFileSync(source, destination)
      const artifactId = crypto.randomUUID()
      artifactIds.push(artifactId)
      const relativePath = projectArtifactRelativePath(relative(pathInside(projectsRoot, projectId), destination).replaceAll('\\', '/'))
      await database.query('INSERT INTO artifacts(id,project_id,reproduction_run_id,kind,name,relative_path,mime_type,sha256,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
        artifactId, projectId, run.id, 'reproduction_output', basename(entry.path), relativePath, entry.mime_type, entry.sha256,
        { reproduction_id: run.reproduction_id, source_commit: run.source_commit, source_relative_path: entry.path, entrypoint: run.entrypoint, random_seeds: run.random_seeds, config: run.config, evidence_status: 'integration_result_requires_review' },
      ])
      await database.query('INSERT INTO artifact_dependencies(id,project_id,artifact_id,upstream_type,upstream_id,relation) VALUES ($1,$2,$3,$4,$5,$6)', [crypto.randomUUID(), projectId, artifactId, 'reproduction_run', run.id, 'generated_from_reproduction'])
    }
    await registerLineageDependencies(projectId, [
      { downstream: { type: 'reproduction_run', id: run.id }, upstream: { type: 'reproduction', id: run.reproduction_id }, relation: 'reproduction_run_source' },
      ...artifactIds.map(artifactId => ({ downstream: { type: 'artifact' as const, id: artifactId }, upstream: { type: 'reproduction_run' as const, id: run.id }, relation: 'reproduction_output' })),
    ])
    await database.query("UPDATE reproduction_runs SET status='completed',artifact_ids=$2 WHERE id=$1", [run.id, artifactIds])
    await audit('repository.reproduction_artifacts_registered', projectId, { reproduction_run_id: run.id, artifact_ids: artifactIds }, actor)
    return { reproduction_run_id: run.id, artifact_ids: artifactIds }
  } catch (error) {
    rmSync(destinationRoot, { recursive: true, force: true })
    for (const artifactId of artifactIds) {
      await database.query('DELETE FROM artifact_dependencies WHERE artifact_id=$1', [artifactId]).catch(() => undefined)
      await database.query('DELETE FROM artifacts WHERE id=$1 AND project_id=$2', [artifactId, projectId]).catch(() => undefined)
    }
    throw error
  }
}

export async function rejectReproductionArtifacts(projectId: string, proposalId: string, actor: string, reason: string): Promise<void> {
  const proposal = await one<{ payload: Record<string, unknown> }>('SELECT payload FROM proposals WHERE id=$1 AND project_id=$2 AND kind=$3', [proposalId, projectId, 'repository_artifact_write'])
  const runId = String(proposal?.payload.reproduction_run_id || '')
  if (runId) {
    await database.query("UPDATE reproduction_runs SET status='artifact_rejected',error=$2,finished_at=COALESCE(finished_at,NOW()) WHERE id=$1 AND project_id=$3 AND status='awaiting_artifact_approval'", [runId, reason, projectId])
    await audit('repository.reproduction_artifacts_rejected', projectId, { reproduction_run_id: runId, reason }, actor)
  }
}
