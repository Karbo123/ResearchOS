import { encode } from 'gpt-tokenizer'
import { contextPacket, contextPlan, type ContextBlock, type ContextPacket, type ContextPlan, type ContextPurpose, type ContextSearchMode } from './context-planner-contracts.js'
import { audit, database, one, rows } from './database.js'
import { IndexingError, searchActiveKnowledge } from './indexing-service.js'
import { knowledgeDocumentId } from './knowledge-document-contracts.js'
import { listKnowledgeDocuments, readRegisteredKnowledgeDocument, type KnowledgeDocumentRow } from './knowledge-document-service.js'

export class ContextPlannerError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: 404 | 409 | 422 | 503 = 422) {
    super(message)
  }
}

type Recipe = {
  purpose: ContextPurpose
  directKinds: string[]
  searchKinds: string[]
  maxDocuments: number
  tokenBudget: number
  outputReserve: number
}

const recipeTable: Record<string, Omit<Recipe, 'purpose'>> = {
  'overview/overview': { directKinds: ['idea', 'related_work_synthesis', 'experiment_synthesis'], searchKinds: ['paper_summary', 'run_result'], maxDocuments: 8, tokenBudget: 6_000, outputReserve: 1_500 },
  'overview/idea': { directKinds: ['idea', 'decision'], searchKinds: ['paper_summary', 'related_work_synthesis'], maxDocuments: 8, tokenBudget: 6_000, outputReserve: 1_500 },
  'overview/approvals': { directKinds: ['idea', 'decision', 'experiment_plan'], searchKinds: ['writing_brief'], maxDocuments: 8, tokenBudget: 5_000, outputReserve: 1_200 },
  'overview/reports': { directKinds: ['idea', 'report'], searchKinds: ['experiment_synthesis', 'run_result'], maxDocuments: 8, tokenBudget: 5_000, outputReserve: 1_200 },
  'related_work/literature': { directKinds: ['idea', 'related_work_synthesis'], searchKinds: ['paper_summary', 'writing_brief'], maxDocuments: 12, tokenBudget: 8_000, outputReserve: 1_800 },
  'related_work/visualization': { directKinds: ['idea', 'related_work_synthesis'], searchKinds: ['paper_summary'], maxDocuments: 10, tokenBudget: 6_000, outputReserve: 1_500 },
  'related_work/seed_expansion': { directKinds: ['idea', 'related_work_synthesis'], searchKinds: ['paper_summary'], maxDocuments: 10, tokenBudget: 6_000, outputReserve: 1_500 },
  'implementation/method': { directKinds: ['idea', 'benchmark_protocol'], searchKinds: ['experiment_plan', 'experiment_synthesis', 'paper_summary'], maxDocuments: 10, tokenBudget: 8_000, outputReserve: 1_800 },
  'implementation/reproduction': { directKinds: ['idea', 'benchmark_protocol'], searchKinds: ['paper_summary', 'experiment_plan', 'run_result'], maxDocuments: 10, tokenBudget: 8_000, outputReserve: 1_800 },
  'paper/introduction': { directKinds: ['idea', 'writing_outline', 'claim_map'], searchKinds: ['related_work_synthesis', 'paper_summary', 'writing_brief'], maxDocuments: 10, tokenBudget: 8_000, outputReserve: 1_800 },
  'paper/paper_related_work': { directKinds: ['idea', 'claim_map'], searchKinds: ['related_work_synthesis', 'paper_summary', 'writing_brief'], maxDocuments: 12, tokenBudget: 9_000, outputReserve: 2_000 },
  'paper/paper_method': { directKinds: ['idea', 'benchmark_protocol', 'claim_map'], searchKinds: ['experiment_plan', 'writing_brief'], maxDocuments: 10, tokenBudget: 8_000, outputReserve: 1_800 },
  'paper/paper_experiments': { directKinds: ['benchmark_protocol', 'claim_map'], searchKinds: ['experiment_synthesis', 'run_result', 'writing_brief'], maxDocuments: 12, tokenBudget: 9_000, outputReserve: 2_000 },
  'paper/conclusion': { directKinds: ['idea', 'claim_map'], searchKinds: ['experiment_synthesis', 'writing_brief', 'related_work_synthesis'], maxDocuments: 10, tokenBudget: 7_000, outputReserve: 1_600 },
}

