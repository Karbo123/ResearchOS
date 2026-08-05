import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { AnyWorkflow } from '@mastra/core/workflows'
import {
  projectWorkflowInputSchema,
  projectWorkflowManifestSchema,
  type ProjectWorkflowContext,
  type ProjectWorkflowInput,
} from '@research-os/workflow-kit'
import { researchRoot } from '../env.js'
import { auditWorkflow } from './audit.js'

const runtimeRoot = process.env.RESEARCH_RUNTIME_DIR
  ? resolve(researchRoot, process.env.RESEARCH_RUNTIME_DIR)
  : resolve(researchRoot, 'runtime')
const projectsRoot = process.env.RESEARCH_PROJECTS_DIR
  ? resolve(researchRoot, process.env.RESEARCH_PROJECTS_DIR)
  : resolve(researchRoot, 'projects')
const cacheRoot = resolve(runtimeRoot, 'workflow-cache')
const runsFile = resolve(runtimeRoot, 'workflow-runs.json')
const workflowKitRoot = resolve(researchRoot, 'packages/workflow-kit/src')

type WorkflowManifest = {
  schemaVersion: 1
  templateVersion: string
  entryStep: 'workflow-entry'
  exitStep: 'workflow-exit'
}

type LoadedVersion = {
  projectId: string
  version: number
  sourceHash: string
  compiledPath: string
  manifest: WorkflowManifest
  workflow: AnyWorkflow
  loadedAt: string
}

type ProjectState = {
  projectId: string
  active: LoadedVersion | null
  versions: Map<number, LoadedVersion>
  lastError: { at: string; message: string } | null
}

type MastraWorkflowRegistry = {
  listWorkflows(props?: { serialized?: boolean }): Record<string, AnyWorkflow>
  getWorkflowById(id: string): AnyWorkflow
}

type RunRecord = {
  mastra_run_id: string
  project_id: string
  workflow_version: number
  source_hash: string
  status: 'running' | 'suspended' | 'success' | 'failed'
  created_at: string
}

export type WorkflowGraphResponse = {
  project_id: string
  version: number
  source_hash: string
  status: 'active' | 'missing' | 'error'
  last_error: string | null
  graph: unknown[]
  step_ids: string[]
}

function collectStepIds(entries: unknown[]): string[] {
  const ids: string[] = []
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    const item = entry as { type?: string; step?: { id?: string }; steps?: unknown[] }
    if (item.type === 'step' && item.step?.id) ids.push(item.step.id)
    if (Array.isArray(item.steps)) ids.push(...collectStepIds(item.steps))
  }
  return ids
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function workflowKitHash(): string {
  if (!existsSync(workflowKitRoot)) return 'missing'
  const entries = readdirSync(workflowKitRoot, { recursive: true, withFileTypes: true })
  const sources = entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.ts'))
    .map(entry => `${resolve(entry.parentPath ?? workflowKitRoot, entry.name)}:${readFileSync(resolve(entry.parentPath ?? workflowKitRoot, entry.name), 'utf8')}`)
    .sort()
  return sha256(sources.join('\n'))
}

function readRuns(): RunRecord[] {
  if (!existsSync(runsFile)) return []
  try {
    const parsed = JSON.parse(readFileSync(runsFile, 'utf8')) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is RunRecord => typeof item === 'object' && item !== null && 'mastra_run_id' in item) : []
  } catch {
    return []
  }
}

function writeRuns(runs: RunRecord[]): void {
  mkdirSync(runtimeRoot, { recursive: true })
  const temporaryPath = `${runsFile}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify(runs, null, 2)}\n`, 'utf8')
  renameSync(temporaryPath, runsFile)
}

export class ProjectWorkflowRuntime {
  private mastra: unknown
  private states = new Map<string, ProjectState>()
  private runs = new Map<string, RunRecord>()
  private refToProjectId = new Map<string, string>()
  private exposedWorkflows = new Map<string, AnyWorkflow>()
  private exposedProjectKeys = new Map<string, string>()
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly pollIntervalMs: number
  private readonly apiBase: string
  private readonly kitHash: string

