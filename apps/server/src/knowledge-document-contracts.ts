import { z } from 'zod'

export const KNOWLEDGE_DOCUMENT_SCHEMA = 'researchos/knowledge-document@1' as const
export const KNOWLEDGE_DOCUMENT_PARSER_VERSION = 'memory-v2-markdown-ast@1' as const

export const knowledgeDocumentKind = z.enum([
  'idea',
  'decision',
  'paper_summary',
  'related_work_synthesis',
  'benchmark_protocol',
  'experiment_plan',
  'run_result',
  'experiment_synthesis',
  'writing_outline',
  'claim_map',
  'writing_brief',
  'report',
])
export type KnowledgeDocumentKind = z.infer<typeof knowledgeDocumentKind>

export const knowledgeAuthorStatus = z.enum(['draft', 'reviewed', 'confirmed', 'superseded', 'archived'])
export type KnowledgeAuthorStatus = z.infer<typeof knowledgeAuthorStatus>

export const knowledgeSystemHealth = z.enum(['current', 'stale', 'blocked', 'indexing', 'index_stale', 'index_failed'])
export type KnowledgeSystemHealth = z.infer<typeof knowledgeSystemHealth>

export const knowledgeImpactPolicy = z.enum(['notify', 'review_required', 'regenerate_required', 'evidence_blocked', 'rerun_required'])
export type KnowledgeImpactPolicy = z.infer<typeof knowledgeImpactPolicy>

export const knowledgeReadScope = z.enum(['metadata', 'abstract', 'partial', 'full_text'])
export const knowledgeExperimentTrack = z.enum(['reproductions', 'method'])
export const knowledgeWritingSection = z.enum(['introduction', 'related-work', 'method', 'experiments', 'conclusion'])
const knowledgeDocumentKey = z.string().trim().min(2).max(80).regex(/^[a-z0-9][a-z0-9._-]*$/, 'document key must be lowercase and URL safe')

const uuid = z.string().uuid()
const entityId = z.string().trim().min(1).max(255).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/, 'entity reference contains unsupported characters')
const workspaceScope = z.string().trim().min(3).max(129).regex(/^[a-z][a-z0-9_-]{0,63}:[a-z][a-z0-9_-]{0,63}$/, 'workspace scope must be area:tab')

export const knowledgeDocumentId = z.string().trim().min(3).max(192).superRefine((value, context) => {
  if (!/^[a-z][a-z0-9_-]{0,31}:[a-z0-9][a-z0-9._/-]{0,159}$/.test(value)) {
    context.addIssue({ code: 'custom', message: 'knowledge document id must be a readable namespace:value identifier' })
  }
  if (value.includes('..') || value.endsWith('/') || value.includes('//')) {
    context.addIssue({ code: 'custom', message: 'knowledge document id contains an unsafe path segment' })
  }
  if (/(?:^|[:/])[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:$|[/])/i.test(value)) {
    context.addIssue({ code: 'custom', message: 'knowledge document id must not expose a UUID' })
  }
})

export const knowledgeDependency = z.object({
  id: entityId,
  relation: z.string().trim().min(1).max(120).regex(/^[a-z][a-z0-9_-]*$/, 'dependency relation must be a stable lowercase identifier'),
  impact: knowledgeImpactPolicy,
}).strict()

export const knowledgeDocumentFrontMatter = z.object({
  schema: z.literal(KNOWLEDGE_DOCUMENT_SCHEMA),
  project_id: z.string().regex(/^[a-z]{2,32}-[a-z]{2,32}-[a-z0-9]{4}$/),
  id: knowledgeDocumentId,
  kind: knowledgeDocumentKind,
  title: z.string().trim().min(1).max(300),
  status: knowledgeAuthorStatus,
  depends_on: z.array(knowledgeDependency).max(200).default([]),
  workspace_scopes: z.array(workspaceScope).max(40).default([]),
  paper_id: uuid.optional(),
  experiment_id: uuid.optional(),
  run_id: entityId.optional(),
  artifact_ids: z.array(uuid).max(200).default([]),
  evidence_ids: z.array(uuid).max(200).default([]),
  read_scope: knowledgeReadScope.optional(),
}).strict()
export type KnowledgeDocumentFrontMatter = z.infer<typeof knowledgeDocumentFrontMatter>

const proposalInstruction = z.string().trim().min(5).max(12_000)
const optionalInstruction = z.string().trim().min(5).max(12_000).optional()

