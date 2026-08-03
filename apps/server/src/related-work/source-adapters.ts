import { XMLParser, XMLValidator } from 'fast-xml-parser'
import type { FetchImplementation, RequestPayload } from './transport.js'
import { invalidResponseAttempt, requestJson, requestXml } from './transport.js'
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

function author(name: unknown, orcid: unknown = null, affiliations: unknown = []): { name: string; orcid: string | null; affiliations: string[] } | null {
  const authorName = stringValue(name)
  if (!authorName) return null
  return {
    name: authorName,
    orcid: urlValue(orcid),
    affiliations: stringArray(affiliations),
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

type ArxivLink = { '@_href'?: unknown; '@_type'?: unknown; '@_title'?: unknown }

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
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

export function createDefaultCitationSourceAdapters(options: SourceAdapterOptions = {}): CitationSourceAdapter[] {
  return [
    new CrossrefSourceAdapter(options),
    new OpenAlexSourceAdapter(options),
    new SemanticScholarSourceAdapter(options),
  ]
}