function scopeKey(area?: string, tab?: string): string {
  return area && tab ? `${area}/${tab}` : 'overview/overview'
}

function scopeMatches(row: KnowledgeDocumentRow, scope: string): boolean {
  if (scope === 'project') return true
  const scopes = Array.isArray(row.metadata?.workspace_scopes) ? row.metadata.workspace_scopes : []
  const normalize = (value: string) => value.replace('/', ':').replaceAll('_', '-')
  const normalizedScope = normalize(scope)
  return scopes.length === 0 || scopes.some(value => typeof value === 'string' && normalize(value) === normalizedScope)
}

function kindMatches(row: KnowledgeDocumentRow, kinds: string[]): boolean {
  return kinds.includes(row.kind)
}

export function recipeFor(area?: string, tab?: string, requestedPurpose: ContextPurpose = 'project_chat'): Recipe {
  const key = scopeKey(area, tab)
  return { purpose: requestedPurpose, ...(recipeTable[key] || recipeTable['overview/overview']!) }
}

function tokens(value: string): number {
  return encode(value).length
}

function inputBudget(plan: ContextPlan): number {
  return Math.max(0, plan.token_budget - plan.output_reserve)
}

function queryWords(query: string): string[] {
  const normalized = query.toLocaleLowerCase().trim()
  if (!normalized) return []
  const separated = normalized.split(/[^\p{L}\p{N}]+/u).filter(word => word.length > 1)
  return separated.length ? separated : [normalized]
}

function countTerm(content: string, word: string): number {
  let count = 0
  let offset = 0
  while (offset < content.length) {
    const index = content.indexOf(word, offset)
    if (index < 0) break
    count += 1
    offset = index + Math.max(1, word.length)
  }
  return count
}

function rankRow(row: KnowledgeDocumentRow, query: string): number {
  const metadataTitle = typeof row.metadata?.title === 'string' ? row.metadata.title.toLocaleLowerCase() : ''
  const words = queryWords(query)
  const titleScore = words.reduce((score, word) => score + (metadataTitle.includes(word) ? 5 : 0), 0)
  const pathScore = row.relative_path.includes('current') || row.relative_path.includes('synthesis') ? 3 : 0
  const healthScore = row.system_health === 'current' ? 2 : row.system_health === 'stale' ? 1 : 0
  return titleScore + pathScore + healthScore
}

function rankChunk(content: string, query: string, ordinal: number): number {
  const normalized = content.toLocaleLowerCase()
  const score = queryWords(query).reduce((total, word) => total + countTerm(normalized, word), 0)
  return score * 10 - ordinal / 10
}

function documentHeader(row: KnowledgeDocumentRow): string {
  return `# ${String(row.metadata?.title || row.document_id)}`
}

type Excluded = { kind: string; id?: string; reason: string }

