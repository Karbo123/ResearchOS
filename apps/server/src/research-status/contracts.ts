import { z } from 'zod'

const uuid = z.string().uuid()

export const researchStatusCodeAvailability = z.enum([
  'official_repository',
  'partial',
  'not_found',
  'unresolved',
])
export type ResearchStatusCodeAvailability = z.infer<typeof researchStatusCodeAvailability>

export const researchStatusMatrixRowRequest = z.object({
  paper_id: uuid,
  theme: z.string().trim().max(500).nullable().default(null),
  method: z.string().trim().max(1_000).nullable().default(null),
  year: z.number().int().min(0).max(3_000).nullable().default(null),
  datasets: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  metrics: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  limitations: z.string().trim().max(4_000).nullable().default(null),
  code_availability: researchStatusCodeAvailability.default('unresolved'),
  evidence_ids: z.array(uuid).min(1).max(50),
  claim_review_ids: z.array(uuid).min(1).max(50),
}).strict()
export type ResearchStatusMatrixRowRequest = z.infer<typeof researchStatusMatrixRowRequest>

export const researchStatusMatrixCreateRequest = z.object({
  rows: z.array(researchStatusMatrixRowRequest).min(1).max(500),
  idea_version: z.number().int().positive().nullable().optional(),
  actor: z.string().trim().min(1).max(200).default('local-user'),
}).strict()
export type ResearchStatusMatrixCreateRequest = z.infer<typeof researchStatusMatrixCreateRequest>

export const researchStatusFilterRequest = z.object({
  matrix_id: uuid.nullable().optional(),
  theme: z.string().trim().max(500).nullable().optional(),
  method: z.string().trim().max(1_000).nullable().optional(),
  year: z.coerce.number().int().min(0).max(3_000).nullable().optional(),
}).strict()
export type ResearchStatusFilterRequest = z.infer<typeof researchStatusFilterRequest>

export const researchStatusGapCandidateRequest = z.object({
  matrix_id: uuid,
  candidate_type: z.enum([
    'gap',
    'cluster',
    'duplicate_risk',
    'innovation',
    'boundary',
    'counterexample',
    'open_question',
  ]),
  statement: z.string().trim().min(5).max(4_000),
  row_ids: z.array(uuid).min(1).max(100),
  idea_version: z.number().int().positive().nullable().optional(),
  actor: z.string().trim().min(1).max(200).default('local-user'),
}).strict()
export type ResearchStatusGapCandidateRequest = z.infer<typeof researchStatusGapCandidateRequest>

export const researchStatusGapDecisionRequest = z.object({
  decision: z.enum(['accepted', 'rejected', 'reopened']),
  reason: z.string().trim().min(3).max(2_000),
  actor: z.string().trim().min(1).max(200).default('local-user'),
}).strict()
export type ResearchStatusGapDecisionRequest = z.infer<typeof researchStatusGapDecisionRequest>

export const researchStatusExportFormat = z.enum(['json', 'csv', 'markdown'])
export type ResearchStatusExportFormat = z.infer<typeof researchStatusExportFormat>
