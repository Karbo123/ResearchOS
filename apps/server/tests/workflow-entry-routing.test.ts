import crypto from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { app } from '../src/index.js'
import { database, migrate } from '../src/database.js'

const projectId = crypto.randomUUID()
const workflowCalls: Array<{ url: string; body?: Record<string, unknown> }> = []

async function requestJson(path: string, init: RequestInit = {}) {
  const response = await app.request(`http://research-os.test${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  })
  return { response, body: await response.json() as Record<string, unknown> }
}

describe('project workflow API entry routing', () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch')

  beforeAll(async () => {
    await migrate()
    await database.query('INSERT INTO projects(id,slug,title,status) VALUES ($1,$2,$3,$4)', [projectId, `wf-entry-${projectId.slice(0, 8)}`, 'Workflow entry test', 'active'])
    await database.query('INSERT INTO idea_versions(id,project_id,version,spec) VALUES ($1,$2,1,$3)', [crypto.randomUUID(), projectId, { schema_version: '1.0', idea: { title: 'Workflow entry test' } }])
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      let body: Record<string, unknown> | undefined
      if (typeof init?.body === 'string') {
        try { body = JSON.parse(init.body) as Record<string, unknown> } catch { body = undefined }
      }
      workflowCalls.push({ url, body })
      if (url.includes('/internal/workflows/project/') && url.endsWith('/run')) {
        return new Response(JSON.stringify({
          status: 'success',
          result: { routed: true, action: body?.action },
          run_id: 'run-1',
          suspended: null,
          suspend_payload: null,
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ message: { items: [] } }), { status: 200 })
    })
  })

  afterAll(async () => {
    fetchMock.mockRestore()
    await database.query('DELETE FROM idea_versions WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM projects WHERE id=$1', [projectId])
  })

  it('routes project chat through the project workflow', async () => {
    const messageKey = 'message'
    const chatMessage = 'please explain this project'
    const { response, body } = await requestJson('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ project_id: projectId, [messageKey]: chatMessage }),
    })
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ routed: true, action: 'project_chat' })
    expect(workflowCalls.at(-1)?.url).toContain(`/internal/workflows/project/${projectId}/run`)
    expect(workflowCalls.at(-1)?.body).toMatchObject({ action: 'project_chat', project_id: projectId })
  })

  it('routes paper translation and revision through the project workflow', async () => {
    const translate = await requestJson(`/api/projects/${projectId}/paper-translate`, {
      method: 'POST',
      body: JSON.stringify({ section_id: 'introduction' }),
    })
    expect(translate.response.status).toBe(200)
    expect(translate.body).toMatchObject({ routed: true, action: 'paper_translate' })
    expect(workflowCalls.at(-1)?.body).toMatchObject({ action: 'paper_translate', section_id: 'introduction' })

    const revise = await requestJson(`/api/projects/${projectId}/paper-revise`, {
      method: 'POST',
      body: JSON.stringify({ section_id: 'conclusion' }),
    })
    expect(revise.response.status).toBe(201)
    expect(revise.body).toMatchObject({ routed: true, action: 'paper_revise' })
    expect(workflowCalls.at(-1)?.body).toMatchObject({ action: 'paper_revise', section_id: 'conclusion' })
  })

  it('routes experiment planning through the project workflow', async () => {
    const { response, body } = await requestJson(`/api/projects/${projectId}/experiment-plan`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(response.status).toBe(201)
    expect(body).toMatchObject({ routed: true, action: 'experiment_plan' })
    expect(workflowCalls.at(-1)?.url).toContain(`/internal/workflows/project/${projectId}/run`)
    expect(workflowCalls.at(-1)?.body).toMatchObject({ action: 'experiment_plan', project_id: projectId, idea_version: 1 })
  })
})