async function addDocumentBlocks(
  row: KnowledgeDocumentRow,
  plan: ContextPlan,
  blocks: ContextBlock[],
  excluded: Excluded[],
  usedTokens: { value: number },
  reason: string,
  preferredChunkKeys: Set<string> = new Set(),
): Promise<void> {
  if (blocks.some(block => block.provenance.document_id === row.document_id)) return
  let loaded: ReturnType<typeof readRegisteredKnowledgeDocument>
  try {
    loaded = readRegisteredKnowledgeDocument(row)
  } catch (error) {
    excluded.push({ kind: 'document_read_blocked', id: row.document_id, reason: error instanceof Error ? error.message : 'document_read_failed' })
    return
  }
  const available = Math.max(0, inputBudget(plan) - usedTokens.value)
  const whole = `${documentHeader(row)}\n\n${loaded.parsed.body}`.trim()
  const wholeTokens = tokens(whole)
  if (wholeTokens > 0 && wholeTokens <= available) {
    blocks.push({
      block_id: `doc-${blocks.length}`,
      kind: reason === 'open decision' ? 'decision' : 'document',
      content: whole,
      token_count: wholeTokens,
      reason,
      provenance: { source: 'knowledge_document', document_id: row.document_id, entity_id: null, entity_type: null, document_sha256: row.current_sha256, locator: 'whole document', line_start: 1, line_end: whole.split('\n').length, author_status: row.author_status, system_health: row.system_health, evidence_level: 'editable_knowledge_source_not_raw_evidence' },
    })
    usedTokens.value += wholeTokens
    return
  }
  const candidateChunks = [...loaded.parsed.chunks].sort((left, right) => {
    const leftPreferred = preferredChunkKeys.has(left.chunk_key) ? 1 : 0
    const rightPreferred = preferredChunkKeys.has(right.chunk_key) ? 1 : 0
    return rightPreferred - leftPreferred || rankChunk(right.content, plan.query, right.ordinal) - rankChunk(left.content, plan.query, left.ordinal)
  })
  let added = 0
  for (const chunk of candidateChunks) {
    const chunkTokens = chunk.token_count
    if (chunkTokens <= 0 || chunkTokens > inputBudget(plan) - usedTokens.value) continue
    blocks.push({
      block_id: `section-${blocks.length}`,
      kind: preferredChunkKeys.size ? 'retrieval' : 'section',
      content: chunk.content,
      token_count: chunkTokens,
      reason,
      provenance: { source: 'knowledge_document', document_id: row.document_id, entity_id: null, entity_type: null, document_sha256: row.current_sha256, locator: `${chunk.heading_path.join(' > ') || 'document'} (lines ${chunk.line_start}-${chunk.line_end})`, line_start: chunk.line_start, line_end: chunk.line_end, author_status: row.author_status, system_health: row.system_health, evidence_level: 'editable_knowledge_source_not_raw_evidence' },
    })
    usedTokens.value += chunkTokens
    added += 1
    if (usedTokens.value >= inputBudget(plan)) break
  }
  if (!added) excluded.push({ kind: 'document_budget_excluded', id: row.document_id, reason: '文档或章节超过当前上下文预算。' })
  else if (added < loaded.parsed.chunks.length) excluded.push({ kind: 'document_section_selection', id: row.document_id, reason: `仅纳入 ${added}/${loaded.parsed.chunks.length} 个语义章节，以保留模型输出预算。` })
}

