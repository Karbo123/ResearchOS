import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, relative } from 'node:path'
import { one } from './database.js'
import { gitBinary, pathInside, projectsRoot } from './paths.js'
import { ApiError } from './http.js'
import { requireProject } from './project-service.js'

const MAX_FILES = 600
const MAX_DIFF_CHARS = 120_000
const IGNORED_DIRECTORIES = new Set(['.git', '.venv', 'node_modules', '__pycache__'])

function runGit(root: string, args: string[]): string | null {
  try {
    return execFileSync(gitBinary(), args, { cwd: root, encoding: 'utf8', timeout: 8_000, maxBuffer: MAX_DIFF_CHARS }).trim()
  } catch {
    return null
  }
}
function collectFiles(root: string): Array<{ path: string; kind: 'file' | 'directory'; size_bytes: number }> {
  if (!existsSync(root)) return []
  const files: Array<{ path: string; kind: 'file' | 'directory'; size_bytes: number }> = []
  const visit = (directory: string) => {
    if (files.length >= MAX_FILES) return
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue
      const absolute = pathInside(directory, entry.name)
      const relativePath = relative(root, absolute).replaceAll('\\', '/')
      if (entry.isDirectory()) {
        files.push({ path: relativePath, kind: 'directory', size_bytes: 0 })
        visit(absolute)
      } else if (entry.isFile()) {
        let size = 0
        try { size = statSync(absolute).size } catch { size = 0 }
        files.push({ path: relativePath, kind: 'file', size_bytes: size })
      }
      if (files.length >= MAX_FILES) return
    }
  }
  visit(root)
  return files
}

export async function projectWorkspaceDetail(
  projectId: string,
  options: { scope?: 'method' | 'reproduction'; reproductionId?: string } = {},
) {
  await requireProject(projectId)
  const root = pathInside(projectsRoot, projectId)
  if (!existsSync(root)) throw new ApiError(404, 'project_workspace_not_found', '项目代码工作区不存在。')
  let codeRoot: string
  let codeRelativePath: string
  let sourceCommit: string | null = null
  if (options.scope === 'reproduction') {
    if (!options.reproductionId) throw new ApiError(422, 'reproduction_id_required', '查看复现代码工作区需要指定复现记录。')
    const reproduction = await one<{ id: string; repository_relative_path: string; source_commit: string }>(
      'SELECT id,repository_relative_path,source_commit FROM reproductions WHERE id=$1 AND project_id=$2',
      [options.reproductionId, projectId],
    )
    if (!reproduction) throw new ApiError(404, 'reproduction_not_found', '复现记录不存在或不属于当前项目。')
    codeRoot = pathInside(root, ...reproduction.repository_relative_path.split('/'))
    codeRelativePath = reproduction.repository_relative_path
    sourceCommit = reproduction.source_commit
  } else {
    codeRoot = pathInside(root, 'code')
    codeRelativePath = `projects/${projectId}/code`
  }
  const branch = runGit(root, ['branch', '--show-current'])
  const head = runGit(root, ['rev-parse', 'HEAD'])
  const status = runGit(root, ['status', '--short', '--branch'])
  const diffPath = options.scope === 'reproduction' ? codeRelativePath : 'code'
  const diff = runGit(root, ['diff', '--no-ext-diff', '--', diffPath])
  const trackedDiff = diff ? diff.slice(0, MAX_DIFF_CHARS) : ''
  return {
    project_id: projectId,
    root_relative_path: `projects/${projectId}`,
    code_relative_path: codeRelativePath,
    code_directory_exists: existsSync(codeRoot),
    source_commit: sourceCommit,
    branch: branch || null,
    head: head || null,
    dirty: Boolean(status?.split('\n').some(line => line && !line.startsWith('##'))),
    status: status || null,
    diff: trackedDiff,
    diff_truncated: Boolean(diff && diff.length > MAX_DIFF_CHARS),
    files: collectFiles(codeRoot),
    dependency_manifests: collectFiles(codeRoot).filter(item => item.kind === 'file' && ['package.json', 'package-lock.json', 'pyproject.toml', 'requirements.txt', 'CMakeLists.txt'].includes(basename(item.path))),
    limits: { max_files: MAX_FILES, max_diff_chars: MAX_DIFF_CHARS },
  }
}
