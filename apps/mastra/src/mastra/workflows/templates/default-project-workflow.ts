import {
  createApprovalGateStep,
  createChatStep,
  createExperimentPlanStep,
  createFinalizeStep,
  createPaperReviseStep,
  createPaperTranslateStep,
  createProjectContextStep,
  createReportsStep,
  createResearchBootstrapStep,
  createWorkflowEditProposalStep,
  extractBranchOutput,
  projectWorkflowInputSchema,
  projectWorkflowOutputSchema,
  type ProjectWorkflowContext,
} from '@research-os/workflow-kit'
import { createWorkflow } from '@mastra/core/workflows'

export const workflowManifest = {
  schemaVersion: 1,
  templateVersion: 'default-project-workflow@1',
  entryStep: 'workflow-entry',
  exitStep: 'workflow-exit',
}

export default function defineProjectWorkflow(ctx: ProjectWorkflowContext) {
  return createWorkflow({
    id: ctx.workflowId,
    inputSchema: projectWorkflowInputSchema,
    outputSchema: projectWorkflowOutputSchema,
  })
    .then(createProjectContextStep(ctx))
    .branch([
      [async ({ inputData }) => inputData.action === 'project_chat', createChatStep(ctx)],
      [async ({ inputData }) => inputData.action === 'research_bootstrap', createResearchBootstrapStep(ctx)],
      [async ({ inputData }) => inputData.action === 'approval_gate', createApprovalGateStep(ctx)],
      [async ({ inputData }) => inputData.action === 'reports', createReportsStep(ctx)],
      [async ({ inputData }) => inputData.action === 'paper_translate', createPaperTranslateStep(ctx)],
      [async ({ inputData }) => inputData.action === 'paper_revise', createPaperReviseStep(ctx)],
      [async ({ inputData }) => inputData.action === 'experiment_plan', createExperimentPlanStep(ctx)],
      [async ({ inputData }) => inputData.action === 'workflow_edit_proposal', createWorkflowEditProposalStep(ctx)],
    ])
    .map(async ({ inputData }) => extractBranchOutput(inputData))
    .then(createFinalizeStep(ctx))
    .commit()
}