async function recentConversationBlocks(projectId: string, workspaceScope: string, sessionId: string | undefined, excludeTurnId: string | undefined, plan: ContextPlan, blocks: ContextBlock[], usedTokens: { value: number }): Promise<void> {
  const messageRows = sessionId
    ? await rows<{ id: string; role: string; content: string; created_at: string }>('SELECT m.id,m.role,m.content,m.created_at FROM messages m JOIN conversation_sessions s ON s.id=m.session_id WHERE m.session_id=$1 AND s.project_id=$2 AND s.scope=$3 AND ($4::uuid IS NULL OR m.turn_id IS NULL OR m.turn_id<>$4::uuid) ORDER BY m.created_at DESC,m.id DESC LIMIT 8', [sessionId, projectId, workspaceScope, excludeTurnId || null])
    : await rows<{ id: string; role: string; content: string; created_at: string }>(`SELECT m.id,m.role,m.content,m.created_at FROM messages m JOIN conversation_sessions s ON s.id=m.session_id WHERE s.project_id=$1 AND s.scope=$2 AND ($3::uuid IS NULL OR m.turn_id IS NULL OR m.turn_id<>$3::uuid) ORDER BY m.created_at DESC,m.id DESC LIMIT 8`, [projectId, workspaceScope, excludeTurnId || null])
  const content = messageRows.reverse().map(row => `${row.role}: ${row.content}`).join('\n\n')
  if (!content) return
  const max = Math.min(inputBudget(plan) - usedTokens.value, 1_200)
  if (max <= 0) return
  if (tokens(content) > max) {
    const messages = content.split('\n\n')
    let selected = ''
    for (const message of messages.reverse()) {
      const next = selected ? `${message}\n\n${selected}` : message
      if (tokens(next) > max) break
      selected = next
    }
    if (!selected) selected = messages[0]?.slice(-Math.max(100, max * 4)) || ''
    if (!selected) return
    const selectedTokens = tokens(selected)
    blocks.push({ block_id: `conversation-${blocks.length}`, kind: 'conversation', content: selected, token_count: selectedTokens, reason: '当前 workspace 的最近对话（按预算保留完整消息边界）', provenance: { source: 'conversation_message', document_id: null, entity_id: null, entity_type: null, document_sha256: null, locator: `workspace:${workspaceScope}`, line_start: null, line_end: null, author_status: null, system_health: null, evidence_level: 'conversation_working_memory_not_evidence' } })
    usedTokens.value += selectedTokens
    return
  }
  const contentTokens = tokens(content)
  blocks.push({ block_id: `conversation-${blocks.length}`, kind: 'conversation', content, token_count: contentTokens, reason: '当前 workspace 的最近对话', provenance: { source: 'conversation_message', document_id: null, entity_id: null, entity_type: null, document_sha256: null, locator: `workspace:${workspaceScope}`, line_start: null, line_end: null, author_status: null, system_health: null, evidence_level: 'conversation_working_memory_not_evidence' } })
  usedTokens.value += contentTokens
}

async function openDecisionBlocks(projectId: string, plan: ContextPlan, blocks: ContextBlock[], usedTokens: { value: number }): Promise<string[]> {
  const decisions = await rows<{ id: string; kind: string; summary: string; reason: string; status: string }>("SELECT id,kind,summary,reason,status FROM proposals WHERE project_id=$1 AND status='pending' ORDER BY created_at DESC,id DESC LIMIT 12", [projectId])
  const entityIds: string[] = []
  for (const decision of decisions) {
    const content = `待处理 Proposal：${decision.summary}\n原因：${decision.reason}\n类型：${decision.kind}\n状态：${decision.status}`
    const tokenCount = tokens(content)
    if (tokenCount > inputBudget(plan) - usedTokens.value) break
    blocks.push({ block_id: `decision-${blocks.length}`, kind: 'decision', content, token_count: tokenCount, reason: '当前项目的待审批决定', provenance: { source: 'structured_state', document_id: null, entity_id: decision.id, entity_type: 'proposal', document_sha256: null, locator: `proposal:${decision.id}`, line_start: null, line_end: null, author_status: 'pending', system_health: 'current', evidence_level: 'structured_project_state_not_scientific_evidence' } })
    usedTokens.value += tokenCount
    entityIds.push(decision.id)
  }
  return entityIds
}

type SearchCandidate = { id: string; metadata: Record<string, unknown>; score?: number }

