import { copyFileSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import { artifactsRoot, pathInside, projectsRoot, runtimeRoot } from './paths.js'

export function projectRoot(projectId: string): string {
  return pathInside(projectsRoot, projectId)
}

export function projectArtifactRoot(projectId: string): string {
  const root = pathInside(projectRoot(projectId), 'artifacts')
  mkdirSync(root, { recursive: true })
  return root
}

export function projectArtifactRelativePath(relativePath: string): string {
  const normalized = relativePath.replaceAll('\\', '/').replace(/^\/+/, '')
  return normalized.startsWith('artifacts/') ? normalized : `artifacts/${normalized}`
}

export function projectArtifactPath(projectId: string, relativePath: string): string {
  return pathInside(projectRoot(projectId), ...projectArtifactRelativePath(relativePath).split('/'))
}

export function projectFilePath(projectId: string, relativePath: string): string {
  const normalized = relativePath.replaceAll('\\', '/').replace(/^\/+/, '')
  if (normalized.startsWith('staging/')) return pathInside(runtimeRoot, ...normalized.split('/'))
  const projectPath = projectArtifactPath(projectId, normalized)
  return existsSync(projectPath) ? projectPath : legacyArtifactPath(normalized)
}

export function legacyArtifactPath(relativePath: string): string {
  return pathInside(artifactsRoot, ...relativePath.split('/'))
}

export function projectStagingPath(sessionId: string): string {
  return pathInside(runtimeRoot, 'staging', 'uploads', sessionId)
}

export function moveIntoProject(projectId: string, source: string, destinationRelativePath: string): string {
  const destination = projectArtifactPath(projectId, destinationRelativePath)
  mkdirSync(pathInside(projectRoot(projectId), ...projectArtifactRelativePath(destinationRelativePath).split('/').slice(0, -1)), { recursive: true })
  if (existsSync(source)) {
    try { renameSync(source, destination) }
    catch (error) {
      if (!(error instanceof Error && 'code' in error && (error.code === 'EACCES' || error.code === 'EXDEV'))) throw error
      copyFileSync(source, destination)
    }
  }
  return destination
}
