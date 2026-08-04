import { XMLParser, XMLValidator } from 'fast-xml-parser'
import type { FetchImplementation, RequestPayload } from './transport.js'
import { invalidResponseAttempt, requestJson, requestText, requestXml } from './transport.js'
import {
  normalizeDoi,
  paperCandidate,
  type PaperCandidate,
  type RelatedWorkProvider,
  type ReferenceSearchResult,
  sourceAttempt,
  type SourceAttempt,
  type SourceSearchOptions,
  type SourceSearchResult,
  stablePaperId,
} from './contracts.js'
import { mergeEnrichedAuthors } from './paper-fields.js'
import type { CitationSourceAdapter, SearchSourceAdapter } from './contracts.js'

export type SourceAdapterOptions = {
  fetch_impl?: FetchImplementation
  semantic_scholar_api_key?: string
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function urlValue(value: unknown): string | null {
  const candidate = stringValue(value)
  if (!candidate) return null
  try {
    return new URL(candidate).toString()
  } catch {
    return null
  }
}

function yearValue(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(number) && number >= 0 && number <= 3_000 ? number : null
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    const string = stringValue(item)
    return string ? [string] : []
  })
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function author(name: unknown, orcid: unknown = null, affiliations: unknown = []): PaperCandidate['authors'][number] | null {
  const authorName = stringValue(name)
  if (!authorName) return null
  return {
    name: authorName,
    orcid: urlValue(orcid),
    affiliations: stringArray(affiliations),
    email: null,
    is_corresponding: null,
    scholar_id: null,
    interests: [],
    citation_stats: null,
  }
}

function authorsFromItems(value: unknown, get: (item: Record<string, unknown>) => { name: unknown; orcid?: unknown; affiliations?: unknown }): PaperCandidate['authors'] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    const data = record(item)
    if (!data) return []
    const parsed = author(get(data).name, get(data).orcid, get(data).affiliations)
    return parsed ? [parsed] : []
  })
}

function abstractText(value: unknown): string | null {
  const text = stringValue(value)
  if (!text) return null
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null
}

function candidate(provider: RelatedWorkProvider, query: string, input: {
  stable_id: string
  title: unknown
  authors?: PaperCandidate['authors']
  year?: unknown
  venue?: unknown
  doi?: unknown
  abstract?: unknown
  pdf_url?: unknown
  html_url?: unknown
  source_url: unknown
  license?: { url?: unknown; terms_url?: unknown; spdx?: unknown } | null
  citation_count?: unknown
  open_access?: unknown
}): PaperCandidate | null {
  const title = stringValue(input.title)
  const sourceUrl = urlValue(input.source_url)
  if (!title || !sourceUrl) return null
  const parsed = paperCandidate.safeParse({
    provider,
    stable_id: input.stable_id,
    title,
    authors: input.authors || [],
    year: yearValue(input.year),
    venue: stringValue(input.venue),
    doi: normalizeDoi(stringValue(input.doi)),
    abstract: abstractText(input.abstract),
    pdf_url: urlValue(input.pdf_url),
    html_url: urlValue(input.html_url),
    license: input.license ? {
      spdx: stringValue(input.license.spdx),
      url: urlValue(input.license.url),
      terms_url: urlValue(input.license.terms_url),
    } : null,
    citation_count: numberValue(input.citation_count),
    open_access: typeof input.open_access === 'boolean' ? input.open_access : null,
    source_url: sourceUrl,
    query,
    retrieved_at: new Date().toISOString(),
  })
  return parsed.success ? parsed.data : null
}

function countAttempt(attempt: SourceAttempt, resultCount: number): SourceAttempt {
  return sourceAttempt.parse({ ...attempt, result_count: resultCount })
}

function invalidResult(provider: RelatedWorkProvider, query: string, attempt: SourceAttempt, message: string): SourceSearchResult {
  return {
    provider,
    query,
    candidates: [],
    attempt: invalidResponseAttempt(attempt, message),
  }
}

function successResult(provider: RelatedWorkProvider, query: string, attempt: SourceAttempt, candidates: PaperCandidate[]): SourceSearchResult {
  return {
    provider,
    query,
    candidates,
    attempt: countAttempt(attempt, candidates.length),
  }
}

function aggregateAttempt(provider: RelatedWorkProvider, query: string, requestUrl: string, attempts: SourceAttempt[], resultCount: number): SourceAttempt {
  const failures = attempts.filter(attempt => attempt.status !== 'succeeded')
  const status: SourceAttempt['status'] = failures.length === 0
    ? 'succeeded'
    : resultCount > 0
      ? 'partial'
      : failures.every(attempt => attempt.status === 'unsupported')
        ? 'unsupported'
        : 'failed'
  return sourceAttempt.parse({
    provider,
    query,
    request_url: requestUrl,
    started_at: attempts[0]?.started_at || new Date().toISOString(),
    finished_at: attempts.at(-1)?.finished_at || new Date().toISOString(),
    status,
    http_status: attempts.find(attempt => attempt.http_status !== null)?.http_status || null,
    result_count: resultCount,
    failure: failures[0]?.failure || null,
  })
}

function referenceResult(provider: RelatedWorkProvider, source: PaperCandidate, requestUrl: string, candidates: PaperCandidate[], attempts: SourceAttempt[]): ReferenceSearchResult {
  return {
    provider,
    source,
    candidates,
    edges: [],
    attempt: aggregateAttempt(provider, source.stable_id, requestUrl, attempts, candidates.length),
    attempts,
  }
}

