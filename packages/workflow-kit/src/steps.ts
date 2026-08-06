import { createStep, createWorkflow, type DefaultEngineType, type Step } from '@mastra/core/workflows'
import { z } from 'zod'
import { callResearchApi } from './api.js'
import {
  paperSectionSchema,
  projectWorkflowInputSchema,
  projectWorkflowOutputSchema,
  projectWorkflowResumeSchema,
  projectWorkflowStudioInputSchema,
  type PaperSectionId,
  type ProjectWorkflowAction,
  type ProjectWorkflowContext,
  type ProjectWorkflowInput,
  type ProjectWorkflowOutput,
  type ResearchPhaseId,
} from './contracts.js'

const branchResultSchema = projectWorkflowOutputSchema

type ProjectWorkflowPhaseState = ProjectWorkflowInput & {
  phase_results?: Partial<Record<ProjectWorkflowAction, unknown>>
}

type ResearchPhaseStepOptions = {
  ctx: ProjectWorkflowContext
  id: string
  isActive: (input: ProjectWorkflowInput) => boolean
  run: (input: ProjectWorkflowInput, resumeData?: unknown) => Promise<unknown>
  resultField?: string
  suspendSchema?: z.ZodType
  resumeSchema?: z.ZodType
}

const paperSectionStepIds: Record<PaperSectionId, string> = {
  introduction: 'paper-introduction',
  paper_related_work: 'paper-related-work',
  paper_method: 'paper-method',
  paper_experiments: 'paper-experiments',
  conclusion: 'paper-conclusion',
}

export function researchPhaseFor(input: unknown): ResearchPhaseId {
  const action = (input as { action?: unknown } | null | undefined)?.action
  switch (action) {
    case 'research_bootstrap': return 'literature'
    case 'experiment_plan': return 'method_and_experiment'
    case 'paper_translate':
    case 'paper_revise': return 'paper'
    case 'reports': return 'reporting'
    case 'approval_gate': return 'approval'
    case 'workflow_edit_proposal': return 'workflow_edit'
    case 'project_chat':
    default: return 'conversation'
  }
}

function auditFor(ctx: ProjectWorkflowContext): ProjectWorkflowOutput['audit'] {
  return {
    workflow_version: ctx.version,
    source_hash: ctx.sourceHash,
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
  }
}

export function createResearchPhaseStep(options: ResearchPhaseStepOptions) {
  const suspend = options.suspendSchema ? { suspendSchema: options.suspendSchema, resumeSchema: options.resumeSchema } : {}
  return createStep({
    id: options.id,
    inputSchema: projectWorkflowStudioInputSchema,
    outputSchema: projectWorkflowStudioInputSchema,
    ...suspend,
    execute: async ({ inputData, resumeData, suspend: suspendRun }) => {
      const state = inputData as ProjectWorkflowPhaseState
      if (!options.isActive(state)) return state
      if (!resumeData && options.suspendSchema && suspendRun) {
        const payload = state as Record<string, unknown>
        return suspendRun({
          reason: String(payload.reason || 'awaiting user decision'),
          project_id: payload.project_id,
          proposal_id: payload.proposal_id,
          tool_name: payload.tool_name,
          args_fingerprint: payload.args_fingerprint,
          policy_version: payload.policy_version,
        })
      }
      const result = await options.run(state, resumeData)
      const previousResults = state.phase_results?.[state.action]
      const mergedResult = options.resultField
        ? { ...(previousResults && typeof previousResults === 'object' && !Array.isArray(previousResults) ? previousResults as Record<string, unknown> : {}), [options.resultField]: result }
        : result
      return {
        ...state,
        phase_results: {
          ...(state.phase_results ?? {}),
          [state.action]: mergedResult,
        },
      }
    },
  })
}

export function createResearchPhaseContextStep(ctx: ProjectWorkflowContext) {
  return createStep({
    id: 'research-phase-context',
    inputSchema: projectWorkflowStudioInputSchema,
    outputSchema: projectWorkflowStudioInputSchema,
    execute: async ({ inputData }) => ({
      ...(inputData as Record<string, unknown>),
      research_phase: researchPhaseFor(inputData),
    }),
  })
}

