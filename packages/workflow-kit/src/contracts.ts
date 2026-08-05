import { z } from 'zod'

export const projectWorkflowActionSchema = z.enum([
  'project_chat',
  'research_bootstrap',
  'approval_gate',
  'reports',
  'paper_translate',
  'paper_revise',
  'experiment_plan',
  'workflow_edit_proposal',
])
export type ProjectWorkflowAction = z.infer<typeof projectWorkflowActionSchema>

const projectIdSchema = z.string().regex(/^[a-z]{2,32}-[a-z]{2,32}-[a-z0-9]{4}$/)

const projectChatSchema = z.object({
  action: z.literal('project_chat'),
  project_id: projectIdSchema,
  session_id: z.string().uuid().nullable().optional(),
  message: z.string().min(1).max(20_000),
  attachments: z.array(z.object({
    name: z.string(),
    artifact_id: z.string().uuid().nullable().optional(),
  }).strict()).max(50).optional(),
  clarification_mode: z.enum(['automatic', 'detailed']).optional(),
}).strict()

const researchBootstrapSchema = z.object({
  action: z.literal('research_bootstrap'),
  project_id: projectIdSchema,
  task_id: z.string().uuid(),
  idempotency_key: z.string().min(1).max(500),
}).strict()

const approvalGateSchema = z.object({
  action: z.literal('approval_gate'),
  project_id: projectIdSchema,
  proposal_id: z.string().uuid(),
  tool_name: z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9_.:-]+$/),
  args_fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  policy_version: z.string().trim().min(1).max(120),
  actor: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(3).max(2000),
  mastra_run_id: z.string().min(1).max(200).optional(),
}).strict()

const reportsSchema = z.object({
  action: z.literal('reports'),
  project_id: projectIdSchema,
  period: z.enum(['daily', 'weekly']),
}).strict()

const paperSectionSchema = z.enum(['introduction', 'paper_related_work', 'paper_method', 'paper_experiments', 'conclusion'])

const paperTranslateSchema = z.object({
  action: z.literal('paper_translate'),
  project_id: projectIdSchema,
  section_id: paperSectionSchema,
  heading: z.string().max(120),
  source: z.string().max(20_000),
}).strict()

const paperReviseSchema = z.object({
  action: z.literal('paper_revise'),
  project_id: projectIdSchema,
  section_id: paperSectionSchema,
  heading: z.string().max(120),
  source: z.string().max(20_000),
  project_context: z.string().max(12_000).optional(),
}).strict()

const experimentPlanSchema = z.object({
  action: z.literal('experiment_plan'),
  project_id: projectIdSchema,
  idea_version: z.number().int().min(1),
  planning_context: z.record(z.string(), z.unknown()),
}).strict()

const workflowEditProposalSchema = z.object({
  action: z.literal('workflow_edit_proposal'),
  project_id: projectIdSchema,
  instruction: z.string().min(5).max(12_000),
}).strict()

export const projectWorkflowInputSchema = z.discriminatedUnion('action', [
  projectChatSchema,
  researchBootstrapSchema,
  approvalGateSchema,
  reportsSchema,
  paperTranslateSchema,
  paperReviseSchema,
  experimentPlanSchema,
  workflowEditProposalSchema,
])
export type ProjectWorkflowInput = z.infer<typeof projectWorkflowInputSchema>

// Mastra Studio's AutoForm cannot render zod discriminated unions and crashes
// on the workflow graph page. Runtime validation stays on the strict schema at
// the API boundary; Studio only needs a form that does not crash.
export const projectWorkflowStudioInputSchema = z.any()

export const projectWorkflowAuditSchema = z.object({
  workflow_version: z.number().int().min(1),
  source_hash: z.string().min(1).max(128),
  started_at: z.string(),
  finished_at: z.string(),
}).strict()

export const projectWorkflowOutputSchema = z.object({
  status: z.literal('success'),
  project_id: projectIdSchema,
  action: projectWorkflowActionSchema,
  result: z.unknown(),
  audit: projectWorkflowAuditSchema,
}).strict()
export type ProjectWorkflowOutput = z.infer<typeof projectWorkflowOutputSchema>

export const projectWorkflowResumeSchema = z.object({
  approved: z.boolean(),
  actor: z.string().trim().min(1).max(200),
  comment: z.string().max(4000).nullable().optional(),
  mastra_run_id: z.string().min(1).max(200).optional(),
}).strict()

export type ProjectWorkflowContext = {
  projectId: string
  slug: string
  workflowId: string
  version: number
  sourceHash: string
  apiBase: string
  dryRun: boolean
}

export const projectWorkflowManifestSchema = z.object({
  schemaVersion: z.literal(1),
  templateVersion: z.string().min(1).max(200),
  entryStep: z.literal('workflow-entry'),
  exitStep: z.literal('workflow-exit'),
}).strict()
