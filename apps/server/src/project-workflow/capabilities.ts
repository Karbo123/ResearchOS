import { createOperationalReport, searchLiterature } from '../research-services.js'
import { createExperimentPlan } from '../experiment-plan-service.js'
import { createCompileProposal } from '../paper-service.js'
import { startRelatedWorkRun } from '../related-work/service.js'
import { projectChatTurn } from '../chat-service.js'
import { createWorkflowEditProposal } from '../workflow-edit-service.js'
import { paperServiceCapability } from '../paper-capability-bridge.js'
import { database, one } from '../database.js'
import { indexUploadedMaterial } from '../indexing-service.js'
import { ingestProjectMemory } from '../supermemory-service.js'
import type { WorkflowCapability } from './contracts.js'

export type WorkflowTaskInput = {
  workflow: {
    project_id: string
    node_id: string
    node_run_id: string
    definition_version: number
    trigger_event_id: string
    correlation_id: string
  }
  input: Record<string, unknown>
}

export async function executeWorkflowCapability(capability: WorkflowCapability, projectId: string, taskId: string, input: WorkflowTaskInput): Promise<unknown> {
  const payload = input.input || {}
  switch (capability) {
    case 'context.project_snapshot': {
      const { projectDetail } = await import('../project-service.js')
      return { project: await projectDetail(projectId) }
    }
    case 'context.finalize':
      return { ok: true }
    case 'conversation.agent_turn': {
      const { chatRequest } = await import('../contracts.js')
      const body = chatRequest.parse({
        request_id: payload.request_id,
        project_id: projectId,
        session_id: payload.session_id ?? null,
        message: payload.message,
        attachments: payload.attachments ?? [],
        clarification_mode: payload.clarification_mode ?? 'automatic',
        workspace_area: payload.workspace_area,
        workspace_tab: payload.workspace_tab,
        workspace_label: payload.workspace_label,
      })
      return await projectChatTurn(body)
    }
    case 'material.extract': {
      const uploadedFileId = typeof payload.uploaded_file_id === 'string' ? payload.uploaded_file_id : ''
      if (!uploadedFileId) throw new Error('uploaded_file_id_missing')
      return await indexUploadedMaterial(projectId, uploadedFileId, taskId)
    }
    case 'literature.search': {
      const query = typeof payload.query === 'string' ? payload.query : ''
      const limit = typeof payload.limit === 'number' ? Math.min(30, Math.max(1, payload.limit)) : 8
      if (!query) throw new Error('literature_query_missing')
      return await searchLiterature(projectId, query, limit)
    }
    case 'literature.recursive': {
      const proposalId = typeof payload.proposal_id === 'string' ? payload.proposal_id : ''
      const actor = typeof payload.actor === 'string' ? payload.actor : 'local-user'
      if (!proposalId) throw new Error('related_work_proposal_id_missing')
      return await startRelatedWorkRun(projectId, proposalId, actor)
    }
    case 'literature.review':
      return { status: 'review_candidate', evidence_status: 'requires_user_confirmation' }
    case 'experiment.plan':
      return await createExperimentPlan(projectId)
    case 'experiment.run': {
      const runId = typeof payload.run_id === 'string' ? payload.run_id : ''
      if (!runId) throw new Error('experiment_run_id_missing')
      const run = await one<{ status: string; error: string | null }>(
        'SELECT status,error FROM experiments WHERE id=$1 AND project_id=$2',
        [runId, projectId],
      )
      if (!run) throw new Error('experiment_run_not_found')
      if (run.status === 'failed') throw new Error(`experiment_run_failed_${run.error || 'unknown'}`)
      return { run_id: runId, status: run.status }
    }
    case 'experiment.artifacts': {
      const runId = typeof payload.run_id === 'string' ? payload.run_id : ''
      if (!runId) throw new Error('experiment_run_id_missing')
      const artifacts = await database.query<{ id: string; kind: string; name: string; sha256: string }>(
        'SELECT id,kind,name,sha256 FROM artifacts WHERE project_id=$1 AND experiment_id=$2 AND valid=TRUE ORDER BY created_at',
        [projectId, runId],
      )
      if (!artifacts.rows.length) throw new Error('experiment_valid_artifacts_missing')
      return {
        run_id: runId,
        artifact_count: artifacts.rows.length,
        artifacts: artifacts.rows.map(row => ({ id: row.id, kind: row.kind, name: row.name, sha256: row.sha256 })),
        evidence_status: 'integration_result_requires_review',
      }
    }
    case 'paper.translate':
    case 'paper.revise': {
      if (capability === 'paper.revise' && payload.section_id === 'paper_experiments') {
        const artifacts = await database.query<{ id: string }>(
          'SELECT id FROM artifacts WHERE project_id=$1 AND valid=TRUE LIMIT 1',
          [projectId],
        )
        if (!artifacts.rows.length) throw new Error('paper_experiments_valid_artifacts_required')
      }
      return await paperServiceCapability(capability, projectId, payload)
    }
    case 'paper.compile':
      return await createCompileProposal(projectId)
    case 'memory.write': {
      const content = typeof payload.content === 'string' ? payload.content : ''
      if (!content) throw new Error('memory_content_missing')
      const sourceType = typeof payload.source_type === 'string'
        ? payload.source_type as 'project_chat_message' | 'idea_message' | 'report' | 'experiment_summary' | 'experiment_plan' | 'related_work' | 'artifact' | 'manual'
        : 'project_chat_message'
      const sourceId = typeof payload.source_id === 'string' ? payload.source_id : null
      const metadata = payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
        ? payload.metadata as Record<string, unknown>
        : {}
      const idempotencyKey = typeof payload.idempotency_key === 'string' ? payload.idempotency_key : `memory-write:${crypto.randomUUID()}`
      await ingestProjectMemory(projectId, {
        source_type: sourceType,
        source_id: sourceId,
        artifact_id: null,
        uploaded_file_id: null,
        content,
        source_url: null,
        quote: null,
        locator: null,
        metadata: { ...metadata, evidence_status: 'semantic_candidate' },
        task_type: 'memory',
        idempotency_key: idempotencyKey,
      })
      return { status: 'memory_written' }
    }
    case 'report.generate': {
      const period = payload.period === 'weekly' ? 'weekly' : payload.period === 'manual' ? 'manual' : 'daily'
      return await createOperationalReport(projectId, period, taskId)
    }
    case 'governance.approval':
      return { status: 'waiting_approval' }
    case 'workflow.edit': {
      const instruction = typeof payload.instruction === 'string' ? payload.instruction : ''
      if (!instruction) throw new Error('workflow_edit_instruction_missing')
      const projectContext = typeof payload.project_context === 'object' && payload.project_context !== null && !Array.isArray(payload.project_context)
        ? payload.project_context as Record<string, unknown>
        : {}
      return await createWorkflowEditProposal(projectId, instruction, projectContext)
    }
    case 'noop':
      {
        const sleepMs = typeof payload.sleep_ms === 'number' ? Math.max(0, Math.min(5_000, payload.sleep_ms)) : 0
        if (sleepMs > 0) await new Promise(resolve => setTimeout(resolve, sleepMs))
        return { ok: true }
      }
    default:
      throw new Error(`workflow_capability_not_implemented_${capability}`)
  }
}
