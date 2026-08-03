import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../src/index.js'
import { database, migrate, rows } from '../src/database.js'

const projectId = crypto.randomUUID()
const sessionId = crypto.randomUUID()

async function requestJson(path: string, init: RequestInit = {}) {
  const response = await app.request(`http://research-os.test${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  })
  return { response, body: await response.json() as Record<string, unknown> }
}

describe('operational report API', () => {
  beforeAll(async () => {
    await migrate()
    await database.query('INSERT INTO projects(id,slug,title) VALUES ($1,$2,$3)', [projectId, `report-api-${projectId.slice(0, 8)}`, 'Report API Test'])
  })

  afterAll(async () => {
    await database.query('DELETE FROM reports WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM messages WHERE session_id=$1', [sessionId])
    await database.query('DELETE FROM conversation_sessions WHERE id=$1', [sessionId])
    await database.query('DELETE FROM audit_events WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM projects WHERE id=$1', [projectId])
  })

  it('returns a structured empty-window failure instead of writing a template report', async () => {
    const result = await requestJson('/api/reports', {
      method: 'POST',
      body: JSON.stringify({ project_id: projectId, period: 'daily' }),
    })
    expect(result.response.status).toBe(409)
    expect(result.body.code).toBe('report_no_events')
    expect(await rows<{ id: string }>('SELECT id FROM reports WHERE project_id=$1', [projectId])).toEqual([])
  })

  it('includes real events and source identifiers in the generated report', async () => {
    await database.query('INSERT INTO conversation_sessions(id,project_id,phase) VALUES ($1,$2,$3)', [sessionId, projectId, 'clarifying'])
    const messageId = crypto.randomUUID()
    await database.query('INSERT INTO messages(id,session_id,role,content) VALUES ($1,$2,$3,$4)', [messageId, sessionId, 'user', '明确比较两个方法在当前 topic 上的实验差异。'])
    const auditId = crypto.randomUUID()
    await database.query('INSERT INTO audit_events(id,project_id,actor,action,details) VALUES ($1,$2,$3,$4,$5)', [auditId, projectId, 'test-user', 'test.report_event', { source: 'test' }])

    const result = await requestJson('/api/reports', {
      method: 'POST',
      body: JSON.stringify({ project_id: projectId, period: 'daily' }),
    })
    expect(result.response.status).toBe(200)
    expect(String(result.body.content)).toContain('明确比较两个方法在当前 topic 上的实验差异。')
    expect(String(result.body.content)).toContain('test.report_event')

    const stored = await rows<{ source_snapshot: Record<string, unknown> }>('SELECT source_snapshot FROM reports WHERE id=$1', [result.body.id])
    expect(stored[0]?.source_snapshot).toMatchObject({ project_id: projectId, event_count: 2, audit_event_ids: [auditId], message_ids: [messageId] })
  })
})
