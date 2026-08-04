import { basename } from 'node:path'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { audit, database, one, rows } from '../database.js'
import { ApiError } from '../http.js'
import { projectFilePath } from '../project-storage.js'
import { requireProject } from '../project-service.js'
import { verifyArtifactFile } from '../artifact-preview-service.js'
import {
  type RelatedWorkRecursivePlanRequest,
  type RelatedWorkSeedRequest,
  type RelatedWorkCandidateDecisionRequest,
  type RelatedWorkFieldName,
  type RelatedWorkFieldSourceType,
  type RelatedWorkFieldSelectionRequest,
  type RelatedWorkEnrichmentRequest,
  relatedWorkFieldName,
  relatedWorkProvider,
  sourceAttempt,
  sourceSearchResult,
  citationEdge,
  type PaperCandidate,
  type RelatedWorkProvider,
  type ReferenceSearchResult,
  normalizeDoi,
  normalizeTitle,
  paperCandidate,
  type SourceAttempt,
  type SourceSearchOptions,
  stablePaperId,
} from './contracts.js'
import { mergeEnrichedAuthors, paperCompleteness, preferIncomingAuthors, titlesMatch } from './paper-fields.js'
import { parseBibTeX } from './bibtex.js'
import { ArxivSourceAdapter, createDefaultCitationSourceAdapters, createDefaultEnrichmentAdapters, createDefaultSourceAdapters, findArxivId } from './source-adapters.js'
import { recursiveCollect, type RankedReference, type ReferenceBatch } from './recursive-search.js'
import { readRelatedWorkCache, writeRelatedWorkCache, type RelatedWorkCacheDescriptor } from './cache.js'

type CandidateRow = {
  id: string
  project_id: string
  provider: RelatedWorkProvider
  stable_id: string
  normalized_doi: string | null
  normalized_title: string
  year: number | null
  title: string
  paper_id: string | null
  status: string
  discovery_depth: number
  candidate: Record<string, unknown>
  first_run_id: string | null
  first_seen_at: string
  updated_at: string
}

type SeedRow = {
  id: string
  project_id: string
  source_type: string
  raw_input: Record<string, unknown>
  input_summary: string
  normalized_doi: string | null
  normalized_title: string | null
  year: number | null
  artifact_id: string | null
  artifact_sha256: string | null
  paper_id: string | null
  status: string
  created_by: string
  created_at: string
  resolved_at: string | null
}

