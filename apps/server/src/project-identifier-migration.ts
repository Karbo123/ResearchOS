import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { audit, rows } from './database.js'
import { pathInside, projectsRoot, runtimeRoot } from './paths.js'
import { isProjectUuidReference } from './project-slug.js'

type AliasRow = { slug: string; project_id: string }

function readJsonIfExists(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function atomicWrite(path: string, value: unknown): void {
  mkdirSync(runtimeRoot, { recursive: true })
  const temporary = `${path}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, path)
}

function mergeDirectory(source: string, target: string): void {
  if (source === target) return
  if (!existsSync(source)) return
  mkdirSync(target, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = resolve(source, entry.name)
    const targetPath = resolve(target, entry.name)
    if (!existsSync(targetPath)) {
      renameSync(sourcePath, targetPath)
      continue
    }
    if (entry.isDirectory()) {
      mergeDirectory(sourcePath, targetPath)
      continue
    }
    if (entry.isFile()) {
      renameSync(sourcePath, `${targetPath}.conflict-${Date.now()}`)
    }
  }
  rmSync(source, { recursive: true, force: true })
}

function migrateKeyedJson(path: string, aliases: Map<string, string>): boolean {
  const parsed = readJsonIfExists(path)
  if (!parsed) return false
  const migrated: Record<string, unknown> = {}
  let changed = false
  for (const [key, value] of Object.entries(parsed)) {
    const canonical = aliases.get(key) ?? key
    if (canonical !== key) changed = true
    if (canonical in migrated && migrated[canonical] && value && typeof value === 'object') {
      migrated[canonical] = { ...(migrated[canonical] as Record<string, unknown>), ...(value as Record<string, unknown>) }
    } else {
      migrated[canonical] = value
    }
  }
  if (changed) atomicWrite(path, migrated)
  return changed
}

function migrateWorkflowRuns(aliases: Map<string, string>): boolean {
  const path = resolve(runtimeRoot, 'workflow-runs.json')
  if (!existsSync(path)) return false
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return false
  }
  if (!Array.isArray(parsed)) return false
  const runs = parsed as Array<Record<string, unknown>>
  let changed = false
  for (const run of runs) {
    const value = typeof run.project_id === 'string' ? run.project_id : ''
    const canonical = aliases.get(value)
    if (canonical && canonical !== value) {
      run.project_id = canonical
      changed = true
    }
  }
  if (changed) atomicWrite(path, runs)
  return changed
}

function migrateWorkflowAudit(aliases: Map<string, string>): boolean {
  const path = resolve(runtimeRoot, 'workflow-audit.jsonl')
  if (!existsSync(path)) return false
  const original = readFileSync(path, 'utf8')
  const lines = original.split('\n')
  let changed = false
  const migrated = lines.map(line => {
    if (!line.trim()) return line
    try {
      const parsed = JSON.parse(line) as { project_id?: unknown }
      if (typeof parsed.project_id !== 'string') return line
      const canonical = aliases.get(parsed.project_id)
      if (!canonical || canonical === parsed.project_id) return line
      changed = true
      return JSON.stringify({ ...parsed, project_id: canonical })
    } catch {
      return line
    }
  })
  if (changed) writeFileSync(path, `${migrated.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 })
  return changed
}

function migrateWorkflowCache(aliases: Map<string, string>): boolean {
  const cacheRoot = resolve(runtimeRoot, 'workflow-cache')
  if (!existsSync(cacheRoot)) return false
  let changed = false
  for (const entry of readdirSync(cacheRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const canonical = aliases.get(entry.name)
    if (!canonical || canonical === entry.name) continue
    mergeDirectory(pathInside(cacheRoot, entry.name), pathInside(cacheRoot, canonical))
    changed = true
  }
  return changed
}

function migrateProjectDirectories(aliases: Map<string, string>): boolean {
  let changed = false
  for (const [alias, canonical] of aliases) {
    if (alias === canonical) continue
    const source = pathInside(projectsRoot, alias)
    if (!existsSync(source)) continue
    mergeDirectory(source, pathInside(projectsRoot, canonical))
    changed = true
  }
  return changed
}

export async function migrateProjectIdentifierStorage(): Promise<void> {
  const aliasRows = await rows<AliasRow>('SELECT slug,project_id FROM project_slug_aliases')
  const aliases = new Map(aliasRows.filter(row => !isProjectUuidReference(row.slug)).map(row => [row.slug, row.project_id]))
  const migratedDirectories = migrateProjectDirectories(aliases)
  const migratedProjectSettings = migrateKeyedJson(resolve(runtimeRoot, 'project-settings.json'), aliases)
  const migratedEmbeddingSettings = migrateKeyedJson(resolve(runtimeRoot, 'project-embedding-settings.json'), aliases)
  const migratedRuns = migrateWorkflowRuns(aliases)
  const migratedAudit = migrateWorkflowAudit(aliases)
  const migratedCache = migrateWorkflowCache(aliases)
  if (migratedDirectories || migratedProjectSettings || migratedEmbeddingSettings || migratedRuns || migratedAudit || migratedCache) {
    await audit('project.identifier_migrated_to_slug', null, {
      directories: migratedDirectories,
      project_settings: migratedProjectSettings,
      embedding_settings: migratedEmbeddingSettings,
      workflow_runs: migratedRuns,
      workflow_audit: migratedAudit,
      workflow_cache: migratedCache,
    })
  }
}
