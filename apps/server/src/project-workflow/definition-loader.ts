import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { audit, database, one, rows } from '../database.js'
import { gitBinary, pathInside, projectsRoot, repositoryRoot, runtimeRoot } from '../paths.js'
import { projectWorkflowDefinitionV2Schema, type ProjectWorkflowDefinitionV2 } from './contracts.js'

const cacheRoot = resolve(runtimeRoot, 'workflow-v2-cache')
const PROJECT_SLUG_PATTERN = /^[a-z]{2,32}-[a-z]{2,32}-[a-z0-9]{4}$/

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function gitCommit(projectId: string): string | null {
  const root = pathInside(projectsRoot, projectId)
  if (!existsSync(resolve(root, '.git'))) return null
  try {
    return execFileSync(gitBinary(), ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() || null
  } catch {
    return null
  }
}

export function assertSafeWorkflowSource(source: string): void {
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
    const allowed = specifier === '@research-os/workflow-kit' || specifier === 'zod'
    if (!allowed) throw new Error(`workflow_source_forbidden_import_${specifier}`)
  }
}

export function validateDefinition(definition: ProjectWorkflowDefinitionV2): string[] {
  const errors: string[] = []
  const nodeIds = new Set(definition.nodes.map(node => node.id))
  const adjacency = new Map<string, string[]>()
  for (const node of definition.nodes) adjacency.set(node.id, [])
  for (const edge of definition.edges) adjacency.get(edge.from)?.push(edge.to)
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (nodeId: string): boolean => {
    if (visited.has(nodeId)) return false
    if (visiting.has(nodeId)) return true
    visiting.add(nodeId)
    for (const next of adjacency.get(nodeId) || []) {
      if (visit(next)) return true
    }
    visiting.delete(nodeId)
    visited.add(nodeId)
    return false
  }
  for (const node of definition.nodes) {
    if (visit(node.id)) {
      errors.push(`workflow_graph_cycle_at_${node.id}`)
      break
    }
  }
  const requiredBy = new Set(definition.nodes.flatMap(node => node.requires))
  for (const requirement of requiredBy) {
    if (!nodeIds.has(requirement)) errors.push(`workflow_required_node_missing_${requirement}`)
  }
  for (const trigger of definition.triggers) {
    if (!nodeIds.has(trigger.node_id)) errors.push(`workflow_trigger_node_missing_${trigger.event_type}`)
  }
  return errors
}

export type LoadedDefinition = {
  project_id: string
  version: number
  source_sha256: string
  git_commit: string | null
  compiled_ref: string | null
  definition: ProjectWorkflowDefinitionV2
}

export class WorkflowDefinitionLoader {
  private readonly pollIntervalMs: number
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(options?: { pollIntervalMs?: number }) {
    this.pollIntervalMs = options?.pollIntervalMs ?? Number(process.env.RESEARCH_WORKFLOW_POLL_INTERVAL_MS || 2_000)
  }

