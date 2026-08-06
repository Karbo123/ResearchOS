import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../src/index.js'
import { database, migrate } from '../src/database.js'
import { testProjectSlug } from './test-project.js'

const projectId = testProjectSlug('chat-scope')
const overviewSessionId = crypto.randomUUID()
const literatureSessionId = crypto.randomUUID()

describe('workspace-scoped project chat', () => {
  beforeAll(async () => {
    await migrate()
    await database.query('INSERT INTO projects(id,slug,title) VALUES ($1,$2,$3)', [projectId, projectId, 'Workspace chat scope test'])
    await database.query('INSERT INTO conversation_sessions(id,project_id,phase,draft,scope) VALUES ($1,$2,$3,$4,$5)', [
      overviewSessionId, projectId, 'supervising', {}, 'overview/overview',
    ])
    await database.query('INSERT INTO conversation_sessions(id,project_id,phase,draft,scope) VALUES ($1,$2,$3,$4,$5)', [
      literatureSessionId, projectId, 'supervising', {}, 'related_work/literature',
    ])
    await database.query('INSERT INTO messages(id,session_id,role,content,metadata) VALUES ($1,$2,$3,$4,$5)', [
      crypto.randomUUID(), overviewSessionId, 'user', 'overview scoped question', { workspace_scope: 'overview/overview' },
    ])
    await database.query('INSERT INTO messages(id,session_id,role,content,metadata) VALUES ($1,$2,$3,$4,$5)', [
      crypto.randomUUID(), literatureSessionId, 'user', 'literature scoped question', { workspace_scope: 'related_work/literature' },
    ])
  })

  afterAll(async () => {
    await database.query('DELETE FROM messages WHERE session_id=ANY($1::uuid[])', [[overviewSessionId, literatureSessionId]])
    await database.query('DELETE FROM conversation_sessions WHERE id=ANY($1::uuid[])', [[overviewSessionId, literatureSessionId]])
    await database.query('DELETE FROM projects WHERE id=$1', [projectId])
  })

  it('returns only the messages bound to the requested tab scope', async () => {
    const overview = await app.request(`/api/projects/${projectId}/chat-session?area=overview&tab=overview`)
    expect(overview.status).toBe(200)
    const overviewBody = await overview.json() as { session_id: string | null; messages: Array<{ role: string; text: string }> }
    expect(overviewBody.session_id).toBe(overviewSessionId)
    expect(overviewBody.messages).toEqual([expect.objectContaining({ role: 'user', text: 'overview scoped question' })])

    const literature = await app.request(`/api/projects/${projectId}/chat-session?area=related_work&tab=literature`)
    expect(literature.status).toBe(200)
    const literatureBody = await literature.json() as { session_id: string | null; messages: Array<{ role: string; text: string }> }
    expect(literatureBody.session_id).toBe(literatureSessionId)
    expect(literatureBody.messages).toEqual([expect.objectContaining({ role: 'user', text: 'literature scoped question' })])

    const method = await app.request(`/api/projects/${projectId}/chat-session?area=implementation&tab=method`)
    expect(method.status).toBe(200)
    await expect(method.json()).resolves.toEqual({ session_id: null, messages: [] })
  })

  it('rejects an invalid workspace tab scope', async () => {
    const response = await app.request(`/api/projects/${projectId}/chat-session?area=overview&tab=unknown`)
    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({ code: 'workspace_scope_invalid' })
  })
})
