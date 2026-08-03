import type { CitationEdge, PaperCandidate, RelatedWorkProvider, SourceAttempt, SourceSearchOptions } from './contracts.js'
import { citationEdge, normalizeDoi, normalizeTitle } from './contracts.js'

export type RankedReference = {
  paper: PaperCandidate
  ranking_score?: number | null
  ranking_reasons?: string[]
  provider?: RelatedWorkProvider
  retrieved_at?: string
  source_attempt_id?: string | null
}

export type ReferenceBatch = {
  provider: RelatedWorkProvider
  references: RankedReference[]
  attempt: SourceAttempt
  attempts?: SourceAttempt[]
  attempt_ids?: string[]
}

export type FetchReferencesResult = ReferenceBatch | ReferenceBatch[]

export type RecursiveSearchOptions = {
  depth: number
  width: number
  max_total: number
  request_options: Omit<SourceSearchOptions, 'limit'>
  signal?: AbortSignal
  on_progress?: (event: RecursiveProgress) => void | Promise<void>
  fetch_references: (paper: PaperCandidate, options: SourceSearchOptions) => Promise<FetchReferencesResult>
}

export type RecursiveProgress = {
  level: number
  new_count: number
  total_count: number
  parent_count: number
  provider_failures: number
  status: 'started' | 'completed' | 'cancelled' | 'max_total_reached'
}

export type DiscoveredPaper = {
  paper: PaperCandidate
  discovery_depth: number
  source_attempt_id?: string | null
}

export type RecursiveSearchResult = {
  papers: DiscoveredPaper[]
  edges: CitationEdge[]
  attempts: SourceAttempt[]
  cancelled: boolean
  truncated: boolean
}

function paperKey(paper: PaperCandidate): string {
  return paperKeys(paper)[0] || `title:${normalizeTitle(paper.title)}:${paper.year ?? 'unknown'}`
}

function paperKeys(paper: PaperCandidate): string[] {
  const keys: string[] = []
  const doi = normalizeDoi(paper.doi)
  if (doi) keys.push(`doi:${doi}`)

  const stableId = paper.stable_id.trim().toLowerCase()
  if (stableId && !stableId.includes(':title:')) keys.push(`stable:${stableId}`)

  // A provider may not expose a stable identifier. For those records the
  // normalized title/year pair is the deterministic cross-provider key.
  if (!doi) keys.push(`title:${normalizeTitle(paper.title)}:${paper.year ?? 'unknown'}`)
  return [...new Set(keys)]
}

function isCancelled(signal: AbortSignal | undefined): boolean {
  return Boolean(signal?.aborted)
}

function rankedReferences(references: RankedReference[]): RankedReference[] {
  return [...references].sort((left, right) => {
    const score = (right.ranking_score ?? 0) - (left.ranking_score ?? 0)
    if (score !== 0) return score
    const leftKey = `${paperKey(left.paper)}:${left.provider || ''}:${left.paper.stable_id.toLowerCase()}:${(left.ranking_reasons || []).join('|')}`
    const rightKey = `${paperKey(right.paper)}:${right.provider || ''}:${right.paper.stable_id.toLowerCase()}:${(right.ranking_reasons || []).join('|')}`
    return leftKey.localeCompare(rightKey)
  })
}

