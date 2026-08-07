import { z } from 'zod'
import { knowledgeDocumentId } from './knowledge-document-contracts.js'

export const contextPurpose = z.enum(['project_chat', 'overview', 'idea', 'literature', 'reproduction', 'method_experiment', 'paper_section'])
export type ContextPurpose = z.infer<typeof contextPurpose>

export const contextStatus = z.enum(['complete', 'partial', 'blocked', 'empty'])
export type ContextStatus = z.infer<typeof contextStatus>

export const contextSearchMode = z.enum(['none', 'bm25', 'semantic', 'hybrid'])
export type ContextSearchMode = z.infer<typeof contextSearchMode>

export const contextPlan = z.object({
  project_id: z.string().regex(/^[a-z]{2,32}-[a-z]{2,32}-[a-z0-9]{4}$/),
  purpose: contextPurpose,
  workspace_scope: z.string().trim().min(1).max(129),
  query: z.string().max(2000),
  requested_document_ids: z.array(knowledgeDocumentId).max(40).default([]),
  direct_document_ids: z.array(knowledgeDocumentId).max(40).default([]),
  search_mode: contextSearchMode.default('hybrid'),
  max_documents: z.number().int().min(0).max(30),
  token_budget: z.number().int().min(256).max(32_000),
  output_reserve: z.number().int().min(0).max(16_000),
}).strict()
export type ContextPlan = z.infer<typeof contextPlan>

export const contextProvenance = z.object({
  source: z.enum(['knowledge_document', 'conversation_message', 'structured_state']),
  document_id: knowledgeDocumentId.nullable().default(null),
  entity_id: z.string().trim().max(255).nullable().default(null),
  entity_type: z.string().trim().max(80).nullable().default(null),
  document_sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable().default(null),
  locator: z.string().max(500),
  line_start: z.number().int().positive().nullable().default(null),
  line_end: z.number().int().positive().nullable().default(null),
  author_status: z.string().max(30).nullable().default(null),
  system_health: z.string().max(30).nullable().default(null),
  evidence_level: z.string().max(120),
}).strict()
export type ContextProvenance = z.infer<typeof contextProvenance>

export const contextBlock = z.object({
  block_id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,95}$/),
  kind: z.enum(['document', 'section', 'retrieval', 'conversation', 'decision', 'state']),
  content: z.string().min(1).max(120_000),
  token_count: z.number().int().positive(),
  reason: z.string().trim().min(1).max(240),
  provenance: contextProvenance,
}).strict()
export type ContextBlock = z.infer<typeof contextBlock>

export const contextExcluded = z.object({
  kind: z.string().trim().min(1).max(80),
  id: z.string().trim().max(255).default(''),
  reason: z.string().trim().min(1).max(500),
}).strict()

export const contextPacket = z.object({
  id: z.string().uuid(),
  project_id: z.string().regex(/^[a-z]{2,32}-[a-z]{2,32}-[a-z0-9]{4}$/),
  status: contextStatus,
  plan: contextPlan,
  blocks: z.array(contextBlock).max(100),
  excluded: z.array(contextExcluded).max(200),
  included_tokens: z.number().int().min(0),
  search: z.object({
    mode: contextSearchMode,
    attempted: z.boolean(),
    result_count: z.number().int().min(0),
    local_result_count: z.number().int().min(0),
    filtered_stale_results: z.number().int().min(0),
    blocked_code: z.string().max(120).nullable(),
  }).strict(),
  manifest_id: z.string().uuid(),
}).strict()
export type ContextPacket = z.infer<typeof contextPacket>
