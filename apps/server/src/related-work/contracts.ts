import { z } from 'zod'

export const relatedWorkProvider = z.enum([
  'crossref',
  'openalex',
  'semantic_scholar',
  'dblp',
  'arxiv',
  'unpaywall',
])
export type RelatedWorkProvider = z.infer<typeof relatedWorkProvider>

export const relatedWorkFieldSourceType = z.enum(['provider', 'user_input', 'controlled_artifact'])
export type RelatedWorkFieldSourceType = z.infer<typeof relatedWorkFieldSourceType>

export const paperAuthor = z.object({
  name: z.string().trim().min(1).max(300),
  orcid: z.string().url().max(500).nullable().default(null),
  affiliations: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  email: z.string().email().max(500).nullable().default(null),
  is_corresponding: z.boolean().nullable().default(null),
  scholar_id: z.string().trim().max(300).nullable().default(null),
  interests: z.array(z.string().trim().min(1).max(300)).max(50).default([]),
  citation_stats: z.record(z.string(), z.unknown()).nullable().default(null),
}).strict()

export const paperLicense = z.object({
  spdx: z.string().trim().max(100).nullable().default(null),
  url: z.string().url().max(2000).nullable().default(null),
  terms_url: z.string().url().max(2000).nullable().default(null),
}).strict()

export const paperCandidate = z.object({
  provider: relatedWorkProvider,
  stable_id: z.string().trim().min(1).max(500),
  title: z.string().trim().min(1).max(2_000),
  authors: z.array(paperAuthor).max(300).default([]),
  year: z.number().int().min(0).max(3_000).nullable().default(null),
  venue: z.string().trim().max(1_000).nullable().default(null),
  doi: z.string().trim().max(500).nullable().default(null),
  abstract: z.string().max(100_000).nullable().default(null),
  pdf_url: z.string().url().max(2_000).nullable().default(null),
  html_url: z.string().url().max(2_000).nullable().default(null),
  license: paperLicense.nullable().default(null),
  citation_count: z.number().int().min(0).nullable().default(null),
  open_access: z.boolean().nullable().default(null),
  source_url: z.string().url().max(2_000),
  query: z.string().trim().min(1).max(2_000),
  retrieved_at: z.string().datetime({ offset: true }),
}).strict()
export type PaperCandidate = z.infer<typeof paperCandidate>

export const sourceFailure = z.object({
  code: z.enum([
    'request_failed',
    'http_error',
    'rate_limited',
    'timed_out',
    'invalid_response',
    'unsupported',
    'cancelled',
  ]),
  message: z.string().trim().min(1).max(2_000),
  retryable: z.boolean(),
  http_status: z.number().int().min(100).max(599).nullable().default(null),
}).strict()
export type SourceFailure = z.infer<typeof sourceFailure>

export const sourceAttempt = z.object({
  provider: relatedWorkProvider,
  query: z.string().trim().min(1).max(2_000),
  request_url: z.string().url().max(2_000),
  started_at: z.string().datetime({ offset: true }),
  finished_at: z.string().datetime({ offset: true }),
  status: z.enum(['succeeded', 'partial', 'failed', 'rate_limited', 'timed_out', 'invalid_response', 'unsupported', 'cancelled']),
  http_status: z.number().int().min(100).max(599).nullable().default(null),
  result_count: z.number().int().min(0).default(0),
  failure: sourceFailure.nullable().default(null),
}).strict()
export type SourceAttempt = z.infer<typeof sourceAttempt>

export const sourceSearchResult = z.object({
  provider: relatedWorkProvider,
  query: z.string().trim().min(1).max(2_000),
  candidates: z.array(paperCandidate).max(200),
  attempt: sourceAttempt,
}).strict()
export type SourceSearchResult = z.infer<typeof sourceSearchResult>

export const citationEdge = z.object({
  provider: relatedWorkProvider,
  source_stable_id: z.string().trim().min(1).max(500),
  target_stable_id: z.string().trim().min(1).max(500),
  relation: z.literal('references'),
  retrieved_at: z.string().datetime({ offset: true }),
  ranking_score: z.number().finite().nullable().default(null),
  ranking_reasons: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
}).strict()
export type CitationEdge = z.infer<typeof citationEdge>

export type SourceSearchOptions = {
  limit: number
  timeout_ms?: number
  signal?: AbortSignal
  user_agent?: string
}

export interface SearchSourceAdapter {
  readonly provider: RelatedWorkProvider
  search(query: string, options: SourceSearchOptions): Promise<SourceSearchResult>
}

export type ReferenceSearchResult = {
  provider: RelatedWorkProvider
  source: PaperCandidate
  candidates: PaperCandidate[]
  ranked_references?: Array<{
    paper: PaperCandidate
    ranking_score?: number | null
    ranking_reasons?: string[]
  }>
  edges: CitationEdge[]
  attempt: SourceAttempt
  attempts?: SourceAttempt[]
}

export interface CitationSourceAdapter extends SearchSourceAdapter {
  fetchReferences(paper: PaperCandidate, options: SourceSearchOptions): Promise<ReferenceSearchResult>
}

