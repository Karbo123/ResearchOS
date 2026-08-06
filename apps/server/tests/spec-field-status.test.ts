import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { app } from '../src/index.js'
import { database, migrate } from '../src/database.js'
import { specFieldStatus, unconfirmedCoreFields } from '../src/spec-field-status.js'
import { testProjectSlug } from './test-project.js'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathInside, projectsRoot, repositoryRoot } from '../src/paths.js'
import { initializeProjectWorkflow } from '../src/project-workflow/runtime-service.js'
import { startTaskWorker } from '../src/task-worker.js'

const confirmedProjectId = testProjectSlug('spec-confirmed')
const blockedProjectId = testProjectSlug('spec-blocked')

async function requestJson(path: string, init: RequestInit = {}) {
  const response = await app.request(`http://research-os.test${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  })
  return { response, body: await response.json() as Record<string, unknown> }
}

describe('specification field status and downstream gating', () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch')
  let worker: ReturnType<typeof startTaskWorker>

  beforeAll(async () => {
    await migrate()
    await database.query('INSERT INTO projects(id,slug,title) VALUES ($1,$2,$3),($4,$5,$6)', [
      confirmedProjectId, confirmedProjectId, 'Confirmed Spec Project',
      blockedProjectId, blockedProjectId, 'Blocked Spec Project',
    ])
    mkdirSync(pathInside(projectsRoot, confirmedProjectId), { recursive: true })
    writeFileSync(
      pathInside(projectsRoot, confirmedProjectId, 'workflow.ts'),
      readFileSync(resolve(repositoryRoot, 'apps/mastra/src/mastra/workflows/templates/default-project-workflow.ts'), 'utf8'),
      'utf8',
    )
    await initializeProjectWorkflow(confirmedProjectId)
    worker = startTaskWorker()
    const fullSpec = {
      schema_version: '1.0',
      idea: {
        title: 'Confirmed Spec Project',
        research_question: 'Does confirmed specification gating work?',
        domain: 'Research engineering',
        available_data: 'Public synthetic data',
        ethics_and_compliance: 'No human subjects',
        hypotheses: ['Gating blocks incomplete specs'],
      },
      feasibility: 'medium',
    }
    await database.query('INSERT INTO idea_versions(id,project_id,version,spec) VALUES ($1,$2,1,$3),($4,$5,1,$6)', [
      crypto.randomUUID(), confirmedProjectId, fullSpec,
      crypto.randomUUID(), blockedProjectId, { schema_version: '1.0', idea: { title: 'Blocked Spec Project' } },
    ])
    fetchMock.mockImplementation(async input => {
      const url = String(input)
      if (url.includes('/works?')) {
        return new Response(JSON.stringify({ message: { items: [] } }), { status: 200 })
      }
      return new Response(JSON.stringify({ message: { items: [] } }), { status: 200 })
    })
  })

  afterAll(async () => {
    worker?.stop()
    fetchMock.mockRestore()
    await database.query('DELETE FROM audit_events WHERE project_id IN ($1,$2)', [confirmedProjectId, blockedProjectId])
    await database.query('DELETE FROM workflow_events WHERE project_id=$1', [confirmedProjectId])
    await database.query('DELETE FROM workflow_node_runs WHERE project_id=$1', [confirmedProjectId])
    await database.query('DELETE FROM tasks WHERE project_id=$1', [confirmedProjectId])
    await database.query('DELETE FROM workflow_definitions WHERE project_id=$1', [confirmedProjectId])
    await database.query('DELETE FROM project_workflow_runtime WHERE project_id=$1', [confirmedProjectId])
    await database.query('DELETE FROM idea_versions WHERE project_id IN ($1,$2)', [confirmedProjectId, blockedProjectId])
    await database.query('DELETE FROM projects WHERE id IN ($1,$2)', [confirmedProjectId, blockedProjectId])
    rmSync(pathInside(projectsRoot, confirmedProjectId), { recursive: true, force: true })
  })

  it('marks user-provided initial spec fields as user-confirmed', async () => {
    const detail = await requestJson(`/api/projects/${confirmedProjectId}`)
    expect(detail.response.status).toBe(200)
    const status = (detail.body.spec_field_status || {}) as Record<string, { status: string; source: string; version: number }>
    expect(status.research_question).toMatchObject({ status: 'user_confirmed', source: 'project_spec', version: 1 })
    expect(status.ethics_and_compliance).toMatchObject({ status: 'user_confirmed' })
    expect(status.risks).toMatchObject({ status: 'unresolved' })
  })

  it('blocks search while core specification fields are unconfirmed', async () => {
    const blocked = await requestJson('/api/search', {
      method: 'POST',
      body: JSON.stringify({ project_id: blockedProjectId, limit: 3 }),
    })
    expect(blocked.response.status).toBe(409)
    expect(blocked.body.code).toBe('spec_field_unconfirmed')
    expect((blocked.body.details as { blocked_fields?: string[] }).blocked_fields).toContain('research_question')
  })

  it('allows search once core specification fields are confirmed', async () => {
    const allowed = await requestJson('/api/search', {
      method: 'POST',
      body: JSON.stringify({ project_id: confirmedProjectId, limit: 3 }),
    })
    expect(allowed.response.status).toBe(200)
    expect(allowed.body.resource_candidates).toEqual([])
  })

  it('derives user-confirmed status from approved idea revisions', async () => {
    const status = specFieldStatus(
      { idea: { title: 'A', research_question: 'Revised question?' } },
      [
        { version: 1, spec: { idea: { title: 'A' } }, change_reason: null },
        { version: 2, spec: { idea: { title: 'A', research_question: 'Revised question?' } }, change_reason: 'Approved revision of research_question' },
      ],
    )
    expect(status.research_question).toMatchObject({ status: 'user_confirmed', source: 'user_revision', version: 2, changed_from_version: 1 })
    expect(unconfirmedCoreFields(status)).not.toContain('research_question')
  })
})