function unsupportedReference(provider: RelatedWorkProvider, source: PaperCandidate, requestUrl: string, message: string): ReferenceSearchResult {
  const now = new Date().toISOString()
  const attempt = sourceAttempt.parse({
    provider,
    query: source.stable_id,
    request_url: requestUrl,
    started_at: now,
    finished_at: now,
    status: 'unsupported',
    http_status: null,
    result_count: 0,
    failure: { code: 'unsupported', message, retryable: false, http_status: null },
  })
  return { provider, source, candidates: [], edges: [], attempt, attempts: [attempt] }
}

function searchUrl(base: string, params: Record<string, string>): string {
  const url = new URL(base)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url.toString()
}

abstract class JsonSourceAdapter implements SearchSourceAdapter {
  abstract readonly provider: RelatedWorkProvider

  protected readonly fetch_impl: FetchImplementation

  constructor(options: SourceAdapterOptions = {}) {
    this.fetch_impl = options.fetch_impl ?? fetch
  }

  protected async json(query: string, url: string, options: SourceSearchOptions) {
    return requestJson({ provider: this.provider, query, request_url: url, options, fetch_impl: this.fetch_impl })
  }

  abstract search(query: string, options: SourceSearchOptions): Promise<SourceSearchResult>
}

export class CrossrefSourceAdapter extends JsonSourceAdapter implements CitationSourceAdapter {
  readonly provider = 'crossref' as const

  async search(query: string, options: SourceSearchOptions): Promise<SourceSearchResult> {
    const url = searchUrl('https://api.crossref.org/works', {
      'query.bibliographic': query,
      rows: String(Math.min(options.limit, 100)),
      select: 'DOI,title,author,published,container-title,URL,link,license,abstract,is-referenced-by-count',
    })
    const response = await this.json(query, url, options)
    if (!response.value) return { provider: this.provider, query, candidates: [], attempt: response.attempt }
    const root = record(response.value)
    const message = record(root?.message)
    const items = message?.items
    if (!Array.isArray(items)) return invalidResult(this.provider, query, response.attempt, 'Crossref response.message.items is missing')
    const candidates = items.flatMap(item => {
      const data = record(item)
      if (!data) return []
      const title = Array.isArray(data.title) ? data.title[0] : data.title
      const doi = normalizeDoi(stringValue(data.DOI))
      const urlValueFromRecord = urlValue(data.URL) || (doi ? `https://doi.org/${doi}` : null)
      const links = Array.isArray(data.link) ? data.link.flatMap(link => {
        const entry = record(link)
        return entry ? [entry] : []
      }) : []
      const pdf = links.find(link => String(link['content-type'] || '').toLowerCase() === 'application/pdf')
      const authors = authorsFromItems(data.author, item => ({
        name: [item.given, item.family].filter(Boolean).join(' '),
        affiliations: Array.isArray(item.affiliation) ? item.affiliation.flatMap(value => {
          const affiliation = record(value)
          return affiliation ? [affiliation.name] : []
        }) : [],
      }))
      const issued = record(data.issued)
      const dateParts = Array.isArray(issued?.['date-parts']) ? issued['date-parts'] : []
      const firstDate = Array.isArray(dateParts[0]) ? dateParts[0][0] : null
      const licenseData = Array.isArray(data.license) ? record(data.license[0]) : null
      const paper = candidate(this.provider, query, {
        stable_id: stablePaperId(this.provider, doi, String(title || '')),
        title,
        authors,
        year: firstDate,
        venue: Array.isArray(data['container-title']) ? data['container-title'][0] : null,
        doi,
        abstract: data.abstract,
        pdf_url: pdf?.URL,
        html_url: urlValueFromRecord,
        source_url: urlValueFromRecord,
        citation_count: data['is-referenced-by-count'],
        open_access: Boolean(pdf),
        license: licenseData ? { url: licenseData.URL, terms_url: licenseData.URL } : null,
      })
      return paper ? [paper] : []
    })
    return successResult(this.provider, query, response.attempt, candidates)
  }

  async fetchReferences(paper: PaperCandidate, options: SourceSearchOptions): Promise<ReferenceSearchResult> {
    const doi = normalizeDoi(paper.doi)
    if (!doi) return unsupportedReference(this.provider, paper, `https://api.crossref.org/works`, 'Crossref references require a DOI')
    const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`
    const response = await this.json(paper.stable_id, url, options)
    if (!response.value) return referenceResult(this.provider, paper, url, [], [response.attempt])
    const root = record(response.value)
    const message = record(root?.message)
    const references = message?.reference
    if (!Array.isArray(references)) {
      const invalid = invalidResponseAttempt(response.attempt, 'Crossref response.message.reference is missing')
      return { provider: this.provider, source: paper, candidates: [], edges: [], attempt: invalid, attempts: [invalid] }
    }
    const candidates = references.flatMap(referenceValue => {
      const reference = record(referenceValue)
      if (!reference) return []
      const title = stringValue(reference['article-title']) || stringValue(reference.unstructured)
      if (!title) return []
      const referenceDoi = normalizeDoi(stringValue(reference.DOI))
      const stableId = stablePaperId(this.provider, referenceDoi || stringValue(reference.key), title)
      const sourceUrl = referenceDoi ? `https://doi.org/${referenceDoi}` : searchUrl('https://api.crossref.org/works', { 'query.bibliographic': title })
      const authors = stringValue(reference.author) ? [author(reference.author)] : []
      return [candidate(this.provider, paper.stable_id, {
        stable_id: stableId,
        title,
        authors: authors.flatMap(value => value ? [value] : []),
        year: reference.year,
        venue: reference['journal-title'],
        doi: referenceDoi,
        html_url: sourceUrl,
        source_url: sourceUrl,
        open_access: null,
      })].filter((value): value is PaperCandidate => Boolean(value))
    })
    return referenceResult(this.provider, paper, url, candidates, [countAttempt(response.attempt, candidates.length)])
  }
}

