import { z } from 'zod'

export const modelTierSchema = z.enum(['simple', 'medium', 'complex'])
export type ModelTier = z.infer<typeof modelTierSchema>
export const reasoningEffortSchema = z.enum(['low', 'medium', 'high'])

export const modelConfigSchema = z.object({
  model: z.string().min(1).max(200),
  url: z.string().url().max(500),
  key: z.string().min(1).max(1000),
  reasoningEffort: reasoningEffortSchema,
}).strict()
export type ModelConfig = z.infer<typeof modelConfigSchema>

export const agentRequestContextSchema = z.object({
  tier: modelTierSchema,
  modelConfig: modelConfigSchema,
  clarificationMode: z.enum(['automatic', 'detailed']).optional(),
  supermemoryProjectId: z.string().uuid().optional(),
  supermemoryConversationId: z.string().min(1).max(200).optional(),
}).strict()

export const resourceConstraintsSchema = z.object({
  compute: z.string().nullable(),
  budget_usd: z.number().min(0).nullable(),
  deadline: z.string().nullable(),
  data_access: z.string().nullable(),
}).strict()

export const researchIdeaDraftSchema = z.object({
  title: z.string().max(240).nullable(),
  research_question: z.string().nullable(),
  domain: z.string().nullable(),
  hypotheses: z.array(z.string()).max(10),
  expected_contributions: z.array(z.string()).max(10),
  keywords: z.array(z.string()).max(30),
  target_venues: z.array(z.string()).max(10),
  available_data: z.string().nullable(),
  constraints: resourceConstraintsSchema,
  success_criteria: z.array(z.string()).max(10),
  risks: z.array(z.string()).max(20),
  open_questions: z.array(z.string()).max(12),
  ethics_and_compliance: z.string().nullable(),
}).strict()

export const adaptiveClarificationResultSchema = z.object({
  draft: researchIdeaDraftSchema,
  assistant_reply: z.string().min(1).max(6000),
  ready_for_confirmation: z.boolean(),
  unresolved_items: z.array(z.string()).max(12),
  assumptions: z.array(z.string()).max(12),
  risk_flags: z.array(z.string()).max(12),
}).strict()

export const projectSlugRequestSchema = z.object({
  idea: researchIdeaDraftSchema,
  tier: modelTierSchema,
}).strict()

export const projectSlugResultSchema = z.object({
  keywords: z.array(z.string().trim().min(2).max(32)).length(3),
}).strict()

export const supervisionIntentSchema = z.object({
  intent: z.enum([
    'explanation', 'advice', 'change_request', 'policy_change',
    'pause_request', 'resume_request', 'cancel_request',
    'approval_request', 'rejection_request', 'ambiguous',
  ]),
  target_field: z.enum([
    'title', 'research_question', 'domain', 'available_data', 'ethics_and_compliance',
  ]).nullable(),
  proposed_value: z.string().max(4000).nullable(),
  policy_rule: z.string().max(2000).nullable(),
  clarification_question: z.string().max(2000).nullable(),
  assistant_reply: z.string().min(1).max(6000),
}).strict()

const uuidList = (max: number) => z.array(z.string().uuid()).max(max)
const evidenceIds = z.object({ basis_evidence_ids: uuidList(30) })

const dataSourceSchema = evidenceIds.extend({
  name: z.string().min(2).max(300),
  purpose: z.string().min(5).max(2000),
  access_and_provenance: z.string().min(5).max(2000),
  split_and_preprocessing: z.string().min(5).max(2000),
}).strict()
const baselineSchema = evidenceIds.extend({
  name: z.string().min(2).max(300),
  rationale: z.string().min(5).max(2000),
  implementation_scope: z.string().min(5).max(2000),
  comparison: z.string().min(5).max(2000),
}).strict()
const metricSchema = evidenceIds.extend({
  name: z.string().min(2).max(160),
  definition: z.string().min(5).max(2000),
  primary: z.boolean(),
  aggregation: z.string().min(3).max(500),
}).strict()
const ablationSchema = evidenceIds.extend({
  component: z.string().min(2).max(300),
  removed_or_changed: z.string().min(5).max(2000),
  rationale: z.string().min(5).max(2000),
  expected_signal: z.string().min(5).max(2000),
}).strict()
const statisticalTestSchema = evidenceIds.extend({
  name: z.string().min(2).max(200),
  comparison: z.string().min(5).max(1000),
  null_hypothesis: z.string().min(5).max(1000),
  alpha: z.number().gt(0).lt(1),
  multiple_comparison_correction: z.string().min(2).max(300),
}).strict()
const resourceBudgetSchema = z.object({
  compute_environment: z.string().min(3).max(1000),
  max_runtime_hours: z.number().gt(0).lte(100000),
  max_gpu_hours: z.number().min(0).lte(100000),
  memory_gb: z.number().gt(0).lte(1000000),
  budget_usd: z.number().min(0).lte(1000000),
  assumptions: z.array(z.string()).max(20),
}).strict()
const riskSchema = evidenceIds.extend({
  risk: z.string().min(3).max(500),
  mitigation: z.string().min(5).max(2000),
  detection: z.string().min(5).max(1000),
  stop_condition: z.string().min(5).max(1000),
}).strict()
const successCriterionSchema = evidenceIds.extend({
  criterion: z.string().min(5).max(1000),
  metric: z.string().min(2).max(160),
  target_or_decision_rule: z.string().min(5).max(1000),
}).strict()