  start(): void {
    mkdirSync(cacheRoot, { recursive: true })
    void this.scanAll().catch(error => this.recordScanError('*', error))
    this.timer = setInterval(() => {
      void this.scanAll().catch(error => this.recordScanError('*', error))
    }, this.pollIntervalMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private recordScanError(projectId: string, error: unknown): void {
    void audit('workflow_v2.scan_failed', projectId === '*' ? null : projectId, {
      error: error instanceof Error ? error.message : String(error),
    }).catch(inner => console.error('workflow scan audit failed', inner))
  }

  async scanAll(): Promise<void> {
    const projectRows = await rows<{ id: string }>('SELECT id FROM projects ORDER BY id')
    for (const project of projectRows) {
      try {
        await this.scanProject(project.id)
      } catch (error) {
        await this.recordDefinitionError(project.id, error)
      }
    }
  }

  async scanProject(projectId: string): Promise<void> {
    if (!PROJECT_SLUG_PATTERN.test(projectId)) throw new Error('workflow_project_slug_invalid')
    const sourcePath = pathInside(projectsRoot, projectId, 'workflow.ts')
    if (!existsSync(sourcePath)) throw new Error('workflow_source_missing')
    const source = readFileSync(sourcePath, 'utf8')
    const sourceHash = sha256(source)
    const active = await one<{ version: number; source_sha256: string; status: string }>(
      'SELECT version,source_sha256,status FROM workflow_definitions WHERE project_id=$1 AND status=$2 ORDER BY version DESC LIMIT 1',
      [projectId, 'active'],
    )
    if (active?.source_sha256 === sourceHash) return
    const loaded = await this.loadVersion(projectId, source, sourceHash)
    await this.activate(projectId, loaded)
  }

  async initializeProject(projectId: string): Promise<LoadedDefinition | null> {
    const runtime = await one<{ active_definition_version: number }>(
      'SELECT active_definition_version FROM project_workflow_runtime WHERE project_id=$1',
      [projectId],
    )
    if (runtime) return this.loadActiveDefinition(projectId, runtime.active_definition_version)
    const sourcePath = pathInside(projectsRoot, projectId, 'workflow.ts')
    if (!existsSync(sourcePath)) return null
    const source = readFileSync(sourcePath, 'utf8')
    const loaded = await this.loadVersion(projectId, source, sha256(source))
    await this.activate(projectId, loaded)
    return loaded
  }

  async loadActiveDefinition(projectId: string, version: number): Promise<LoadedDefinition | null> {
    const row = await one<{
      project_id: string
      version: number
      source_sha256: string
      git_commit: string | null
      compiled_ref: string | null
      graph_json: unknown
    }>('SELECT project_id,version,source_sha256,git_commit,compiled_ref,graph_json FROM workflow_definitions WHERE project_id=$1 AND version=$2', [projectId, version])
    if (!row) return null
    return {
      project_id: row.project_id,
      version: row.version,
      source_sha256: row.source_sha256,
      git_commit: row.git_commit,
      compiled_ref: row.compiled_ref,
      definition: projectWorkflowDefinitionV2Schema.parse(row.graph_json),
    }
  }

  async validateSource(projectId: string, source: string): Promise<{ valid: boolean; errors: string[]; definition: ProjectWorkflowDefinitionV2 | null; source_hash: string }> {
    try {
      assertSafeWorkflowSource(source)
      const loaded = await this.loadVersion(projectId, source, sha256(source))
      return { valid: true, errors: [], definition: loaded.definition, source_hash: loaded.source_sha256 }
    } catch (error) {
      return { valid: false, errors: [error instanceof Error ? error.message : String(error)], definition: null, source_hash: sha256(source) }
    }
  }

  private async loadVersion(projectId: string, source: string, sourceHash: string): Promise<LoadedDefinition> {
    assertSafeWorkflowSource(source)
    const compiledPath = resolve(cacheRoot, projectId, `workflow-${sourceHash}.mjs`)
    if (!existsSync(compiledPath)) {
      mkdirSync(resolve(compiledPath, '..'), { recursive: true })
      await build({
        stdin: {
          contents: source,
          loader: 'ts',
          resolveDir: pathInside(projectsRoot, projectId),
          sourcefile: 'workflow.ts',
        },
        bundle: true,
        platform: 'node',
        format: 'esm',
        outfile: compiledPath,
        absWorkingDir: repositoryRoot,
        external: ['zod', '@research-os/workflow-kit'],
        sourcemap: false,
      })
    }
    const moduleUrl = `${pathToFileURL(compiledPath).href}?v=${sourceHash}`
    const module = await import(moduleUrl) as {
      default?: unknown
      workflowManifest?: unknown
    }
    const candidate = module.default ?? module.workflowManifest
    const definition = projectWorkflowDefinitionV2Schema.parse(candidate)
    const validationErrors = validateDefinition(definition)
    if (validationErrors.length) throw new Error(validationErrors.join(';'))
    const versionRow = await one<{ next: number }>('SELECT COALESCE(MAX(version),0)+1 AS next FROM workflow_definitions WHERE project_id=$1', [projectId])
    const version = versionRow?.next || 1
    return {
      project_id: projectId,
      version,
      source_sha256: sourceHash,
      git_commit: gitCommit(projectId),
      compiled_ref: compiledPath,
      definition,
    }
  }

  private async activate(projectId: string, loaded: LoadedDefinition): Promise<void> {
    await database.transaction(async transaction => {
      const existing = (await transaction.query<{ version: number }>('SELECT version FROM workflow_definitions WHERE project_id=$1 AND version=$2', [projectId, loaded.version])).rows[0]
      if (!existing) {
        await transaction.query(
          `INSERT INTO workflow_definitions(project_id,version,source_sha256,git_commit,status,graph_json,compiled_ref)
           VALUES ($1,$2,$3,$4,'active',$5,$6)`,
          [projectId, loaded.version, loaded.source_sha256, loaded.git_commit, loaded.definition, loaded.compiled_ref],
        )
      }
      await transaction.query(
        `UPDATE workflow_definitions SET status='deactivated',deactivated_at=NOW()
         WHERE project_id=$1 AND status='active' AND version<>$2`,
        [projectId, loaded.version],
      )
      await transaction.query(
        `INSERT INTO project_workflow_runtime(project_id,active_definition_version,status)
         VALUES ($1,$2,'waiting')
         ON CONFLICT (project_id) DO UPDATE SET
           active_definition_version=EXCLUDED.active_definition_version,
           status=CASE WHEN project_workflow_runtime.status='failed' THEN 'waiting' ELSE project_workflow_runtime.status END,
           last_error=NULL,
           updated_at=NOW()`,
        [projectId, loaded.version],
      )
      await transaction.query(
        `INSERT INTO workflow_events(id,project_id,sequence,event_type,payload,source,definition_version,correlation_id,idempotency_key)
         SELECT $2::uuid, $1::varchar(120), COALESCE(MAX(sequence),0)+1, 'workflow.definition.activated', $4::jsonb, 'definition-loader', $3::int, 'definition:' || $2::text, 'definition-activated:' || $3::text || ':' || $2::text
         FROM workflow_events WHERE project_id=$1::varchar(120)
         ON CONFLICT (project_id,idempotency_key) DO NOTHING`,
        [projectId, crypto.randomUUID(), loaded.version, JSON.stringify({ source_sha256: loaded.source_sha256, git_commit: loaded.git_commit })],
      )
    })
    await audit('workflow_v2.definition_activated', projectId, {
      version: loaded.version,
      source_sha256: loaded.source_sha256,
      git_commit: loaded.git_commit,
      template_version: loaded.definition.templateVersion,
    })
  }

  private async recordDefinitionError(projectId: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error)
    await database.query(
      `INSERT INTO project_workflow_runtime(project_id,status,last_error,updated_at)
       VALUES ($1,'blocked',$2,NOW())
       ON CONFLICT (project_id) DO UPDATE SET status='blocked',last_error=EXCLUDED.last_error,updated_at=NOW()`,
      [projectId, message],
    )
    await audit('workflow_v2.definition_invalid', projectId, { error: message })
  }
}

export async function removeWorkflowDefinitionCache(projectId: string): Promise<void> {
  rmSync(resolve(cacheRoot, projectId), { recursive: true, force: true })
}