async function localKnowledgeSearch(projectId: string, query: string, documents: KnowledgeDocumentRow[], limit: number): Promise<SearchCandidate[]> {
  const candidates: SearchCandidate[] = []
  for (const row of documents) {
    if (!row.present || ['superseded', 'archived'].includes(row.author_status) || row.system_health === 'blocked') continue
    try {
      const loaded = readRegisteredKnowledgeDocument(row)
      const best = [...loaded.parsed.chunks]
        .map(chunk => ({ chunk, score: rankChunk(chunk.content, query, chunk.ordinal) }))
        .filter(item => item.score > 0)
        .sort((left, right) => right.score - left.score || left.chunk.ordinal - right.chunk.ordinal)[0]
      if (!best) continue
      candidates.push({ id: `${row.document_id}:${best.chunk.chunk_key}`, score: best.score, metadata: { knowledge_document_id: row.document_id, knowledge_chunk_key: best.chunk.chunk_key, knowledge_document_sha256: row.current_sha256, heading_path: best.chunk.heading_path, line_start: best.chunk.line_start, line_end: best.chunk.line_end, search_source: 'local_bm25' } })
    } catch {
      // The document watcher owns reconciliation of files changed mid-search.
    }
  }
  return candidates.sort((left, right) => (right.score || 0) - (left.score || 0)).slice(0, limit)
}

function mergeSearchCandidates(semantic: SearchCandidate[], local: SearchCandidate[]): SearchCandidate[] {
  const merged: SearchCandidate[] = []
  const seen = new Set<string>()
  for (const candidate of [...semantic, ...local]) {
    const key = `${String(candidate.metadata.knowledge_document_id || '')}:${String(candidate.metadata.knowledge_chunk_key || '')}`
    if (!key || seen.has(key)) continue
    seen.add(key)
    merged.push(candidate)
  }
  return merged
}

