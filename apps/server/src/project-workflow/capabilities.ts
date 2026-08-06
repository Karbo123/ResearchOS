import { createOperationalReport, searchLiterature } from '../research-services.js'
import { createExperimentPlan } from '../experiment-plan-service.js'
import { projectChatTurn } from '../chat-service.js'
import { createWorkflowEditProposal } from '../workflow-edit-service.js'
import { paperServiceCapability } from '../paper-capability-bridge.js'
import { database, one } from '../database.js'
import { extractMaterialChunks, type MaterialFile } from '../material-indexer.js'
import { ingestProjectMemory, supermemoryEnabled } from '../supermemory-service.js'
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

async function indexUploadedMaterial(projectId: string, uploadedFileId: string, taskId: string): Promise<{ indexed: number; parse_status: string }> {
  if (!supermemoryEnabled()) throw new Error('supermemory_not_configured')
  const file = await one<Record<string, unknown>>('SELECT * FROM uploaded_files WHERE id=$1 AND project_id=$2', [uploadedFileId, projectId])
  if (!file) throw new Error('uploaded_file_not_found')
  const extracted = await extractMaterialChunks(file as MaterialFile)
  let indexed = 0
  if (extracted.raw_upload) {
    await ingestProjectMemory(projectId, {
      source_type: 'artifact', source_id: null, artifact_id: null, uploaded_file_id: uploadedFileId,
      content: null, source_url: null, quote: null, locator: null,
      metadata: { task_id: taskId, parse_status: extracted.parse_status, evidence_status: 'untrusted_uploaded_material' },
      task_type: 'memory', idempotency_key: `material-index:${uploadedFileId}:raw`,
    })
    indexed += 1
  }
  for (const chunk of extracted.chunks) {
    await ingestProjectMemory(projectId, {
      source_type: 'artifact', source_id: null, artifact_id: null, uploaded_file_id: uploadedFileId,
      content: chunk.content, source_url: null, quote: chunk.content, locator: chunk.locator,
      metadata: { task_id: taskId, chunk_index: chunk.index, parse_status: extracted.parse_status, content_sha256: chunk.content_sha256, evidence_status: 'untrusted_uploaded_material' },
      task_type: 'superrag', idempotency_key: `material-index:${uploadedFileId}:chunk:${chunk.content_sha256}`,
    })
    indexed += 1
  }
  await database.query('UPDATE uploaded_files SET metadata=$2 WHERE id=$1 AND project_id=$3', [uploadedFileId, { ...((file.metadata || {}) as Record<string, unknown>), semantic_index_status: 'active', semantic_index_task_id: taskId, semantic_indexed_items: indexed, parse_status: extracted.parse_status }, projectId])
  return { indexed, parse_status: extracted.parse_status }
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
    case 'literature.review':
      return { status: 'review_candidate', evidence_status: 'requires_user_confirmation' }
    case 'experiment.plan':
      return await createExperimentPlan(projectId)
    case 'experiment.run':
      throw new Error('experiment_run_capability_requires_approved_proposal')
    case 'paper.translate':
    case 'paper.revise':
      return await paperServiceCapability(capability, projectId, payload)
    case 'paper.compile':
      return { status: 'compile_gate_pending' }
    case 'report.generate': {
      const period = payload.period === 'weekly' ? 'weekly' : payload.period === 'manual' ? 'manual' : 'daily'
      return await createOperationalReport(projectId, period)
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
