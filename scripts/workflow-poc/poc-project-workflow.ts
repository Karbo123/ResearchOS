import { createStep, createWorkflow } from '@mastra/core/workflows'
import { z } from 'zod'

export const workflowManifest = {
  schemaVersion: 1,
  templateVersion: 'workflow-poc@1',
  entryStep: 'workflow-entry',
  exitStep: 'workflow-exit',
}

const inputSchema = z.object({
  project_id: z.string().min(1),
}).strict()

const entryOutputSchema = z.object({
  project_id: z.string().min(1),
  entered: z.boolean(),
}).strict()

const entryStep = createStep({
  id: 'workflow-entry',
  inputSchema,
  outputSchema: entryOutputSchema,
  execute: async ({ inputData }) => ({
    project_id: inputData.project_id,
    entered: true,
  }),
})

const exitOutputSchema = z.object({
  status: z.literal('success'),
  project_id: z.string().min(1),
}).strict()

const exitStep = createStep({
  id: 'workflow-exit',
  inputSchema: entryOutputSchema,
  outputSchema: exitOutputSchema,
  execute: async ({ inputData }) => ({
    status: 'success' as const,
    project_id: inputData.project_id,
  }),
})

export default function defineProjectWorkflow(ctx: { workflowId: string; description?: string }) {
  return createWorkflow({
    id: ctx.workflowId,
    description: ctx.description,
    inputSchema,
    outputSchema: exitOutputSchema,
  })
    .then(entryStep)
    .then(exitStep)
    .commit()
}
