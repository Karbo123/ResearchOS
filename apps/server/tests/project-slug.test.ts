import crypto from 'node:crypto'
import { describe, expect, it, afterAll, beforeAll } from 'vitest'
import { database, migrate } from '../src/database.js'
import { nextAvailableProjectSlug, normalizeProjectSlug, normalizeProjectSlugKeywords } from '../src/project-slug.js'
import { app } from '../src/index.js'

const projectId = crypto.randomUUID()

describe('semantic project slugs', () => {
  beforeAll(async () => {
    await migrate()
    await database.query('INSERT INTO projects(id,slug,title) VALUES ($1,$2,$3)', [projectId, 'mnist-cnn-example', 'Slug test'])
  })

  afterAll(async () => {
    await database.query('DELETE FROM projects WHERE id=$1', [projectId])
  })

  it('normalizes three distinct URL-safe words', () => {
    expect(normalizeProjectSlug(' MNIST_cnn example ')).toBe('mnist-cnn-example')
    expect(normalizeProjectSlugKeywords(['ViT', 'satellite', 'segmentation'])).toBe('vit-satellite-segmentation')
  })

  it('rejects invalid or repeated words', () => {
    expect(() => normalizeProjectSlug('research-project')).toThrow('project_slug_invalid')
    expect(() => normalizeProjectSlug('cnn-cnn-image')).toThrow('project_slug_invalid')
    expect(() => normalizeProjectSlugKeywords(['one', 'two'])).toThrow('project_slug_invalid')
  })

  it('chooses a deterministic numeric suffix on an automatic collision', async () => {
    await expect(nextAvailableProjectSlug('mnist-cnn-example')).resolves.toBe('mnist-cnn-example-2')
  })

  it('resolves project details by semantic slug as well as UUID', async () => {
    const bySlug = await app.request('/api/projects/mnist-cnn-example')
    const byId = await app.request(`/api/projects/${projectId}`)
    expect(bySlug.status).toBe(200)
    expect(byId.status).toBe(200)
    await expect(bySlug.json()).resolves.toMatchObject({ id: projectId, slug: 'mnist-cnn-example' })
    await expect(byId.json()).resolves.toMatchObject({ id: projectId, slug: 'mnist-cnn-example' })
  })

  it('serves the SPA shell for a clean workspace path', async () => {
    const response = await app.request('/project/mnist-cnn-example/overview/idea')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
  })
})