function reconstructOpenAlexAbstract(value: unknown): string | null {
  const inverted = record(value)
  if (!inverted) return null
  const words = new Map<number, string>()
  for (const [word, positions] of Object.entries(inverted)) {
    if (!Array.isArray(positions)) continue
    for (const position of positions) if (typeof position === 'number') words.set(position, word)
  }
  return [...words.entries()].sort((left, right) => left[0] - right[0]).map(([, word]) => word).join(' ') || null
}

export class OpenAlexSourceAdapter extends JsonSourceAdapter implements CitationSourceAdapter {
  readonly provider = 'openalex' as const

  async search(query: string, options: SourceSearchOptions): Promise<SourceSearchResult> {
    const url = searchUrl('https://api.openalex.org/works', {
      search: query,
      'per-page': String(Math.min(options.limit, 100)),
      mailto: process.env.RESEARCH_CONTACT_EMAIL || 'research@example.com',
    })
    const response = await this.json(query, url, options)
    if (!response.value) return { provider: this.provider, query, candidates: [], attempt: response.attempt }
    const root = record(response.value)
    const items = root?.results
    if (!Array.isArray(items)) return invalidResult(this.provider, query, response.attempt, 'OpenAlex response.results is missing')
    const candidates = items.flatMap(item => {
      const data = record(item)
      if (!data) return []
      const ids = record(data.ids)
      const doi = normalizeDoi(stringValue(ids?.doi))
      const bestLocation = record(data.best_oa_location)
      const primaryLocation = record(data.primary_location)
      const openAccess = record(data.open_access)
      const source = record(primaryLocation?.source)
      const sourceUrl = urlValue(ids?.doi) || urlValue(data.id)
      const paper = candidate(this.provider, query, {
        stable_id: stablePaperId(this.provider, stringValue(data.id) || doi, String(data.title || '')),
        title: data.title,
        authors: Array.isArray(data.authorships) ? data.authorships.flatMap(item => {
          const authorship = record(item)
          const authorRecord = record(authorship?.author)
          const parsed = author(authorRecord?.display_name, authorRecord?.orcid, Array.isArray(authorship?.institutions) ? authorship.institutions.flatMap(value => record(value)?.display_name || []) : [])
          return parsed ? [parsed] : []
        }) : [],
        year: data.publication_year,
        venue: source?.display_name,
        doi,
        abstract: reconstructOpenAlexAbstract(data.abstract_inverted_index),
        pdf_url: bestLocation?.pdf_url || primaryLocation?.pdf_url,
        html_url: bestLocation?.landing_page_url || primaryLocation?.landing_page_url || sourceUrl,
        source_url: sourceUrl,
        citation_count: data.cited_by_count,
        open_access: openAccess?.is_oa,
        license: bestLocation ? { url: bestLocation.license_id, terms_url: bestLocation.license_id } : null,
      })
      return paper ? [paper] : []
    })
    return successResult(this.provider, query, response.attempt, candidates)
  }

  async fetchReferences(paper: PaperCandidate, options: SourceSearchOptions): Promise<ReferenceSearchResult> {
    const stableValue = paper.stable_id.replace(/^openalex:/i, '')
    const workId = stableValue.match(/(?:openalex\.org\/)?(W\d+)$/i)?.[1]
    if (!workId) return unsupportedReference(this.provider, paper, 'https://api.openalex.org/works', 'OpenAlex references require an OpenAlex work id')
    const workUrl = `https://api.openalex.org/works/${workId}`
    const workResponse = await this.json(paper.stable_id, workUrl, options)
    if (!workResponse.value) return referenceResult(this.provider, paper, workUrl, [], [workResponse.attempt])
    const work = record(workResponse.value)
    const references = Array.isArray(work?.referenced_works) ? work.referenced_works.flatMap(value => {
      const id = stringValue(value)?.match(/(?:openalex\.org\/)?(W\d+)$/i)?.[1]
      return id ? [id] : []
    }).slice(0, Math.min(options.limit, 100)) : []
    if (!references.length) return referenceResult(this.provider, paper, workUrl, [], [countAttempt(workResponse.attempt, 0)])
    const detailsUrl = searchUrl('https://api.openalex.org/works', {
      filter: `ids.openalex:${references.join('|')}`,
      'per-page': String(Math.min(references.length, 100)),
      mailto: process.env.RESEARCH_CONTACT_EMAIL || 'research@example.com',
    })
    const detailsResponse = await this.json(paper.stable_id, detailsUrl, options)
    const attempts = [workResponse.attempt, detailsResponse.attempt]
    if (!detailsResponse.value) return referenceResult(this.provider, paper, detailsUrl, [], attempts)
    const root = record(detailsResponse.value)
    const items = Array.isArray(root?.results) ? root.results : null
    if (!items) {
      const invalid = invalidResponseAttempt(detailsResponse.attempt, 'OpenAlex reference response.results is missing')
      return referenceResult(this.provider, paper, detailsUrl, [], [workResponse.attempt, invalid])
    }
    const candidates = items.flatMap(item => {
      const data = record(item)
      if (!data) return []
      const ids = record(data.ids)
      const doi = normalizeDoi(stringValue(ids?.doi))
      const bestLocation = record(data.best_oa_location)
      const primaryLocation = record(data.primary_location)
      const source = record(primaryLocation?.source)
      const sourceUrl = urlValue(ids?.doi) || urlValue(data.id)
      const paperCandidate = candidate(this.provider, paper.stable_id, {
        stable_id: stablePaperId(this.provider, stringValue(data.id) || doi, String(data.title || '')),
        title: data.title,
        authors: Array.isArray(data.authorships) ? data.authorships.flatMap(value => {
          const authorship = record(value)
          const authorRecord = record(authorship?.author)
          const parsed = author(authorRecord?.display_name, authorRecord?.orcid, Array.isArray(authorship?.institutions) ? authorship.institutions.flatMap(value => record(value)?.display_name || []) : [])
          return parsed ? [parsed] : []
        }) : [],
        year: data.publication_year,
        venue: source?.display_name,
        doi,
        abstract: reconstructOpenAlexAbstract(data.abstract_inverted_index),
        pdf_url: bestLocation?.pdf_url || primaryLocation?.pdf_url,
        html_url: bestLocation?.landing_page_url || primaryLocation?.landing_page_url || sourceUrl,
        source_url: sourceUrl,
        citation_count: data.cited_by_count,
        open_access: record(data.open_access)?.is_oa,
        license: bestLocation ? { url: bestLocation.license_id, terms_url: bestLocation.license_id } : null,
      })
      return paperCandidate ? [paperCandidate] : []
    })
    return referenceResult(this.provider, paper, detailsUrl, candidates, [countAttempt(workResponse.attempt, references.length), countAttempt(detailsResponse.attempt, candidates.length)])
  }
}