type RunRow = {
  id: string
  project_id: string
  proposal_id: string
  seed_ids: string[]
  providers: RelatedWorkProvider[]
  depth: number
  width: number
  max_total: number
  status: string
  cancel_requested: boolean
  discovered_count: number
  edge_count: number
  failure_count: number
  error: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

type CandidateSave = { row: CandidateRow; match_method: 'doi' | 'provider_stable_id' | 'title_year' | 'new' }

type CandidateFieldValue = {
  field_name: RelatedWorkFieldName
  value: unknown
  locator: string | null
}

type FieldProvenanceRow = {
  id: string
  project_id: string
  candidate_id: string
  field_name: RelatedWorkFieldName
  provider: RelatedWorkProvider | null
  source_type: RelatedWorkFieldSourceType
  stable_id: string | null
  source_attempt_id: string | null
  artifact_id: string | null
  retrieved_at: string
  locator: string | null
  raw_value_hash: string
  normalized_value: unknown
  status: string
  conflict_group: string | null
  created_at: string
}

const allProviders: RelatedWorkProvider[] = ['crossref', 'openalex', 'semantic_scholar', 'dblp', 'arxiv', 'unpaywall']
const searchProviders: RelatedWorkProvider[] = ['crossref', 'openalex', 'semantic_scholar', 'dblp', 'arxiv']
const runningControllers = new Map<string, AbortController>()

function inputValue(input: RelatedWorkSeedRequest, key: string): unknown {
  return (input as unknown as Record<string, unknown>)[key]
}

function textInput(input: RelatedWorkSeedRequest, key: string): string | null {
  const value = inputValue(input, key)
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function yearInput(input: RelatedWorkSeedRequest): number | null {
  const value = inputValue(input, 'year')
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

function bibtexField(content: string, name: string): string | null {
  // BibTeX is treated as untrusted text. This bounded field reader is only used to
  // derive a search hint; the original entry remains the audited seed input.
  const match = new RegExp(`(?:^|[,\\s])${name}\\s*=\\s*(?:\\{([^{}]{1,2000})\\}|"([^"\\r\\n]{1,2000})")`, 'i').exec(content)
  return (match?.[1] || match?.[2] || '').trim() || null
}

function seedQuery(input: RelatedWorkSeedRequest, artifactName: string | null): string {
  return textInput(input, 'title')
    || textInput(input, 'doi')
    || textInput(input, 'url')
    || (textInput(input, 'bibtex') ? bibtexField(textInput(input, 'bibtex')!, 'title') : null)
    || artifactName
    || 'unresolved related-work seed'
}

function sourceUrlForProvider(provider: RelatedWorkProvider): string {
  const urls: Record<RelatedWorkProvider, string> = {
    crossref: 'https://api.crossref.org/works',
    openalex: 'https://api.openalex.org/works',
    semantic_scholar: 'https://api.semanticscholar.org/graph/v1/paper',
    dblp: 'https://dblp.org/search/publ/api',
    arxiv: 'https://export.arxiv.org/api/query',
    unpaywall: 'https://api.unpaywall.org/v2/',
  }
  return urls[provider]
}

function unexpectedAttempt(provider: RelatedWorkProvider, query: string, error: unknown): SourceAttempt {
  const now = new Date().toISOString()
  return sourceAttempt.parse({
    provider,
    query,
    request_url: sourceUrlForProvider(provider),
    started_at: now,
    finished_at: now,
    status: 'failed',
    http_status: null,
    result_count: 0,
    failure: {
      code: 'request_failed',
      message: error instanceof Error ? error.message.slice(0, 2_000) : 'provider request failed',
      retryable: false,
      http_status: null,
    },
  })
}

function providerAdapterOptions() {
  const key = process.env.SEMANTIC_SCHOLAR_API_KEY
  return key ? { semantic_scholar_api_key: key } : {}
}

type CachedExecution<T> = {
  result: T
  from_cache: boolean
  request_hash: string | null
}

function cacheDescriptor(projectId: string, provider: RelatedWorkProvider, operation: RelatedWorkCacheDescriptor['operation'], query: string, options: SourceSearchOptions): RelatedWorkCacheDescriptor {
  return {
    project_id: projectId,
    provider,
    operation,
    query,
    request_params: {
      limit: options.limit,
      timeout_ms: options.timeout_ms ?? null,
      user_agent: options.user_agent ?? null,
    },
  }
}

function replayAttempt(attempt: SourceAttempt, requestUrl: string): SourceAttempt {
  const now = new Date().toISOString()
  return sourceAttempt.parse({ ...attempt, request_url: requestUrl, started_at: now, finished_at: now })
}

function parseReferenceSearchResult(value: unknown): ReferenceSearchResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('related_work_cache_reference_response_invalid')
  const raw = value as Record<string, unknown>
  const provider = relatedWorkProvider.parse(raw.provider)
  const source = paperCandidate.parse(raw.source)
  const candidates = Array.isArray(raw.candidates) ? raw.candidates.map(item => paperCandidate.parse(item)) : []
  const edges = Array.isArray(raw.edges) ? raw.edges.map(item => citationEdge.parse(item)) : []
  const attempt = sourceAttempt.parse(raw.attempt)
  const attempts = Array.isArray(raw.attempts) ? raw.attempts.map(item => sourceAttempt.parse(item)) : undefined
  const rankedReferences = Array.isArray(raw.ranked_references)
    ? raw.ranked_references.map(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('related_work_cache_ranked_reference_invalid')
      const ranked = item as Record<string, unknown>
      const parsed: { paper: PaperCandidate; ranking_score?: number | null; ranking_reasons?: string[] } = { paper: paperCandidate.parse(ranked.paper) }
      if (typeof ranked.ranking_score === 'number' || ranked.ranking_score === null) parsed.ranking_score = ranked.ranking_score
      if (Array.isArray(ranked.ranking_reasons)) parsed.ranking_reasons = ranked.ranking_reasons.filter((reason): reason is string => typeof reason === 'string')
      return parsed
    })
    : undefined
  return { provider, source, candidates, ...(rankedReferences ? { ranked_references: rankedReferences } : {}), edges, attempt, ...(attempts ? { attempts } : {}) }
}

function replayReferenceSearchResult(value: ReferenceSearchResult, requestUrl: string): ReferenceSearchResult {
  const replayedAttempt = replayAttempt(value.attempt, requestUrl)
  const replayedAttempts = value.attempts?.map(item => replayAttempt(item, item.request_url))
  return { ...value, attempt: replayedAttempt, ...(replayedAttempts ? { attempts: replayedAttempts } : {}) }
}

async function searchWithCache(projectId: string, provider: RelatedWorkProvider, query: string, options: SourceSearchOptions, search: () => Promise<import('./contracts.js').SourceSearchResult>): Promise<CachedExecution<import('./contracts.js').SourceSearchResult>> {
  const descriptor = cacheDescriptor(projectId, provider, 'search', query, options)
  const cached = await readRelatedWorkCache(descriptor, value => sourceSearchResult.parse(value))
  if (cached) {
    const result = sourceSearchResult.parse({ ...cached.value, attempt: replayAttempt(cached.value.attempt, cached.request_url) })
    return { result, from_cache: true, request_hash: cached.request_hash }
  }
  const result = await search()
  const stored = await writeRelatedWorkCache(descriptor, result, result.attempt)
  return { result, from_cache: false, request_hash: stored.request_hash }
}

async function referencesWithCache(projectId: string, provider: RelatedWorkProvider, paper: PaperCandidate, options: SourceSearchOptions, fetchReferences: () => Promise<ReferenceSearchResult>): Promise<CachedExecution<ReferenceSearchResult>> {
  const descriptor = cacheDescriptor(projectId, provider, 'references', paper.stable_id, options)
  descriptor.request_params = { ...descriptor.request_params, paper_stable_id: paper.stable_id }
  const cached = await readRelatedWorkCache(descriptor, parseReferenceSearchResult)
  if (cached) return { result: replayReferenceSearchResult(cached.value, cached.request_url), from_cache: true, request_hash: cached.request_hash }
  const result = await fetchReferences()
  const stored = await writeRelatedWorkCache(descriptor, result, result.attempt)
  return { result, from_cache: false, request_hash: stored.request_hash }
}

function normalizeProviders(providers: RelatedWorkProvider[]): RelatedWorkProvider[] {
  const requested = new Set(providers)
  return allProviders.filter(provider => requested.has(provider))
}

function normalizeSearchProviders(providers: RelatedWorkProvider[]): RelatedWorkProvider[] {
  const requested = new Set(providers)
  return searchProviders.filter(provider => requested.has(provider))
}

const provenanceFields: RelatedWorkFieldName[] = ['title', 'authors', 'abstract', 'venue', 'doi', 'year', 'institutions', 'pdf_url', 'bibtex']

function candidateFieldValues(paper: PaperCandidate): CandidateFieldValue[] {
  const institutions = [...new Set(paper.authors.flatMap(author => author.affiliations).filter(Boolean))]
  const values: Record<RelatedWorkFieldName, unknown> = {
    title: paper.title,
    authors: paper.authors,
    abstract: paper.abstract,
    venue: paper.venue,
    doi: normalizeDoi(paper.doi),
    year: paper.year,
    institutions,
    pdf_url: paper.pdf_url,
    bibtex: null,
  }
  return provenanceFields.flatMap(field_name => {
    const value = values[field_name]
    if (value === null || value === undefined) return []
    if (typeof value === 'string' && !value.trim()) return []
    if (Array.isArray(value) && value.length === 0) return []
    return [{ field_name, value, locator: null }]
  })
}

function valueHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function candidateCore(value: Record<string, unknown>): { paper: PaperCandidate | null; enrichment: Record<string, unknown> } {
  const { enrichment: rawEnrichment, ...rawCore } = value
  const parsed = paperCandidate.safeParse(rawCore)
  const enrichment = rawEnrichment && typeof rawEnrichment === 'object' && !Array.isArray(rawEnrichment)
    ? rawEnrichment as Record<string, unknown>
    : {}
  return { paper: parsed.success ? parsed.data : null, enrichment }
}

function mergeMissingCandidateFields(existing: PaperCandidate, incoming: PaperCandidate): PaperCandidate {
  const merged = { ...existing } as Record<string, unknown>
  const fields: Array<keyof PaperCandidate> = ['title', 'authors', 'year', 'venue', 'doi', 'abstract', 'pdf_url', 'html_url', 'license', 'citation_count', 'open_access', 'source_url']
  for (const field of fields) {
    const current = merged[field]
    const next = incoming[field]
    const currentEmpty = current === null || current === undefined || (typeof current === 'string' && !current.trim()) || (Array.isArray(current) && current.length === 0)
    const nextPresent = next !== null && next !== undefined && !(typeof next === 'string' && !next.trim()) && !(Array.isArray(next) && next.length === 0)
    if (currentEmpty && nextPresent) merged[field] = next
  }
  return paperCandidate.parse(merged)
}

function mergeEnrichedCandidate(existing: PaperCandidate, incoming: PaperCandidate): PaperCandidate {
  const merged = mergeMissingCandidateFields(existing, incoming)
  if (incoming.authors.length) {
    const replaced = incoming.provider === 'arxiv' && incoming.authors.length > existing.authors.length
    merged.authors = (replaced ? preferIncomingAuthors(existing.authors, incoming.authors) : mergeEnrichedAuthors(existing.authors, incoming.authors)).map(author => ({
      ...author,
      orcid: author.orcid || null,
      email: author.email ?? null,
      is_corresponding: author.is_corresponding ?? null,
      scholar_id: author.scholar_id ?? null,
      affiliations: author.affiliations || [],
      interests: author.interests || [],
      citation_stats: author.citation_stats ?? null,
    }))
  }
  return paperCandidate.parse(merged)
}

async function persistCandidateFieldProvenance(
  projectId: string,
  candidateId: string,
  paper: PaperCandidate,
  sourceAttemptId: string | null = null,
  artifactId: string | null = null,
  selectedFields: RelatedWorkFieldName[] = provenanceFields,
): Promise<void> {
  const allowed = new Set(selectedFields)
  for (const field of candidateFieldValues(paper).filter(item => allowed.has(item.field_name))) {
    await database.query(`INSERT INTO related_work_field_provenance
      (id,project_id,candidate_id,field_name,provider,source_type,stable_id,source_attempt_id,artifact_id,retrieved_at,locator,raw_value_hash,normalized_value,status,conflict_group)
      VALUES ($1,$2,$3,$4,$5,'provider',$6,$7,$8,$9,$10,$11,$12,'observed',$13)`, [
      crypto.randomUUID(), projectId, candidateId, field.field_name, paper.provider, paper.stable_id, sourceAttemptId, artifactId,
      paper.retrieved_at, field.locator, valueHash(field.value), JSON.stringify(field.value), `${candidateId}:${field.field_name}`,
    ])
    await database.query(`UPDATE related_work_field_provenance
      SET status=CASE WHEN status IN ('observed','conflict') AND (SELECT COUNT(DISTINCT raw_value_hash) FROM related_work_field_provenance WHERE candidate_id=$1 AND field_name=$2) > 1 THEN 'conflict' ELSE status END
      WHERE project_id=$3 AND candidate_id=$1 AND field_name=$2 AND status='observed'`, [candidateId, field.field_name, projectId])
  }
}

async function persistSeedInputProvenance(
  projectId: string,
  candidateId: string,
  seedId: string,
  input: RelatedWorkSeedRequest,
  artifactId: string | null,
): Promise<void> {
  const bibtex = textInput(input, 'bibtex')
  const parsedBibtex = bibtex ? parseBibTeX(bibtex) : null
  const values: CandidateFieldValue[] = []
  const add = (field_name: RelatedWorkFieldName, value: unknown, locator: string) => {
    if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return
    values.push({ field_name, value, locator })
  }
  add('title', textInput(input, 'title') || parsedBibtex?.title, `seed:${seedId}:title`)
  add('doi', normalizeDoi(textInput(input, 'doi')) || parsedBibtex?.doi, `seed:${seedId}:doi`)
  add('year', yearInput(input) ?? parsedBibtex?.year, `seed:${seedId}:year`)
  add('venue', parsedBibtex?.venue, `seed:${seedId}:venue`)
  add('abstract', parsedBibtex?.abstract, `seed:${seedId}:abstract`)
  if (parsedBibtex?.authors.length) {
    add('authors', parsedBibtex.authors.map(name => ({ name, orcid: null, affiliations: [], email: null, is_corresponding: null, scholar_id: null, interests: [], citation_stats: null })), `seed:${seedId}:authors`)
  }
  add('bibtex', bibtex, `seed:${seedId}:bibtex`)
  if (!values.length) return

  const candidate = await candidateForProject(projectId, candidateId)
  const current = candidateCore(candidate.candidate || {})
  if (!current.paper) return
  const next = { ...current.paper }
  const title = values.find(item => item.field_name === 'title')?.value
  const doi = values.find(item => item.field_name === 'doi')?.value
  const year = values.find(item => item.field_name === 'year')?.value
  const venue = values.find(item => item.field_name === 'venue')?.value
  const abstract = values.find(item => item.field_name === 'abstract')?.value
  const authors = values.find(item => item.field_name === 'authors')?.value
  if (!next.title && typeof title === 'string') next.title = title
  if (!next.doi && typeof doi === 'string') next.doi = doi
  if (!next.year && typeof year === 'number') next.year = year
  if (!next.venue && typeof venue === 'string') next.venue = venue
  if (!next.abstract && typeof abstract === 'string') next.abstract = abstract
  if (Array.isArray(authors)) {
    const mergedAuthors = mergeEnrichedAuthors(next.authors, authors)
    next.authors = mergedAuthors.map(author => ({
      ...author,
      orcid: author.orcid || null,
      email: author.email ?? null,
      is_corresponding: author.is_corresponding ?? null,
      scholar_id: author.scholar_id ?? null,
      affiliations: author.affiliations || [],
      interests: author.interests || [],
      citation_stats: author.citation_stats ?? null,
    }))
  }
  const enrichment = { ...current.enrichment }
  if (bibtex) enrichment.bibtex = bibtex
  const stored = { ...paperCandidate.parse(next), ...(Object.keys(enrichment).length ? { enrichment } : {}) }
  await database.query(`UPDATE related_work_candidates
    SET title=$2,normalized_title=$3,normalized_doi=$4,year=$5,candidate=$6,updated_at=NOW()
    WHERE id=$1 AND project_id=$7`, [candidateId, stored.title, normalizeTitle(stored.title), normalizeDoi(stored.doi), stored.year, stored, projectId])
  const sourceType: RelatedWorkFieldSourceType = input.source_type === 'artifact_pdf' ? 'controlled_artifact' : 'user_input'
  for (const field of values) {
    await database.query(`INSERT INTO related_work_field_provenance
      (id,project_id,candidate_id,field_name,provider,source_type,stable_id,source_attempt_id,artifact_id,retrieved_at,locator,raw_value_hash,normalized_value,status,conflict_group)
      VALUES ($1,$2,$3,$4,NULL,$5,NULL,NULL,$6,$7,$8,$9,$10,'observed',$11)`, [
      crypto.randomUUID(), projectId, candidateId, field.field_name, sourceType, artifactId, new Date().toISOString(), field.locator,
      valueHash(field.value), JSON.stringify(field.value), `${candidateId}:${field.field_name}`,
    ])
    await database.query(`UPDATE related_work_field_provenance
      SET status=CASE WHEN status IN ('observed','conflict') AND (SELECT COUNT(DISTINCT raw_value_hash) FROM related_work_field_provenance WHERE project_id=$3 AND candidate_id=$1 AND field_name=$2) > 1 THEN 'conflict' ELSE status END
      WHERE project_id=$3 AND candidate_id=$1 AND field_name=$2 AND status='observed'`, [candidateId, field.field_name, projectId])
  }
}

function candidateFromPaper(projectPaper: Record<string, unknown>): PaperCandidate {
  const metadata = projectPaper.metadata && typeof projectPaper.metadata === 'object' ? projectPaper.metadata as Record<string, unknown> : {}
  const title = String(projectPaper.title || '').trim()
  const doi = normalizeDoi(typeof projectPaper.doi === 'string' ? projectPaper.doi : null)
  const provider = typeof metadata.source_provider === 'string' && allProviders.includes(metadata.source_provider as RelatedWorkProvider)
    ? metadata.source_provider as RelatedWorkProvider
    : 'crossref'
  const sourceUrl = typeof projectPaper.source_url === 'string' && projectPaper.source_url.startsWith('http')
    ? projectPaper.source_url
    : doi ? `https://doi.org/${doi}` : `https://api.crossref.org/works`
  const rawAuthors = Array.isArray(metadata.authors) ? metadata.authors : []
  const authors = rawAuthors.flatMap(value => {
    if (typeof value === 'string' && value.trim()) return [{ name: value.trim(), orcid: null, affiliations: [] }]
    if (value && typeof value === 'object' && typeof (value as Record<string, unknown>).name === 'string') {
      const item = value as Record<string, unknown>
      return [{ name: String(item.name), orcid: typeof item.orcid === 'string' ? item.orcid : null, affiliations: Array.isArray(item.affiliations) ? item.affiliations.filter((item): item is string => typeof item === 'string') : [] }]
    }
    return []
  })
  return paperCandidate.parse({
    provider,
    stable_id: typeof metadata.stable_id === 'string' ? metadata.stable_id : stablePaperId(provider, doi, title),
    title,
    authors,
    year: typeof metadata.year === 'number' ? metadata.year : null,
    venue: typeof metadata.venue === 'string' ? metadata.venue : null,
    doi,
    abstract: typeof metadata.abstract === 'string' ? metadata.abstract : null,
    pdf_url: typeof metadata.pdf_url === 'string' ? metadata.pdf_url : null,
    html_url: sourceUrl,
    license: null,
    citation_count: typeof metadata.citation_count === 'number' ? metadata.citation_count : null,
    open_access: typeof metadata.open_access === 'boolean' ? metadata.open_access : null,
    source_url: sourceUrl,
    query: 'existing-project-paper',
    retrieved_at: new Date().toISOString(),
  })
}

async function verifySeedArtifact(projectId: string, artifactId: string): Promise<{ sha256: string; name: string }> {
  const artifact = await one<{ id: string; name: string; relative_path: string; mime_type: string; sha256: string; valid: boolean }>('SELECT id,name,relative_path,mime_type,sha256,valid FROM artifacts WHERE id=$1 AND project_id=$2', [artifactId, projectId])
  if (!artifact) throw new ApiError(404, 'related_work_artifact_not_found', '受控 PDF Artifact 不属于当前项目或不存在。')
  if (!artifact.valid || artifact.mime_type !== 'application/pdf') throw new ApiError(422, 'related_work_artifact_invalid', '相关工作种子必须使用有效的受控 PDF Artifact。')
  try {
  const path = projectFilePath(projectId, artifact.relative_path)
    await verifyArtifactFile(path, artifact.sha256)
  } catch (error) {
    throw new ApiError(422, 'related_work_artifact_hash_invalid', error instanceof Error ? error.message : 'PDF Artifact 哈希校验失败。')
  }
  return { sha256: artifact.sha256, name: basename(artifact.name) }
}

async function findCandidateByDoi(projectId: string, doi: string): Promise<CandidateRow | null> {
  return one<CandidateRow>('SELECT * FROM related_work_candidates WHERE project_id=$1 AND normalized_doi=$2 ORDER BY first_seen_at,id LIMIT 1', [projectId, doi])
}

async function findCandidateByStableId(projectId: string, provider: RelatedWorkProvider, stableId: string): Promise<CandidateRow | null> {
  return one<CandidateRow>('SELECT * FROM related_work_candidates WHERE project_id=$1 AND provider=$2 AND stable_id=$3 LIMIT 1', [projectId, provider, stableId])
}

async function findCandidateByTitleYear(projectId: string, title: string, year: number | null): Promise<CandidateRow | null> {
  return one<CandidateRow>('SELECT * FROM related_work_candidates WHERE project_id=$1 AND normalized_title=$2 AND year IS NOT DISTINCT FROM $3 ORDER BY first_seen_at,id LIMIT 1', [projectId, normalizeTitle(title), year])
}

async function findCandidate(projectId: string, paper: PaperCandidate): Promise<{ row: CandidateRow | null; match_method: CandidateSave['match_method'] }> {
  const doi = normalizeDoi(paper.doi)
  if (doi) {
    const byDoi = await findCandidateByDoi(projectId, doi)
    if (byDoi) return { row: byDoi, match_method: 'doi' }
  }
  const byStable = await findCandidateByStableId(projectId, paper.provider, paper.stable_id)
  if (byStable) return { row: byStable, match_method: 'provider_stable_id' }
  const byTitle = await findCandidateByTitleYear(projectId, paper.title, paper.year)
  if (byTitle) return { row: byTitle, match_method: 'title_year' }
  return { row: null, match_method: 'new' }
}

async function saveCandidate(projectId: string, paper: PaperCandidate, discoveryDepth: number, firstRunId: string | null = null, paperId: string | null = null, sourceAttemptId: string | null = null, artifactId: string | null = null): Promise<CandidateSave> {
  const found = await findCandidate(projectId, paper)
  const normalizedDoi = normalizeDoi(paper.doi)
  const normalizedTitle = normalizeTitle(paper.title)
  let row: CandidateRow
  if (found.row) {
    const existing = candidateCore(found.row.candidate || {})
    const mergedCandidate = existing.paper ? mergeMissingCandidateFields(existing.paper, paper) : paper
    const storedCandidate = { ...mergedCandidate, ...(Object.keys(existing.enrichment).length ? { enrichment: existing.enrichment } : {}) }
    await database.query(`UPDATE related_work_candidates
      SET normalized_doi=COALESCE(normalized_doi,$2), paper_id=COALESCE(paper_id,$3), candidate=$6,
          status=CASE WHEN paper_id IS NOT NULL OR $3 IS NOT NULL THEN 'confirmed' ELSE status END,
          discovery_depth=LEAST(discovery_depth,$4), first_run_id=COALESCE(first_run_id,$5), updated_at=NOW()
      WHERE id=$1`, [found.row.id, normalizedDoi, paperId, discoveryDepth, firstRunId, storedCandidate])
    row = (await one<CandidateRow>('SELECT * FROM related_work_candidates WHERE id=$1', [found.row.id]))!
  } else {
    const id = crypto.randomUUID()
    await database.query(`INSERT INTO related_work_candidates
      (id,project_id,provider,stable_id,normalized_doi,normalized_title,year,title,paper_id,status,discovery_depth,candidate,first_run_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [
      id, projectId, paper.provider, paper.stable_id, normalizedDoi, normalizedTitle, paper.year, paper.title,
      paperId, paperId ? 'confirmed' : 'candidate', discoveryDepth, paper, firstRunId,
    ])
    row = (await one<CandidateRow>('SELECT * FROM related_work_candidates WHERE id=$1', [id]))!
  }
  await database.query(`INSERT INTO related_work_candidate_sources
    (id,project_id,candidate_id,provider,stable_id,candidate,retrieved_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (project_id,candidate_id,provider,stable_id) DO UPDATE SET candidate=EXCLUDED.candidate,retrieved_at=EXCLUDED.retrieved_at`, [
    crypto.randomUUID(), projectId, row.id, paper.provider, paper.stable_id, paper, paper.retrieved_at,
  ])
  await persistCandidateFieldProvenance(projectId, row.id, paper, sourceAttemptId, artifactId)
  return { row, match_method: found.match_method }
}

async function linkSeedCandidate(seedId: string, candidate: CandidateSave, provider: RelatedWorkProvider): Promise<void> {
  await database.query(`INSERT INTO related_work_seed_candidates(seed_id,candidate_id,provider,match_method)
    VALUES ($1,$2,$3,$4) ON CONFLICT (seed_id,candidate_id,provider) DO NOTHING`, [seedId, candidate.row.id, provider, candidate.match_method])
}

async function persistAttempt(projectId: string, attempt: SourceAttempt, seedId: string | null, runId: string | null, parentCandidateId: string | null): Promise<string> {
  const id = crypto.randomUUID()
  await database.query(`INSERT INTO related_work_source_attempts
    (id,project_id,seed_id,run_id,parent_candidate_id,provider,query,request_url,started_at,finished_at,status,http_status,result_count,failure)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [
    id, projectId, seedId, runId, parentCandidateId, attempt.provider, attempt.query, attempt.request_url,
    attempt.started_at, attempt.finished_at, attempt.status, attempt.http_status, attempt.result_count, attempt.failure,
  ])
  return id
}

function providerResultStatus(attempts: SourceAttempt[], candidateCount: number): 'resolved' | 'resolved_partial' | 'no_match' | 'failed' {
  const failures = attempts.filter(attempt => attempt.status !== 'succeeded')
  if (candidateCount > 0 && failures.length === 0) return 'resolved'
  if (candidateCount > 0 && failures.length > 0) return 'resolved_partial'
  return failures.length > 0 ? 'failed' : 'no_match'
}

export async function createRelatedWorkSeed(projectId: string, input: RelatedWorkSeedRequest, actor = 'local-user') {
  await requireProject(projectId, true)
  let artifact: { sha256: string; name: string } | null = null
  const artifactId = typeof inputValue(input, 'artifact_id') === 'string' ? String(inputValue(input, 'artifact_id')) : null
  if (artifactId) artifact = await verifySeedArtifact(projectId, artifactId)
  const parsedBibtex = textInput(input, 'bibtex') ? parseBibTeX(textInput(input, 'bibtex')!) : null
  const doi = normalizeDoi(textInput(input, 'doi')) || parsedBibtex?.doi || null
  const title = textInput(input, 'title') || parsedBibtex?.title || null
  const year = yearInput(input) ?? parsedBibtex?.year ?? null
  let existingProjectPaper: Record<string, unknown> | null = null
  if (input.source_type === 'existing_paper') {
    existingProjectPaper = await one<Record<string, unknown>>('SELECT * FROM papers WHERE id=$1 AND project_id=$2', [input.paper_id, projectId])
    if (!existingProjectPaper) throw new ApiError(404, 'related_work_paper_not_found', '选择的 Paper 不属于当前项目。')
  }
  const seedId = crypto.randomUUID()
  const rawInput = input as unknown as Record<string, unknown>
  const inputSummary = doi ? `DOI ${doi}` : title ? `标题 ${title}` : artifact ? `PDF ${artifact.name}` : seedQuery(input, null)
  await database.query(`INSERT INTO related_work_seeds
    (id,project_id,source_type,raw_input,input_summary,normalized_doi,normalized_title,year,artifact_id,artifact_sha256,created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [
    seedId, projectId, input.source_type, rawInput, inputSummary, doi, title ? normalizeTitle(title) : null, year,
    artifactId, artifact?.sha256 || null, actor,
  ])

  if (input.source_type === 'existing_paper') {
    const candidate = await saveCandidate(projectId, candidateFromPaper(existingProjectPaper!), 0, null, input.paper_id)
    await linkSeedCandidate(seedId, candidate, candidate.row.provider)
    await database.query("UPDATE related_work_seeds SET paper_id=$2,status='resolved',resolved_at=NOW() WHERE id=$1", [seedId, input.paper_id])
    await audit('related_work.seed_created', projectId, { seed_id: seedId, source_type: input.source_type, candidate_ids: [candidate.row.id], status: 'resolved' }, actor)
    return { seed_id: seedId, status: 'resolved', candidate_ids: [candidate.row.id], attempts: [] }
  }

  const query = seedQuery(input, artifact?.name || null)
  const adapters = new Map(createDefaultSourceAdapters(providerAdapterOptions()).map(adapter => [adapter.provider, adapter]))
  const providers = normalizeSearchProviders(input.providers)
  const responses = await Promise.all(providers.map(async provider => {
    const adapter = adapters.get(provider)
    if (!adapter) return {
      provider,
      execution: {
        result: { provider, query, candidates: [], attempt: unexpectedAttempt(provider, query, new Error('provider adapter unavailable')) },
        from_cache: false,
        request_hash: null,
      } satisfies CachedExecution<import('./contracts.js').SourceSearchResult>,
    }
    try {
      return { provider, execution: await searchWithCache(projectId, provider, query, { limit: 10, timeout_ms: 15_000 }, () => adapter.search(query, { limit: 10, timeout_ms: 15_000 })) }
    } catch (error) {
      return {
        provider,
        execution: {
          result: { provider, query, candidates: [], attempt: unexpectedAttempt(provider, query, error) },
          from_cache: false,
          request_hash: null,
        } satisfies CachedExecution<import('./contracts.js').SourceSearchResult>,
      }
    }
  }))
  const attempts = responses.map(response => response.execution.result.attempt)
  const attemptIds = new Map<RelatedWorkProvider, string>()
  for (const response of responses) {
    const attempt = response.execution.result.attempt
    attemptIds.set(response.provider, await persistAttempt(projectId, attempt, seedId, null, null))
  }
  const saved: CandidateRow[] = []
  for (const response of responses) {
    for (const paper of response.execution.result.candidates) {
      const candidate = await saveCandidate(projectId, paper, 0, null, null, attemptIds.get(response.provider) || null, artifactId)
      await linkSeedCandidate(seedId, candidate, response.provider)
      if (!saved.some(item => item.id === candidate.row.id)) saved.push(candidate.row)
    }
  }
  for (const candidate of saved) await persistSeedInputProvenance(projectId, candidate.id, seedId, input, artifactId)
  const status = providerResultStatus(attempts, saved.length)
  await database.query('UPDATE related_work_seeds SET status=$2,resolved_at=NOW() WHERE id=$1', [seedId, status])
  await audit('related_work.seed_created', projectId, {
    seed_id: seedId,
    source_type: input.source_type,
    candidate_ids: saved.map(item => item.id),
    provider_attempts: attempts.map(attempt => ({ provider: attempt.provider, status: attempt.status, result_count: attempt.result_count, failure: attempt.failure })),
    status,
  }, actor)
  return { seed_id: seedId, status, candidate_ids: saved.map(item => item.id), attempts }
}

async function candidateForProject(projectId: string, candidateId: string): Promise<CandidateRow> {
  const candidate = await one<CandidateRow>('SELECT * FROM related_work_candidates WHERE id=$1 AND project_id=$2', [candidateId, projectId])
  if (!candidate) throw new ApiError(404, 'related_work_candidate_not_found', '相关工作候选不存在或不属于当前项目。')
  return candidate
}

async function unresolvedCandidateConflicts(projectId: string, candidateId: string): Promise<string[]> {
  const rowsWithConflicts = await rows<{ field_name: string }>(`SELECT field_name
    FROM related_work_field_provenance
    WHERE project_id=$1 AND candidate_id=$2 AND status='conflict'
    GROUP BY field_name
    HAVING COUNT(DISTINCT raw_value_hash) > 1
    ORDER BY field_name`, [projectId, candidateId])
  return rowsWithConflicts.map(item => item.field_name)
}

function metadataFromCandidate(candidate: CandidateRow, parsed: PaperCandidate, bibtex: string | null = null, confirmedFieldSnapshot: Array<Record<string, unknown>> = [], confirmedBy = 'local-user'): Record<string, unknown> {
  const raw = candidate.candidate && typeof candidate.candidate === 'object' ? candidate.candidate : {}
  const enrichment = raw.enrichment && typeof raw.enrichment === 'object' ? raw.enrichment as Record<string, unknown> : {}
  return {
    ...parsed,
    source_provider: parsed.provider,
    stable_id: parsed.stable_id,
    normalized_title: candidate.normalized_title,
    candidate_id: candidate.id,
    discovery_depth: candidate.discovery_depth,
    enrichment,
    evidence_status: 'metadata_confirmed_requires_fulltext_review',
    bibtex: bibtex || (typeof enrichment.bibtex === 'string' ? enrichment.bibtex : null),
    confirmed_field_snapshot: confirmedFieldSnapshot,
    confirmed_by: confirmedBy,
    confirmed_at: new Date().toISOString(),
  }
}

export async function selectRelatedWorkField(projectId: string, candidateId: string, fieldName: RelatedWorkFieldName, input: RelatedWorkFieldSelectionRequest) {
  await requireProject(projectId, true)
  await candidateForProject(projectId, candidateId)
  const provenance = await one<FieldProvenanceRow>('SELECT * FROM related_work_field_provenance WHERE id=$1 AND project_id=$2 AND candidate_id=$3 AND field_name=$4', [input.provenance_id, projectId, candidateId, fieldName])
  if (!provenance) throw new ApiError(404, 'related_work_field_provenance_not_found', '字段来源不存在或不属于当前候选。')
  await database.query(`UPDATE related_work_field_provenance
    SET status=CASE WHEN id=$1 THEN 'selected' ELSE 'superseded' END
    WHERE project_id=$2 AND candidate_id=$3 AND field_name=$4`, [provenance.id, projectId, candidateId, provenance.field_name])

  const candidate = await candidateForProject(projectId, candidateId)
  const candidateJson = { ...(candidate.candidate || {}) } as Record<string, unknown>
  const current = candidateCore(candidateJson)
  const baseCandidateJson = { ...candidateJson }
  delete baseCandidateJson.enrichment
  const enrichment = { ...current.enrichment }
  const baseFields = new Set(['title', 'authors', 'abstract', 'venue', 'doi', 'year', 'pdf_url'])
  if (baseFields.has(provenance.field_name)) baseCandidateJson[provenance.field_name] = provenance.normalized_value
  else enrichment[provenance.field_name] = provenance.normalized_value
  const parsed = paperCandidate.safeParse(baseCandidateJson)
  if (!parsed.success) throw new ApiError(422, 'related_work_field_value_invalid', `字段 ${provenance.field_name} 选择后不满足候选契约。`)
  const storedCandidate = { ...parsed.data, ...(Object.keys(enrichment).length ? { enrichment } : {}) }
  await database.query(`UPDATE related_work_candidates
    SET title=$2,normalized_title=$3,normalized_doi=$4,year=$5,candidate=$6,updated_at=NOW()
    WHERE id=$1 AND project_id=$7`, [candidateId, parsed.data.title, normalizeTitle(parsed.data.title), normalizeDoi(parsed.data.doi), parsed.data.year, storedCandidate, projectId])
  await audit('related_work.candidate_field_selected', projectId, { candidate_id: candidateId, field_name: provenance.field_name, provenance_id: provenance.id }, input.actor)
  return { candidate_id: candidateId, field_name: provenance.field_name, provenance_id: provenance.id, status: 'selected' }
}

export async function decideRelatedWorkCandidate(projectId: string, candidateId: string, input: RelatedWorkCandidateDecisionRequest) {
  await requireProject(projectId, true)
  const candidate = await candidateForProject(projectId, candidateId)
  if (input.decision === 'approved') {
    if (candidate.paper_id) throw new ApiError(409, 'related_work_candidate_already_confirmed', '该候选已经转换为项目 Paper。')
    const conflicts = await unresolvedCandidateConflicts(projectId, candidateId)
    if (conflicts.length) throw new ApiError(409, 'related_work_candidate_conflicts_unresolved', `字段来源存在冲突，先选择来源：${conflicts.join(', ')}`)
    const current = candidateCore(candidate.candidate || {})
    if (!current.paper) throw new ApiError(422, 'related_work_candidate_invalid', '候选数据不满足 Paper 元数据契约，不能确认。')
    const parsed = current.paper
    const enrichment = current.enrichment
    const bibtex = typeof enrichment.bibtex === 'string' ? enrichment.bibtex : null
    const provenanceRows = await rows<FieldProvenanceRow>(`SELECT field_name,provider,source_type,stable_id,source_attempt_id,artifact_id,retrieved_at,locator,raw_value_hash,normalized_value,status
      FROM related_work_field_provenance WHERE project_id=$1 AND candidate_id=$2 ORDER BY field_name,created_at,id`, [projectId, candidateId])
    const confirmedFieldSnapshot = provenanceRows.map(row => ({
      field_name: row.field_name,
      provider: row.provider,
      source_type: row.source_type,
      stable_id: row.stable_id,
      source_attempt_id: row.source_attempt_id,
      artifact_id: row.artifact_id,
      retrieved_at: row.retrieved_at,
      locator: row.locator,
      raw_value_hash: row.raw_value_hash,
      normalized_value: row.normalized_value,
      status: row.status,
    }))
    const existing = parsed.doi
      ? await one<{ id: string }>('SELECT id FROM papers WHERE project_id=$1 AND LOWER(doi)=LOWER($2) LIMIT 1', [projectId, parsed.doi])
      : await one<{ id: string }>(`SELECT id FROM papers WHERE project_id=$1 AND metadata->>'normalized_title'=$2 LIMIT 1`, [projectId, normalizeTitle(parsed.title)])
    const paperId = existing?.id || crypto.randomUUID()
    if (!existing) {
      await database.query(`INSERT INTO papers(id,project_id,title,doi,source_url,metadata,bibtex,verified,confirmed)
        VALUES ($1,$2,$3,$4,$5,$6,$7,FALSE,TRUE)`, [paperId, projectId, parsed.title, parsed.doi, parsed.source_url, metadataFromCandidate(candidate, parsed, bibtex, confirmedFieldSnapshot, input.actor), bibtex])
    } else {
      await database.query('UPDATE papers SET confirmed=TRUE WHERE id=$1 AND project_id=$2', [paperId, projectId])
    }
    await database.query(`UPDATE related_work_candidates SET paper_id=$2,status='confirmed',updated_at=NOW() WHERE id=$1 AND project_id=$3`, [candidateId, paperId, projectId])
    await database.query(`UPDATE related_work_field_provenance SET status='selected' WHERE candidate_id=$1 AND project_id=$2 AND status='observed'`, [candidateId, projectId])
    await database.query('INSERT INTO related_work_candidate_reviews(id,project_id,candidate_id,decision,reason,actor) VALUES ($1,$2,$3,$4,$5,$6)', [crypto.randomUUID(), projectId, candidateId, 'approved', input.reason, input.actor])
    await audit('related_work.candidate_approved', projectId, { candidate_id: candidateId, paper_id: paperId, existing_paper: Boolean(existing) }, input.actor)
    return { candidate_id: candidateId, paper_id: paperId, status: 'confirmed' }
  }

  const nextStatus = input.decision === 'reopened' ? 'candidate' : 'rejected'
  if (input.decision === 'reopened' && candidate.paper_id) throw new ApiError(409, 'related_work_candidate_confirmed_cannot_reopen', '已确认 Paper 不能重新打开候选状态。')
  await database.query('UPDATE related_work_candidates SET status=$2,updated_at=NOW() WHERE id=$1 AND project_id=$3', [candidateId, nextStatus, projectId])
  await database.query('INSERT INTO related_work_candidate_reviews(id,project_id,candidate_id,decision,reason,actor) VALUES ($1,$2,$3,$4,$5,$6)', [crypto.randomUUID(), projectId, candidateId, input.decision, input.reason, input.actor])
  await audit(`related_work.candidate_${input.decision}`, projectId, { candidate_id: candidateId, reason: input.reason }, input.actor)
  return { candidate_id: candidateId, status: nextStatus }
}

export async function createRelatedWorkEnrichmentProposal(projectId: string, input: RelatedWorkEnrichmentRequest, actor = 'local-user') {
  await requireProject(projectId, true)
  const candidate = await candidateForProject(projectId, input.candidate_id)
  if (candidate.paper_id) throw new ApiError(409, 'related_work_candidate_already_confirmed', '已确认 Paper 不需要候选补全。')
  const payload = { candidate_id: input.candidate_id, fields: input.fields, providers: normalizeProviders(input.providers), max_rounds: input.max_rounds }
  const proposalId = crypto.randomUUID()
  await database.query(`INSERT INTO proposals(id,project_id,kind,reason,summary,impact,payload)
    VALUES ($1,$2,'related_work_field_enrichment',$3,$4,$5,$6)`, [proposalId, projectId, input.reason, `Enrich fields for candidate ${candidate.title}`, { candidate_id: candidate.id, fields: input.fields, providers: input.providers, max_rounds: input.max_rounds, external_requests: true }, payload])
  await audit('related_work.field_enrichment_proposal_created', projectId, { proposal_id: proposalId, ...payload }, actor)
  return { proposal_id: proposalId, status: 'pending', candidate_id: candidate.id, fields: input.fields, providers: payload.providers }
}

async function attachEnrichmentSource(projectId: string, target: CandidateRow, paper: PaperCandidate, attemptId: string, fields: RelatedWorkFieldName[]) {
  await database.query(`INSERT INTO related_work_candidate_sources
    (id,project_id,candidate_id,provider,stable_id,candidate,retrieved_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (project_id,candidate_id,provider,stable_id) DO UPDATE SET candidate=EXCLUDED.candidate,retrieved_at=EXCLUDED.retrieved_at`, [
    crypto.randomUUID(), projectId, target.id, paper.provider, paper.stable_id, paper, paper.retrieved_at,
  ])
  const current = candidateCore(target.candidate || {})
  const merged = current.paper ? mergeEnrichedCandidate(current.paper, paper) : paper
  const enrichment = { ...current.enrichment }
  const institutions = [...new Set(merged.authors.flatMap(author => author.affiliations).filter(Boolean))]
  if (institutions.length) enrichment.institutions = institutions
  const storedCandidate = { ...merged, ...(Object.keys(enrichment).length ? { enrichment } : {}) }
  await database.query(`UPDATE related_work_candidates SET title=$2,normalized_title=$3,normalized_doi=COALESCE(normalized_doi,$4),year=COALESCE(year,$5),candidate=$6,updated_at=NOW() WHERE id=$1 AND project_id=$7`, [target.id, merged.title, normalizeTitle(merged.title), normalizeDoi(merged.doi), merged.year, storedCandidate, projectId])
  await persistCandidateFieldProvenance(projectId, target.id, paper, attemptId, null, fields)
  target.candidate = storedCandidate
}

export async function executeRelatedWorkEnrichment(projectId: string, proposalId: string, actor = 'local-user') {
  const proposal = await one<{ id: string; project_id: string; kind: string; status: string; payload: Record<string, unknown> }>('SELECT id,project_id,kind,status,payload FROM proposals WHERE id=$1 AND project_id=$2', [proposalId, projectId])
  if (!proposal || proposal.kind !== 'related_work_field_enrichment') throw new ApiError(404, 'related_work_enrichment_proposal_not_found', '相关工作字段补全 Proposal 不存在。')
  if (proposal.status !== 'approved') throw new ApiError(409, 'related_work_enrichment_proposal_not_approved', '字段补全必须先获得明确批准。')
  const payload = z.object({
    candidate_id: z.string().uuid(),
    fields: z.array(relatedWorkFieldName),
    providers: z.array(relatedWorkProvider),
    max_rounds: z.number().int().min(1).max(6).optional(),
  }).parse(proposal.payload)
  const adapters = new Map(createDefaultEnrichmentAdapters(providerAdapterOptions()).map(adapter => [adapter.provider, adapter]))
  const attempts: SourceAttempt[] = []
  const savedProviders: RelatedWorkProvider[] = []
  const matchedCounts: Array<{ provider: RelatedWorkProvider; returned_count: number; matched_count: number; rejected_mismatch_count: number }> = []
  const rounds: Array<{ round: number; completeness: number; improved: boolean; providers_with_results: string[] }> = []
  const maxRounds = payload.max_rounds ?? 3
  let candidate = await candidateForProject(projectId, payload.candidate_id)

  const candidateScore = (row: CandidateRow): number => {
    const current = candidateCore(row.candidate || {})
    if (!current.paper) return 0
    const enrichment = current.enrichment || {}
    return paperCompleteness({
      ...current.paper,
      institutions: Array.isArray(enrichment.institutions) ? enrichment.institutions as string[] : [],
    })
  }

  for (let round = 1; round <= maxRounds; round += 1) {
    const beforeScore = candidateScore(candidate)
    let roundImproved = false
    const providersWithResults: string[] = []
    for (const provider of normalizeProviders(payload.providers)) {
      candidate = await candidateForProject(projectId, payload.candidate_id)
      const currentPaper = candidateCore(candidate.candidate || {}).paper
      if (!currentPaper) continue
      const adapter = adapters.get(provider)
      const targetDoi = normalizeDoi(currentPaper.doi)
      if (provider === 'unpaywall' && !targetDoi) continue
      const arxivId = findArxivId(currentPaper)
      const query = provider === 'unpaywall' ? targetDoi! : provider === 'arxiv' && arxivId ? `arxiv:${arxivId}` : currentPaper.title
      let response: CachedExecution<import('./contracts.js').SourceSearchResult>
      try {
        response = adapter
          ? await searchWithCache(projectId, provider, query, { limit: 10, timeout_ms: 15_000 }, () => provider === 'arxiv' && arxivId && adapter instanceof ArxivSourceAdapter
            ? adapter.fetchByArxivId(arxivId, { limit: 10, timeout_ms: 15_000 })
            : adapter.search(query, { limit: 10, timeout_ms: 15_000 }))
          : {
            result: { provider, query, candidates: [], attempt: unexpectedAttempt(provider, query, new Error('provider adapter unavailable')) },
            from_cache: false,
            request_hash: null,
          }
      } catch (error) {
        response = {
          result: { provider, query, candidates: [], attempt: unexpectedAttempt(provider, query, error) },
          from_cache: false,
          request_hash: null,
        }
      }
      const attemptId = await persistAttempt(projectId, response.result.attempt, null, null, candidate.id)
      attempts.push(response.result.attempt)
      const matched = response.result.candidates.filter(paper => {
        const paperDoi = normalizeDoi(paper.doi)
        if (targetDoi && paperDoi) return targetDoi === paperDoi
        if (provider === 'arxiv' && arxivId) return String(paper.stable_id).toLowerCase().includes(arxivId.toLowerCase()) || titlesMatch(currentPaper.title, paper.title)
        if (provider === 'unpaywall') return paperDoi === targetDoi
        return titlesMatch(currentPaper.title, paper.title)
      })
      matchedCounts.push({ provider, returned_count: response.result.candidates.length, matched_count: matched.length, rejected_mismatch_count: response.result.candidates.length - matched.length })
      if (matched.length) {
        savedProviders.push(provider)
        providersWithResults.push(provider)
        roundImproved = true
        for (const paper of matched) await attachEnrichmentSource(projectId, candidate, paper, attemptId, payload.fields)
      }
      if (provider === 'arxiv' && adapter instanceof ArxivSourceAdapter && payload.fields.includes('institutions')) {
        const affiliationResult = await adapter.fetchAuthorAffiliations(currentPaper, { limit: 1, timeout_ms: 15_000 })
        const affiliationAttemptId = await persistAttempt(projectId, affiliationResult.attempt, null, null, candidate.id)
        attempts.push(affiliationResult.attempt)
        if (affiliationResult.candidates.length) {
          matchedCounts.push({ provider, returned_count: 1, matched_count: 1, rejected_mismatch_count: 0 })
          if (!savedProviders.includes(provider)) savedProviders.push(provider)
          if (!providersWithResults.includes(provider)) providersWithResults.push(provider)
          roundImproved = true
          for (const paper of affiliationResult.candidates) await attachEnrichmentSource(projectId, candidate, paper, affiliationAttemptId, payload.fields)
        }
      }
    }
    candidate = await candidateForProject(projectId, payload.candidate_id)
    const afterScore = candidateScore(candidate)
    const improved = roundImproved || afterScore - beforeScore > 0.001
    rounds.push({ round, completeness: afterScore, improved, providers_with_results: providersWithResults })
    if (afterScore >= 0.85) break
    if (!improved) break
  }
  const hasFailures = attempts.some(item => item.status !== 'succeeded')
  const hasMatches = matchedCounts.some(item => item.matched_count > 0)
  const status = hasMatches ? (hasFailures ? 'partial' : 'completed') : hasFailures ? 'failed' : 'no_match'
  await audit(`related_work.field_enrichment_${status}`, projectId, { proposal_id: proposalId, candidate_id: candidate.id, attempts: attempts.map(item => ({ provider: item.provider, status: item.status, result_count: item.result_count })), matched_counts: matchedCounts, rounds }, actor)
  return { proposal_id: proposalId, candidate_id: candidate.id, status, attempts, providers_with_results: [...new Set(savedProviders)], matched_counts: matchedCounts, rounds }
}

export async function createRelatedWorkRecursiveProposal(projectId: string, input: RelatedWorkRecursivePlanRequest, actor = 'local-user') {
  await requireProject(projectId, true)
  const seeds = await rows<SeedRow>('SELECT * FROM related_work_seeds WHERE project_id=$1 AND id = ANY($2::uuid[])', [projectId, input.seed_ids])
  if (seeds.length !== input.seed_ids.length) throw new ApiError(404, 'related_work_seed_not_found', '一个或多个种子不属于当前项目。')
  const candidateLinks = await rows<{ seed_id: string; count: string }>('SELECT seed_id,COUNT(*)::text AS count FROM related_work_seed_candidates WHERE seed_id = ANY($1::uuid[]) GROUP BY seed_id', [input.seed_ids])
  const linkedSeedIds = new Set(candidateLinks.filter(link => Number(link.count) > 0).map(link => link.seed_id))
  if (linkedSeedIds.size !== input.seed_ids.length) throw new ApiError(409, 'related_work_seed_unresolved', '所有递归种子必须先解析为至少一个项目范围候选。')
  const proposalId = crypto.randomUUID()
  const payload = { seed_ids: input.seed_ids, depth: input.depth, width: input.width, max_total: input.max_total, providers: input.providers }
  await database.query(`INSERT INTO proposals(id,project_id,kind,reason,summary,impact,payload)
    VALUES ($1,$2,'related_work_recursive',$3,$4,$5,$6)`, [
    proposalId, projectId, input.reason, 'Expand related work citation network',
    { seed_count: input.seed_ids.length, depth: input.depth, width: input.width, max_total: input.max_total, providers: input.providers, external_requests: true }, payload,
  ])
  await audit('related_work.recursive_proposal_created', projectId, { proposal_id: proposalId, ...payload }, actor)
  return { proposal_id: proposalId, status: 'pending', payload }
}

function unsupportedBatch(provider: RelatedWorkProvider, paper: PaperCandidate): ReferenceBatch {
  const now = new Date().toISOString()
  const attempt = sourceAttempt.parse({
    provider,
    query: paper.stable_id,
    request_url: sourceUrlForProvider(provider),
    started_at: now,
    finished_at: now,
    status: 'unsupported',
    http_status: null,
    result_count: 0,
    failure: { code: 'unsupported', message: `${provider} 当前没有可用的引用 API 适配器`, retryable: false, http_status: null },
  })
  return { provider, references: [], attempt, attempts: [attempt] }
}

function defaultRanking(paper: PaperCandidate): RankedReference {
  const count = paper.citation_count
  return count === null
    ? { paper, ranking_score: null, ranking_reasons: ['no_ranking_signal'] }
    : { paper, ranking_score: Math.min(count, 10_000), ranking_reasons: [`citation_count:${count}`] }
}

async function startRun(run: RunRow, actor: string): Promise<void> {
  const controller = new AbortController()
  runningControllers.set(run.id, controller)
  try {
    const existing = await one<{ cancel_requested: boolean; status: string }>('SELECT cancel_requested,status FROM related_work_recursive_runs WHERE id=$1 AND project_id=$2', [run.id, run.project_id])
    if (!existing || existing.cancel_requested || existing.status === 'cancelled') {
      await database.query("UPDATE related_work_recursive_runs SET status='cancelled',finished_at=NOW() WHERE id=$1", [run.id])
      return
    }
    await database.query("UPDATE related_work_recursive_runs SET status='running',started_at=NOW() WHERE id=$1", [run.id])
    await database.query('INSERT INTO related_work_run_events(id,project_id,run_id,event_type,payload) VALUES ($1,$2,$3,$4,$5)', [crypto.randomUUID(), run.project_id, run.id, 'started', { actor, depth: run.depth, width: run.width, max_total: run.max_total, providers: run.providers }])
    await audit('related_work.recursive_started', run.project_id, { run_id: run.id, proposal_id: run.proposal_id }, actor)

    const seeds = await rows<{ seed_id: string; candidate_id: string }>('SELECT seed_id,candidate_id FROM related_work_seed_candidates WHERE seed_id = ANY($1::uuid[]) ORDER BY created_at,candidate_id', [run.seed_ids])
    const seedCandidates: PaperCandidate[] = []
    for (const link of seeds) {
      const row = await one<CandidateRow>('SELECT * FROM related_work_candidates WHERE id=$1 AND project_id=$2', [link.candidate_id, run.project_id])
      if (!row) continue
      const parsed = paperCandidate.safeParse(row.candidate)
      if (parsed.success && !seedCandidates.some(item => normalizeDoi(item.doi) === normalizeDoi(parsed.data.doi) && normalizeTitle(item.title) === normalizeTitle(parsed.data.title) && item.year === parsed.data.year)) seedCandidates.push(parsed.data)
    }
    if (!seedCandidates.length) throw new ApiError(409, 'related_work_seed_candidates_missing', '递归运行没有可用的种子候选。')

    const adapters = new Map(createDefaultCitationSourceAdapters(providerAdapterOptions()).map(adapter => [adapter.provider, adapter]))
    const requestOptionsBase: Omit<SourceSearchOptions, 'limit'> = { timeout_ms: 15_000 }
    const result = await recursiveCollect(seedCandidates, {
      depth: run.depth,
      width: run.width,
      max_total: run.max_total,
      request_options: requestOptionsBase,
      signal: controller.signal,
      on_progress: async event => {
        await database.query('INSERT INTO related_work_run_events(id,project_id,run_id,event_type,level,payload) VALUES ($1,$2,$3,$4,$5,$6)', [crypto.randomUUID(), run.project_id, run.id, 'progress', event.level, event])
        await database.query('UPDATE related_work_recursive_runs SET discovered_count=$2,failure_count=$3 WHERE id=$1', [run.id, event.total_count, event.provider_failures])
      },
      fetch_references: async (paper, options) => {
        const parent = await findCandidate(run.project_id, paper)
        const batches = await Promise.all(run.providers.map(async provider => {
          const adapter = adapters.get(provider)
          if (!adapter) return unsupportedBatch(provider, paper)
          try {
            const execution = await referencesWithCache(run.project_id, provider, paper, options, () => adapter.fetchReferences(paper, options))
            const referenceResult = execution.result
            const rankedReferences = referenceResult.ranked_references || referenceResult.candidates.map(defaultRanking)
            return {
              provider,
              references: rankedReferences,
              attempt: referenceResult.attempt,
              attempts: referenceResult.attempts || [referenceResult.attempt],
              cache_hit: execution.from_cache,
              cache_hash: execution.request_hash,
            }
          } catch (error) {
            const attempt = unexpectedAttempt(provider, paper.stable_id, error)
            return { provider, references: [], attempt, attempts: [attempt] }
          }
        }))
        return Promise.all(batches.map(async batch => {
          const attemptIds: string[] = []
          for (const attempt of batch.attempts || [batch.attempt]) attemptIds.push(await persistAttempt(run.project_id, attempt, null, run.id, parent.row?.id || null))
          return { ...batch, attempt_ids: attemptIds }
        }))
      },
    })

    for (const discovered of result.papers) {
      const saved = await saveCandidate(run.project_id, discovered.paper, discovered.discovery_depth, run.id, null, discovered.source_attempt_id || null)
      if (saved.row.paper_id === null && discovered.discovery_depth === 0) {
        await database.query('UPDATE related_work_candidates SET first_run_id=COALESCE(first_run_id,$2) WHERE id=$1', [saved.row.id, run.id])
      }
    }
    let edgeCount = 0
    for (const edge of result.edges) {
      const sourcePaper = result.papers.find(item => item.paper.stable_id === edge.source_stable_id)?.paper
      const targetPaper = result.papers.find(item => item.paper.stable_id === edge.target_stable_id)?.paper
      const source = sourcePaper ? await findCandidate(run.project_id, sourcePaper) : { row: null }
      const target = targetPaper ? await findCandidate(run.project_id, targetPaper) : { row: null }
      if (!source.row || !target.row) {
        await database.query('INSERT INTO related_work_run_events(id,project_id,run_id,event_type,payload) VALUES ($1,$2,$3,$4,$5)', [crypto.randomUUID(), run.project_id, run.id, 'edge_skipped_missing_node', { source_stable_id: edge.source_stable_id, target_stable_id: edge.target_stable_id, provider: edge.provider }])
        continue
      }
      await database.query(`INSERT INTO related_work_citation_edges
        (id,project_id,run_id,source_candidate_id,target_candidate_id,provider,relation,ranking_score,ranking_reasons,discovery_depth)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (project_id,source_candidate_id,target_candidate_id,provider,relation) DO NOTHING`, [
        crypto.randomUUID(), run.project_id, run.id, source.row.id, target.row.id, edge.provider, edge.relation, edge.ranking_score, edge.ranking_reasons, targetPaper ? result.papers.find(item => item.paper.stable_id === targetPaper.stable_id)?.discovery_depth || 0 : 0,
      ])
      edgeCount += 1
    }
    const failures = result.attempts.filter(attempt => attempt.status !== 'succeeded')
    const successes = result.attempts.filter(attempt => attempt.status === 'succeeded' || attempt.status === 'partial')
    const status = result.cancelled
      ? 'cancelled'
      : failures.length === 0
        ? result.truncated ? 'max_total_reached' : 'completed'
        : successes.length > 0 ? 'partial' : 'failed'
    const error = failures.length ? JSON.stringify(failures.map(attempt => ({ provider: attempt.provider, status: attempt.status, failure: attempt.failure }))) : null
    await database.query('UPDATE related_work_recursive_runs SET status=$2,discovered_count=$3,edge_count=$4,failure_count=$5,error=$6,finished_at=NOW() WHERE id=$1', [run.id, status, result.papers.length, edgeCount, failures.length, error])
    await database.query('INSERT INTO related_work_run_events(id,project_id,run_id,event_type,payload) VALUES ($1,$2,$3,$4,$5)', [crypto.randomUUID(), run.project_id, run.id, 'finished', { status, discovered_count: result.papers.length, edge_count: edgeCount, failure_count: failures.length, truncated: result.truncated, cancelled: result.cancelled }])
    await audit(`related_work.recursive_${status}`, run.project_id, { run_id: run.id, discovered_count: result.papers.length, edge_count: edgeCount, failure_count: failures.length }, actor)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'related-work recursive run failed'
    await database.query("UPDATE related_work_recursive_runs SET status='failed',error=$2,finished_at=NOW() WHERE id=$1", [run.id, message.slice(0, 4_000)])
    await database.query('INSERT INTO related_work_run_events(id,project_id,run_id,event_type,payload) VALUES ($1,$2,$3,$4,$5)', [crypto.randomUUID(), run.project_id, run.id, 'failed', { message: message.slice(0, 4_000) }])
    await audit('related_work.recursive_failed', run.project_id, { run_id: run.id, error: message.slice(0, 2_000) }, actor)
  } finally {
    runningControllers.delete(run.id)
  }
}

export async function startRelatedWorkRun(projectId: string, proposalId: string, actor = 'local-user') {
  const proposal = await one<{ id: string; project_id: string; kind: string; status: string; payload: Record<string, unknown> }>('SELECT id,project_id,kind,status,payload FROM proposals WHERE id=$1 AND project_id=$2', [proposalId, projectId])
  if (!proposal) throw new ApiError(404, 'related_work_proposal_not_found', '相关工作递归 Proposal 不属于当前项目。')
  if (proposal.kind !== 'related_work_recursive') throw new ApiError(409, 'related_work_proposal_kind_invalid', '该 Proposal 不是相关工作递归任务。')
  if (proposal.status !== 'approved') throw new ApiError(409, 'related_work_proposal_not_approved', '相关工作递归必须先获得明确批准。')
  const existing = await one<RunRow>('SELECT * FROM related_work_recursive_runs WHERE proposal_id=$1', [proposalId])
  if (existing) {
    if (existing.status === 'queued' && !runningControllers.has(existing.id)) void startRun(existing, actor)
    return { run_id: existing.id, status: existing.status }
  }
  const payload = z.object({ seed_ids: z.array(z.string().uuid()), depth: z.number().int(), width: z.number().int(), max_total: z.number().int(), providers: z.array(z.enum(['crossref', 'openalex', 'semantic_scholar', 'dblp', 'arxiv'])) }).parse(proposal.payload)
  const runId = crypto.randomUUID()
  await database.query(`INSERT INTO related_work_recursive_runs(id,project_id,proposal_id,seed_ids,providers,depth,width,max_total)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [runId, projectId, proposalId, payload.seed_ids, payload.providers, payload.depth, payload.width, payload.max_total])
  const run = (await one<RunRow>('SELECT * FROM related_work_recursive_runs WHERE id=$1', [runId]))!
  void startRun(run, actor)
  return { run_id: runId, status: 'queued' }
}

export async function resumeQueuedRelatedWorkRuns(actor = 'restart-recovery'): Promise<number> {
  const runs = await rows<RunRow>(`SELECT * FROM related_work_recursive_runs
    WHERE status='queued' AND cancel_requested=FALSE ORDER BY created_at,id`)
  for (const run of runs) {
    if (!runningControllers.has(run.id)) void startRun(run, actor)
  }
  return runs.length
}

export async function cancelRelatedWorkRun(projectId: string, runId: string, reason: string, actor = 'local-user') {
  const run = await one<RunRow>('SELECT * FROM related_work_recursive_runs WHERE id=$1 AND project_id=$2', [runId, projectId])
  if (!run) throw new ApiError(404, 'related_work_run_not_found', '相关工作递归运行不存在。')
  if (['completed', 'partial', 'failed', 'cancelled', 'max_total_reached'].includes(run.status)) throw new ApiError(409, 'related_work_run_finished', '相关工作递归运行已经结束。')
  await database.query("UPDATE related_work_recursive_runs SET cancel_requested=TRUE,status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END,finished_at=CASE WHEN status='queued' THEN NOW() ELSE finished_at END WHERE id=$1", [runId])
  runningControllers.get(runId)?.abort()
  await database.query('INSERT INTO related_work_run_events(id,project_id,run_id,event_type,payload) VALUES ($1,$2,$3,$4,$5)', [crypto.randomUUID(), projectId, runId, 'cancel_requested', { reason, actor }])
  await audit('related_work.recursive_cancel_requested', projectId, { run_id: runId, reason }, actor)
  return { run_id: runId, status: 'cancel_requested' }
}

export async function relatedWorkRunDetail(projectId: string, runId: string) {
  const run = await one<RunRow>('SELECT * FROM related_work_recursive_runs WHERE id=$1 AND project_id=$2', [runId, projectId])
  if (!run) throw new ApiError(404, 'related_work_run_not_found', '相关工作递归运行不存在。')
  const [events, attempts, edges] = await Promise.all([
    rows('SELECT * FROM related_work_run_events WHERE run_id=$1 AND project_id=$2 ORDER BY created_at,id', [runId, projectId]),
    rows('SELECT * FROM related_work_source_attempts WHERE run_id=$1 AND project_id=$2 ORDER BY created_at,id', [runId, projectId]),
    rows('SELECT e.*,s.title AS source_title,t.title AS target_title FROM related_work_citation_edges e JOIN related_work_candidates s ON s.id=e.source_candidate_id JOIN related_work_candidates t ON t.id=e.target_candidate_id WHERE e.run_id=$1 AND e.project_id=$2 ORDER BY e.created_at,e.id', [runId, projectId]),
  ])
  return { project_id: projectId, run, events, attempts, edges }
}
