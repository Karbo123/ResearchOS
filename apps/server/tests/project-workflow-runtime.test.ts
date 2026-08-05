import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const repositoryRoot = resolve(import.meta.dirname, '../../..')
const templatePath = resolve(repositoryRoot, 'apps/mastra/src/mastra/workflows/templates/default-project-workflow.ts')
const template = readFileSync(templatePath, 'utf8')
const projectId = crypto.randomUUID()

let root: string
let projectsRoot: string
let runtimeRoot: string
let runtime: import('../../mastra/src/mastra/workflow-runtime/loader.js').ProjectWorkflowRuntime
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
        return new Response(JSON.stringify({ id: projectId, slug: 'mnist-cnn-example', title: 'Point cloud acceptance title' }), {
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
    mastra = {
      getLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
      getStorage: () => ({ getStore: async () => undefined }),
      generateId: () => crypto.randomUUID(),
      listWorkflows: () => ({}),
      getWorkflowById: () => { throw new Error('workflow not found') },
    }
    runtime = new ProjectWorkflowRuntime(mastra)
  })

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

  it('exposes only the latest workflow version to Mastra Studio', async () => {
    await runtime.scanProject(projectId)
    const listed = mastra.listWorkflows()
    const workflowKey = 'mnist-cnn-example'
    const before = listed[workflowKey] as { name: string; description: string; id: string }
    expect(before).toBeDefined()
    expect(before.name).toBe('mnist-cnn-example')
    expect(before.description).toBe('Point cloud acceptance title')
    expect(mastra.getWorkflowById(workflowKey)).toBe(before)

    const updatedSource = `// hot reloaded for studio\n${template}`
    writeFileSync(resolve(projectsRoot, projectId, 'workflow.ts'), updatedSource, 'utf8')
    await runtime.scanProject(projectId)

    const afterList = mastra.listWorkflows()
    const after = afterList[workflowKey] as { name: string; description: string; id: string }
    expect(after).toBeDefined()
    expect(after.name).toBe('mnist-cnn-example')
    expect(after).not.toBe(before)
    expect(Object.keys(afterList).filter(key => key.startsWith('mnist-cnn-example'))).toHaveLength(1)
    expect(mastra.getWorkflowById(workflowKey)).toBe(after)
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