export class SemanticScholarSourceAdapter extends JsonSourceAdapter implements CitationSourceAdapter {
  readonly provider = 'semantic_scholar' as const
  private readonly apiKey: string | undefined

  constructor(options: SourceAdapterOptions = {}) {
    super(options)
    this.apiKey = options.semantic_scholar_api_key || process.env.SEMANTIC_SCHOLAR_API_KEY || undefined
  }

  async search(query: string, options: SourceSearchOptions): Promise<SourceSearchResult> {
    const url = searchUrl('https://api.semanticscholar.org/graph/v1/paper/search', {
      query,
      limit: String(Math.min(options.limit, 100)),
      fields: 'paperId,title,authors,year,venue,externalIds,abstract,openAccessPdf,url,citationCount',
    })
    const request: RequestPayload = {
      provider: this.provider,
      query,
      request_url: url,
      options,
      fetch_impl: this.fetch_impl,
    }
    if (this.apiKey) request.headers = { 'x-api-key': this.apiKey }
    const response = await requestJson(request)
    if (!response.value) return { provider: this.provider, query, candidates: [], attempt: response.attempt }
    const root = record(response.value)
    const items = root?.data
    if (!Array.isArray(items)) return invalidResult(this.provider, query, response.attempt, 'Semantic Scholar response.data is missing')
    const candidates = items.flatMap(item => {
      const data = record(item)
      if (!data) return []
      const ids = record(data.externalIds)
      const openAccessPdf = record(data.openAccessPdf)
      const htmlUrl = urlValue(data.url) || (ids?.ArXiv ? `https://arxiv.org/abs/${ids.ArXiv}` : null)
      const paper = candidate(this.provider, query, {
        stable_id: stablePaperId(this.provider, stringValue(data.paperId), String(data.title || '')),
        title: data.title,
        authors: authorsFromItems(data.authors, item => ({ name: item.name, orcid: item.orcid })),
        year: data.year,
        venue: data.venue,
        doi: ids?.DOI,
        abstract: data.abstract,
        pdf_url: openAccessPdf?.url,
        html_url: htmlUrl,
        source_url: htmlUrl || (ids?.DOI ? `https://doi.org/${ids.DOI}` : `https://www.semanticscholar.org/paper/${data.paperId}`),
        citation_count: data.citationCount,
        open_access: Boolean(openAccessPdf),
      })
      return paper ? [paper] : []
    })
    return successResult(this.provider, query, response.attempt, candidates)
  }

