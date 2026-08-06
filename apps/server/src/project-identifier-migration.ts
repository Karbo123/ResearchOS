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
  if (migratedDirectories || migratedProjectSettings || migratedEmbeddingSettings) {
    await audit('project.identifier_migrated_to_slug', null, {
      directories: migratedDirectories,
      project_settings: migratedProjectSettings,
      embedding_settings: migratedEmbeddingSettings,
    })
  }
}