  constructor(mastra: unknown, options?: { pollIntervalMs?: number }) {
    this.mastra = mastra
    this.pollIntervalMs = options?.pollIntervalMs ?? Number(process.env.RESEARCH_WORKFLOW_POLL_INTERVAL_MS || 500)
    this.apiBase = (process.env.RESEARCH_API_INTERNAL_URL || 'http://127.0.0.1:8080').replace(/\/$/, '')
    this.kitHash = workflowKitHash()
    for (const run of readRuns()) this.runs.set(run.mastra_run_id, run)
    this.installStudioBridge()
  }

  private installStudioBridge(): void {
    const mastra = this.mastra as MastraWorkflowRegistry
    const originalListWorkflows = mastra.listWorkflows.bind(mastra)
    const originalGetWorkflowById = mastra.getWorkflowById.bind(mastra)
    // Mastra has no public removeWorkflow in 1.55.0, so the runtime keeps its own
    // active registry and only surfaces the latest version through Studio's lookup methods.
    mastra.listWorkflows = ((props?: { serialized?: boolean }) => {
      const workflows = originalListWorkflows(props)
      for (const [key, workflow] of this.exposedWorkflows) {
        workflows[key] = props?.serialized ? { name: workflow.name } as AnyWorkflow : workflow
      }
      return workflows
    }) as MastraWorkflowRegistry['listWorkflows']
    mastra.getWorkflowById = ((id: string) => {
      const byKey = this.exposedWorkflows.get(id)
      if (byKey) return byKey
      const byId = [...this.exposedWorkflows.values()].find(workflow => workflow.id === id)
      if (byId) return byId
      return originalGetWorkflowById(id)
    }) as MastraWorkflowRegistry['getWorkflowById']
  }

  private exposeWorkflow(projectId: string, workflow: AnyWorkflow): void {
    const previousKey = this.exposedProjectKeys.get(projectId)
    if (previousKey) this.exposedWorkflows.delete(previousKey)
    this.exposedWorkflows.set(workflow.id, workflow)
    this.exposedProjectKeys.set(projectId, workflow.id)
  }

  private unexposeProject(projectId: string): void {
    const key = this.exposedProjectKeys.get(projectId)
    if (key) this.exposedWorkflows.delete(key)
    this.exposedProjectKeys.delete(projectId)
  }