export function normalizeDoi(value: string | null | undefined): string | null {
  if (!value) return null
  const normalized = value.trim().replace(/^https?:\/\/doi\.org\//i, '').replace(/^doi:\s*/i, '').trim().toLowerCase()
  return normalized || null
}

export function normalizeTitle(value: string | null | undefined): string {
  return (value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function stablePaperId(provider: RelatedWorkProvider, value: string | null | undefined, title: string): string {
  const id = value?.trim()
  if (id) return `${provider}:${id}`
  const normalized = normalizeTitle(title).replace(/\s/g, '').slice(0, 160)
  return `${provider}:title:${normalized || 'unknown'}`
}

const relatedWorkUuid = z.string().uuid()
const doiInput = z.string().trim().min(7).max(500).refine(value => /^10\.\d{4,9}\/\S+$/i.test(normalizeDoi(value) || ''), 'DOI 格式无效')
const sourceUrl = z.string().trim().url().max(2_000).refine(value => new URL(value).protocol === 'https:', '来源 URL 必须使用 HTTPS')
const seedYear = z.number().int().min(0).max(3_000).nullable().optional()
const seedProviders = { providers: z.array(relatedWorkProvider).min(1).max(5).default(['crossref', 'openalex', 'semantic_scholar', 'dblp', 'arxiv']) }

const seedMetadataFields = {
  doi: doiInput.optional(),
  title: z.string().trim().min(1).max(2_000).optional(),
  year: seedYear,
  url: sourceUrl.optional(),
  bibtex: z.string().trim().min(20).max(100_000).optional(),
  ...seedProviders,
}

export const relatedWorkSeedRequest = z.discriminatedUnion('source_type', [
  z.object({ source_type: z.literal('doi'), doi: doiInput, title: seedMetadataFields.title, year: seedYear, url: seedMetadataFields.url, bibtex: seedMetadataFields.bibtex, ...seedProviders }).strict(),
  z.object({ source_type: z.literal('title'), title: z.string().trim().min(1).max(2_000), doi: seedMetadataFields.doi, year: seedYear, url: seedMetadataFields.url, bibtex: seedMetadataFields.bibtex, ...seedProviders }).strict(),
  z.object({ source_type: z.literal('url'), url: sourceUrl, doi: seedMetadataFields.doi, title: seedMetadataFields.title, year: seedYear, bibtex: seedMetadataFields.bibtex, ...seedProviders }).strict(),
  z.object({ source_type: z.literal('bibtex'), bibtex: z.string().trim().min(20).max(100_000), doi: seedMetadataFields.doi, title: seedMetadataFields.title, year: seedYear, url: seedMetadataFields.url, ...seedProviders }).strict(),
  z.object({ source_type: z.literal('artifact_pdf'), artifact_id: relatedWorkUuid, doi: seedMetadataFields.doi, title: seedMetadataFields.title, year: seedYear, ...seedProviders }).strict().superRefine((value, context) => {
    if (!value.doi && !value.title) context.addIssue({ code: 'custom', path: ['title'], message: 'PDF 种子必须提供 DOI 或标题用于元数据解析' })
  }),
  z.object({ source_type: z.literal('existing_paper'), paper_id: relatedWorkUuid, ...seedProviders }).strict(),
])
export type RelatedWorkSeedRequest = z.infer<typeof relatedWorkSeedRequest>

export const relatedWorkRecursivePlanRequest = z.object({
  seed_ids: z.array(relatedWorkUuid).min(1).max(100),
  depth: z.number().int().min(1).max(5),
  width: z.number().int().min(1).max(50),
  max_total: z.number().int().min(1).max(500),
  providers: z.array(relatedWorkProvider).min(1).max(5).default(['crossref', 'openalex', 'semantic_scholar']),
  reason: z.string().trim().min(5).max(2_000),
}).strict().superRefine((value, context) => {
  if (value.max_total < value.seed_ids.length) context.addIssue({ code: 'custom', path: ['max_total'], message: 'max_total 不能小于种子数量' })
})
export type RelatedWorkRecursivePlanRequest = z.infer<typeof relatedWorkRecursivePlanRequest>

export const relatedWorkFieldName = z.enum([
  'title',
  'authors',
  'abstract',
  'venue',
  'doi',
  'year',
  'institutions',
  'pdf_url',
  'bibtex',
])
export type RelatedWorkFieldName = z.infer<typeof relatedWorkFieldName>

export const relatedWorkCandidateDecisionRequest = z.object({
  decision: z.enum(['approved', 'rejected', 'reopened']),
  reason: z.string().trim().min(3).max(2_000),
  actor: z.string().trim().min(1).max(200).default('local-user'),
}).strict()
export type RelatedWorkCandidateDecisionRequest = z.infer<typeof relatedWorkCandidateDecisionRequest>

export const relatedWorkFieldSelectionRequest = z.object({
  provenance_id: z.string().uuid(),
  actor: z.string().trim().min(1).max(200).default('local-user'),
}).strict()
export type RelatedWorkFieldSelectionRequest = z.infer<typeof relatedWorkFieldSelectionRequest>

export const relatedWorkEnrichmentRequest = z.object({
  candidate_id: z.string().uuid(),
  fields: z.array(relatedWorkFieldName).min(1).max(9),
  providers: z.array(relatedWorkProvider).min(1).max(6).default(['crossref', 'openalex', 'semantic_scholar', 'dblp', 'arxiv', 'unpaywall']),
  max_rounds: z.number().int().min(1).max(6).default(3),
  reason: z.string().trim().min(5).max(2_000),
}).strict()
export type RelatedWorkEnrichmentRequest = z.infer<typeof relatedWorkEnrichmentRequest>

export const relatedWorkRunCancelRequest = z.object({
  reason: z.string().trim().min(3).max(2_000),
  actor: z.string().trim().min(1).max(200).default('local-user'),
}).strict()

export const relatedWorkRunExecuteRequest = z.object({
  actor: z.string().trim().min(1).max(200).default('local-user'),
}).strict()
