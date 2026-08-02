import crypto from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../src/index.js'
import { database, migrate } from '../src/database.js'

const firstProjectId = crypto.randomUUID()
const secondProjectId = crypto.randomUUID()

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
    await database.query('INSERT INTO projects(id,slug,title,pinned) VALUES ($1,$2,$3,FALSE),($4,$5,$6,TRUE)', [
      firstProjectId, `pin-first-${firstProjectId.slice(0, 8)}`, 'First pin test project',
      secondProjectId, `pin-second-${secondProjectId.slice(0, 8)}`, 'Second pin test project',
    ])
  })

  afterAll(async () => {
    await database.query('DELETE FROM audit_events WHERE project_id IN ($1,$2)', [firstProjectId, secondProjectId])
    await database.query('DELETE FROM projects WHERE id IN ($1,$2)', [firstProjectId, secondProjectId])
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
    expect(firstIndex).toBeLessThan(secondIndex)
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
})