  async fetchReferences(paper: PaperCandidate, options: SourceSearchOptions): Promise<ReferenceSearchResult> {
    const paperId = paper.stable_id.replace(/^semantic_scholar:/i, '').trim()
    if (!paperId) return unsupportedReference(this.provider, paper, 'https://api.semanticscholar.org/graph/v1/paper', 'Semantic Scholar references require a paper id')
    const url = searchUrl(`https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(paperId)}/references`, {
      limit: String(Math.min(options.limit, 100)),
      fields: 'contexts,intents,isInfluential,citedPaper.paperId,citedPaper.title,citedPaper.authors,citedPaper.year,citedPaper.venue,citedPaper.externalIds,citedPaper.abstract,citedPaper.openAccessPdf,citedPaper.url,citedPaper.citationCount',
    })
    const request: RequestPayload = {
      provider: this.provider,
      query: paper.stable_id,
      request_url: url,
      options,
      fetch_impl: this.fetch_impl,
    }
    if (this.apiKey) request.headers = { 'x-api-key': this.apiKey }
    const response = await requestJson(request)
    if (!response.value) return referenceResult(this.provider, paper, url, [], [response.attempt])
    const root = record(response.value)
    const items = root?.data
    if (!Array.isArray(items)) {
      const invalid = invalidResponseAttempt(response.attempt, 'Semantic Scholar reference response.data is missing')
      return referenceResult(this.provider, paper, url, [], [invalid])
    }
    const candidates: Array<{ paper: PaperCandidate; ranking_score: number | null; ranking_reasons: string[] }> = []
    for (const item of items) {
      const data = record(item)
      const cited = record(data?.citedPaper)
      if (!data || !cited) continue
      const ids = record(cited.externalIds)
      const citedPaperId = stringValue(cited.paperId)
      const doi = normalizeDoi(stringValue(ids?.DOI))
      const htmlUrl = urlValue(cited.url) || (citedPaperId ? `https://www.semanticscholar.org/paper/${citedPaperId}` : null)
      const parsed = candidate(this.provider, paper.stable_id, {
        stable_id: stablePaperId(this.provider, citedPaperId || doi, String(cited.title || '')),
        title: cited.title,
        authors: authorsFromItems(cited.authors, value => ({ name: value.name, orcid: value.orcid })),
        year: cited.year,
        venue: cited.venue,
        doi,
        abstract: cited.abstract,
        pdf_url: record(cited.openAccessPdf)?.url,
        html_url: htmlUrl,
        source_url: htmlUrl || (doi ? `https://doi.org/${doi}` : `https://www.semanticscholar.org/paper/${citedPaperId || 'unknown'}`),
        citation_count: cited.citationCount,
        open_access: Boolean(record(cited.openAccessPdf)),
      })
      if (!parsed) continue
      const contexts = stringArray(data.contexts)
      const intents = stringArray(data.intents)
      const citationCount = numberValue(cited.citationCount)
      const reasons: string[] = []
      if (data.isInfluential === true) reasons.push('is_influential')
      if (contexts.length) reasons.push(`contexts:${contexts.length}`)
      for (const intent of intents.filter(value => ['methodology', 'result'].includes(value.toLowerCase()))) reasons.push(`intent:${intent.toLowerCase()}`)
      if (citationCount !== null) reasons.push(`citation_count:${citationCount}`)
      if (!reasons.length) reasons.push('no_ranking_signal')
      const score = (data.isInfluential === true ? 10_000 : 0) + contexts.length * 100 + intents.length * 10 + (citationCount || 0)
      candidates.push({ paper: parsed, ranking_score: score || null, ranking_reasons: reasons })
    }
    return {
      ...referenceResult(this.provider, paper, url, candidates.map(item => item.paper), [countAttempt(response.attempt, candidates.length)]),
      candidates: candidates.map(item => item.paper),
      ranked_references: candidates,
      edges: [],
      attempt: countAttempt(response.attempt, candidates.length),
      attempts: [countAttempt(response.attempt, candidates.length)],
    }
  }
}

export class DblpSourceAdapter extends JsonSourceAdapter {
  readonly provider = 'dblp' as const

  async search(query: string, options: SourceSearchOptions): Promise<SourceSearchResult> {
    const url = searchUrl('https://dblp.org/search/publ/api', {
      q: query,
      h: String(Math.min(options.limit, 100)),
      format: 'json',
    })
    const response = await this.json(query, url, options)
    if (!response.value) return { provider: this.provider, query, candidates: [], attempt: response.attempt }
    const root = record(response.value)
    const result = record(root?.result)
    const hits = record(result?.hits)
    const items = hits?.hit
    if (!Array.isArray(items) && !record(items)) return invalidResult(this.provider, query, response.attempt, 'DBLP response.result.hits.hit is missing')
    const normalizedItems = Array.isArray(items) ? items : [items]
    const candidates = normalizedItems.flatMap(item => {
      const hit = record(item)
      const info = record(hit?.info)
      if (!info) return []
      const authorsRecord = record(info.authors)
      const authors = Array.isArray(authorsRecord?.author) ? authorsRecord.author : authorsRecord?.author ? [authorsRecord.author] : []
      const paper = candidate(this.provider, query, {
        stable_id: stablePaperId(this.provider, stringValue(info.key) || stringValue(info.url), String(info.title || '')),
        title: info.title,
        authors: authors.flatMap(value => {
          const data = record(value)
          const parsed = author(data?.text || data?.name)
          return parsed ? [parsed] : []
        }),
        year: info.year,
        venue: info.venue || info.booktitle,
        doi: info.doi,
        html_url: info.url,
        source_url: info.url,
        open_access: null,
      })
      return paper ? [paper] : []
    })
    return successResult(this.provider, query, response.attempt, candidates)
  }
}

export class UnpaywallSourceAdapter extends JsonSourceAdapter {
  readonly provider = 'unpaywall' as const

  async search(query: string, options: SourceSearchOptions): Promise<SourceSearchResult> {
    const doi = normalizeDoi(query)
    if (!doi) {
      const now = new Date().toISOString()
      const attempt = sourceAttempt.parse({
        provider: this.provider,
        query,
        request_url: 'https://api.unpaywall.org/v2/',
        started_at: now,
        finished_at: now,
        status: 'unsupported',
        http_status: null,
        result_count: 0,
        failure: { code: 'unsupported', message: 'Unpaywall enrichment requires a DOI query', retryable: false, http_status: null },
      })
      return { provider: this.provider, query, candidates: [], attempt }
    }
    const email = process.env.UNPAYWALL_EMAIL || process.env.RESEARCH_CONTACT_EMAIL || 'research-os@users.noreply.github.com'
    const url = `https://api.unpaywall.org/v2/${doi.replace(/\//g, '%2F')}?email=${encodeURIComponent(email)}`
    const response = await this.json(query, url, options)
    if (!response.value) return { provider: this.provider, query, candidates: [], attempt: response.attempt }
    const root = record(response.value)
    if (!root || root.is_oa !== true) return successResult(this.provider, query, response.attempt, [])
    const locations = Array.isArray(root.oa_locations) ? root.oa_locations.flatMap(value => {
      const location = record(value)
      return location ? [location] : []
    }) : []
    const pdfUrl = locations.map(location => stringValue(location.url_for_pdf)).find(Boolean) || null
    const landing = locations.map(location => stringValue(location.url_for_landing_page)).find(Boolean) || urlValue(root.landing_page_url)
    const sourceUrl = urlValue(root.landing_page_url) || (doi ? `https://doi.org/${doi}` : null)
    if (!sourceUrl) return invalidResult(this.provider, query, response.attempt, 'Unpaywall response has no landing page URL')
    const parsed = candidate(this.provider, query, {
      stable_id: stablePaperId(this.provider, doi, String(root.title || query)),
      title: root.title || query,
      year: yearValue(root.year),
      doi,
      pdf_url: pdfUrl,
      html_url: landing,
      source_url: sourceUrl,
      open_access: true,
    })
    return successResult(this.provider, query, response.attempt, parsed ? [parsed] : [])
  }
}

