import { z } from 'zod'

const uuid = z.string().uuid()

export const comparisonMetricDirection = z.enum(['higher_is_better', 'lower_is_better', 'unknown'])
export type ComparisonMetricDirection = z.infer<typeof comparisonMetricDirection>

export const comparisonMetricInput = z.object({
  value: z.number().finite(),
  evidence_ids: z.array(uuid).min(1).max(30),
  direction: comparisonMetricDirection.default('unknown'),
  definition: z.string().trim().min(1).max(2_000).nullable().default(null),
}).strict()
export type ComparisonMetricInput = z.infer<typeof comparisonMetricInput>

export const comparisonContext = z.object({
  data_version: z.string().trim().min(1).max(500).nullable().default(null),
  datasets: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  config_fingerprint: z.string().regex(/^[0-9a-f]{64}$/).nullable().default(null),
  seeds: z.array(z.number().int().min(-1_000_000).max(1_000_000)).max(100).nullable().default(null),
  metric_definitions: z.record(z.string().trim().min(1).max(120), z.string().trim().min(1).max(2_000)).default({}),
}).strict()
export type ComparisonContext = z.infer<typeof comparisonContext>

export const researchComparisonRequest = z.object({
  paper_id: uuid,
  reproduction_run_id: uuid,
  evidence_ids: z.array(uuid).min(1).max(30),
  paper_metrics: z.record(z.string().regex(/^[A-Za-z0-9_.-]{1,120}$/), comparisonMetricInput).refine(value => Object.keys(value).length >= 1 && Object.keys(value).length <= 100, '论文指标至少需要一项且不能超过 100 项'),
  paper_context: comparisonContext,
  reason: z.string().trim().min(5).max(2_000),
  actor: z.string().trim().min(1).max(200).default('local-user'),
}).strict()
export type ResearchComparisonRequest = z.infer<typeof researchComparisonRequest>

export const comparisonCandidateType = z.enum([
  'innovation',
  'research_gap',
  'counterexample',
  'difference',
  'comparability_gap',
  'potential_improvement',
  'potential_regression',
])
export type ComparisonCandidateType = z.infer<typeof comparisonCandidateType>

export const comparisonCandidateCreateRequest = z.object({
  candidate_type: comparisonCandidateType,
  statement: z.string().trim().min(5).max(4_000),
  reason: z.string().trim().min(5).max(2_000),
  actor: z.string().trim().min(1).max(200).default('local-user'),
}).strict()
export type ComparisonCandidateCreateRequest = z.infer<typeof comparisonCandidateCreateRequest>

export const comparisonCandidateDecisionRequest = z.object({
  decision: z.enum(['accepted', 'rejected', 'reopened']),
  reason: z.string().trim().min(3).max(2_000),
  actor: z.string().trim().min(1).max(200).default('local-user'),
}).strict()
export type ComparisonCandidateDecisionRequest = z.infer<typeof comparisonCandidateDecisionRequest>