export function extractPhaseOutput(inputData: unknown, ctx: ProjectWorkflowContext): ProjectWorkflowOutput {
  const direct = projectWorkflowOutputSchema.safeParse(inputData)
  if (direct.success) return direct.data
  if (!inputData || typeof inputData !== 'object' || Array.isArray(inputData)) {
    throw new Error('workflow_phase_output_invalid')
  }
  const record = inputData as Record<string, unknown>
  const phaseResults = record.phase_results
  if (typeof record.action === 'string' && typeof record.project_id === 'string' && phaseResults && typeof phaseResults === 'object') {
    const results = phaseResults as Partial<Record<ProjectWorkflowAction, unknown>>
    if (record.action in results) {
      return {
        status: 'success',
        project_id: record.project_id,
        action: record.action as ProjectWorkflowAction,
        result: results[record.action as ProjectWorkflowAction] ?? null,
        audit: auditFor(ctx),
      }
    }
  }
  for (const value of Object.values(record)) {
    if (!value || typeof value !== 'object') continue
    try {
      return extractPhaseOutput(value, ctx)
    } catch {
      // Keep searching for the active phase result inside nested workflow output.
    }
  }
  throw new Error('workflow_phase_output_invalid')
}

export function createPhaseOutputStep(ctx: ProjectWorkflowContext, id: string) {
  return createStep({
    id,
    inputSchema: projectWorkflowStudioInputSchema,
    outputSchema: projectWorkflowOutputSchema,
    execute: async ({ inputData }) => extractPhaseOutput(inputData, ctx),
  })
}

export function createLiteraturePhaseWorkflow(ctx: ProjectWorkflowContext) {
  return createWorkflow({
    id: 'literature-phase',
    inputSchema: projectWorkflowStudioInputSchema,
    outputSchema: projectWorkflowOutputSchema,
  })
    .then(createLiteratureSearchStep(ctx))
    .then(createNoveltyReviewStep(ctx))
    .then(createPhaseOutputStep(ctx, 'literature-phase-output'))
    .commit()
}

export function createResearchLifecycleWorkflow(ctx: ProjectWorkflowContext) {
  return createWorkflow({
    id: 'research-lifecycle',
    inputSchema: projectWorkflowStudioInputSchema,
    outputSchema: projectWorkflowOutputSchema,
  })
    .then(createResearchLifecycleEntryStep(ctx))
    .branch([
      [async ({ inputData }) => researchPhaseFor(inputData) === 'literature', createLiteraturePhaseWorkflow(ctx) as unknown as Step<string, any, any, any, any, any, DefaultEngineType, any>],
      [async ({ inputData }) => researchPhaseFor(inputData) === 'method_and_experiment', createMethodAndExperimentPhaseWorkflow(ctx) as unknown as Step<string, any, any, any, any, any, DefaultEngineType, any>],
      [async ({ inputData }) => researchPhaseFor(inputData) === 'paper', createPaperWritingPhaseWorkflow(ctx) as unknown as Step<string, any, any, any, any, any, DefaultEngineType, any>],
      [async ({ inputData }) => researchPhaseFor(inputData) === 'reporting', createReportingPhaseWorkflow(ctx) as unknown as Step<string, any, any, any, any, any, DefaultEngineType, any>],
      [async ({ inputData }) => researchPhaseFor(inputData) === 'approval', createApprovalPhaseWorkflow(ctx) as unknown as Step<string, any, any, any, any, any, DefaultEngineType, any>],
      [async ({ inputData }) => researchPhaseFor(inputData) === 'workflow_edit', createWorkflowEditPhaseWorkflow(ctx) as unknown as Step<string, any, any, any, any, any, DefaultEngineType, any>],
      [async ({ inputData }) => researchPhaseFor(inputData) === 'conversation', createConversationPhaseWorkflow(ctx) as unknown as Step<string, any, any, any, any, any, DefaultEngineType, any>],
    ])
    .then(createResearchLifecycleExitStep(ctx))
    .commit()
}

export function createResearchLifecycleEntryStep(ctx: ProjectWorkflowContext) {
  return createStep({
    id: 'research-lifecycle-entry',
    inputSchema: projectWorkflowStudioInputSchema,
    outputSchema: projectWorkflowStudioInputSchema,
    execute: async ({ inputData }) => ({
      ...(inputData as Record<string, unknown>),
      research_phase: researchPhaseFor(inputData),
    }),
  })
}

export function createResearchLifecycleExitStep(ctx: ProjectWorkflowContext) {
  return createStep({
    id: 'research-lifecycle-exit',
    inputSchema: projectWorkflowStudioInputSchema,
    outputSchema: projectWorkflowOutputSchema,
    execute: async ({ inputData }) => extractPhaseOutput(inputData, ctx),
  })
}