type ArxivLink = { '@_href'?: unknown; '@_type'?: unknown; '@_title'?: unknown }

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function extractPersonNameBlocks(html: string): string[] {
  const starts = [...html.matchAll(/<span class="ltx_personname">/g)]
  const blocks: string[] = []
  for (const start of starts) {
    const startIndex = (start.index || 0) + start[0].length
    let depth = 1
    let index = startIndex
    while (index < html.length && depth > 0) {
      const nextOpen = html.indexOf('<span', index)
      const nextClose = html.indexOf('</span>', index)
      if (nextClose === -1 && nextOpen === -1) break
      if (nextOpen !== -1 && (nextClose === -1 || nextOpen < nextClose)) {
        depth += 1
        index = nextOpen + 5
      } else if (nextClose !== -1) {
        depth -= 1
        index = nextClose + 7
      }
    }
    if (depth === 0) blocks.push(html.slice(startIndex, index - 7))
  }
  return blocks
}

function looksLikeInstitution(value: string): boolean {
  const text = value.trim()
  if (!text || text.length < 2 || text.startsWith('http') || /^\d+$/.test(text)) return false
  if (/^[A-Z]{2,8}$/.test(text)) return true
  const keywords = /university|college|institute|laboratory|research|center|centre|school|department|faculty|division|technologies|inc\.|ltd|llc|corp|tencent|google|meta|microsoft|amazon|apple|ibm|intel|nvidia|adobe|\bai\s|lab\b|science|technology|innovation|foundation|hospital|academy|大学|学院|研究所|研究院|中心|实验室|科技|公司/i
  if (keywords.test(text)) return true
  const words = text.split(/\s+/)
  return words.length >= 3 || (words.length === 1 && words[0]!.length >= 7)
}

function looksLikePerson(value: string): boolean {
  const text = value.trim()
  const words = text.split(/\s+/)
  if (words.length < 2 || words.length > 4) return false
  if (!words.every(word => /^[A-Z]/.test(word))) return false
  const institutionKeywords = /university|college|institute|laboratory|research|center|centre|school|department|faculty|division|technologies|inc\.|ltd|llc|corp|tencent|google|meta|microsoft|amazon|apple|ibm|intel|nvidia|adobe|\bai\s|lab\b|science|technology|innovation|foundation|hospital|academy|大学|学院|研究所|研究院|中心|实验室|科技|公司/i
  return !institutionKeywords.test(text)
}