export const experimentPlanSchema = z.object({
  schema_version: z.literal('1.0'),
  plan_type: z.literal('topic_specific'),
  project_id: z.string().uuid(),
  idea_version: z.number().int().min(1),
  research_question: z.string().min(10).max(4000),
  objective: z.string().min(10).max(4000),
  source_evidence_ids: uuidList(100).min(1),
  policy_ids: uuidList(100),
  data_sources: z.array(dataSourceSchema).min(1).max(30),
  baselines: z.array(baselineSchema).min(1).max(30),
  metrics: z.array(metricSchema).min(1).max(30),
  ablations: z.array(ablationSchema).min(1).max(30),
  statistical_tests: z.array(statisticalTestSchema).min(1).max(20),
  random_seeds: z.array(z.number().int()).min(1).max(10),
  resource_budget: resourceBudgetSchema,
  risks: z.array(riskSchema).min(1).max(30),
  success_criteria: z.array(successCriterionSchema).min(1).max(30),
}).strict()

export const clarifyRequestSchema = z.object({
  message: z.string().min(1).max(20000),
  current_draft: z.record(z.string(), z.unknown()),
  transcript: z.array(z.object({ role: z.string(), content: z.string() }).strict()).max(12),
  attachment_count: z.number().int().min(0).max(50),
  clarification_mode: z.enum(['automatic', 'detailed']),
  attachment_context: z.array(z.record(z.string(), z.unknown())).max(50),
  attachment_images: z.array(z.object({ data_url: z.string().max(6_000_000) }).strict()).max(4),
  tier: modelTierSchema,
  memory_resource: z.string().min(1).max(200).optional(),
  memory_thread: z.string().min(1).max(200).optional(),
}).strict()

export const supervisionRequestSchema = z.object({
  message: z.string().min(1).max(20000),
  project_context: z.record(z.string(), z.unknown()),
  transcript: z.array(z.object({ role: z.string(), content: z.string() }).strict()).max(12),
  tier: modelTierSchema,
  memory_resource: z.string().min(1).max(200).optional(),
  memory_thread: z.string().min(1).max(200).optional(),
}).strict()

export const experimentPlanRequestSchema = z.object({
  project_id: z.string().uuid(),
  idea_version: z.number().int().min(1),
  planning_context: z.record(z.string(), z.unknown()),
}).strict()

export const coordinatorRequestSchema = z.object({
  project_id: z.string().uuid(),
  task: z.string().trim().min(10).max(12000),
  planning_context: z.record(z.string(), z.unknown()),
  tier: modelTierSchema.default('complex'),
  memory_resource: z.string().min(1).max(200).optional(),
  memory_thread: z.string().min(1).max(200).optional(),
}).strict()

export const coordinatorResultSchema = z.object({
  summary: z.string().min(1).max(6000),
  delegated_findings: z.array(z.object({
    role: z.enum(['idea_clarification', 'project_supervision', 'experiment_planning']),
    finding: z.string().min(1).max(4000),
    unresolved: z.array(z.string()).max(12),
  }).strict()).max(3),
  blocked_questions: z.array(z.string()).max(12),
  next_action: z.enum(['clarify', 'review_evidence', 'draft_plan', 'await_approval']),
}).strict()

export const researchWorkflowInputSchema = z.object({
  project_id: z.string().uuid(),
  task_id: z.string().uuid(),
  idempotency_key: z.string().min(1).max(500),
}).strict()

export const chatWorkflowInputSchema = z.object({
  session_id: z.string().uuid().nullable().optional(),
  project_id: z.string().uuid().nullable().optional(),
  message: z.string().min(1).max(20000),
  attachments: z.array(z.object({
    name: z.string(),
    artifact_id: z.string().uuid().nullable().optional(),
  }).strict()).max(50),
  clarification_mode: z.enum(['automatic', 'detailed']).default('automatic'),
}).strict()

export const reportWorkflowInputSchema = z.object({
  period: z.enum(['daily', 'weekly']),
}).strict()

export const approvalGateInputSchema = z.object({
  project_id: z.string().uuid(),
  proposal_id: z.string().uuid(),
  tool_name: z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9_.:-]+$/),
  args_fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  policy_version: z.string().trim().min(1).max(120),
  actor: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(3).max(2000),
  mastra_run_id: z.string().min(1).max(200).optional(),
}).strict()

export const approvalGateResumeSchema = z.object({
  approved: z.boolean(),
  actor: z.string().trim().min(1).max(200),
  comment: z.string().max(4000).nullable().optional(),
}).strict()

export const approvalGateRequestSchema = approvalGateInputSchema.extend({ run_id: z.string().min(1).max(200).optional() }).strict()
export const approvalGateResumeRequestSchema = approvalGateResumeSchema.extend({ run_id: z.string().min(1).max(200) }).strict()

export const approvalGateOutputSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  project_id: z.string().uuid(),
  proposal_id: z.string().uuid(),
  tool_name: z.string(),
  args_fingerprint: z.string(),
  policy_version: z.string(),
  decision: z.unknown(),
}).strict()