export async function recursiveCollect(seedPapers: PaperCandidate[], options: RecursiveSearchOptions): Promise<RecursiveSearchResult> {
  // Keep every identity alias pointing at one canonical record. This lets a
  // DOI, a provider stable ID, and a title/year fallback converge without
  // allowing an edge to reference a discarded duplicate.
  const seen = new Map<string, DiscoveredPaper>()
  const ordered: DiscoveredPaper[] = []
  const edges = new Map<string, CitationEdge>()
  const attempts: SourceAttempt[] = []
  let current: DiscoveredPaper[] = []
  let cancelled = false
  let truncated = false

  const findSeen = (paper: PaperCandidate): DiscoveredPaper | undefined => {
    for (const key of paperKeys(paper)) {
      const discovered = seen.get(key)
      if (discovered) return discovered
    }
    return undefined
  }

  const addSeen = (paper: PaperCandidate, discoveryDepth: number, sourceAttemptId: string | null = null): DiscoveredPaper => {
    const discovered = { paper, discovery_depth: discoveryDepth, source_attempt_id: sourceAttemptId }
    for (const key of paperKeys(paper)) seen.set(key, discovered)
    ordered.push(discovered)
    return discovered
  }

  for (const paper of seedPapers) {
    if (ordered.length >= options.max_total) {
      truncated = true
      break
    }
    if (findSeen(paper)) continue
    const discovered = addSeen(paper, 0)
    current.push(discovered)
  }
  await options.on_progress?.({ level: 0, new_count: current.length, total_count: ordered.length, parent_count: 0, provider_failures: 0, status: 'started' })

  for (let level = 1; level < options.depth && current.length; level += 1) {
    if (isCancelled(options.signal)) {
      cancelled = true
      await options.on_progress?.({ level, new_count: 0, total_count: ordered.length, parent_count: current.length, provider_failures: 0, status: 'cancelled' })
      break
    }
    if (ordered.length >= options.max_total) {
      truncated = true
      await options.on_progress?.({ level, new_count: 0, total_count: ordered.length, parent_count: current.length, provider_failures: 0, status: 'max_total_reached' })
      break
    }

    const batches = await Promise.all(current.map(parent => {
      const requestOptions: SourceSearchOptions = { ...options.request_options, limit: Math.max(options.width, 1) }
      if (options.signal) requestOptions.signal = options.signal
      return options.fetch_references(parent.paper, requestOptions)
    }))
    const nextLevel: DiscoveredPaper[] = []
    let providerFailures = 0
    for (let parentIndex = 0; parentIndex < current.length; parentIndex += 1) {
      const parent = current[parentIndex]
      const parentBatches = batches[parentIndex]
      if (!parent || !parentBatches) continue
      const normalizedBatches = Array.isArray(parentBatches) ? parentBatches : [parentBatches]
      for (const batch of normalizedBatches) {
        attempts.push(...(batch.attempts || [batch.attempt]))
        if (batch.attempt.status !== 'succeeded') providerFailures += 1
      }
      const references = normalizedBatches.flatMap(batch => batch.references.map(reference => ({
        ...reference,
        provider: batch.provider,
        retrieved_at: batch.attempt.finished_at,
        source_attempt_id: reference.source_attempt_id || batch.attempt_ids?.[batch.attempt_ids.length - 1] || null,
      })))
      const ranked = rankedReferences(references)
      for (const reference of ranked.slice(0, options.width)) {
        if (isCancelled(options.signal)) {
          cancelled = true
          break
        }
        const existing = findSeen(reference.paper)
        let child = existing
        if (!child) {
          if (ordered.length >= options.max_total) {
            truncated = true
            break
          }
          child = addSeen(reference.paper, level, reference.source_attempt_id || null)
          nextLevel.push(child)
        }
        const edge = citationEdge.parse({
          provider: reference.provider || normalizedBatches[0]!.provider,
          source_stable_id: parent.paper.stable_id,
          target_stable_id: child.paper.stable_id,
          relation: 'references',
          retrieved_at: reference.retrieved_at || normalizedBatches[0]!.attempt.finished_at,
          ranking_score: reference.ranking_score ?? null,
          ranking_reasons: reference.ranking_reasons || [],
        })
        edges.set(`${parent.paper.stable_id}->${child.paper.stable_id}->${reference.provider}`, edge)
      }
      if (cancelled || truncated) break
    }
    await options.on_progress?.({ level, new_count: nextLevel.length, total_count: ordered.length, parent_count: current.length, provider_failures: providerFailures, status: cancelled ? 'cancelled' : truncated ? 'max_total_reached' : 'completed' })
    current = nextLevel
    if (cancelled || truncated) break
  }

  return {
    papers: ordered,
    edges: [...edges.values()].sort((left, right) => `${left.source_stable_id}:${left.target_stable_id}:${left.provider}:${left.relation}`.localeCompare(`${right.source_stable_id}:${right.target_stable_id}:${right.provider}:${right.relation}`)),
    attempts,
    cancelled,
    truncated,
  }
}
