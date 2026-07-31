import { z } from 'zod'

export const uuid = z.string().uuid()
export const clarificationMode = z.enum(['automatic', 'detailed'])
export const modelTier = z.enum(['simple', 'medium', 'complex'])
export type ModelTier = z.infer<typeof modelTier>

export const resourceConstraints = z.object({
  compute: z.string().nullable().default(null),
  budget_usd: z.number().min(0).nullable().default(null),
  deadline: z.string().nullable().default(null),
  data_access: z.string().nullable().default(null),
}).strict()

export const ideaDraft = z.object({
  title: z.string().max(240).nullable().default(null),
  research_question: z.string().nullable().default(null),
  domain: z.string().nullable().default(null),
  hypotheses: z.array(z.string()).max(10).default([]),
  expected_contributions: z.array(z.string()).max(10).default([]),
  keywords: z.array(z.string()).max(30).default([]),
  target_venues: z.array(z.string()).max(10).default([]),
  available_data: z.string().nullable().default(null),
  constraints: resourceConstraints.default({ compute: null, budget_usd: null, deadline: null, data_access: null }),
  success_criteria: z.array(z.string()).max(10).default([]),
  risks: z.array(z.string()).max(20).default([]),
  open_questions: z.array(z.string()).max(12).default([]),
  ethics_and_compliance: z.string().nullable().default(null),
}).strict()

export const chatRequest = z.object({
  session_id: uuid.nullable().optional(),
  project_id: uuid.nullable().optional(),
  message: z.string().trim().min(1).max(20_000),
  attachments: z.array(z.object({ name: z.string(), artifact_id: uuid.nullable().optional() }).strict()).max(50).default([]),
  clarification_mode: clarificationMode.default('automatic'),
}).strict()

export const projectCreateRequest = z.object({ session_id: uuid, confirmed: z.literal(true) }).strict()
export const modelTierSettings = z.object({
  model: z.string().trim().min(1).max(200),
  url: z.string().url().max(500),
  key: z.string().max(1000),
  reasoning_effort: z.enum(['low', 'medium', 'high']),
}).strict()
export const modelSettingsRequest = z.object({
  simple: modelTierSettings,
  medium: modelTierSettings,
  complex: modelTierSettings,
}).strict()

export const proposalCreateRequest = z.object({
  project_id: uuid,
  kind: z.enum(['experiment_plan', 'experiment_rerun', 'code_patch', 'config_change', 'idea_revision', 'data_change', 'dependency_install', 'delete_artifact', 'memory_revoke', 'external_publish', 'diagnostic_suggestion']),
  reason: z.string().min(5),
  summary: z.string().min(5),
  diff: z.string().nullable().optional(),
  impact: z.record(z.string(), z.unknown()).default({}),
  estimated_cost_usd: z.number().min(0).default(0),
  payload: z.record(z.string(), z.unknown()).default({}),
}).strict().superRefine((value, context) => {
  if (['code_patch', 'config_change'].includes(value.kind) && !value.diff) {
    context.addIssue({ code: 'custom', message: 'code and config changes require an explicit diff' })
  }
})

const experimentTypes = z.enum(['topic_specific', 'compile_latex', 'python_analysis', 'cpp_cmake', 'gpu_python'])
export const experimentRequest = z.object({
  project_id: uuid,
  proposal_id: uuid,
  experiment_type: experimentTypes,
  execution_backend: z.enum(['windows', 'wsl2']).default('windows'),
  config: z.record(z.string(), z.unknown()).default({}),
  random_seeds: z.array(z.number().int()).min(1).max(10).default([13, 37, 73]),
  topic_plan: z.record(z.string(), z.unknown()).nullable().optional(),
  topic_resume: z.record(z.string(), z.unknown()).nullable().optional(),
}).strict().superRefine((value, context) => {
  const forbidden = ['command', 'cmd', 'shell', 'cwd', 'path', 'url', 'image', 'network', 'environment']
  for (const key of forbidden) if (key in value.config) context.addIssue({ code: 'custom', path: ['config', key], message: 'arbitrary execution fields are forbidden' })
  if (value.experiment_type === 'topic_specific' && !value.topic_plan) context.addIssue({ code: 'custom', path: ['topic_plan'], message: 'topic-specific execution requires an approved plan' })
})

