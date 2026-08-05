import {
  createFinalizeStep,
  createProjectContextStep,
  createResearchLifecycleWorkflow,
  projectWorkflowOutputSchema,
  projectWorkflowStudioInputSchema,
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
    inputSchema: projectWorkflowStudioInputSchema,
    outputSchema: projectWorkflowOutputSchema,
  })
    .then(createProjectContextStep(ctx))
    .then(createResearchLifecycleWorkflow(ctx))
    .then(createFinalizeStep(ctx))
    .commit()
}