export function createMethodAndExperimentPhaseWorkflow(ctx: ProjectWorkflowContext) {
  return createWorkflow({
    id: 'method-and-experiment-phase',
    inputSchema: projectWorkflowStudioInputSchema,
    outputSchema: projectWorkflowOutputSchema,
  })
    .then(createMethodDesignAndExperimentPlanningStep(ctx))
    .then(createPhaseOutputStep(ctx, 'method-and-experiment-phase-output'))
    .commit()
}

export function createPaperWritingPhaseWorkflow(ctx: ProjectWorkflowContext) {
  return createWorkflow({
    id: 'paper-writing-phase',
    inputSchema: projectWorkflowStudioInputSchema,
    outputSchema: projectWorkflowOutputSchema,
  })
    .parallel([
      createPaperSectionStep(ctx, 'introduction'),
      createPaperSectionStep(ctx, 'paper_related_work'),
      createPaperSectionStep(ctx, 'paper_method'),
      createPaperSectionStep(ctx, 'paper_experiments'),
      createPaperSectionStep(ctx, 'conclusion'),
    ])
    .then(createPhaseOutputStep(ctx, 'paper-writing-phase-output'))
    .commit()
}

export function createReportingPhaseWorkflow(ctx: ProjectWorkflowContext) {
  return createWorkflow({
    id: 'reporting-phase',
    inputSchema: projectWorkflowStudioInputSchema,
    outputSchema: projectWorkflowOutputSchema,
  })
    .then(createReportingStep(ctx))
    .then(createPhaseOutputStep(ctx, 'reporting-phase-output'))
    .commit()
}

export function createApprovalPhaseWorkflow(ctx: ProjectWorkflowContext) {
  return createWorkflow({
    id: 'approval-phase',
    inputSchema: projectWorkflowStudioInputSchema,
    outputSchema: projectWorkflowOutputSchema,
  })
    .then(createHumanApprovalStep(ctx))
    .then(createPhaseOutputStep(ctx, 'approval-phase-output'))
    .commit()
}

export function createWorkflowEditPhaseWorkflow(ctx: ProjectWorkflowContext) {
  return createWorkflow({
    id: 'workflow-edit-phase',
    inputSchema: projectWorkflowStudioInputSchema,
    outputSchema: projectWorkflowOutputSchema,
  })
    .then(createWorkflowEditStep(ctx))
    .then(createPhaseOutputStep(ctx, 'workflow-edit-phase-output'))
    .commit()
}

export function createConversationPhaseWorkflow(ctx: ProjectWorkflowContext) {
  return createWorkflow({
    id: 'conversation-phase',
    inputSchema: projectWorkflowStudioInputSchema,
    outputSchema: projectWorkflowOutputSchema,
  })
    .then(createProjectConversationStep(ctx))
    .then(createPhaseOutputStep(ctx, 'conversation-phase-output'))
    .commit()
}

