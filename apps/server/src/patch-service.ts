import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, extname } from 'node:path'
import { mkdirSync } from 'node:fs'
import { gitBinary, pathInside, projectsRoot } from './paths.js'
import { ApiError } from './http.js'
import { ensureProjectGit } from './project-service.js'

type Operation = { action: 'create' | 'replace' | 'delete'; path: string; content?: string; expected_sha256?: string }
const allowedExtensions = new Set(['.ts', '.tsx', '.json', '.toml', '.tex', '.bib', '.md', '.yaml', '.yml', '.css', '.sty'])

function sha256(content: Buffer): string { return createHash('sha256').update(content).digest('hex') }
function validateOperation(operation: Operation): void {
  if (!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(operation.path) || operation.path.split('/').some(part => part === '.git' || part === '.env')) throw new ApiError(422, 'patch_path_invalid', 'Patch 路径不安全。')
  if (!allowedExtensions.has(extname(operation.path).toLowerCase())) throw new ApiError(422, 'patch_type_forbidden', 'Patch 文件类型不在白名单中。')
  if (operation.content && Buffer.byteLength(operation.content) > 512 * 1024) throw new ApiError(422, 'patch_content_too_large', '单个 Patch 内容超过限制。')
}

export function gitCommit(projectId: string): string {
  return ensureProjectGit(projectId)
}

export function applyApprovedPatch(projectId: string, payload: Record<string, unknown>, actor: string): string {
  const operations = payload.operations
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > 50) throw new ApiError(422, 'patch_operations_invalid', 'Patch 操作列表无效。')
  if (typeof payload.base_git_commit !== 'string' || gitCommit(projectId) !== payload.base_git_commit) throw new ApiError(409, 'patch_base_changed', '项目 Git 基线已变化，必须重新审查 diff。')
  const root = pathInside(projectsRoot, projectId)
  const backups = new Map<string, Buffer | null>()
  try {
    for (const raw of operations) {
      const operation = raw as Operation
      validateOperation(operation)
      const target = pathInside(root, ...operation.path.split('/'))
      const existing = existsSync(target) ? readFileSync(target) : null
      backups.set(target, existing)
      if (operation.action === 'create' && existing) throw new ApiError(409, 'patch_create_conflict', `${operation.path} 已存在。`)
      if (operation.action !== 'create' && !existing) throw new ApiError(409, 'patch_target_missing', `${operation.path} 不存在。`)
      if (operation.action !== 'create' && sha256(existing!) !== operation.expected_sha256) throw new ApiError(409, 'patch_sha_changed', `${operation.path} 内容已变化。`)
      if (operation.action === 'delete') rmSync(target)
      else {
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, operation.content || '', { encoding: 'utf8', flag: operation.action === 'create' ? 'wx' : 'w' })
      }
    }
    execFileSync(gitBinary(), ['add', '--all'], { cwd: root, stdio: 'ignore' })
    execFileSync(gitBinary(), ['-c', `user.name=${actor}`, '-c', 'user.email=local@research-os.invalid', 'commit', '-m', 'chore: apply approved research change'], { cwd: root, stdio: 'ignore' })
    return gitCommit(projectId)
  } catch (error) {
    for (const [path, content] of backups) {
      if (content === null) { if (existsSync(path)) rmSync(path) }
      else writeFileSync(path, content)
    }
    try { execFileSync(gitBinary(), ['reset', '--mixed', 'HEAD'], { cwd: root, stdio: 'ignore' }) } catch { /* Preserve the original structured failure. */ }
    throw error
  }
}
