import { audit, database, rows } from './database.js'
import {
  deterministicProjectSlugSuffix,
  isCurrentProjectSlug,
  legacyProjectSlugBase,
} from './project-slug.js'

type ProjectRow = { id: string; slug: string; title: string }
type AliasRow = { slug: string; project_id: string }

export async function migrateProjectSlugs(): Promise<void> {
  const projects = await rows<ProjectRow>('SELECT id,slug,title FROM projects ORDER BY created_at,id')
  const aliases = await rows<AliasRow>('SELECT slug,project_id FROM project_slug_aliases')
  const occupiedSlugs = new Set(projects.map(project => project.slug))
  const aliasOwners = new Map(aliases.map(alias => [alias.slug, alias.project_id]))
  let migrated = 0
  let aliasConflicts = 0

  for (const project of projects) {
    if (isCurrentProjectSlug(project.slug)) continue
    const legacySlug = project.slug
    const base = legacyProjectSlugBase(project.title, legacySlug)
    let candidate = ''
    for (let attempt = 0; attempt < 10_000; attempt += 1) {
      const suffix = deterministicProjectSlugSuffix(project.id, legacySlug, attempt)
      const next = `${base}-${suffix}`
      if (!occupiedSlugs.has(next) && !aliasOwners.has(next)) {
        candidate = next
        break
      }
    }
    if (!candidate) throw new Error('project_slug_unavailable')

    const existingAliasOwner = aliasOwners.get(legacySlug)
    if (existingAliasOwner && existingAliasOwner !== project.id) {
      aliasConflicts += 1
      continue
    }

    await database.transaction(async transaction => {
      await transaction.query('UPDATE projects SET slug=$2 WHERE id=$1', [project.id, candidate])
      await transaction.query(
        'INSERT INTO project_slug_aliases(slug,project_id) VALUES ($1,$2) ON CONFLICT (slug) DO UPDATE SET project_id=EXCLUDED.project_id',
        [legacySlug, project.id],
      )
    })
    occupiedSlugs.delete(legacySlug)
    occupiedSlugs.add(candidate)
    aliasOwners.set(legacySlug, project.id)
    migrated += 1
  }

  if (migrated || aliasConflicts) {
    await audit('project.slugs_migrated', null, { migrated, alias_conflicts: aliasConflicts })
  }
}
