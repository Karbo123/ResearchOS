import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ApiError } from './http.js'
import { audit, database } from './database.js'
import { mastraJson } from './mastra-client.js'
import { gitCommit } from './patch-service.js'
import { pathInside, projectsRoot, runtimeRoot } from './paths.js'
import { requireProject } from './project-service.js'
import { WorkflowDefinitionLoader } from './project-workflow/definition-loader.js'

type WorkflowEditProposalResult = {
  proposal_id: string
  status: 'pending'
  diff: string
  summary: string
  affected_step_ids: string[]
  validation: { valid: boolean; errors: string[]; step_ids: string[] }
  new_source_hash: string
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

export function readWorkflowSource(projectId: string): string {
  const sourcePath = pathInside(projectsRoot, projectId, 'workflow.ts')
  if (!existsSync(sourcePath)) throw new ApiError(404, 'project_workflow_missing', '项目还没有 workflow.ts。')
  return readFileSync(sourcePath, 'utf8')
}

function assertDiffOnlyWorkflow(diff: string): void {
  for (const line of diff.split(/\r?\n/)) {
    const match = /^(?:---|\+\+\+) (?:a\/|b\/)?(.+)$/.exec(line)
    if (!match) continue
    const rawPath = match[1]
    if (rawPath === undefined) continue
    const firstPart = rawPath.split('\t')[0]
    if (firstPart === undefined) continue
    const diffPath = firstPart.trim()
    if (diffPath !== '/dev/null' && diffPath !== 'workflow.ts') {
      throw new ApiError(422, 'workflow_diff_path_invalid', `Workflow diff 只能修改 workflow.ts，收到 ${diffPath}。`)
    }
  }
}

export function applyWorkflowDiff(projectId: string, diff: string): string {
  const current = readWorkflowSource(projectId)
  assertDiffOnlyWorkflow(diff)
  const temporaryRoot = mkdtempSync(resolve(runtimeRoot, 'workflow-edit-'))
  try {
    writeFileSync(resolve(temporaryRoot, 'workflow.ts'), current, 'utf8')
    const diffPath = resolve(temporaryRoot, 'change.patch')
    writeFileSync(diffPath, diff, 'utf8')
    execFileSync('git', ['apply', '--check', '--whitespace=error-all', diffPath], { cwd: temporaryRoot, stdio: 'pipe' })
    execFileSync('git', ['apply', '--whitespace=nowarn', diffPath], { cwd: temporaryRoot, stdio: 'pipe' })
    return readFileSync(resolve(temporaryRoot, 'workflow.ts'), 'utf8')
  } catch (error) {
    throw new ApiError(422, 'workflow_diff_apply_failed', error instanceof Error ? error.message : 'Workflow diff 无法干净应用。')
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

export async function validateWorkflowSource(projectId: string, source: string): Promise<{ valid: boolean; errors: string[]; step_ids: string[] }> {
  const result = await new WorkflowDefinitionLoader().validateSource(projectId, source)
  if (!result.valid) {
    throw new ApiError(422, 'workflow_validation_failed', `工作流校验失败：${result.errors.join('；') || '未知错误'}`)
  }
  return { valid: true, errors: [], step_ids: result.definition?.nodes.map(node => node.id) || [] }
}

export async function createWorkflowEditProposal(projectId: string, instruction: string, projectContext: Record<string, unknown>): Promise<WorkflowEditProposalResult> {
  await requireProject(projectId, true)
  const current = readWorkflowSource(projectId)
  const modelResult = await mastraJson<{
    result: { summary: string; diff: string; affected_step_ids: string[]; planned_validation: string[] }
  }>('/internal/agents/workflow-edit', {
    project_id: projectId,
    instruction,
    current_source: current,
    project_context: projectContext,
    tier: 'complex',
  })
  const proposed = modelResult.result
  const next = applyWorkflowDiff(projectId, proposed.diff)
  if (next === current) throw new ApiError(422, 'workflow_diff_no_change', '生成的 diff 没有产生任何变更。')
  const validation = await validateWorkflowSource(projectId, next)
  const proposalId = crypto.randomUUID()
  const baseGitCommit = gitCommit(projectId)
  await database.query('INSERT INTO proposals(id,project_id,kind,reason,summary,diff,impact,payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [
    proposalId,
    projectId,
    'code_patch',
    `Workflow change requested: ${instruction.slice(0, 300)}`,
    proposed.summary,
    proposed.diff,
    { source: 'project_workflow_edit', affected_step_ids: proposed.affected_step_ids },
    {
      patch_kind: 'workflow',
      base_git_commit: baseGitCommit,
      instruction,
      operations: [{ action: 'replace', path: 'workflow.ts', content: next, expected_sha256: sha256(current) }],
      affected_step_ids: proposed.affected_step_ids,
      validation,
    },
  ])
  await audit('workflow.edit_proposal_created', projectId, {
    proposal_id: proposalId,
    instruction,
    diff_hash: sha256(proposed.diff),
    validation,
  })
  return {
    proposal_id: proposalId,
    status: 'pending',
    diff: proposed.diff,
    summary: proposed.summary,
    affected_step_ids: proposed.affected_step_ids,
    validation,
    new_source_hash: sha256(next),
  }
}

export async function assertWorkflowPatchValid(projectId: string, payload: Record<string, unknown>): Promise<void> {
  const operations = Array.isArray(payload.operations) ? payload.operations : []
  const operation = operations.find(item => typeof item === 'object' && item !== null && (item as { path?: unknown }).path === 'workflow.ts') as { content?: unknown } | undefined
  if (!operation || typeof operation.content !== 'string') throw new ApiError(422, 'workflow_patch_invalid', 'Workflow Proposal 缺少 workflow.ts 替换内容。')
  await validateWorkflowSource(projectId, operation.content)
}