export const approvalDecision = z.object({
  decision: z.enum(['approved', 'rejected']),
  comment: z.string().max(4000).nullable().optional(),
  actor: z.string().max(200).default('local-user'),
  mastra_run_id: z.string().trim().min(1).max(200).nullable().optional(),
  tool_name: z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9_.:-]+$/).nullable().optional(),
  args_fingerprint: z.string().regex(/^[0-9a-f]{64}$/).nullable().optional(),
  policy_version: z.string().trim().min(1).max(120).nullable().optional(),
}).strict()
export const projectStateRequest = z.object({ action: z.enum(['pause', 'resume', 'cancel']), reason: z.string().min(3).max(2000) }).strict()
export const policyRequest = z.object({ project_id: uuid, rule: z.string().min(5).max(2000), rationale: z.string().max(2000).nullable().optional() }).strict()
export const reportRequest = z.object({ project_id: uuid, period: z.enum(['daily', 'weekly', 'manual']).default('manual'), notify: z.boolean().default(false) }).strict()
export const humanFeedbackRequest = z.object({
  session_id: uuid.nullable().optional(),
  category: z.enum(['idea', 'report', 'experiment', 'memory', 'general']),
  instruction: z.string().trim().min(1).max(8_000),
  reference_id: uuid.nullable().optional(),
}).strict()
export const claimReviewRequest = z.object({
  claim: z.string().trim().min(5).max(4_000),
  evidence_ids: z.array(uuid).min(1).max(30),
}).strict()
export const claimReviewDecisionRequest = z.object({
  decision: z.enum(['accepted', 'rejected']),
  actor: z.string().trim().min(1).max(200).default('local-user'),
  comment: z.string().max(4_000).nullable().optional(),
}).strict()
export const repositoryCandidateRequest = z.object({ paper_id: uuid, source_url: z.string().url().max(500) }).strict()
const flatMemoryMetadata = z.record(z.string(), z.union([z.string().max(4000), z.number().finite(), z.boolean(), z.array(z.string().max(4000)).max(20)])).default({})
export const memoryIngestRequest = z.object({
  source_type: z.enum(['idea_message', 'project_chat_message', 'report', 'experiment_summary', 'experiment_plan', 'related_work', 'artifact', 'manual']),
  source_id: uuid.nullable().optional(),
  artifact_id: uuid.nullable().optional(),
  uploaded_file_id: uuid.nullable().optional(),
  content: z.string().trim().min(1).max(200_000).nullable().optional(),
  source_url: z.string().url().max(2000).nullable().optional(),
  quote: z.string().max(20_000).nullable().optional(),
  locator: z.string().max(255).nullable().optional(),
  metadata: flatMemoryMetadata,
  task_type: z.enum(['memory', 'superrag']).default('memory'),
  idempotency_key: z.string().trim().min(1).max(200).nullable().optional(),
}).strict().superRefine((value, context) => {
  if (!value.content && !value.artifact_id && !value.uploaded_file_id) context.addIssue({ code: 'custom', path: ['content'], message: 'memory ingestion requires content or a controlled file id' })
  if (value.artifact_id && value.uploaded_file_id) context.addIssue({ code: 'custom', path: ['artifact_id'], message: 'provide only one controlled file id' })
  if (value.source_type === 'artifact' && !value.artifact_id && !value.uploaded_file_id) context.addIssue({ code: 'custom', path: ['artifact_id'], message: 'artifact source requires artifact_id or uploaded_file_id' })
})
export const memorySearchRequest = z.object({ query: z.string().trim().min(1).max(2000), limit: z.number().int().min(1).max(20).default(8), search_mode: z.enum(['memories', 'hybrid', 'documents']).default('hybrid') }).strict()
export const memoryRevokeRequest = z.object({ reason: z.string().trim().min(3).max(2000), operation: z.enum(['forget', 'delete']).default('forget') }).strict()

export function emptyIdeaDraft(): z.infer<typeof ideaDraft> {
  return ideaDraft.parse({})
}