export const knowledgeDocumentProposalRequest = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('idea'),
    instruction: proposalInstruction,
    session_id: uuid.optional(),
  }).strict(),
  z.object({
    kind: z.literal('paper_summary'),
    paper_id: uuid,
    read_scope: knowledgeReadScope,
    instruction: optionalInstruction,
  }).strict(),
  z.object({
    kind: z.literal('related_work_synthesis'),
    paper_ids: z.array(uuid).max(100).default([]),
    instruction: optionalInstruction,
  }).strict(),
  z.object({
    kind: z.literal('experiment_plan'),
    experiment_id: uuid,
    track: knowledgeExperimentTrack,
    document_key: knowledgeDocumentKey.optional(),
    instruction: optionalInstruction,
  }).strict(),
  z.object({
    kind: z.literal('run_result'),
    experiment_id: uuid,
    track: knowledgeExperimentTrack,
    document_key: knowledgeDocumentKey.optional(),
    instruction: optionalInstruction,
  }).strict(),
  z.object({
    kind: z.literal('experiment_synthesis'),
    experiment_id: uuid,
    related_experiment_ids: z.array(uuid).max(100).default([]),
    track: knowledgeExperimentTrack,
    document_key: knowledgeDocumentKey.optional(),
    instruction: optionalInstruction,
  }).strict(),
  z.object({
    kind: z.literal('writing_brief'),
    section: knowledgeWritingSection,
    instruction: optionalInstruction,
  }).strict(),
])
export type KnowledgeDocumentProposalRequest = z.infer<typeof knowledgeDocumentProposalRequest>

export const knowledgeDocumentManualProposalRequest = z.object({
  document_id: knowledgeDocumentId,
  expected_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  source: z.string().min(1).max(512 * 1024),
  reason: z.string().trim().min(5).max(2_000),
}).strict()
export type KnowledgeDocumentManualProposalRequest = z.infer<typeof knowledgeDocumentManualProposalRequest>

const exactPaths: Partial<Record<KnowledgeDocumentKind, ReadonlySet<string>>> = {
  idea: new Set(['research/idea/current.md']),
  related_work_synthesis: new Set(['research/related-work/synthesis.md']),
  benchmark_protocol: new Set(['research/experiments/benchmark-protocol.md']),
  writing_outline: new Set(['research/writing/outline.md']),
  claim_map: new Set(['research/writing/claim-map.md']),
}

const pathPatterns: Partial<Record<KnowledgeDocumentKind, RegExp[]>> = {
  decision: [/^research\/idea\/decisions\/[a-z0-9][a-z0-9._-]*\.md$/],
  paper_summary: [/^research\/related-work\/papers\/[a-z0-9][a-z0-9._-]*\.md$/],
  experiment_plan: [/^research\/experiments\/(?:reproductions|method)\/[a-z0-9][a-z0-9._-]*\/plan\.md$/],
  run_result: [/^research\/experiments\/(?:reproductions|method)\/[a-z0-9][a-z0-9._-]*\/runs\/[a-z0-9][a-z0-9._-]*\/result\.md$/],
  experiment_synthesis: [/^research\/experiments\/(?:reproductions|method)\/[a-z0-9][a-z0-9._-]*\/synthesis\.md$/],
  writing_brief: [/^research\/writing\/section-briefs\/(?:introduction|related-work|method|experiments|conclusion)\.md$/],
  report: [/^research\/reports\/[a-z0-9][a-z0-9._-]*\.md$/],
}

export function canonicalKnowledgePath(relativePath: string): string {
  if (!relativePath || relativePath.includes('\\') || relativePath.startsWith('/') || relativePath.endsWith('/')) throw new Error('knowledge_path_invalid')
  const parts = relativePath.split('/')
  if (parts.some(part => !part || part === '.' || part === '..' || part.startsWith('.'))) throw new Error('knowledge_path_invalid')
  if (parts[0] !== 'research' || !relativePath.endsWith('.md')) throw new Error('knowledge_path_not_allowed')
  return relativePath
}

export function assertKnowledgePathForKind(relativePath: string, kind: KnowledgeDocumentKind): string {
  const canonical = canonicalKnowledgePath(relativePath)
  if (exactPaths[kind]?.has(canonical)) return canonical
  if (pathPatterns[kind]?.some(pattern => pattern.test(canonical))) return canonical
  throw new Error('knowledge_path_kind_mismatch')
}

const generatedKnowledgeDocumentJsonSchema = z.toJSONSchema(knowledgeDocumentFrontMatter) as {
  $schema?: string
  type?: string
  properties?: Record<string, unknown>
  [key: string]: unknown
}

export const knowledgeDocumentFrontMatterJsonSchema = {
  ...generatedKnowledgeDocumentJsonSchema,
  $id: 'https://research-os.local/schemas/knowledge-document-front-matter.schema.json',
  properties: {
    ...generatedKnowledgeDocumentJsonSchema.properties,
    id: {
      ...(generatedKnowledgeDocumentJsonSchema.properties?.id as Record<string, unknown> | undefined),
      pattern: '^[a-z][a-z0-9_-]{0,31}:[a-z0-9][a-z0-9._/-]{0,159}$',
    },
  },
}
