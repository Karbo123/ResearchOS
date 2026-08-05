import { testProjectSlug } from './test-project.js'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { LibSQLStore } from '@mastra/libsql'

const repositoryRoot = resolve(import.meta.dirname, '../../..')
const templatePath = resolve(repositoryRoot, 'apps/mastra/src/mastra/workflows/templates/default-project-workflow.ts')
const template = readFileSync(templatePath, 'utf8')
const projectId = testProjectSlug()

let root: string
let projectsRoot: string
let runtimeRoot: string
let runtime: import('../../mastra/src/mastra/workflow-runtime/loader.js').ProjectWorkflowRuntime
let storage: LibSQLStore
let mastra: {
  getLogger(): unknown
  getStorage(): unknown
  listWorkflows(props?: { serialized?: boolean }): Record<string, unknown>
  getWorkflowById(id: string): unknown
}

async function loadRuntime() {
  vi.resetModules()
  const loader = await import('../../mastra/src/mastra/workflow-runtime/loader.js')
  return loader.ProjectWorkflowRuntime
}

describe('project workflow runtime', () => {
  beforeAll(async () => {
    root = mkdtempSync(resolve(repositoryRoot, 'runtime', 'workflow-runtime-test-'))
    projectsRoot = resolve(root, 'projects')
    runtimeRoot = resolve(root, 'runtime')
    mkdirSync(resolve(projectsRoot, projectId), { recursive: true })
    writeFileSync(resolve(projectsRoot, projectId, 'workflow.ts'), template, 'utf8')
    process.env.RESEARCH_ROOT = repositoryRoot
    process.env.RESEARCH_PROJECTS_DIR = projectsRoot
    process.env.RESEARCH_RUNTIME_DIR = runtimeRoot
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/meta')) {
        return new Response(JSON.stringify({ id: projectId, slug: projectId, title: 'Point cloud acceptance title' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ id: projectId }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }))
    const ProjectWorkflowRuntime = await loadRuntime()
    storage = new LibSQLStore({ id: 'runtime-test', url: ':memory:' })
    await storage.init()
    mastra = {
      getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, trackException: () => {} }),
      getStorage: () => storage,
      getServer: () => ({}),
      generateId: () => crypto.randomUUID(),
      listWorkflows: () => ({}),
      getWorkflowById: () => { throw new Error('workflow not found') },
    }
    runtime = new ProjectWorkflowRuntime(mastra)
  }, 60_000)

  afterAll(() => {
    runtime?.dispose(projectId)
    vi.unstubAllGlobals()
    rmSync(root, { recursive: true, force: true })
    delete process.env.RESEARCH_ROOT
    delete process.env.RESEARCH_PROJECTS_DIR
    delete process.env.RESEARCH_RUNTIME_DIR
  })

  it('compiles and activates the project workflow with a stable graph', async () => {
    await runtime.scanProject(projectId)
    const graph = runtime.graph(projectId)
    expect(graph.project_id).toBe(projectId)
    expect(graph.status).toBe('active')
    expect(graph.step_ids).toEqual(expect.arrayContaining(['workflow-entry', 'workflow-exit']))
    expect(graph.source_hash).toBeTruthy()
  })

  it('keeps the Studio-facing workflow input schema free of discriminated unions', () => {
    expect(template).toContain('inputSchema: projectWorkflowStudioInputSchema')
    expect(template).not.toContain('inputSchema: projectWorkflowInputSchema')
  })

  it('exposes only the latest workflow version to Mastra Studio', async () => {
    await runtime.scanProject(projectId)
    const listed = mastra.listWorkflows()
    const workflowKey = projectId
    const before = listed[workflowKey] as { name: string; description: string; id: string }
    expect(before).toBeDefined()
    expect(before.name).toBe(projectId)
    expect(before.description).toBe('Point cloud acceptance title')
    expect(mastra.getWorkflowById(workflowKey)).toBe(before)

    const updatedSource = `// hot reloaded for studio\n${template}`
    writeFileSync(resolve(projectsRoot, projectId, 'workflow.ts'), updatedSource, 'utf8')
    await runtime.scanProject(projectId)

    const afterList = mastra.listWorkflows()
    const after = afterList[workflowKey] as { name: string; description: string; id: string }
    expect(after).toBeDefined()
    expect(after.name).toBe(projectId)
    expect(after).not.toBe(before)
    expect(Object.keys(afterList).filter(key => key.startsWith(projectId))).toHaveLength(1)
    expect(mastra.getWorkflowById(workflowKey)).toBe(after)
  })

  it('suspends and resumes the nested approval phase through the project workflow', async () => {
    await runtime.scanProject(projectId)
    const proposalId = crypto.randomUUID()
    const argsFingerprint = 'a'.repeat(64)
    const started = await runtime.run(projectId, {
      action: 'approval_gate',
      project_id: projectId,
      proposal_id: proposalId,
      tool_name: 'runtime.test_approval',
      args_fingerprint: argsFingerprint,
      policy_version: 'runtime-test-v1',
      actor: 'runtime-test',
      reason: 'Verify nested approval phase suspend and resume.',
    })
    expect(started.status).toBe('suspended')
    expect(started.suspended?.[0]).toEqual(expect.arrayContaining(['research-lifecycle', 'approval-phase', 'human-approval']))
    expect(started.suspend_payload).toMatchObject({
      project_id: projectId,
      proposal_id: proposalId,
      tool_name: 'runtime.test_approval',
      args_fingerprint: argsFingerprint,
      policy_version: 'runtime-test-v1',
    })

    const resumed = await runtime.resume(projectId, started.run_id, {
      approved: false,
      actor: 'runtime-test',
      comment: 'Rejected by runtime test.',
    })
    expect(resumed.status).toBe('success')
    const decision = (resumed.result as { result: { decision: string } }).result
    expect(decision.decision).toBe('rejected')
    expect(decision.proposal_id).toBe(proposalId)
  })

  it('hot reloads a changed workflow.ts without replacing the old graph on invalid source', async () => {
    const workflowPath = resolve(projectsRoot, projectId, 'workflow.ts')
    const before = runtime.graph(projectId)
    const updatedSource = `// updated template\n${template}`
    writeFileSync(workflowPath, updatedSource, 'utf8')
    await runtime.scanProject(projectId)
    const after = runtime.graph(projectId)
    expect(after.source_hash).not.toBe(before.source_hash)

    writeFileSync(workflowPath, "import { readFileSync } from 'node:fs'\n" + updatedSource, 'utf8')
    await runtime.scanProject(projectId)
    const invalid = runtime.graph(projectId)
    expect(invalid.source_hash).toBe(after.source_hash)
    expect(invalid.last_error).toContain('workflow_source_forbidden_import')

    await expect(runtime.run(projectId, {
      action: 'project_chat',
      project_id: projectId,
      message: 'must not run against the previous version',
    })).rejects.toThrow('workflow_source_invalid')
  })

  it('clears the error and activates a repaired workflow', async () => {
    const updatedSource = `// updated template\n${template}`
    writeFileSync(resolve(projectsRoot, projectId, 'workflow.ts'), updatedSource, 'utf8')
    await runtime.scanProject(projectId)
    const repaired = runtime.graph(projectId)
    expect(repaired.status).toBe('active')
    expect(repaired.last_error).toBeNull()

    writeFileSync(resolve(projectsRoot, projectId, 'workflow.ts'), template, 'utf8')
    await runtime.scanProject(projectId)
    const graph = runtime.graph(projectId)
    expect(graph.status).toBe('active')
    expect(graph.last_error).toBeNull()
  })

  it('cleans the registry and compile cache on delete', async () => {
    const cachePath = resolve(runtimeRoot, 'workflow-cache', projectId)
    expect(existsSync(cachePath)).toBe(true)
    runtime.dispose(projectId)
    expect(existsSync(cachePath)).toBe(false)
    expect(() => runtime.graph(projectId)).toThrow('workflow_project_not_loaded')
  })
})
