import crypto from 'node:crypto'
import { describe, expect, it, afterAll, beforeAll } from 'vitest'
import { database, migrate } from '../src/database.js'
import { isCurrentProjectSlug, nextAvailableProjectSlug, normalizeProjectSlug, normalizeProjectSlugKeywords } from '../src/project-slug.js'
import { migrateProjectSlugs } from '../src/project-slug-migration.js'
import { app } from '../src/index.js'

const projectId = crypto.randomUUID()
const newProjectId = crypto.randomUUID()
const collisionProjectId = crypto.randomUUID()
const migrationProjectId = crypto.randomUUID()

describe('project URL slugs', () => {
  beforeAll(async () => {
    await migrate()
    await database.query('INSERT INTO projects(id,slug,title) VALUES ($1,$2,$3),($4,$5,$6),($7,$8,$9),($10,$11,$12)', [
      projectId, 'mnist-cnn-example', 'Legacy slug test',
      newProjectId, 'cnn-minimal-2q95', 'New slug test',
      collisionProjectId, 'vit-satellite-2q95', 'Collision slug test',
      migrationProjectId, 'research-60145276', 'Uncertainty Based Active Learning',
    ])
  })

  afterAll(async () => {
    await database.query('DELETE FROM projects WHERE id=ANY($1::uuid[])', [[projectId, newProjectId, collisionProjectId, migrationProjectId]])
  })

  it('normalizes exactly two English words and a four-character suffix', () => {
    expect(normalizeProjectSlug(' CNN_minimal_2Q95 ')).toBe('cnn-minimal-2q95')
    expect(normalizeProjectSlugKeywords(['ViT', 'satellite'])).toBe('vit-satellite')
  })

  it('rejects missing, repeated, extra, or malformed slug parts', () => {
    expect(() => normalizeProjectSlug('research-project')).toThrow('project_slug_invalid')
    expect(() => normalizeProjectSlug('cnn-cnn-2q95')).toThrow('project_slug_invalid')
    expect(() => normalizeProjectSlug('cnn-image-classification-2q95')).toThrow('project_slug_invalid')
    expect(() => normalizeProjectSlug('cnn-image-2q9')).toThrow('project_slug_invalid')
    expect(() => normalizeProjectSlug('cnn-image-2q95-extra')).toThrow('project_slug_invalid')
    expect(() => normalizeProjectSlugKeywords(['one', 'two', 'three'])).toThrow('project_slug_invalid')
  })

  it('chooses another random-format suffix on an automatic collision', async () => {
    const suffixes = ['2q95', '3z7a']
    await expect(nextAvailableProjectSlug('vit-satellite', () => suffixes.shift() || '4m8n')).resolves.toBe('vit-satellite-3z7a')
  })

  it('resolves both new and historical slugs as well as UUID', async () => {
    const bySlug = await app.request('/api/projects/cnn-minimal-2q95')
    const byLegacySlug = await app.request('/api/projects/mnist-cnn-example')
    const byId = await app.request(`/api/projects/${projectId}`)
    expect(bySlug.status).toBe(200)
    expect(byLegacySlug.status).toBe(200)
    expect(byId.status).toBe(200)
    await expect(bySlug.json()).resolves.toMatchObject({ id: newProjectId, slug: 'cnn-minimal-2q95' })
    await expect(byLegacySlug.json()).resolves.toMatchObject({ id: projectId, slug: 'mnist-cnn-example' })
    await expect(byId.json()).resolves.toMatchObject({ id: projectId, slug: 'mnist-cnn-example' })
  })

  it('serves the SPA shell for a clean workspace path', async () => {
    const response = await app.request('/project/cnn-minimal-2q95/overview/idea')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
  })

  it('migrates legacy slugs and keeps an alias for the old URL', async () => {
    await migrateProjectSlugs()
    const migrated = await database.query<{ slug: string }>('SELECT slug FROM projects WHERE id=$1', [migrationProjectId])
    const alias = await database.query<{ project_id: string }>('SELECT project_id FROM project_slug_aliases WHERE slug=$1', ['research-60145276'])
    expect(isCurrentProjectSlug(migrated.rows[0]?.slug || '')).toBe(true)
    expect(alias.rows[0]?.project_id).toBe(migrationProjectId)
    const oldUrl = await app.request('/api/projects/research-60145276')
    expect(oldUrl.status).toBe(200)
    await expect(oldUrl.json()).resolves.toMatchObject({ id: migrationProjectId, slug: migrated.rows[0]?.slug })
  })
})
