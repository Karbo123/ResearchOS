import { createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import { callResearchApi } from './api.js'
import {
  projectWorkflowInputSchema,
  projectWorkflowOutputSchema,
  projectWorkflowResumeSchema,
  type ProjectWorkflowAction,
  type ProjectWorkflowContext,
  type ProjectWorkflowInput,
  type ProjectWorkflowOutput,
} from './contracts.js'

const branchResultSchema = projectWorkflowOutputSchema

function auditFor(ctx: ProjectWorkflowContext): ProjectWorkflowOutput['audit'] {
  return {
    workflow_version: ctx.version,
    source_hash: ctx.sourceHash,
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
  }
}

export function createProjectContextStep(ctx: ProjectWorkflowContext) {
  return createStep({
    id: 'workflow-entry',
    inputSchema: projectWorkflowInputSchema,
    outputSchema: projectWorkflowInputSchema,
    execute: async ({ inputData }) => inputData,
  })
}

type ProjectActionStepOptions = {
  ctx: ProjectWorkflowContext
  id: string
  action: ProjectWorkflowAction
  run: (input: ProjectWorkflowInput, resumeData?: unknown) => Promise<unknown>
  suspendSchema?: z.ZodType
  resumeSchema?: z.ZodType
}

export function createProjectActionStep(options: ProjectActionStepOptions) {
  const suspend = options.suspendSchema ? { suspendSchema: options.suspendSchema, resumeSchema: options.resumeSchema } : {}
  return createStep({
    id: options.id,
    inputSchema: projectWorkflowInputSchema,
    outputSchema: branchResultSchema,
    ...suspend,
    execute: async ({ inputData, resumeData, suspend: suspendRun }) => {
      if (!resumeData) {
        if (options.suspendSchema && suspendRun) {
          const payload = inputData as Record<string, unknown>
          return suspendRun({
            reason: String(payload.reason || 'awaiting user decision'),
            project_id: payload.project_id,
            proposal_id: payload.proposal_id,
            tool_name: payload.tool_name,
            args_fingerprint: payload.args_fingerprint,
            policy_version: payload.policy_version,
          })
        }
        return {
          status: 'success' as const,
          project_id: inputData.project_id,
          action: options.action,
          result: await options.run(inputData),
          audit: auditFor(options.ctx),
        }
      }
      return {
        status: 'success' as const,
        project_id: inputData.project_id,
        action: options.action,
        result: await options.run(inputData, resumeData),
        audit: auditFor(options.ctx),
      }
    },
  })
}

export function createChatStep(ctx: ProjectWorkflowContext) {
  return createProjectActionStep({
    ctx,
    id: 'run-project-chat-agent',
    action: 'project_chat',
    run: async input => {
      if (input.action !== 'project_chat') throw new Error('unexpected_action')
      return callResearchApi('/internal/chat', {
        method: 'POST',
        body: JSON.stringify({
          session_id: input.session_id ?? null,
          project_id: input.project_id,
          message: input.message,
          attachments: input.attachments ?? [],
          clarification_mode: input.clarification_mode ?? 'automatic',
        }),
      }, ctx)
    },
  })
}

export function createResearchBootstrapStep(ctx: ProjectWorkflowContext) {
  return createProjectActionStep({
    ctx,
    id: 'research-bootstrap',
    action: 'research_bootstrap',
    run: async input => {
      if (input.action !== 'research_bootstrap') throw new Error('unexpected_action')
      const search = await callResearchApi('/api/search', {
        method: 'POST',
        body: JSON.stringify({ project_id: input.project_id, limit: 8 }),
      }, ctx)
      const review = await callResearchApi(`/api/projects/${input.project_id}/novelty`, {}, ctx)
      return { search, review }
    },
  })
}

export function createApprovalGateStep(ctx: ProjectWorkflowContext) {
  return createProjectActionStep({
    ctx,
    id: 'human-approval',
    action: 'approval_gate',
    suspendSchema: z.object({
      reason: z.string(),
      project_id: z.string().uuid(),
      proposal_id: z.string().uuid(),
      tool_name: z.string(),
      args_fingerprint: z.string(),
      policy_version: z.string(),
    }).strict(),
    resumeSchema: projectWorkflowResumeSchema,
    run: async (input, resumeData) => {
      if (input.action !== 'approval_gate') throw new Error('unexpected_action')
      if (!resumeData) throw new Error('approval_gate_requires_resume')
      const resume = resumeData as { approved: boolean; actor: string; comment?: string | null; mastra_run_id?: string }
      const decision = await callResearchApi(`/api/proposals/${input.proposal_id}/decision`, {
        method: 'POST',
        body: JSON.stringify({
          decision: resume.approved ? 'approved' : 'rejected',
          actor: resume.actor,
          comment: resume.comment ?? null,
          mastra_run_id: resume.mastra_run_id ?? input.mastra_run_id ?? null,
          tool_name: input.tool_name,
          args_fingerprint: input.args_fingerprint,
          policy_version: input.policy_version,
        }),
      }, ctx)
      return {
        decision: resume.approved ? 'approved' as const : 'rejected' as const,
        proposal_id: input.proposal_id,
        tool_name: input.tool_name,
        args_fingerprint: input.args_fingerprint,
        policy_version: input.policy_version,
        decision_result: decision,
      }
    },
  })
}

export function createReportsStep(ctx: ProjectWorkflowContext) {
  return createProjectActionStep({
    ctx,
    id: 'generate-project-reports',
    action: 'reports',
    run: async input => {
      if (input.action !== 'reports') throw new Error('unexpected_action')
      const report = await callResearchApi('/api/reports', {
        method: 'POST',
        body: JSON.stringify({ project_id: input.project_id, period: input.period }),
      }, ctx)
      return { report }
    },
  })
}

export function createPaperTranslateStep(ctx: ProjectWorkflowContext) {
  return createProjectActionStep({
    ctx,
    id: 'paper-translate',
    action: 'paper_translate',
    run: async input => {
      if (input.action !== 'paper_translate') throw new Error('unexpected_action')
      return callResearchApi(`/internal/projects/${input.project_id}/paper-translate`, {
        method: 'POST',
        body: JSON.stringify({ section_id: input.section_id }),
      }, ctx)
    },
  })
}

export function createPaperReviseStep(ctx: ProjectWorkflowContext) {
  return createProjectActionStep({
    ctx,
    id: 'paper-revise',
    action: 'paper_revise',
    run: async input => {
      if (input.action !== 'paper_revise') throw new Error('unexpected_action')
      return callResearchApi(`/internal/projects/${input.project_id}/paper-revise`, {
        method: 'POST',
        body: JSON.stringify({
          section_id: input.section_id,
          project_context: input.project_context ?? '',
        }),
      }, ctx)
    },
  })
}

export function createExperimentPlanStep(ctx: ProjectWorkflowContext) {
  return createProjectActionStep({
    ctx,
    id: 'create-experiment-plan',
    action: 'experiment_plan',
    run: async input => {
      if (input.action !== 'experiment_plan') throw new Error('unexpected_action')
      return callResearchApi(`/internal/projects/${input.project_id}/experiment-plan`, {
        method: 'POST',
        body: JSON.stringify({
          project_id: input.project_id,
        }),
      }, ctx)
    },
  })
}

export function createWorkflowEditProposalStep(ctx: ProjectWorkflowContext) {
  return createProjectActionStep({
    ctx,
    id: 'workflow-edit-proposal',
    action: 'workflow_edit_proposal',
    run: async input => {
      if (input.action !== 'workflow_edit_proposal') throw new Error('unexpected_action')
      return callResearchApi(`/api/projects/${input.project_id}/workflow-edit-proposal`, {
        method: 'POST',
        body: JSON.stringify({ instruction: input.instruction }),
      }, ctx)
    },
  })
}

export function createFinalizeStep(ctx: ProjectWorkflowContext) {
  return createStep({
    id: 'workflow-exit',
    inputSchema: branchResultSchema,
    outputSchema: branchResultSchema,
    execute: async ({ inputData }) => ({
      ...inputData,
      audit: {
        workflow_version: ctx.version,
        source_hash: ctx.sourceHash,
        started_at: inputData.audit.started_at,
        finished_at: new Date().toISOString(),
      },
    }),
  })
}

export function extractBranchOutput(inputData: unknown): ProjectWorkflowOutput {
  if (!inputData || typeof inputData !== 'object') throw new Error('workflow_branch_output_invalid')
  const record = inputData as Record<string, unknown>
  const candidates = [inputData, ...Object.values(record)]
  for (const candidate of candidates) {
    const parsed = projectWorkflowOutputSchema.safeParse(candidate)
    if (parsed.success) return parsed.data
  }
  throw new Error('workflow_branch_output_invalid')
}
