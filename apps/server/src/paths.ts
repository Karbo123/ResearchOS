import { mkdirSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const sourceDirectory = dirname(fileURLToPath(import.meta.url))
export const repositoryRoot = resolve(sourceDirectory, '../../..')
const defaultRuntimeDirectory = process.env.NODE_ENV === 'test' ? `runtime/test-${process.pid}` : 'runtime'
export const runtimeRoot = resolve(repositoryRoot, process.env.RESEARCH_RUNTIME_DIR || defaultRuntimeDirectory)
export const projectsRoot = resolve(repositoryRoot, process.env.RESEARCH_PROJECTS_DIR || 'projects')
export const artifactsRoot = resolve(repositoryRoot, process.env.RESEARCH_ARTIFACTS_DIR || 'artifacts')
export const publicRoot = resolve(repositoryRoot, 'apps/web/public')

for (const path of [runtimeRoot, projectsRoot, artifactsRoot]) mkdirSync(path, { recursive: true })

export function pathInside(root: string, ...parts: string[]): string {
  const candidate = resolve(root, ...parts)
  const normalizedRoot = resolve(root)
  const prefix = `${normalizedRoot}${sep}`.toLowerCase()
  if (candidate.toLowerCase() !== normalizedRoot.toLowerCase() && !candidate.toLowerCase().startsWith(prefix)) {
    throw new Error('path_outside_allowed_root')
  }
  return candidate
}

export function gitBinary(): string {
  return 'git'
}
