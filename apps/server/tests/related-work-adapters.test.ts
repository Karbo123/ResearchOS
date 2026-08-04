import { describe, expect, it } from 'vitest'
import { normalizeDoi, normalizeTitle, paperCandidate } from '../src/related-work/contracts.js'
import {
  ArxivSourceAdapter,
  CrossrefSourceAdapter,
  DblpSourceAdapter,
  OpenAlexSourceAdapter,
  parseArxivAuthorAffiliations,
  SemanticScholarSourceAdapter,
  UnpaywallSourceAdapter,
} from '../src/related-work/source-adapters.js'

function jsonFetch(payload: unknown, status = 200, capture?: (input: RequestInfo | URL, init?: RequestInit) => void): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    capture?.(input, init)
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
}

function xmlFetch(payload: string): typeof fetch {
  return (async () => new Response(payload, { status: 200, headers: { 'content-type': 'application/atom+xml' } })) as typeof fetch
}

const options = { limit: 10, timeout_ms: 500 }

describe('related work source contracts', () => {
  it('normalizes DOI and Unicode titles deterministically', () => {
    expect(normalizeDoi('https://doi.org/10.1000/ABC')).toBe('10.1000/abc')
    expect(normalizeDoi(' DOI: 10.1000/ABC ')).toBe('10.1000/abc')
    expect(normalizeTitle('  A\u2014Study: of  Signals  ')).toBe('a study of signals')
  })

  it('maps Crossref candidates and records a successful source attempt', async () => {
    const adapter = new CrossrefSourceAdapter({ fetch_impl: jsonFetch({
      message: {
        items: [{
          DOI: '10.1000/xyz',
          title: ['A Study of Signals'],
          author: [{ given: 'Ada', family: 'Lovelace', affiliation: [{ name: 'Analytical Engine Lab' }] }],
          issued: { 'date-parts': [[2024]] },
          'container-title': ['Research Journal'],
          URL: 'https://doi.org/10.1000/xyz',
          link: [{ URL: 'https://example.test/paper.pdf', 'content-type': 'application/pdf' }],
          'is-referenced-by-count': 12,
        }],
      },
    }) })
    const result = await adapter.search('signals', options)
    expect(result.attempt.status).toBe('succeeded')
    expect(result.attempt.result_count).toBe(1)
    expect(result.candidates[0]).toMatchObject({
      stable_id: 'crossref:10.1000/xyz',
      doi: '10.1000/xyz',
      year: 2024,
      venue: 'Research Journal',
      pdf_url: 'https://example.test/paper.pdf',
      citation_count: 12,
    })
    expect(result.candidates[0]?.authors[0]?.affiliations).toEqual(['Analytical Engine Lab'])
  })

  it('reconstructs OpenAlex inverted abstracts and keeps OA links', async () => {
    const adapter = new OpenAlexSourceAdapter({ fetch_impl: jsonFetch({
      results: [{
        id: 'https://openalex.org/W123',
        title: 'Signals in Practice',
        ids: { doi: 'https://doi.org/10.1000/signals' },
        publication_year: 2023,
        abstract_inverted_index: { Signals: [0], 'in': [1], practice: [2] },
        authorships: [{ author: { display_name: 'Grace Hopper' }, institutions: [{ display_name: 'Computing Lab' }] }],
        primary_location: { landing_page_url: 'https://example.test/signals', pdf_url: 'https://example.test/signals.pdf', source: { display_name: 'Open Journal' } },
        best_oa_location: { landing_page_url: 'https://example.test/signals', pdf_url: 'https://example.test/signals.pdf' },
        open_access: { is_oa: true },
        cited_by_count: 8,
      }],
    }) })
    const result = await adapter.search('signals', options)
    expect(result.candidates[0]).toMatchObject({
      stable_id: 'openalex:https://openalex.org/W123',
      abstract: 'Signals in practice',
      open_access: true,
      pdf_url: 'https://example.test/signals.pdf',
    })
  })

  it('passes Semantic Scholar key as a request header without returning it', async () => {
    let requestHeaders: HeadersInit | undefined
    const adapter = new SemanticScholarSourceAdapter({
      semantic_scholar_api_key: 'secret-test-key',
      fetch_impl: jsonFetch({ data: [{ paperId: 'ss-1', title: 'A Semantic Result', authors: [{ name: 'K. He' }], year: 2022, externalIds: { DOI: '10.1000/ss' }, url: 'https://www.semanticscholar.org/paper/ss-1' }] }, 200, (_input, init) => {
        requestHeaders = init?.headers
      }),
    })
    const result = await adapter.search('semantic', options)
    expect(new Headers(requestHeaders).get('x-api-key')).toBe('secret-test-key')
    expect(JSON.stringify(result)).not.toContain('secret-test-key')
    expect(result.candidates[0]?.stable_id).toBe('semantic_scholar:ss-1')
  })

  it('maps DBLP JSON hit data', async () => {
    const adapter = new DblpSourceAdapter({ fetch_impl: jsonFetch({ result: { hits: { hit: { info: {
      key: 'conf/test/Smith2024',
      title: 'A DBLP Result',
      authors: { author: [{ text: 'Jane Smith' }] },
      year: '2024',
      venue: 'Test Conference',
      url: 'https://dblp.org/rec/conf/test/Smith2024',
    } } } } }) })
    const result = await adapter.search('dblp', options)
    expect(result.candidates[0]).toMatchObject({
      stable_id: 'dblp:conf/test/Smith2024',
      year: 2024,
      venue: 'Test Conference',
      html_url: 'https://dblp.org/rec/conf/test/Smith2024',
    })
  })

  it('parses arXiv Atom through an XML parser', async () => {
    const adapter = new ArxivSourceAdapter({ fetch_impl: xmlFetch(`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>https://arxiv.org/abs/2401.00001</id><title>  An arXiv Result  </title><summary>A concise abstract.</summary><published>2024-01-02T00:00:00Z</published><author><name>Alan Turing</name></author><link title="pdf" type="application/pdf" href="https://arxiv.org/pdf/2401.00001" /></entry></feed>`) })
    const result = await adapter.search('arxiv', options)
    expect(result.candidates[0]).toMatchObject({
      stable_id: 'arxiv:https://arxiv.org/abs/2401.00001',
      year: 2024,
      pdf_url: 'https://arxiv.org/pdf/2401.00001',
      open_access: true,
    })
  })

  it('returns a structured invalid-response attempt instead of a successful empty result', async () => {
    const adapter = new CrossrefSourceAdapter({ fetch_impl: (async () => new Response('{broken', { status: 200 })) as typeof fetch })
    const result = await adapter.search('broken', options)
    expect(result.candidates).toEqual([])
    expect(result.attempt.status).toBe('invalid_response')
    expect(result.attempt.failure?.code).toBe('invalid_response')
  })

  it('parses Semantic Scholar references and preserves ranking signals', async () => {
    const root = paperCandidate.parse({
      provider: 'semantic_scholar', stable_id: 'semantic_scholar:root', title: 'Root', authors: [], year: 2024,
      venue: null, doi: '10.1000/root', abstract: null, pdf_url: null, html_url: 'https://example.test/root', license: null,
      citation_count: 10, open_access: null, source_url: 'https://example.test/root', query: 'fixture', retrieved_at: new Date().toISOString(),
    })
    const adapter = new SemanticScholarSourceAdapter({ fetch_impl: jsonFetch({ data: [{
      isInfluential: true,
      contexts: ['method context'],
      intents: ['Methodology'],
      citedPaper: { paperId: 'child', title: 'Child Reference', authors: [{ name: 'Ada Lovelace' }], year: 2023, externalIds: { DOI: '10.1000/child' }, url: 'https://example.test/child', citationCount: 42 },
    }] }) })
    const result = await adapter.fetchReferences(root, options)
    expect(result.attempt.status).toBe('succeeded')
    expect(result.ranked_references?.[0]).toMatchObject({ ranking_reasons: ['is_influential', 'contexts:1', 'intent:methodology', 'citation_count:42'] })
    expect(result.candidates[0]).toMatchObject({ stable_id: 'semantic_scholar:child', doi: '10.1000/child' })
  })

  it('maps Unpaywall open-access PDF links by DOI', async () => {
    const adapter = new UnpaywallSourceAdapter({ fetch_impl: jsonFetch({
      is_oa: true,
      title: 'Open Access Result',
      year: 2024,
      landing_page_url: 'https://example.test/oa',
      oa_locations: [{ url_for_pdf: 'https://example.test/paper.pdf', url_for_landing_page: 'https://example.test/oa' }],
    }) })
    const result = await adapter.search('10.1000/oa', options)
    expect(result.attempt.status).toBe('succeeded')
    expect(result.candidates[0]).toMatchObject({
      provider: 'unpaywall',
      stable_id: 'unpaywall:10.1000/oa',
      doi: '10.1000/oa',
      pdf_url: 'https://example.test/paper.pdf',
      open_access: true,
    })
  })

  it('returns a successful no-match for non-open-access Unpaywall responses', async () => {
    const adapter = new UnpaywallSourceAdapter({ fetch_impl: jsonFetch({ is_oa: false, oa_locations: [] }) })
    const result = await adapter.search('10.1000/closed', options)
    expect(result.attempt.status).toBe('succeeded')
    expect(result.candidates).toEqual([])
  })

  it('parses arXiv HTML author affiliations and keeps them auditable under the arxiv provider', async () => {
    const adapter = new ArxivSourceAdapter({ fetch_impl: (async () => new Response(`<html><body>
      <div class="ltx_authors"><span class="ltx_personname">Ada Lovelace<sup>1</sup></span></div>
      <p>1 Analytical Engine Lab</p>
      <div class="ltx_abstract"><p>Abstract</p></div>
    </body></html>`, { status: 200, headers: { 'content-type': 'text/html' } })) as typeof fetch })
    const root = paperCandidate.parse({
      provider: 'arxiv',
      stable_id: 'arxiv:https://arxiv.org/abs/2401.00001',
      title: 'An Arxiv Result',
      authors: [{ name: 'Ada Lovelace' }],
      year: 2024,
      venue: null,
      doi: null,
      abstract: null,
      pdf_url: null,
      html_url: 'https://arxiv.org/abs/2401.00001',
      license: null,
      citation_count: null,
      open_access: true,
      source_url: 'https://arxiv.org/abs/2401.00001',
      query: 'fixture',
      retrieved_at: new Date().toISOString(),
    })
    const result = await adapter.fetchAuthorAffiliations(root, options)
    expect(result.attempt.status).toBe('succeeded')
    expect(result.candidates[0]?.authors[0]?.affiliations).toContain('Analytical Engine Lab')
  })

  it('parses compressed arXiv author blocks without treating person names as institutions', async () => {
    const parsed = parseArxivAuthorAffiliations(`<html><body>
      <div class="ltx_authors"><span class="ltx_personname">Ada Lovelace<br>Analytical Engine Lab &amp; Charles Babbage<br>Computing Laboratory</span></div>
      <div class="ltx_abstract"><p>Abstract</p></div>
    </body></html>`)
    expect(parsed.authors.map(author => author.name)).toEqual(['Ada Lovelace', 'Charles Babbage'])
    expect(parsed.authors[0]?.affiliations).toContain('Analytical Engine Lab')
    expect(parsed.authors[1]?.affiliations).toContain('Computing Laboratory')
  })

  it('fetches complete authors and abstract by arXiv id', async () => {
    const adapter = new ArxivSourceAdapter({ fetch_impl: (async () => new Response(`<?xml version="1.0" encoding="UTF-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <id>http://arxiv.org/abs/2401.00001v1</id>
          <title>Full Author Fixture</title>
          <published>2024-01-01T00:00:00Z</published>
          <summary>The complete abstract for the fixture paper.</summary>
          <author><name>Ada Lovelace</name></author>
          <author><name>Charles Babbage</name></author>
        </entry>
      </feed>`, { status: 200, headers: { 'content-type': 'application/atom+xml' } })) as typeof fetch })
    const result = await adapter.fetchByArxivId('2401.00001', options)
    expect(result.attempt.status).toBe('succeeded')
    expect(result.candidates[0]?.authors.map(author => author.name)).toEqual(['Ada Lovelace', 'Charles Babbage'])
    expect(result.candidates[0]?.abstract).toContain('complete abstract')
  })

  it('treats a missing arXiv HTML5 version as a successful no-match', async () => {
    const adapter = new ArxivSourceAdapter({ fetch_impl: (async () => new Response('Not Found', { status: 404 })) as typeof fetch })
    const root = paperCandidate.parse({
      provider: 'arxiv',
      stable_id: 'arxiv:https://arxiv.org/abs/2401.00001',
      title: 'An Arxiv Result',
      authors: [],
      year: 2024,
      venue: null,
      doi: null,
      abstract: null,
      pdf_url: null,
      html_url: 'https://arxiv.org/abs/2401.00001',
      license: null,
      citation_count: null,
      open_access: true,
      source_url: 'https://arxiv.org/abs/2401.00001',
      query: 'fixture',
      retrieved_at: new Date().toISOString(),
    })
    const result = await adapter.fetchAuthorAffiliations(root, options)
    expect(result.attempt.status).toBe('succeeded')
    expect(result.attempt.http_status).toBe(404)
    expect(result.candidates).toEqual([])
  })

  it('parses Crossref reference entries and uses an explicit no-signal reason', async () => {
    const root = paperCandidate.parse({
      provider: 'crossref', stable_id: 'crossref:10.1000/root', title: 'Root', authors: [], year: 2024,
      venue: null, doi: '10.1000/root', abstract: null, pdf_url: null, html_url: 'https://doi.org/10.1000/root', license: null,
      citation_count: null, open_access: null, source_url: 'https://doi.org/10.1000/root', query: 'fixture', retrieved_at: new Date().toISOString(),
    })
    const adapter = new CrossrefSourceAdapter({ fetch_impl: jsonFetch({ message: { reference: [{ 'article-title': 'Referenced Work', year: '2020', key: 'ref-1' }] } }) })
    const result = await adapter.fetchReferences(root, options)
    expect(result.attempt.status).toBe('succeeded')
    expect(result.candidates[0]?.title).toBe('Referenced Work')
    expect(result.candidates[0]?.citation_count).toBeNull()
  })

  it('keeps an empty response as an explicit no-match for every provider', async () => {
    const jsonCases: Array<[string, ReturnType<typeof jsonFetch>]> = [
      ['crossref', jsonFetch({ message: { items: [] } })],
      ['openalex', jsonFetch({ results: [] })],
      ['semantic_scholar', jsonFetch({ data: [] })],
      ['dblp', jsonFetch({ result: { hits: { hit: [] } } })],
    ]
    const adapters = [
      new CrossrefSourceAdapter({ fetch_impl: jsonCases[0]![1] }),
      new OpenAlexSourceAdapter({ fetch_impl: jsonCases[1]![1] }),
      new SemanticScholarSourceAdapter({ fetch_impl: jsonCases[2]![1] }),
      new DblpSourceAdapter({ fetch_impl: jsonCases[3]![1] }),
      new ArxivSourceAdapter({ fetch_impl: xmlFetch('<feed xmlns="http://www.w3.org/2005/Atom"></feed>') }),
    ]

    for (const adapter of adapters) {
      const result = await adapter.search('no-match', options)
      expect(result.candidates, adapter.provider).toEqual([])
      expect(result.attempt, adapter.provider).toMatchObject({ status: 'succeeded', result_count: 0, failure: null })
    }
  })

  it('keeps malformed provider shapes as invalid_response for every provider', async () => {
    const adapters = [
      new CrossrefSourceAdapter({ fetch_impl: jsonFetch({ message: {} }) }),
      new OpenAlexSourceAdapter({ fetch_impl: jsonFetch({}) }),
      new SemanticScholarSourceAdapter({ fetch_impl: jsonFetch({}) }),
      new DblpSourceAdapter({ fetch_impl: jsonFetch({ result: { hits: {} } }) }),
      new ArxivSourceAdapter({ fetch_impl: xmlFetch('<feed>') }),
    ]

    for (const adapter of adapters) {
      const result = await adapter.search('invalid-shape', options)
      expect(result.candidates, adapter.provider).toEqual([])
      expect(result.attempt, adapter.provider).toMatchObject({ status: 'invalid_response', failure: { code: 'invalid_response' } })
    }
  })
})
