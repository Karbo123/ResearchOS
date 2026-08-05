import { z } from 'zod'
import { isAllowedModelUrl, isResponsesBaseUrl } from './model-url.js'

export const uuid = z.string().uuid()
export const projectSlug = z.string().regex(/^[a-z]{2,32}-[a-z]{2,32}-[a-z0-9]{4}$/)
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
  project_id: projectSlug.nullable().optional(),
  message: z.string().trim().min(1).max(20_000),
  attachments: z.array(z.object({ name: z.string(), artifact_id: uuid.nullable().optional() }).strict()).max(50).default([]),
  clarification_mode: clarificationMode.default('automatic'),
}).strict()

export const workflowEditProposalRequest = z.object({
  instruction: z.string().trim().min(5).max(12_000),
  project_context: z.record(z.string(), z.unknown()).default({}),
}).strict()

export const projectCreateRequest = z.object({
  slug: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(240),
}).strict()
export const projectDeleteRequest = z.object({
  project_title: z.string().trim().min(1).max(240),
  confirmation: z.literal('DELETE'),
}).strict()
export const projectPinRequest = z.object({
  pinned: z.boolean(),
}).strict()
export const paperSectionEditRequest = z.object({
  section_id: z.enum(['introduction', 'paper_related_work', 'paper_method', 'paper_experiments', 'conclusion']),
  content: z.string().max(100_000),
}).strict()
export const paperSectionModelRequest = z.object({
  section_id: z.enum(['introduction', 'paper_related_work', 'paper_method', 'paper_experiments', 'conclusion']),
}).strict()
export const projectOrderRequest = z.object({
  project_ids: z.array(projectSlug).min(1).max(500),
}).strict().superRefine((value, context) => {
  if (new Set(value.project_ids).size !== value.project_ids.length) {
    context.addIssue({ code: 'custom', path: ['project_ids'], message: 'project_ids cannot contain duplicates' })
  }
})
export const modelTierSettings = z.object({
  model: z.string().trim().min(1).max(200),
  url: z.string().url().max(500)
    .refine(isAllowedModelUrl, 'model URL must use HTTPS or loopback/private HTTP')
    .refine(isResponsesBaseUrl, 'model URL must be a Responses API base URL, not an operation endpoint'),
  key: z.string().max(1000),
  reasoning_effort: z.enum(['low', 'medium', 'high']),
}).strict()
export const documentModelSettings = z.object({
  model: z.string().trim().min(1).max(200),
  url: z.string().url().max(500)
    .refine(isAllowedModelUrl, 'document model URL must use HTTPS or loopback/private HTTP')
    .refine(isResponsesBaseUrl, 'document model URL must be a Responses API base URL, not an operation endpoint'),
  key: z.string().max(1000),
}).strict()
export const documentModelSettingsRequest = documentModelSettings
export const visionModelSettings = z.object({
  model: z.string().trim().min(1).max(200),
  url: z.string().url().max(500)
    .refine(isAllowedModelUrl, 'vision model URL must use HTTPS or loopback/private HTTP')
    .refine(isResponsesBaseUrl, 'vision model URL must be a Responses API base URL, not an operation endpoint'),
  key: z.string().max(1000),
}).strict()
export const visionModelSettingsRequest = visionModelSettings
export const imageGenerationResolution = z.enum(['1k', '2k', '4k'])
export const imageGenerationQuality = z.enum(['low', 'medium', 'high'])
export const imageGenerationSettings = z.object({
  model: z.string().trim().min(1).max(200),
  url: z.string().url().max(500)
    .refine(isAllowedModelUrl, 'image generation URL must use HTTPS or loopback/private HTTP'),
  key: z.string().max(1000),
  resolution: imageGenerationResolution.default('1k'),
  quality: imageGenerationQuality.default('low'),
}).strict()
export const imageGenerationSettingsRequest = imageGenerationSettings
export const proxySettings = z.object({
  enabled: z.boolean(),
  url: z.string().trim().max(500),
}).strict().refine(value => !value.enabled || /^https?:\/\//i.test(value.url), 'proxy URL must start with http:// or https://')
export const proxySettingsRequest = proxySettings
export const modelSettingsRequest = z.object({
  simple: modelTierSettings,
  medium: modelTierSettings,
  complex: modelTierSettings,
  proxy: proxySettings.optional(),
}).strict()
export const projectModelSettingsRequest = modelSettingsRequest.omit({ proxy: true })
export const modelTestKind = z.enum(['simple', 'medium', 'complex', 'document', 'vision', 'image', 'voice'])
export type ModelTestKind = z.infer<typeof modelTestKind>
export const modelTestRequest = z.object({
  kind: modelTestKind,
  model: z.string().trim().max(200).default(''),
  url: z.string().trim().max(500).default(''),
  key: z.string().max(1000).default(''),
  project_id: projectSlug.optional(),
}).strict()

export const voiceProvider = z.enum(['browser', 'api', 'groq'])
export type VoiceProvider = z.infer<typeof voiceProvider>

export const voiceSettingsRequest = z.object({
  provider: voiceProvider.default('browser'),
  model: z.string().trim().max(200).default(''),
  url: z.string().trim().max(500).default('')
    .refine(value => !value || isAllowedModelUrl(value), 'voice URL must be HTTPS or loopback/private HTTP'),
  key: z.string().max(1000).default(''),
}).strict()
export type VoiceSettingsRequest = z.infer<typeof voiceSettingsRequest>

export const embeddingProvider = z.enum(['local', 'openai', 'gemini'])
export type EmbeddingProvider = z.infer<typeof embeddingProvider>

export const projectEmbeddingSettingsRequest = z.object({
  mode: z.enum(['global', 'custom']),
  provider: embeddingProvider.default('local'),
  model: z.string().trim().max(300).default(''),
  dimensions: z.number().int().min(1).max(4096).default(1024),
  base_url: z.string().trim().max(500).default(''),
  key: z.string().max(2000).default(''),
  reset_data: z.boolean().default(false),
}).strict()
export type ProjectEmbeddingSettingsRequest = z.infer<typeof projectEmbeddingSettingsRequest>

export const proposalCreateRequest = z.object({
  project_id: projectSlug,
  kind: z.enum(['experiment_plan', 'experiment_rerun', 'code_patch', 'config_change', 'idea_revision', 'data_change', 'dependency_install', 'delete_artifact', 'memory_revoke', 'external_publish', 'diagnostic_suggestion', 'related_work_recursive', 'related_work_field_enrichment', 'repository_download', 'repository_dependency_install', 'repository_reproduction_run', 'repository_artifact_write']),
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
  project_id: projectSlug,
  proposal_id: uuid,
  experiment_type: experimentTypes,
  execution_backend: z.literal('linux').default('linux'),
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
export const policyRequest = z.object({ project_id: projectSlug, rule: z.string().min(5).max(2000), rationale: z.string().max(2000).nullable().optional() }).strict()
export const reportRequest = z.object({ project_id: projectSlug, period: z.enum(['daily', 'weekly', 'manual']).default('manual'), notify: z.boolean().default(false) }).strict()
export const humanFeedbackRequest = z.object({
  session_id: uuid.nullable().optional(),
  category: z.enum(['idea', 'report', 'experiment', 'memory', 'general']),
  instruction: z.string().trim().min(1).max(8_000),
  reference_id: uuid.nullable().optional(),
}).strict()
export const humanFeedbackDecisionRequest = z.object({
  decision: z.enum(['acknowledged', 'rejected', 'revision_requested']),
  actor: z.string().trim().min(1).max(200).default('local-user'),
  comment: z.string().max(4000).nullable().optional(),
}).strict()
export const feedbackProposalRequest = z.object({
  kind: z.enum(['idea_revision', 'experiment_plan', 'related_work_recursive', 'code_patch', 'config_change', 'diagnostic_suggestion']),
  summary: z.string().trim().min(5).max(500),
  reason: z.string().trim().min(5).max(2000),
  diff: z.string().max(100_000).nullable().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
  estimated_cost_usd: z.number().min(0).default(0),
}).strict().superRefine((value, context) => {
  if (['code_patch', 'config_change'].includes(value.kind) && !value.diff) {
    context.addIssue({ code: 'custom', path: ['diff'], message: '代码或配置 Proposal 必须提供明确 diff。' })
  }
})
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
export const repositoryDependencyPlanRequest = z.object({
  dependency_manifest: z.string().trim().min(1).max(300),
  reason: z.string().trim().min(5).max(2000),
}).strict()
const reproductionConfigValue = z.union([
  z.string().max(4000),
  z.number().finite(),
  z.boolean(),
  z.array(z.union([z.string().max(4000), z.number().finite(), z.boolean()])).max(100),
])
export const repositoryReproductionRunRequest = z.object({
  entrypoint: z.string().trim().min(1).max(300),
  random_seeds: z.array(z.number().int().min(-1_000_000).max(1_000_000)).min(1).max(10),
  config: z.record(z.string().max(120), reproductionConfigValue).default({}),
  timeout_seconds: z.number().int().min(1).max(86_400).default(3_600),
  reason: z.string().trim().min(5).max(2000),
}).strict().superRefine((value, context) => {
  const forbiddenKeys = new Set(['command', 'cmd', 'shell', 'cwd', 'path', 'url', 'image', 'network', 'environment', 'env', 'executable', 'interpreter'])
  for (const key of Object.keys(value.config)) {
    if (forbiddenKeys.has(key.toLowerCase())) context.addIssue({ code: 'custom', path: ['config', key], message: '任意执行、路径或网络字段不允许进入复现计划。' })
  }
  if (new Set(value.random_seeds).size !== value.random_seeds.length) context.addIssue({ code: 'custom', path: ['random_seeds'], message: '复现 seed 必须互不重复。' })
})
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
