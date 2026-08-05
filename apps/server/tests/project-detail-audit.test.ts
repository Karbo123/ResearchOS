import { testProjectSlug } from './test-project.js'
import crypto from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../src/index.js'
import { database, migrate } from '../src/database.js'

const projectId = testProjectSlug()
const slug = `detail-audit-${projectId.slice(0, 8)}`
const eventId = crypto.randomUUID()

async function requestJson(path: string, init: RequestInit = {}) {
  const response = await app.request(`http://research-os.test${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  })
  return { response, body: await response.json() as Record<string, unknown> }
}

describe('project detail audit timeline source', () => {
  beforeAll(async () => {
    await migrate()
    await database.query('INSERT INTO projects(id,slug,title) VALUES ($1,$2,$3)', [projectId, slug, 'Detail audit test'])
    await database.query('INSERT INTO audit_events(id,project_id,actor,action,details) VALUES ($1,$2,$3,$4,$5)', [
      eventId,
      projectId,
      'test-user',
      'literature.searched',
      { query: 'timeline test', resource_candidates: 3 },
    ])
  })

  afterAll(async () => {
    await database.query('DELETE FROM audit_events WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM projects WHERE id=$1', [projectId])
  })

  it('returns recent audit events in project detail', async () => {
    const detail = await requestJson(`/api/projects/${projectId}`)
    expect(detail.response.status).toBe(200)
    const events = (detail.body.audit_events || []) as Array<{ id: string; action: string }>
    expect(events.find(event => event.id === eventId)).toMatchObject({ action: 'literature.searched' })
  })

  it('accepts semantic slugs on the audit endpoint', async () => {
    const audit = await requestJson(`/api/projects/${slug}/audit`)
    expect(audit.response.status).toBe(200)
    const events = audit.body as Array<{ id: string }>
    expect(events.some(event => event.id === eventId)).toBe(true)
  })
})