  async start(): Promise<void> {
    mkdirSync(cacheRoot, { recursive: true })
    await this.scanAll()
    this.timer = setInterval(() => {
      void this.scanAll().catch(error => auditWorkflow('*', 'workflow.poll_failed', { error: error instanceof Error ? error.message : String(error) }))
    }, this.pollIntervalMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async scanAll(): Promise<void> {
    const entries = existsSync(projectsRoot) ? readdirSync(projectsRoot, { withFileTypes: true }) : []
    const refs = entries.filter(entry => entry.isDirectory()).map(entry => entry.name)
    const projectIds: string[] = []
    for (const ref of refs) {
      try {
        const projectId = await this.resolveProjectId(ref)
        projectIds.push(projectId)
        await this.scanProjectRef(ref, projectId)
      } catch (error) {
        auditWorkflow(ref, 'workflow.ref_resolve_failed', { error: error instanceof Error ? error.message : String(error) })
      }
    }
    for (const projectId of this.states.keys()) {
      if (!projectIds.includes(projectId)) this.dispose(projectId)
    }
  }

  async scanProject(projectId: string): Promise<void> {
    await this.scanProjectRef(projectId, await this.resolveProjectId(projectId))
  }

  private async scanProjectRef(ref: string, projectId: string): Promise<void> {
    const sourcePath = resolve(projectsRoot, ref, 'workflow.ts')
    if (!existsSync(sourcePath)) {
      // Only the canonical UUID directory represents the project source. Legacy
      // semantic-name directories may resolve to the same project without a
      // workflow.ts and must not mark an otherwise active project as missing.
      if (ref.toLowerCase() === projectId.toLowerCase()) {
        const state = this.states.get(projectId)
        if (state?.active) this.setLastError(projectId, new Error('workflow_source_missing'))
      }
      return
    }
    const source = readFileSync(sourcePath, 'utf8')
    const hash = sha256(`${source}\n${this.kitHash}`)
    const state = this.states.get(projectId)
    if (state?.active?.sourceHash === hash) {
      if (state.lastError) state.lastError = null
      return
    }
    try {
      await this.reload(ref, projectId, source, hash)
    } catch (error) {
      this.setLastError(projectId, error)
    }
  }

  private async resolveProjectId(ref: string): Promise<string> {
    const cached = this.refToProjectId.get(ref)
    if (cached) return cached
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (uuidPattern.test(ref)) {
      this.refToProjectId.set(ref, ref.toLowerCase())
      return ref.toLowerCase()
    }
    const response = await fetch(`${this.apiBase}/api/projects/${encodeURIComponent(ref)}/id`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`project_ref_resolve_http_${response.status}`)
    const body = await response.json() as { id?: unknown }
    if (typeof body.id !== 'string') throw new Error('project_ref_resolve_invalid')
    this.refToProjectId.set(ref, body.id)
    return body.id
  }

  async reload(ref: string, projectId: string, source: string, sourceHash: string): Promise<LoadedVersion> {
    const loaded = await this.loadVersion(ref, projectId, source, sourceHash)
    let state = this.states.get(projectId)
    if (!state) {
      state = { projectId, active: null, versions: new Map(), lastError: null }
      this.states.set(projectId, state)
    }
    state.versions.set(loaded.version, loaded)
    state.active = loaded
    state.lastError = null
    this.exposeWorkflow(projectId, loaded.workflow)
    auditWorkflow(projectId, 'workflow.activated', {
      version: loaded.version,
      source_hash: loaded.sourceHash,
      template_version: loaded.manifest.templateVersion,
      compiled_path: loaded.compiledPath,
    })
    return loaded
  }

  private async loadVersion(ref: string, projectId: string, source: string, sourceHash: string): Promise<LoadedVersion> {
    const compiledPath = resolve(cacheRoot, projectId, `workflow-${sourceHash}.mjs`)
    if (!existsSync(compiledPath)) await this.compile(ref, source, compiledPath)
    const moduleUrl = `${pathToFileURL(compiledPath).href}?v=${sourceHash}`
    const module = await import(moduleUrl) as {
      default?: unknown
      workflowManifest?: unknown
    }
    if (typeof module.default !== 'function') throw new Error('workflow_module_must_export_factory')
    const factory = module.default as (ctx: ProjectWorkflowContext) => AnyWorkflow
    const manifest = projectWorkflowManifestSchema.parse(module.workflowManifest)
    this.assertSafeSource(source)
    const state = this.states.get(projectId)
    const existing = state ? [...state.versions.values()].find(version => version.sourceHash === sourceHash) : undefined
    const versionsForHash = [...this.runs.values()]
      .filter(run => run.project_id === projectId && run.source_hash === sourceHash)
      .map(run => run.workflow_version)
    const version = existing?.version ?? (versionsForHash.length ? Math.max(...versionsForHash) : 1 + Math.max(0, ...(state?.versions.keys() ?? [])))
    const context: ProjectWorkflowContext = {
      projectId,
      slug: projectId,
      workflowId: `project-${projectId}-research`,
      version,
      sourceHash,
      apiBase: process.env.RESEARCH_API_INTERNAL_URL || 'http://127.0.0.1:8080',
      dryRun: false,
    }
    const workflow = factory(context)
    if (!workflow || typeof workflow !== 'object') throw new Error('workflow_factory_must_return_workflow')
    if (workflow.id !== `project-${projectId}-research`) throw new Error('workflow_id_mismatch')
    if (!workflow.committed) throw new Error('workflow_must_be_committed')
    this.assertGraph(projectId, workflow, manifest)
    this.registerWorkflow(workflow)
    await this.dryRun(projectId, factory, context)
    return {
      projectId,
      version,
      sourceHash,
      compiledPath,
      manifest,
      workflow,
      loadedAt: new Date().toISOString(),
    }
  }

  private async compile(ref: string, source: string, outputPath: string): Promise<void> {
    mkdirSync(resolve(outputPath, '..'), { recursive: true })
    await build({
      stdin: {
        contents: source,
        loader: 'ts',
        resolveDir: resolve(projectsRoot, ref),
        sourcefile: 'workflow.ts',
      },
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: outputPath,
      absWorkingDir: researchRoot,
      external: ['@mastra/core', '@mastra/core/workflows', 'zod'],
      sourcemap: false,
    })
  }

  private assertSafeSource(source: string): void {
    const forbidden = [
      /(?:node:)?(?:fs|child_process|net|dns|vm|worker_threads|cluster)['"]/,
      /\brequire\s*\(/,
      /\bimport\s*\(/,
      /\beval\s*\(/,
      /\bnew\s+Function\s*\(/,
      /\bfetch\s*\(/,
      /\bWebSocket\s*\(/,
      /\bprocess\./,
      /\bglobalThis\./,
      /https?:\/\//,
      /\b(?:api_key|apiKey|token|secret|cookie|password)\b/i,
    ]
    for (const pattern of forbidden) {
      if (pattern.test(source)) throw new Error('workflow_source_forbidden_import')
    }
    const importPattern = /\b(?:import|export)\b[^;\n]*?\bfrom\s+['"]([^'"]+)['"]/g
    let match: RegExpExecArray | null
    while ((match = importPattern.exec(source))) {
      const specifier = match[1]
      if (!specifier) continue
      const allowed = specifier === '@research-os/workflow-kit' || specifier === 'zod' || specifier === '@mastra/core' || specifier.startsWith('@mastra/core/')
      if (!allowed) throw new Error(`workflow_source_forbidden_import_${specifier}`)
    }
  }

  private assertGraph(projectId: string, workflow: AnyWorkflow, manifest: WorkflowManifest): void {
    const graph = (workflow.serializedStepGraph || []) as Array<{ type: string; step?: { id: string } }>
    const stepIds = collectStepIds(graph)
    if (!stepIds.includes(manifest.entryStep)) throw new Error(`workflow_missing_entry_${manifest.entryStep}`)
    if (!stepIds.includes(manifest.exitStep)) throw new Error(`workflow_missing_exit_${manifest.exitStep}`)
    if (new Set(stepIds).size !== stepIds.length) throw new Error('workflow_duplicate_step_ids')
    if (workflow.id !== `project-${projectId}-research`) throw new Error('workflow_id_mismatch')
  }

  private registerWorkflow(workflow: AnyWorkflow): void {
    const mastra = this.mastra as { getLogger(): unknown; getStorage(): unknown }
    ;(workflow as unknown as { __registerMastra(mastra: unknown): void }).__registerMastra(this.mastra)
    ;(workflow as unknown as { __registerPrimitives(primitives: { logger: unknown; storage?: unknown }): void }).__registerPrimitives({
      logger: mastra.getLogger(),
      storage: mastra.getStorage(),
    })
  }

  private async dryRun(projectId: string, factory: (ctx: ProjectWorkflowContext) => AnyWorkflow, context: ProjectWorkflowContext): Promise<void> {
    const input = projectWorkflowInputSchema.parse({
      action: 'project_chat',
      project_id: projectId,
      message: 'dry run',
    })
    const dryWorkflow = factory({ ...context, dryRun: true })
    this.registerWorkflow(dryWorkflow)
    const run = await dryWorkflow.createRun({ resourceId: `project:${projectId}:dry` })
    const result = await run.start({ inputData: input as ProjectWorkflowInput })
    if (result.status !== 'success') throw new Error(`workflow_dry_run_${result.status}`)
  }

  async run(projectId: string, input: ProjectWorkflowInput): Promise<{ status: string; result: unknown; run_id: string; suspended: string[][] | null; suspend_payload: unknown }> {
    const state = this.requireState(projectId)
    if (state.lastError) throw new Error(`workflow_source_invalid: ${state.lastError.message}`)
    if (!state.active) throw new Error('workflow_not_loaded')
    const run = await state.active.workflow.createRun({ resourceId: `project:${projectId}` })
    const record: RunRecord = {
      mastra_run_id: run.runId,
      project_id: projectId,
      workflow_version: state.active.version,
      source_hash: state.active.sourceHash,
      status: 'running',
      created_at: new Date().toISOString(),
    }
    this.runs.set(record.mastra_run_id, record)
    this.persistRuns()
    const result = await run.start({ inputData: input })
    record.status = result.status === 'suspended' ? 'suspended' : result.status === 'success' ? 'success' : 'failed'
    this.persistRuns()
    const suspended = result.status === 'suspended' ? result.suspended : undefined
    const suspendPayload = suspended?.length
      ? (result.steps as Record<string, { suspendPayload?: unknown }>)[(suspended[0] as string[]).at(-1) ?? '']?.suspendPayload ?? null
      : null
    return {
      status: result.status,
      result: result.status === 'success' ? result.result : null,
      run_id: run.runId,
      suspended: suspended ?? null,
      suspend_payload: suspendPayload,
    }
  }

  async resume(projectId: string, runId: string, resumeData: unknown): Promise<{ status: string; result: unknown; run_id: string }> {
    const record = this.runs.get(runId)
    if (!record || record.project_id !== projectId) throw new Error('workflow_run_not_found')
    const state = this.requireState(projectId)
    const version = state.versions.get(record.workflow_version) ?? await this.loadCachedVersion(projectId, record.source_hash, record.workflow_version)
    const run = await version.workflow.createRun({ runId })
    const resumeWithRunId = { ...(resumeData as Record<string, unknown>), mastra_run_id: runId }
    const result = await run.resume({ step: 'human-approval', resumeData: resumeWithRunId })
    record.status = result.status === 'suspended' ? 'suspended' : result.status === 'success' ? 'success' : 'failed'
    this.persistRuns()
    return { status: result.status, result: result.status === 'success' ? result.result : null, run_id: runId }
  }

  graph(projectId: string): WorkflowGraphResponse {
    const state = this.requireState(projectId)
    const active = state.active
    if (!active) return {
      project_id: projectId,
      version: 0,
      source_hash: '',
      status: 'missing',
      last_error: state.lastError?.message ?? null,
      graph: [],
      step_ids: [],
    }
    const graph = (active.workflow.serializedStepGraph || []) as unknown[]
    return {
      project_id: projectId,
      version: active.version,
      source_hash: active.sourceHash,
      status: 'active',
      last_error: state.lastError?.message ?? null,
      graph,
      step_ids: collectStepIds(graph),
    }
  }

  listRuns(projectId: string): RunRecord[] {
    return [...this.runs.values()].filter(run => run.project_id === projectId)
  }

  async validatePreview(projectId: string, source: string): Promise<{ valid: boolean; errors: string[]; graph: unknown[]; step_ids: string[] }> {
    const ref = await this.findRefForProject(projectId)
    const hash = sha256(source)
    const compiledPath = resolve(cacheRoot, projectId, `preview-${hash}.mjs`)
    try {
      await this.compile(ref, source, compiledPath)
      const moduleUrl = `${pathToFileURL(compiledPath).href}?preview=${hash}`
      const module = await import(moduleUrl) as {
        default?: unknown
        workflowManifest?: unknown
      }
      if (typeof module.default !== 'function') throw new Error('workflow_module_must_export_factory')
      const factory = module.default as (ctx: ProjectWorkflowContext) => AnyWorkflow
      const manifest = projectWorkflowManifestSchema.parse(module.workflowManifest)
      this.assertSafeSource(source)
      const context: ProjectWorkflowContext = {
        projectId,
        slug: projectId,
        workflowId: `project-${projectId}-research`,
        version: 1,
        sourceHash: hash,
        apiBase: process.env.RESEARCH_API_INTERNAL_URL || 'http://127.0.0.1:8080',
        dryRun: true,
      }
      const workflow = factory(context)
      if (workflow.id !== `project-${projectId}-research`) throw new Error('workflow_id_mismatch')
      if (!workflow.committed) throw new Error('workflow_must_be_committed')
      this.assertGraph(projectId, workflow, manifest)
      this.registerWorkflow(workflow)
      await this.dryRun(projectId, factory, context)
      const graph = (workflow.serializedStepGraph || []) as unknown[]
      return { valid: true, errors: [], graph, step_ids: collectStepIds(graph) }
    } catch (error) {
      try { rmSync(compiledPath, { force: true }) } catch { /* Preserve the original structured failure. */ }
      return { valid: false, errors: [error instanceof Error ? error.message : String(error)], graph: [], step_ids: [] }
    }
  }

  dispose(projectId: string): void {
    this.unexposeProject(projectId)
    const state = this.states.get(projectId)
    if (!state) return
    this.states.delete(projectId)
    for (const [runId, record] of this.runs) {
      if (record.project_id === projectId) this.runs.delete(runId)
    }
    this.persistRuns()
    rmSync(resolve(cacheRoot, projectId), { recursive: true, force: true })
    auditWorkflow(projectId, 'workflow.disposed', {})
  }

  private requireState(projectId: string): ProjectState {
    const state = this.states.get(projectId)
    if (!state) throw new Error('workflow_project_not_loaded')
    return state
  }

  private async loadCachedVersion(projectId: string, sourceHash: string, version: number): Promise<LoadedVersion> {
    const compiledPath = resolve(cacheRoot, projectId, `workflow-${sourceHash}.mjs`)
    if (!existsSync(compiledPath)) throw new Error('workflow_cached_version_unavailable')
    const moduleUrl = `${pathToFileURL(compiledPath).href}?v=${sourceHash}-${version}`
    const module = await import(moduleUrl) as {
      default?: unknown
      workflowManifest?: unknown
    }
    if (typeof module.default !== 'function') throw new Error('workflow_cached_module_invalid')
    const factory = module.default as (ctx: ProjectWorkflowContext) => AnyWorkflow
    const manifest = projectWorkflowManifestSchema.parse(module.workflowManifest)
    const context: ProjectWorkflowContext = {
      projectId,
      slug: projectId,
      workflowId: `project-${projectId}-research`,
      version,
      sourceHash,
      apiBase: process.env.RESEARCH_API_INTERNAL_URL || 'http://127.0.0.1:8080',
      dryRun: false,
    }
    const workflow = factory(context)
    this.assertGraph(projectId, workflow, manifest)
    this.registerWorkflow(workflow)
    const loaded: LoadedVersion = {
      projectId,
      version,
      sourceHash,
      compiledPath,
      manifest,
      workflow,
      loadedAt: new Date().toISOString(),
    }
    const state = this.requireState(projectId)
    state.versions.set(version, loaded)
    return loaded
  }

  private setLastError(projectId: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    let state = this.states.get(projectId)
    if (!state) {
      state = { projectId, active: null, versions: new Map(), lastError: null }
      this.states.set(projectId, state)
    }
    if (state) state.lastError = { at: new Date().toISOString(), message }
    auditWorkflow(projectId, 'workflow.load_failed', { error: message })
  }

  private async findRefForProject(projectId: string): Promise<string> {
    for (const [ref, id] of this.refToProjectId) if (id === projectId) return ref
    if (!existsSync(projectsRoot)) throw new Error('workflow_project_root_missing')
    const entries = readdirSync(projectsRoot, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        if (await this.resolveProjectId(entry.name) === projectId) return entry.name
      } catch { /* Try the next project directory. */ }
    }
    throw new Error('workflow_ref_not_found')
  }

  private persistRuns(): void {
    writeRuns([...this.runs.values()])
  }
}
