import { describe, expect, it } from 'vitest'
import { paperCandidate, type SourceAttempt } from '../src/related-work/contracts.js'
import { backoff, matchAuthor, missingFields, normalizeText, paperCompleteness, stripControlChars, titlesMatch } from '../src/related-work/paper-fields.js'
import { recursiveCollect, type ReferenceBatch } from '../src/related-work/recursive-search.js'

function paper(stableId: string, title: string, doi: string | null = null, year = 2024) {
  return paperCandidate.parse({
    provider: 'crossref',
    stable_id: stableId,
    title,
    authors: [],
    year,
    venue: null,
    doi,
    abstract: null,
    pdf_url: null,
    html_url: `https://example.test/${stableId}`,
    license: null,
    citation_count: null,
    open_access: null,
    source_url: `https://example.test/${stableId}`,
    query: 'fixture',
    retrieved_at: new Date().toISOString(),
  })
}

function attempt(provider: 'crossref', query: string): SourceAttempt {
  const now = new Date().toISOString()
  return {
    provider,
    query,
    request_url: 'https://example.test/references',
    started_at: now,
    finished_at: now,
    status: 'succeeded',
    http_status: 200,
    result_count: 0,
    failure: null,
  }
}

function batch(query: string, references: ReferenceBatch['references']): ReferenceBatch {
  return { provider: 'crossref', references, attempt: attempt('crossref', query) }
}

