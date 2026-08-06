import { testProjectSlug } from './test-project.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../src/index.js'
import { database, migrate } from '../src/database.js'

const projectId = testProjectSlug()

async function requestJson(path: string, init: RequestInit = {}) {
  const response = await app.request(`http://research-os.test${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  })
  return { response, body: await response.json() as Record<string, unknown> }
}

describe('project rename API', () => {
  beforeAll(async () => {
    await migrate()
    await database.query('INSERT INTO projects(id,slug,title,pinned,sidebar_order) VALUES ($1,$2,$3,FALSE,0)', [projectId, projectId, 'Original title'])
    await database.query('INSERT INTO idea_versions(id,project_id,version,spec) VALUES ($1,$2,1,$3)', [crypto.randomUUID(), projectId, { schema_version: '1.0', idea: { title: 'Original title' } }])
  })

  afterAll(async () => {
    await database.query('DELETE FROM audit_events WHERE project_id=$1', [projectId]).catch(() => undefined)
    await database.query('DELETE FROM projects WHERE id=$1', [projectId]).catch(() => undefined)
  })

  it('renames the project and keeps the latest Idea spec title in sync', async () => {
    const renamed = await requestJson(`/api/projects/${projectId}/title`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Renamed project' }),
    })
    expect(renamed.response.status).toBe(200)
    expect(renamed.body).toMatchObject({ id: projectId, slug: projectId, title: 'Renamed project' })

    const project = await requestJson(`/api/projects/${projectId}`)
    expect(project.body).toMatchObject({ title: 'Renamed project' })
    const idea = (project.body.idea_versions as Array<{ spec: { idea?: { title?: string } } }>)[0]
    expect(idea?.spec?.idea?.title).toBe('Renamed project')
  })

  it('rejects blank titles and extra fields', async () => {
    const blank = await requestJson(`/api/projects/${projectId}/title`, {
      method: 'PATCH',
      body: JSON.stringify({ title: '   ' }),
    })
    expect(blank.response.status).toBe(422)

    const extra = await requestJson(`/api/projects/${projectId}/title`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'New title', extra: true }),
    })
    expect(extra.response.status).toBe(422)
  })
})
