import { testProjectSlug } from './test-project.js'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from '../src/index.js'
import { database, migrate } from '../src/database.js'
import { projectsRoot } from '../src/paths.js'
import { pathInside } from '../src/paths.js'
import { WorkflowDefinitionLoader } from '../src/project-workflow/definition-loader.js'

const repositoryRoot = resolve(import.meta.dirname, '../../..')
const templatePath = resolve(repositoryRoot, 'apps/mastra/src/mastra/workflows/templates/default-project-workflow.ts')
const template = readFileSync(templatePath, 'utf8')
const projectId = testProjectSlug()

async function requestJson(path: string, init: RequestInit = {}) {
  const response = await app.request(`http://research-os.test${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  })
  return { response, body: await response.json() as Record<string, unknown> }
}

describe('workflow v2 API entry', () => {
  beforeAll(async () => {
    await migrate()
    await database.query('INSERT INTO projects(id,slug,title,status) VALUES ($1,$2,$3,$4)', [projectId, projectId, 'Workflow v2 API test', 'active'])
    mkdirSync(pathInside(projectsRoot, projectId), { recursive: true })
    writeFileSync(pathInside(projectsRoot, projectId, 'workflow.ts'), template, 'utf8')
    await new WorkflowDefinitionLoader().initializeProject(projectId)
  }, 30_000)

  afterAll(async () => {
    await database.query('DELETE FROM workflow_events WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM workflow_node_runs WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM tasks WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM workflow_definitions WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM project_workflow_runtime WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM audit_events WHERE project_id=$1', [projectId])
    await database.query('DELETE FROM projects WHERE id=$1', [projectId])
    rmSync(pathInside(projectsRoot, projectId), { recursive: true, force: true })
  })

  it('exposes runtime, definition, graph, node runs, tasks and events', async () => {
    const runtime = await requestJson(`/api/projects/${projectId}/workflow/runtime`)
    expect(runtime.response.status).toBe(200)
    expect(runtime.body.status).toBe('waiting')

    const graph = await requestJson(`/api/projects/${projectId}/workflow/graph`)
    expect(graph.response.status).toBe(200)
    expect((graph.body.groups as Array<{ id: string }>).map(group => group.id)).toContain('project_context')
    expect((graph.body.nodes as Array<{ id: string }>).map(node => node.id)).toContain('conversation.agent_turn')

    const definition = await requestJson(`/api/projects/${projectId}/workflow/definition`)
    expect(definition.response.status).toBe(200)
    expect(definition.body.definition_version).toBe(1)

    const nodeRuns = await requestJson(`/api/projects/${projectId}/workflow/node-runs`)
    expect(nodeRuns.response.status).toBe(200)
    const tasks = await requestJson(`/api/projects/${projectId}/workflow/tasks`)
    expect(tasks.response.status).toBe(200)
    const events = await requestJson(`/api/projects/${projectId}/workflow/events`)
    expect(events.response.status).toBe(200)
  })

  it('appends project-scoped events with idempotency', async () => {
    const first = await requestJson(`/api/projects/${projectId}/workflow/events`, {
      method: 'POST',
      body: JSON.stringify({
        event_type: 'test.start',
        payload: { source: 'test' },
        source: 'test',
        correlation_id: 'entry-1',
        idempotency_key: 'entry-1',
      }),
    })
    expect(first.response.status).toBe(201)
    const second = await requestJson(`/api/projects/${projectId}/workflow/events`, {
      method: 'POST',
      body: JSON.stringify({
        event_type: 'test.start',
        payload: { source: 'test' },
        source: 'test',
        correlation_id: 'entry-1',
        idempotency_key: 'entry-1',
      }),
    })
    expect(second.body.id).toBe(first.body.id)
  })
})