export function parseArxivAuthorAffiliations(html: string): {
  authors: Array<{ name: string; affiliations: string[]; is_corresponding: boolean }>
  emails: string[]
} {
  const normalized = html.replace(/\r\n/g, '\n')
  const authorsMatch = /class="ltx_authors"/.exec(normalized)
  const abstractMatch = /class="ltx_abstract"/.exec(normalized)
  const authorsStart = authorsMatch?.index ?? 0
  const sectionEnd = abstractMatch?.index ?? Math.min(normalized.length, authorsStart + 30_000)
  const sectionHtml = normalized.slice(authorsStart, sectionEnd)
  const plain = decodeHtmlEntities(sectionHtml.replace(/<[^>]+>/g, '\n')).replace(/\n\s*\n+/g, '\n').trim()

  const institutionMap = new Map<string, string>()
  for (const line of plain.split('\n').map(value => value.trim()).filter(Boolean)) {
    const numbered = /^(\d{1,2})\s+(\S.{1,120})$/.exec(line)
    const numberId = numbered?.[1]
    const institutionName = numbered?.[2]
    if (numberId && institutionName && looksLikeInstitution(institutionName)) institutionMap.set(numberId, institutionName)
  }
  const plainLines = plain.split('\n').map(value => value.trim()).filter(Boolean)
  for (let index = 0; index < plainLines.length - 1; index += 1) {
    const current = plainLines[index] || ''
    const next = plainLines[index + 1] || ''
    if (/^\d{1,2}$/.test(current) && !institutionMap.has(current) && looksLikeInstitution(next)) institutionMap.set(current, next)
  }

  const authorHtmlEnd = abstractMatch?.index ?? Math.min(normalized.length, authorsStart + 8_000)
  const authorHtml = normalized.slice(authorsStart, authorHtmlEnd)
  const authors: Array<{ name: string; affiliations: string[]; is_corresponding: boolean }> = []
  const seenNames = new Set<string>()
  const personNameBlocks = extractPersonNameBlocks(authorHtml)
  const emails = new Set<string>([...normalized.matchAll(/href="mailto:([^"]+)"/g)].map(match => match[1] || '').filter(Boolean))

  const addAuthor = (name: string, affiliations: string[], isCorresponding: boolean) => {
    const cleanName = name
      .replace(/(?:[\d,\s]*[*†‡§¶#∗♡♠♦♣©®™⊕⋆]+\s*|\d[\d,\s]*)$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!cleanName || cleanName.length < 2 || seenNames.has(cleanName) || /^[A-Z]{2,8}$/.test(cleanName) || cleanName.includes('http')) return
    seenNames.add(cleanName)
    authors.push({ name: cleanName, affiliations: [...new Set(affiliations.filter(Boolean))], is_corresponding: isCorresponding })
  }

  for (const block of personNameBlocks) {
    const decoded = decodeHtmlEntities(block)
    const raw = decoded.replace(/<\s*br[^>]*>/g, '\n').replace(/<[^>]+>/g, '')
    const entries = raw.split('&').map(entry => entry.trim()).filter(Boolean)
    const isCompressed = personNameBlocks.length === 1 && (block.includes('&') || decoded.includes('<br') || entries.length > 1)
    if (isCompressed) {
      for (const entry of entries) {
        const lines = entry.split('\n').map(value => value.trim()).filter(Boolean)
        if (!lines.length) continue
        const name = lines[0]!.replace(/(?:[\d,\s]*[*†‡§¶#∗♡♠♦♣©®™⊕⋆]+\s*|\d[\d,\s]*)$/g, '').replace(/\s+/g, ' ').trim()
        const affiliations = lines.slice(1).filter(line => line && !/^\d+$/.test(line) && !line.includes('@') && !looksLikePerson(line))
        for (const line of lines) if (line.includes('@')) emails.add(line.replace(/^.*?([\w.+-]+@[\w-]+\.[\w.-]+).*$/, '$1'))
        addAuthor(name, affiliations, false)
      }
      continue
    }
    const supRaw = [...block.matchAll(/<sup[^>]*>(.*?)<\/sup>/gs)].map(sup => sup[1]).join(' ')
    let supText = decodeHtmlEntities(supRaw.replace(/<[^>]+>/g, '').trim())
    if (!supText) {
      const plainName = decodeHtmlEntities(block.replace(/<[^>]+>/g, '')).trim()
      const trailing = /(\d[\d,\s]*[*†‡§¶#∗]+|\d[\d,\s]+)$/.exec(plainName)
      if (trailing) supText = trailing[1] || ''
    }
    const institutionIds = [...supText.matchAll(/\b(\d+)\b/g)]
      .map(item => item[1] || '')
      .filter((value, index, items) => items.indexOf(value) === index)
    const isCorresponding = /[*†‡§¶#∗]/.test(supText)
    let name = decodeHtmlEntities(block.replace(/<sup[^>]*>.*?<\/sup>/gs, '').replace(/<[^>]+>/g, ''))
    name = name.replace(/[\d,\s]*[*†‡§¶#∗♡♠♦♣©®™⊕⋆]*\s*$/g, '').replace(/\s+/g, ' ').trim()
    name = name.replace(/,$/, '').trim()
    addAuthor(name, institutionIds.flatMap(id => {
      const institution = institutionMap.get(id)
      return institution ? [institution] : []
    }), isCorresponding)
  }
  return { authors, emails: [...emails] }
}

export function findArxivId(paper: PaperCandidate): string | null {
  const values = [paper.html_url, paper.pdf_url, paper.stable_id, paper.source_url]
  for (const value of values) {
    const match = String(value || '').match(/arxiv\.org\/(?:abs|pdf|html)\/(\d{4}\.\d{4,5})(?:v\d+)?/i)
    if (match?.[1]) return match[1]
  }
  const eprint = String(paper.doi || '').match(/\b(\d{4}\.\d{4,5})(?:v\d+)?\b/)
  return eprint?.[1] || null
}

export class ArxivSourceAdapter implements SearchSourceAdapter {
  readonly provider = 'arxiv' as const
  private readonly fetch_impl: FetchImplementation

  constructor(options: SourceAdapterOptions = {}) {
    this.fetch_impl = options.fetch_impl ?? fetch
  }

  async search(query: string, options: SourceSearchOptions): Promise<SourceSearchResult> {
    const url = searchUrl('https://export.arxiv.org/api/query', {
      search_query: `all:${query}`,
      start: '0',
      max_results: String(Math.min(options.limit, 100)),
    })
    const response = await requestXml({ provider: this.provider, query, request_url: url, options, fetch_impl: this.fetch_impl })
    if (!response.value) return { provider: this.provider, query, candidates: [], attempt: response.attempt }
    try {
      const validation = XMLValidator.validate(response.value)
      if (validation !== true) {
        const message = validation.err?.msg || 'arXiv response is not valid Atom XML'
        return invalidResult(this.provider, query, response.attempt, message)
      }
      const parsed = new XMLParser({ ignoreAttributes: false, isArray: name => ['entry', 'author', 'link'].includes(name) }).parse(response.value) as Record<string, unknown>
      const feed = record(parsed.feed)
      const entries = arrayValue(feed?.entry)
      const candidates = entries.flatMap(entryValue => {
        const entry = record(entryValue)
        if (!entry) return []
        const links = arrayValue(entry.link).flatMap(value => {
          const link = record(value) as ArxivLink | null
          return link ? [link] : []
        })
        const pdf = links.find(link => String(link['@_type'] || '').toLowerCase() === 'application/pdf')
        const html = urlValue(entry.id)
        const paper = candidate(this.provider, query, {
          stable_id: stablePaperId(this.provider, stringValue(entry.id), String(entry.title || '')),
          title: entry.title,
          authors: arrayValue(entry.author).flatMap(value => {
            const authorRecord = record(value)
            const parsedAuthor = author(authorRecord?.name)
            return parsedAuthor ? [parsedAuthor] : []
          }),
          year: stringValue(entry.published)?.slice(0, 4),
          abstract: entry.summary,
          pdf_url: pdf?.['@_href'],
          html_url: html,
          source_url: html,
          open_access: true,
        })
        return paper ? [paper] : []
      })
      return successResult(this.provider, query, response.attempt, candidates)
    } catch {
      return invalidResult(this.provider, query, response.attempt, 'arXiv response is not valid Atom XML')
    }
  }

  async fetchByArxivId(arxivId: string, options: SourceSearchOptions): Promise<SourceSearchResult> {
    const url = searchUrl('https://export.arxiv.org/api/query', {
      id_list: arxivId,
      max_results: '1',
    })
    const response = await requestXml({ provider: this.provider, query: `arxiv:${arxivId}`, request_url: url, options, fetch_impl: this.fetch_impl })
    if (!response.value) return { provider: this.provider, query: `arxiv:${arxivId}`, candidates: [], attempt: response.attempt }
    try {
      const validation = XMLValidator.validate(response.value)
      if (validation !== true) {
        const message = validation.err?.msg || 'arXiv response is not valid Atom XML'
        return invalidResult(this.provider, `arxiv:${arxivId}`, response.attempt, message)
      }
      const parsed = new XMLParser({ ignoreAttributes: false, isArray: name => ['entry', 'author', 'link'].includes(name) }).parse(response.value) as Record<string, unknown>
      const feed = record(parsed.feed)
      const entries = arrayValue(feed?.entry)
      const candidates = entries.flatMap(entryValue => {
        const entry = record(entryValue)
        if (!entry) return []
        const links = arrayValue(entry.link).flatMap(value => {
          const link = record(value) as ArxivLink | null
          return link ? [link] : []
        })
        const pdf = links.find(link => String(link['@_type'] || '').toLowerCase() === 'application/pdf')
        const html = urlValue(entry.id)
        const paper = candidate(this.provider, `arxiv:${arxivId}`, {
          stable_id: stablePaperId(this.provider, stringValue(entry.id), String(entry.title || '')),
          title: entry.title,
          authors: arrayValue(entry.author).flatMap(value => {
            const authorRecord = record(value)
            const parsedAuthor = author(authorRecord?.name)
            return parsedAuthor ? [parsedAuthor] : []
          }),
          year: stringValue(entry.published)?.slice(0, 4),
          abstract: entry.summary,
          pdf_url: pdf?.['@_href'],
          html_url: html,
          source_url: html,
          open_access: true,
        })
        return paper ? [paper] : []
      })
      return successResult(this.provider, `arxiv:${arxivId}`, response.attempt, candidates)
    } catch {
      return invalidResult(this.provider, `arxiv:${arxivId}`, response.attempt, 'arXiv response is not valid Atom XML')
    }
  }

  async fetchAuthorAffiliations(paper: PaperCandidate, options: SourceSearchOptions): Promise<SourceSearchResult> {
    const arxivId = findArxivId(paper)
    const now = new Date().toISOString()
    if (!arxivId) {
      const attempt = sourceAttempt.parse({
        provider: this.provider,
        query: paper.stable_id,
        request_url: 'https://arxiv.org/html/',
        started_at: now,
        finished_at: now,
        status: 'succeeded',
        http_status: null,
        result_count: 0,
        failure: null,
      })
      return { provider: this.provider, query: paper.stable_id, candidates: [], attempt }
    }
    const url = `https://arxiv.org/html/${arxivId}v1`
    const response = await requestText({
      provider: this.provider,
      query: paper.stable_id,
      request_url: url,
      options,
      fetch_impl: this.fetch_impl,
    })
    if (!response.value) {
      if (response.attempt.http_status === 404) {
        return successResult(this.provider, paper.stable_id, sourceAttempt.parse({ ...response.attempt, status: 'succeeded', failure: null }), [])
      }
      return { provider: this.provider, query: paper.stable_id, candidates: [], attempt: response.attempt }
    }
    const parsed = parseArxivAuthorAffiliations(response.value)
    if (!parsed.authors.length) return successResult(this.provider, paper.stable_id, countAttempt(response.attempt, 0), [])
    const existingByLowerName = new Map(paper.authors.map(author => [author.name.toLocaleLowerCase(), author]))
    const merged = mergeEnrichedAuthors(paper.authors, parsed.authors).map(author => {
      const existing = existingByLowerName.get(author.name.toLocaleLowerCase())
      return {
        ...author,
        orcid: existing?.orcid || null,
        email: author.email || parsed.emails[0] || null,
      }
    })
    const enriched = paperCandidate.parse({
      ...paper,
      authors: merged,
      retrieved_at: now,
    })
    return successResult(this.provider, paper.stable_id, countAttempt(response.attempt, merged.length), [enriched])
  }
}

export function createDefaultSourceAdapters(options: SourceAdapterOptions = {}): SearchSourceAdapter[] {
  return [
    new CrossrefSourceAdapter(options),
    new OpenAlexSourceAdapter(options),
    new SemanticScholarSourceAdapter(options),
    new DblpSourceAdapter(options),
    new ArxivSourceAdapter(options),
  ]
}

export function createDefaultEnrichmentAdapters(options: SourceAdapterOptions = {}): SearchSourceAdapter[] {
  return [
    ...createDefaultSourceAdapters(options),
    new UnpaywallSourceAdapter(options),
  ]
}

export function createDefaultCitationSourceAdapters(options: SourceAdapterOptions = {}): CitationSourceAdapter[] {
  return [
    new CrossrefSourceAdapter(options),
    new OpenAlexSourceAdapter(options),
    new SemanticScholarSourceAdapter(options),
  ]
}