export function createLiteratureReviewStep(ctx: ProjectWorkflowContext) {
  return createResearchPhaseStep({
    ctx,
    id: 'literature-review',
    isActive: input => input.action === 'research_bootstrap',
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

export function createLiteratureSearchStep(ctx: ProjectWorkflowContext) {
  return createResearchPhaseStep({
    ctx,
    id: 'literature-search',
    resultField: 'search',
    isActive: input => input.action === 'research_bootstrap',
    run: async input => {
      if (input.action !== 'research_bootstrap') throw new Error('unexpected_action')
      return callResearchApi('/api/search', {
        method: 'POST',
        body: JSON.stringify({ project_id: input.project_id, limit: 8 }),
      }, ctx)
    },
  })
}

export function createNoveltyReviewStep(ctx: ProjectWorkflowContext) {
  return createResearchPhaseStep({
    ctx,
    id: 'literature-novelty-review',
    resultField: 'novelty',
    isActive: input => input.action === 'research_bootstrap',
    run: async input => {
      if (input.action !== 'research_bootstrap') throw new Error('unexpected_action')
      return callResearchApi(`/api/projects/${input.project_id}/novelty`, {}, ctx)
    },
  })
}

export function createMethodDesignAndExperimentPlanningStep(ctx: ProjectWorkflowContext) {
  return createResearchPhaseStep({
    ctx,
    id: 'method-design-and-experiment-planning',
    isActive: input => input.action === 'experiment_plan',
    run: async input => {
      if (input.action !== 'experiment_plan') throw new Error('unexpected_action')
      return callResearchApi(`/internal/projects/${input.project_id}/experiment-plan`, {
        method: 'POST',
        body: JSON.stringify({ project_id: input.project_id }),
      }, ctx)
    },
  })
}

export function createPaperSectionStep(ctx: ProjectWorkflowContext, sectionId: PaperSectionId) {
  return createResearchPhaseStep({
    ctx,
    id: paperSectionStepIds[sectionId],
    isActive: input => (input.action === 'paper_translate' || input.action === 'paper_revise') && input.section_id === sectionId,
    run: async input => {
      if (input.action === 'paper_translate') {
        return callResearchApi(`/internal/projects/${input.project_id}/paper-translate`, {
          method: 'POST',
          body: JSON.stringify({ section_id: input.section_id }),
        }, ctx)
      }
      if (input.action === 'paper_revise') {
        return callResearchApi(`/internal/projects/${input.project_id}/paper-revise`, {
          method: 'POST',
          body: JSON.stringify({
            section_id: input.section_id,
            project_context: input.project_context ?? '',
          }),
        }, ctx)
      }
      throw new Error('unexpected_action')
    },
  })
}

export function createReportingStep(ctx: ProjectWorkflowContext) {
  return createResearchPhaseStep({
    ctx,
    id: 'reporting-and-feedback',
    isActive: input => input.action === 'reports',
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

export function createHumanApprovalStep(ctx: ProjectWorkflowContext) {
  return createResearchPhaseStep({
    ctx,
    id: 'human-approval',
    isActive: input => input.action === 'approval_gate',
    suspendSchema: z.object({
      reason: z.string(),
      project_id: z.string().regex(/^[a-z]{2,32}-[a-z]{2,32}-[a-z0-9]{4}$/),
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

export function createWorkflowEditStep(ctx: ProjectWorkflowContext) {
  return createResearchPhaseStep({
    ctx,
    id: 'workflow-edit-proposal',
    isActive: input => input.action === 'workflow_edit_proposal',
    run: async input => {
      if (input.action !== 'workflow_edit_proposal') throw new Error('unexpected_action')
      return callResearchApi(`/api/projects/${input.project_id}/workflow-edit-proposal`, {
        method: 'POST',
        body: JSON.stringify({ instruction: input.instruction }),
      }, ctx)
    },
  })
}

export function createProjectConversationStep(ctx: ProjectWorkflowContext) {
  return createResearchPhaseStep({
    ctx,
    id: 'project-conversation',
    isActive: input => input.action === 'project_chat',
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
          workspace_area: input.workspace_area,
          workspace_tab: input.workspace_tab,
          workspace_label: input.workspace_label,
        }),
      }, ctx)
    },
  })
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
          workspace_area: input.workspace_area,
          workspace_tab: input.workspace_tab,
          workspace_label: input.workspace_label,
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
      project_id: z.string().regex(/^[a-z]{2,32}-[a-z]{2,32}-[a-z0-9]{4}$/),
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
    inputSchema: projectWorkflowStudioInputSchema,
    outputSchema: branchResultSchema,
    execute: async ({ inputData }) => {
      const output = extractPhaseOutput(inputData, ctx)
      return {
        ...output,
        audit: {
          workflow_version: ctx.version,
          source_hash: ctx.sourceHash,
          started_at: output.audit.started_at,
          finished_at: new Date().toISOString(),
        },
      }
    },
  })
}

export function extractBranchOutput(inputData: unknown): ProjectWorkflowOutput {
  const context = { version: 1, sourceHash: 'branch', startedAt: new Date().toISOString() }
  const find = (value: unknown): ProjectWorkflowOutput | null => {
    const parsed = projectWorkflowOutputSchema.safeParse(value)
    if (parsed.success) return parsed.data
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    for (const child of Object.values(value as Record<string, unknown>)) {
      const found = find(child)
      if (found) return found
    }
    return null
  }
  const output = find(inputData)
  if (output) {
    return {
      ...output,
      audit: {
        workflow_version: context.version,
        source_hash: context.sourceHash,
        started_at: context.startedAt,
        finished_at: context.startedAt,
      },
    }
  }
  throw new Error('workflow_branch_output_invalid')
}
