import { createHash } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { app } from '../src/index.js'
import { database, migrate, rows } from '../src/database.js'
import { fingerprintReproductionSource } from '../src/reproduction-service.js'
import { pathInside, projectsRoot } from '../src/paths.js'

const projectId = crypto.randomUUID()
const otherProjectId = crypto.randomUUID()
const paperId = crypto.randomUUID()
const repositoryId = crypto.randomUUID()
const reproductionId = crypto.randomUUID()
const commit = 'a'.repeat(40)

async function requestJson(path: string, init: RequestInit = {}) {
  const response = await app.request(`http://research-os.test${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  })
  return { response, body: await response.json() as Record<string, unknown> }
}

describe('project-scoped reproduction approval chain', () => {
  beforeAll(async () => {
    await migrate()
    await database.query('INSERT INTO projects(id,slug,title) VALUES ($1,$2,$3),($4,$5,$6)', [
      projectId, `reproduction-${projectId.slice(0, 8)}`, 'Reproduction test',
      otherProjectId, `reproduction-other-${otherProjectId.slice(0, 8)}`, 'Other reproduction test',
    ])
    mkdirSync(pathInside(projectsRoot, otherProjectId), { recursive: true })
    await database.query('INSERT INTO papers(id,project_id,title,source_url,doi) VALUES ($1,$2,$3,$4,$5)', [paperId, projectId, 'Reproduction test paper', 'https://doi.org/10.1000/reproduction', '10.1000/reproduction'])
    await database.query('INSERT INTO repositories(id,project_id,paper_id,source_url,license_spdx,commit_or_tag,verified_official,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [
      repositoryId, projectId, paperId, 'https://github.com/example/reproduction', 'MIT', commit, true,
      { verification: { license_status: 'known_spdx', commit, readiness: { entrypoint_status: 'declared', dependency_status: 'declared', data_requirements_status: 'declared', system_requirements_status: 'declared', writable_directory_status: 'project_contained' } } },
    ])
    const root = pathInside(projectsRoot, projectId, 'experiment', 'reproductions', reproductionId)
    const source = pathInside(root, 'source')
    mkdirSync(pathInside(source, 'scripts'), { recursive: true })
    mkdirSync(pathInside(root, '.venv', 'bin'), { recursive: true })
    writeFileSync(pathInside(source, 'requirements.txt'), 'numpy==1.26.4\n')
    writeFileSync(pathInside(source, 'scripts', 'evaluate.py'), 'print("test")\n')
    writeFileSync(pathInside(root, '.venv', 'bin', 'python'), '# test-only placeholder\n')
    const sourceTreeSha256 = await fingerprintReproductionSource(source)
    const dependencySha256 = createHash('sha256').update('numpy==1.26.4\n').digest('hex')
    await database.query('INSERT INTO reproductions(id,project_id,repository_id,status,source_commit,repository_relative_path,dependency_manifest,dependency_sha256,venv_relative_path,plan,dependency_report) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [
      reproductionId, projectId, repositoryId, 'source_downloaded', commit, `experiment/reproductions/${reproductionId}/source`, 'requirements.txt', dependencySha256, `experiment/reproductions/${reproductionId}/.venv`, { source_tree_sha256: sourceTreeSha256, timeout_seconds: 3600 }, { installed_at: new Date().toISOString() },
    ])
  })

  afterAll(async () => {
    await database.query('DELETE FROM artifact_dependencies WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM lineage_dependencies WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM tasks WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM reproduction_runs WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM artifacts WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM reproductions WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM proposals WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM repositories WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM papers WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM audit_events WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM projects WHERE id IN ($1,$2)', [projectId, otherProjectId])
    rmSync(pathInside(projectsRoot, projectId), { recursive: true, force: true })
    rmSync(pathInside(projectsRoot, otherProjectId), { recursive: true, force: true })
  })

  it('keeps download, dependency, and run approvals separate', async () => {
    const download = await requestJson(`/api/projects/${projectId}/repositories/${repositoryId}/download`, { method: 'POST' })
    expect(download.response.status).toBe(201)
    const downloadProposal = await rows<{ kind: string; status: string }>('SELECT kind,status FROM proposals WHERE id=$1', [String(download.body.proposal_id)])
    expect(downloadProposal[0]).toEqual({ kind: 'repository_download', status: 'pending' })

    const dependency = await requestJson(`/api/projects/${projectId}/reproductions/${reproductionId}/dependency-plan`, {
      method: 'POST', body: JSON.stringify({ dependency_manifest: 'requirements.txt', reason: 'pin the approved environment' }),
    })
    expect(dependency.response.status).toBe(201)
    expect((await rows<{ kind: string }>('SELECT kind FROM proposals WHERE id=$1', [String(dependency.body.proposal_id)]))[0]?.kind).toBe('repository_dependency_install')
    await database.query("UPDATE reproductions SET status='ready' WHERE id=$1", [reproductionId])

    const forbidden = await requestJson(`/api/projects/${projectId}/reproductions/${reproductionId}/run-plan`, {
      method: 'POST', body: JSON.stringify({ entrypoint: 'scripts/evaluate.py', random_seeds: [13], config: { command: 'rm -rf' }, reason: 'must reject arbitrary execution' }),
    })
    expect(forbidden.response.status).toBe(422)
    expect(forbidden.body.code).toBe('validation_error')

    const runPlan = await requestJson(`/api/projects/${projectId}/reproductions/${reproductionId}/run-plan`, {
      method: 'POST', body: JSON.stringify({ entrypoint: 'scripts/evaluate.py', random_seeds: [13, 37], config: { epochs: 3 }, reason: 'run the pinned evaluator' }),
    })
    expect(runPlan.response.status).toBe(201)
    const runProposalId = String(runPlan.body.proposal_id)
    expect((await rows<{ kind: string }>('SELECT kind FROM proposals WHERE id=$1', [runProposalId]))[0]?.kind).toBe('repository_reproduction_run')

    const crossProject = await requestJson(`/api/projects/${otherProjectId}/reproductions/${reproductionId}/run-plan`, {
      method: 'POST', body: JSON.stringify({ entrypoint: 'scripts/evaluate.py', random_seeds: [13], config: {}, reason: 'cross project must fail' }),
    })
    expect(crossProject.response.status).toBe(404)
    expect(crossProject.body.code).toBe('reproduction_not_found')

    const approved = await requestJson(`/api/proposals/${runProposalId}/decision`, {
      method: 'POST', body: JSON.stringify({ decision: 'approved', actor: 'test-user' }),
    })
    expect(approved.response.status).toBe(200)
    expect(approved.body.reproduction_run).toMatchObject({ status: 'queued' })
    const runId = String((approved.body.reproduction_run as Record<string, unknown>).run_id)
    expect((await rows<{ kind: string; max_attempts: number }>('SELECT kind,max_attempts FROM tasks WHERE payload->>\'reproduction_run_id\'=$1', [runId]))[0]).toEqual({ kind: 'repository_reproduction_run', max_attempts: 1 })
  })

  it('exposes only the pinned reproduction source as a scoped workspace', async () => {
    const invalidScope = await requestJson(`/api/projects/${projectId}/workspace?scope=unknown`)
    expect(invalidScope.response.status).toBe(422)
    expect(invalidScope.body.code).toBe('workspace_scope_invalid')

    const missingReproduction = await requestJson(`/api/projects/${projectId}/workspace?scope=reproduction`)
    expect(missingReproduction.response.status).toBe(422)
    expect(missingReproduction.body.code).toBe('reproduction_id_required')

    const methodWorkspace = await requestJson(`/api/projects/${projectId}/workspace?scope=method`)
    expect(methodWorkspace.response.status).toBe(200)
    expect(methodWorkspace.body.code_relative_path).toBe(`projects/${projectId}/code`)

    const reproductionWorkspace = await requestJson(`/api/projects/${projectId}/workspace?scope=reproduction&reproductionId=${reproductionId}`)
    expect(reproductionWorkspace.response.status).toBe(200)
    expect(reproductionWorkspace.body).toMatchObject({
      code_relative_path: `experiment/reproductions/${reproductionId}/source`,
      source_commit: commit,
      code_directory_exists: true,
    })
    const paths = (reproductionWorkspace.body.files as Array<{ path: string }>).map(file => file.path)
    expect(paths).toContain('requirements.txt')
    expect(paths).toContain('scripts/evaluate.py')

    const crossProject = await requestJson(`/api/projects/${otherProjectId}/workspace?scope=reproduction&reproductionId=${reproductionId}`)
    expect(crossProject.response.status).toBe(404)
    expect(crossProject.body.code).toBe('reproduction_not_found')
  })
})