export async function buildContextPacket(input: {
  project_id: string
  purpose?: ContextPurpose
  workspace_area?: string
  workspace_tab?: string
  workspace_scope?: string
  query?: string
  session_id?: string
  exclude_turn_id?: string
  manifest_id?: string
  requested_document_ids?: string[]
  search_mode?: ContextSearchMode
}, dependencies: { semanticSearch?: typeof searchActiveKnowledge } = {}): Promise<ContextPacket> {
  const recipe = recipeFor(input.workspace_area, input.workspace_tab, input.purpose || 'project_chat')
  const scope = input.workspace_scope || scopeKey(input.workspace_area, input.workspace_tab)
  const query = (input.query || '').slice(0, 2_000)
  const parsedRequested = [...new Set((input.requested_document_ids || []).map(id => knowledgeDocumentId.parse(id)))]
  const all = (await listKnowledgeDocuments(input.project_id)).filter(row => {
    if (!scopeMatches(row, scope) || ['superseded', 'archived'].includes(row.author_status)) return false
    if (recipe.purpose !== 'paper_section') return true
    return row.author_status === 'confirmed' && !['stale', 'blocked', 'index_failed'].includes(row.system_health)
  })
  const plan = contextPlan.parse({ project_id: input.project_id, purpose: recipe.purpose, workspace_scope: scope, query, requested_document_ids: parsedRequested, direct_document_ids: [], search_mode: query ? (input.search_mode || 'hybrid') : 'none', max_documents: recipe.maxDocuments, token_budget: recipe.tokenBudget, output_reserve: recipe.outputReserve })
  const excluded: Excluded[] = []
  for (const documentId of parsedRequested) {
    if (!all.some(row => row.document_id === documentId)) excluded.push({ kind: 'requested_document_unavailable', id: documentId, reason: '文档不存在、已归档、超出当前 workspace scope 或尚未完成对账。' })
  }
  const directRows = all.filter(row => parsedRequested.includes(row.document_id) || kindMatches(row, recipe.directKinds)).sort((left, right) => rankRow(right, plan.query) - rankRow(left, plan.query))
  const requestedRows = directRows.filter(row => parsedRequested.includes(row.document_id))
  const coreRows = directRows.filter(row => !parsedRequested.includes(row.document_id))
  const directSelected = [...requestedRows, ...coreRows].slice(0, plan.max_documents)
  for (const row of requestedRows.slice(plan.max_documents)) excluded.push({ kind: 'requested_document_budget_excluded', id: row.document_id, reason: '明确选择的文档数量超过当前任务预算。' })
  plan.direct_document_ids.push(...directSelected.map(row => row.document_id))
  const blocks: ContextBlock[] = []
  const usedTokens = { value: 0 }
  for (const row of directSelected) await addDocumentBlocks(row, plan, blocks, excluded, usedTokens, parsedRequested.includes(row.document_id) ? '用户明确选择的知识文档' : '当前 workspace 的核心知识文档')
  const entityIds = await openDecisionBlocks(plan.project_id, plan, blocks, usedTokens)
  const searchMeta = { mode: plan.search_mode, attempted: false, result_count: 0, local_result_count: 0, filtered_stale_results: 0, blocked_code: null as string | null }
  if (plan.search_mode !== 'none' && plan.query) {
    searchMeta.attempted = true
    const searchDocuments = all.filter(row => kindMatches(row, recipe.searchKinds))
    const localCandidates = plan.search_mode === 'semantic' ? [] : await localKnowledgeSearch(plan.project_id, plan.query, searchDocuments, Math.min(12, plan.max_documents))
    searchMeta.local_result_count = localCandidates.length
    const semanticCandidates: SearchCandidate[] = []
    if (plan.search_mode === 'semantic' || plan.search_mode === 'hybrid') {
      try {
        const search = await (dependencies.semanticSearch || searchActiveKnowledge)(plan.project_id, plan.query, Math.min(12, plan.max_documents))
        searchMeta.filtered_stale_results = search.filtered_stale_results
        semanticCandidates.push(...search.results.map(result => ({ id: String(result.id || ''), metadata: ((result.metadata || {}) as Record<string, unknown>) })))
      } catch (error) {
        const code = error instanceof IndexingError ? error.code : 'knowledge_search_failed'
        searchMeta.blocked_code = code
        excluded.push({ kind: 'semantic_search_blocked', reason: `当前项目的 Supermemory 语义检索没有成功：${code}` })
      }
    }
    searchMeta.result_count = mergeSearchCandidates(semanticCandidates, localCandidates).length
    const alreadySelected = new Set(blocks.map(block => block.provenance.document_id).filter((id): id is string => Boolean(id)))
    for (const result of mergeSearchCandidates(semanticCandidates, localCandidates)) {
      const documentId = typeof result.metadata.knowledge_document_id === 'string' ? result.metadata.knowledge_document_id : ''
      if (!documentId || alreadySelected.has(documentId)) continue
      const row = all.find(item => item.document_id === documentId)
      if (!row || !scopeMatches(row, scope) || !kindMatches(row, recipe.searchKinds)) {
        excluded.push({ kind: 'search_candidate_filtered', id: documentId, reason: '候选文档不属于当前 workspace recipe 或已经不在项目范围内。' })
        continue
      }
      if (result.metadata.search_source !== 'local_bm25') {
        const candidateProjectId = typeof result.metadata.project_id === 'string' ? result.metadata.project_id : ''
        const generation = typeof result.metadata.knowledge_index_generation === 'string' ? result.metadata.knowledge_index_generation : ''
        const documentSha = typeof result.metadata.knowledge_document_sha256 === 'string' ? result.metadata.knowledge_document_sha256 : ''
        if ((candidateProjectId && candidateProjectId !== plan.project_id) || !row.active_index_generation || generation !== row.active_index_generation || documentSha !== row.current_sha256) {
          excluded.push({ kind: 'search_candidate_stale', id: documentId, reason: '远端候选不属于本地账本中的当前 active generation。' })
          continue
        }
      }
      const chunkKey = typeof result.metadata.knowledge_chunk_key === 'string' ? result.metadata.knowledge_chunk_key : ''
      await addDocumentBlocks(row, plan, blocks, excluded, usedTokens, '语义/关键词检索命中的当前知识文档', chunkKey ? new Set([chunkKey]) : new Set())
      alreadySelected.add(documentId)
      if (alreadySelected.size >= plan.max_documents) break
    }
  }
  if (recipe.purpose === 'project_chat' || recipe.purpose === 'idea' || recipe.purpose === 'literature' || recipe.purpose === 'method_experiment' || recipe.purpose === 'paper_section') await recentConversationBlocks(plan.project_id, scope, input.session_id, input.exclude_turn_id, plan, blocks, usedTokens)
  const status = searchMeta.blocked_code && !blocks.length ? 'blocked' : blocks.length ? (searchMeta.blocked_code ? 'partial' : 'complete') : 'empty'
  const manifestId = input.manifest_id || crypto.randomUUID()
  const existingManifest = input.manifest_id ? await one<{ project_id: string; purpose: string; workspace_scope: string }>('SELECT project_id,purpose,workspace_scope FROM context_manifests WHERE id=$1', [manifestId]) : null
  if (existingManifest && (existingManifest.project_id !== plan.project_id || existingManifest.purpose !== plan.purpose || existingManifest.workspace_scope !== plan.workspace_scope)) {
    throw new ContextPlannerError('context_manifest_identity_conflict', '上下文来源清单身份与当前请求不一致。', 409)
  }
  const documentIds = [...new Set(blocks.map(block => block.provenance.document_id).filter((id): id is string => Boolean(id)))]
  const manifestEntityIds = [...new Set([...entityIds, ...blocks.map(block => block.provenance.entity_id).filter((id): id is string => Boolean(id))])]
  await database.query(`INSERT INTO context_manifests(id,project_id,purpose,workspace_scope,query,plan,document_ids,entity_ids,source_refs,search_metadata,token_budget,output_reserve,included_tokens,excluded,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    ON CONFLICT (id) DO UPDATE SET query=EXCLUDED.query,plan=EXCLUDED.plan,document_ids=EXCLUDED.document_ids,entity_ids=EXCLUDED.entity_ids,source_refs=EXCLUDED.source_refs,search_metadata=EXCLUDED.search_metadata,token_budget=EXCLUDED.token_budget,output_reserve=EXCLUDED.output_reserve,included_tokens=EXCLUDED.included_tokens,excluded=EXCLUDED.excluded,status=EXCLUDED.status`, [manifestId, plan.project_id, plan.purpose, plan.workspace_scope, plan.query, plan, documentIds, manifestEntityIds, blocks.map(block => block.provenance), searchMeta, plan.token_budget, plan.output_reserve, usedTokens.value, excluded, status])
  await audit(existingManifest ? 'context.packet_rebuilt' : 'context.packet_built', plan.project_id, { manifest_id: manifestId, purpose: plan.purpose, workspace_scope: scope, document_ids: documentIds, entity_ids: manifestEntityIds, included_tokens: usedTokens.value, excluded_count: excluded.length, search: searchMeta })
  return contextPacket.parse({ id: manifestId, project_id: plan.project_id, status, plan, blocks, excluded, included_tokens: usedTokens.value, search: searchMeta, manifest_id: manifestId })
}

export function contextPacketPrompt(packet: ContextPacket): string {
  if (!packet.blocks.length) return `<research-context status="${packet.status}" manifest_id="${packet.manifest_id}">暂无当前 workspace 的已登记知识文档上下文。</research-context>`
  return `<research-context status="${packet.status}" manifest_id="${packet.manifest_id}">\n${packet.blocks.map(block => [`<source block_id="${block.block_id}" kind="${block.kind}" document_id="${block.provenance.document_id || block.provenance.entity_id || 'conversation'}" locator="${block.provenance.locator}">`, block.content, '</source>'].join('\n')).join('\n\n')}\n</research-context>`
}

export async function getContextManifest(projectId: string, manifestId: string): Promise<Record<string, unknown>> {
  const manifest = await one<Record<string, unknown>>('SELECT * FROM context_manifests WHERE id=$1 AND project_id=$2', [manifestId, projectId])
  if (!manifest) throw new ContextPlannerError('context_manifest_not_found', '上下文来源清单不存在。', 404)
  return manifest
}