describe('TypeScript related-work core', () => {
  it('ports title, author, normalization, completeness, and backoff behavior', () => {
    expect(titlesMatch('Attention Is All You Need', 'Attention is all you need for machine translation')).toBe(true)
    expect(titlesMatch('Deep Residual Learning', 'Attention Is All You Need')).toBe(false)
    expect(matchAuthor('He, Kaiming', ['Jian Sun', 'Kaiming He'])).toBe('Kaiming He')
    expect(matchAuthor('SR Choi', ['Choi, Sanghyuk Roy'])).toBe('Choi, Sanghyuk Roy')
    expect(stripControlChars('hello\u200bworld')).toBe('helloworld')
    expect(normalizeText(String.raw`J{\"o}rg:claims  50\% accuracy`)).toBe('J"org: claims 50% accuracy')
    expect(backoff(2, { random: () => 0 })).toBe(4)
    expect(backoff(8, { max_wait: 30, random: () => 1 })).toBe(39)
  })

  it('reports missing fields and gives affiliated, complete papers a higher score', () => {
    const empty = missingFields({})
    expect(empty).toEqual(expect.arrayContaining(['title', 'authors', 'abstract', 'doi', 'year', 'venue', 'institutions', 'bibtex']))
    const minimal = { title: 'T', authors: [{ name: 'A' }] }
    const complete = {
      title: 'T',
      authors: [{ name: 'A', affiliations: ['Lab'] }],
      abstract: 'x '.repeat(100),
      doi: '10.1000/test',
      year: 2024,
      venue: 'Venue',
      institutions: ['Lab'],
      bibtex: '@article{test}',
    }
    expect(paperCompleteness(complete)).toBeGreaterThan(paperCompleteness(minimal))
    expect(paperCompleteness({})).toBeLessThan(0.3)
  })

  it('recursively collects by depth and width with deterministic deduplication and non-dangling edges', async () => {
    const root = paper('root', 'Root Paper', '10.1000/root')
    const duplicateRoot = paper('root-other-provider', 'Root Paper', '10.1000/ROOT')
    const first = paper('first', 'First Reference', '10.1000/first')
    const second = paper('second', 'Second Reference', '10.1000/second')
    const third = paper('third', 'Third Reference', '10.1000/third')
    const progress: number[] = []
    const result = await recursiveCollect([root, duplicateRoot], {
      depth: 3,
      width: 1,
      max_total: 10,
      request_options: {},
      on_progress: event => progress.push(event.total_count),
      fetch_references: async current => current.stable_id === 'root'
        ? batch(current.title, [
            { paper: second, ranking_score: 2, ranking_reasons: ['citation_count'] },
            { paper: first, ranking_score: 1, ranking_reasons: ['methodology'] },
          ])
        : current.stable_id === 'second'
          ? batch(current.title, [{ paper: third, ranking_score: 1, ranking_reasons: [] }])
          : batch(current.title, []),
    })
    expect(result.papers.map(item => item.paper.doi)).toEqual(['10.1000/root', '10.1000/second', '10.1000/third'])
    expect(result.papers.map(item => item.discovery_depth)).toEqual([0, 1, 2])
    expect(result.edges.every(edge => result.papers.some(item => item.paper.stable_id === edge.source_stable_id) && result.papers.some(item => item.paper.stable_id === edge.target_stable_id))).toBe(true)
    expect(result.edges).toHaveLength(2)
    expect(progress).toEqual([1, 2, 3])
  })

  it('deduplicates DOI, provider stable IDs, and normalized title-year keys with stable tie breaks', async () => {
    const doiRoot = paper('doi-root', 'Root', '10.1000/root')
    const sameDoi = paper('doi-root-other', 'Different spelling', '10.1000/ROOT')
    const stableOne = paper('stable-shared', 'First stable title', null, 2024)
    const stableTwo = paper('stable-shared', 'Second stable title', null, 2020)
    const titleOne = paper('title-one', 'Normalized Title', null, 2024)
    const titleTwo = paper('title-two', ' normalized—title ', null, 2024)
    const first = paper('first', 'First', null, 2024)
    const second = paper('second', 'Second', null, 2024)
    const result = await recursiveCollect([doiRoot, sameDoi, stableOne, stableTwo, titleOne, titleTwo], {
      depth: 2,
      width: 2,
      max_total: 20,
      request_options: {},
      fetch_references: async current => current.stable_id === 'doi-root'
        ? batch(current.title, [
            { paper: second, ranking_score: 4 },
            { paper: first, ranking_score: 4 },
          ])
        : batch(current.title, []),
    })
    expect(result.papers.map(item => item.paper.stable_id)).toEqual(['doi-root', 'stable-shared', 'title-one', 'first', 'second'])
    expect(result.edges.map(edge => edge.target_stable_id)).toEqual(['first', 'second'])
    const stableOutput = (value: Awaited<ReturnType<typeof recursiveCollect>>) => JSON.stringify({
      papers: value.papers.map(item => ({ stable_id: item.paper.stable_id, discovery_depth: item.discovery_depth })),
      edges: value.edges.map(edge => ({ provider: edge.provider, source: edge.source_stable_id, target: edge.target_stable_id, ranking_score: edge.ranking_score, ranking_reasons: edge.ranking_reasons })),
      cancelled: value.cancelled,
      truncated: value.truncated,
    })
    expect(stableOutput(result)).toBe(stableOutput(await recursiveCollect([doiRoot, sameDoi, stableOne, stableTwo, titleOne, titleTwo], {
      depth: 2,
      width: 2,
      max_total: 20,
      request_options: {},
      fetch_references: async current => current.stable_id === 'doi-root'
        ? batch(current.title, [
            { paper: second, ranking_score: 4 },
            { paper: first, ranking_score: 4 },
          ])
        : batch(current.title, []),
    })))
  })

  it('points citation edges at the canonical paper after title-year alias deduplication', async () => {
    const root = paper('root', 'Root')
    const canonical = paper('canonical', 'Same Paper', null, 2024)
    const alias = paper('alias', ' same—paper ', null, 2024)
    const result = await recursiveCollect([root, canonical], {
      depth: 2,
      width: 1,
      max_total: 10,
      request_options: {},
      fetch_references: async current => current.stable_id === 'root'
        ? batch(current.title, [{ paper: alias, ranking_score: 1 }])
        : batch(current.title, []),
    })

    expect(result.papers.map(item => item.paper.stable_id)).toEqual(['root', 'canonical'])
    expect(result.edges).toHaveLength(1)
    expect(result.edges[0]).toMatchObject({ source_stable_id: 'root', target_stable_id: 'canonical' })
  })

  it('stops at max_total without adding an edge to an omitted paper', async () => {
    const root = paper('root', 'Root')
    const child = paper('child', 'Child')
    const result = await recursiveCollect([root], {
      depth: 2,
      width: 2,
      max_total: 1,
      request_options: {},
      fetch_references: async current => batch(current.title, [{ paper: child, ranking_score: 1 }]),
    })
    expect(result.truncated).toBe(true)
    expect(result.papers).toHaveLength(1)
    expect(result.edges).toHaveLength(0)
  })

  it('honors cancellation before expanding the seed layer', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await recursiveCollect([paper('root', 'Root')], {
      depth: 3,
      width: 1,
      max_total: 5,
      request_options: {},
      signal: controller.signal,
      fetch_references: async current => batch(current.title, []),
    })
    expect(result.cancelled).toBe(true)
    expect(result.attempts).toHaveLength(0)
  })
})
