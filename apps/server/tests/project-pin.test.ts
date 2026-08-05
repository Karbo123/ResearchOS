import { testProjectSlug } from './test-project.js'
import crypto from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../src/index.js'
import { database, migrate } from '../src/database.js'

const firstProjectId = testProjectSlug()
const secondProjectId = testProjectSlug()
const thirdProjectId = testProjectSlug()

async function requestJson(path: string, init: RequestInit = {}) {
  const response = await app.request(`http://research-os.test${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  })
  return { response, body: await response.json() as Record<string, unknown> }
}

describe('project pin API', () => {
  beforeAll(async () => {
    await migrate()
    await database.query('INSERT INTO projects(id,slug,title,pinned,sidebar_order) VALUES ($1,$2,$3,FALSE,0),($4,$5,$6,TRUE,0),($7,$8,$9,TRUE,1)', [
      firstProjectId, `pin-first-${firstProjectId.slice(0, 8)}`, 'First pin test project',
      secondProjectId, `pin-second-${secondProjectId.slice(0, 8)}`, 'Second pin test project',
      thirdProjectId, `pin-third-${thirdProjectId.slice(0, 8)}`, 'Third pin test project',
    ])
  })

  afterAll(async () => {
    await database.query('DELETE FROM audit_events WHERE project_id IN ($1,$2,$3)', [firstProjectId, secondProjectId, thirdProjectId])
    await database.query('DELETE FROM projects WHERE id IN ($1,$2,$3)', [firstProjectId, secondProjectId, thirdProjectId])
  })

  it('persists pin state and returns pinned projects first', async () => {
    const pinned = await requestJson(`/api/projects/${firstProjectId}/pin`, {
      method: 'PATCH',
      body: JSON.stringify({ pinned: true }),
    })
    expect(pinned.response.status).toBe(200)
    expect(pinned.body).toMatchObject({ id: firstProjectId, pinned: true })

    const listed = await requestJson('/api/projects')
    expect(listed.response.status).toBe(200)
    const projects = listed.body as unknown as Array<{ id: string; pinned: boolean }>
    const firstIndex = projects.findIndex(project => project.id === firstProjectId)
    const secondIndex = projects.findIndex(project => project.id === secondProjectId)
    expect(firstIndex).toBeGreaterThanOrEqual(0)
    expect(secondIndex).toBeGreaterThanOrEqual(0)
    const thirdIndex = projects.findIndex(project => project.id === thirdProjectId)
    expect(secondIndex).toBeLessThan(thirdIndex)
    expect(thirdIndex).toBeLessThan(firstIndex)
    expect(projects[firstIndex]?.pinned).toBe(true)
  })

  it('unpins the project with the strict request contract', async () => {
    const unpinned = await requestJson(`/api/projects/${firstProjectId}/pin`, {
      method: 'PATCH',
      body: JSON.stringify({ pinned: false, extra: true }),
    })
    expect(unpinned.response.status).toBe(422)

    const restored = await requestJson(`/api/projects/${firstProjectId}/pin`, {
      method: 'PATCH',
      body: JSON.stringify({ pinned: false }),
    })
    expect(restored.response.status).toBe(200)
    expect(restored.body).toMatchObject({ id: firstProjectId, pinned: false })
  })

  it('reorders one pinned group and rejects duplicates or mixed groups', async () => {
    const reordered = await requestJson('/api/projects/order', {
      method: 'PATCH',
      body: JSON.stringify({ project_ids: [thirdProjectId, secondProjectId] }),
    })
    expect(reordered.response.status).toBe(200)
    const listed = await requestJson('/api/projects')
    const projects = listed.body as unknown as Array<{ id: string; pinned: boolean }>
    expect(projects.findIndex(project => project.id === thirdProjectId)).toBeLessThan(projects.findIndex(project => project.id === secondProjectId))

    const duplicate = await requestJson('/api/projects/order', {
      method: 'PATCH',
      body: JSON.stringify({ project_ids: [thirdProjectId, thirdProjectId] }),
    })
    expect(duplicate.response.status).toBe(422)

    const mixed = await requestJson('/api/projects/order', {
      method: 'PATCH',
      body: JSON.stringify({ project_ids: [firstProjectId, thirdProjectId] }),
    })
    expect(mixed.response.status).toBe(422)
  })
})
