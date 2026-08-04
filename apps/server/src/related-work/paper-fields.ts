import { normalizeTitle } from './contracts.js'

export type EnrichableAuthor = {
  name: string
  orcid?: string | null
  affiliations?: string[]
  email?: string | null
  is_corresponding?: boolean | null
  scholar_id?: string | null
  interests?: string[]
  citation_stats?: Record<string, unknown> | null
}

export type EnrichableAuthorWithExtra = EnrichableAuthor

export type EnrichablePaper = {
  title?: string | null
  authors?: Array<EnrichableAuthor | string> | null
  abstract?: string | null
  doi?: string | null
  year?: number | null
  venue?: string | null
  institutions?: string[] | null
  bibtex?: string | null
}

export function stripControlChars(value: unknown): unknown {
  if (typeof value !== 'string') return value
  return value
    .replace(/[\u0000-\u001f\u007f\u200b\u200c\u200d\u200e\u200f\ufeff]/g, '')
    .replace(/\u00a0/g, ' ')
}

export function normalizeText(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const stripped = stripControlChars(value) as string
  return stripped
    .replace(/\\(["'])/g, '$1')
    .replace(/\\[%&#_{}]/g, match => match.slice(1))
    .replace(/\\[a-zA-Z]+\s*/g, match => match.replace(/^\\[a-zA-Z]+\s*/, ''))
    .replace(/[{}]/g, '')
    .replace(/\s*:\s*/g, ': ')
    .replace(/\s+/g, ' ')
    .trim()
}

function titleWords(value: string | null | undefined): Set<string> {
  return new Set(normalizeTitle(value).split(' ').filter(Boolean))
}

export function titlesMatch(left: string | null | undefined, right: string | null | undefined, minWordOverlap = 0.55): boolean {
  const leftWords = titleWords(left)
  const rightWords = titleWords(right)
  if (!leftWords.size || !rightWords.size) return false
  const shared = [...leftWords].filter(word => rightWords.has(word)).length
  const union = new Set([...leftWords, ...rightWords]).size
  const shorter = Math.min(leftWords.size, rightWords.size)
  return shared / union >= minWordOverlap || (shared >= 3 && shared / shorter >= 0.6)
}

function authorTokens(value: string | null | undefined): string[] {
  return normalizeTitle(value).split(' ').filter(Boolean)
}

function authorParts(value: string | null | undefined): { family: string[]; given: string[] } {
  const text = normalizeText(value) as string
  if (!text) return { family: [], given: [] }
  if (text.includes(',')) {
    const [family = '', given = ''] = text.split(',', 2)
    return { family: authorTokens(family), given: authorTokens(given) }
  }
  const tokens = authorTokens(text)
  return { family: tokens.slice(-1), given: tokens.slice(0, -1) }
}

function initialSignature(tokens: string[]): string {
  return tokens.map(token => token[0] || '').join('')
}

export function matchAuthor(query: string | null | undefined, candidates: Array<string | null | undefined>): string | null {
  const queryTokens = authorTokens(query)
  if (!queryTokens.length) return null
  for (const candidate of candidates) {
    const candidateTokens = authorTokens(candidate)
    if (!candidate || !candidateTokens.length) continue
    const queryParts = authorParts(query)
    const candidateParts = authorParts(candidate)
    const familyMatch = queryParts.family.some(queryFamily => candidateParts.family.some(candidateFamily => candidateFamily === queryFamily))
    const givenSignature = initialSignature(queryParts.given)
    const candidateSignature = initialSignature(candidateParts.given)
    const givenMatch = !givenSignature || !candidateSignature || givenSignature === candidateSignature || givenSignature.startsWith(candidateSignature) || candidateSignature.startsWith(givenSignature)
    if (familyMatch && givenMatch) return candidate
    const querySet = new Set(queryTokens)
    const candidateSet = new Set(candidateTokens)
    if ([...querySet].every(token => candidateSet.has(token)) || [...candidateSet].every(token => querySet.has(token))) return candidate
    const initialsMatch = (shorter: string[], longer: string[]) => shorter.every((token, index) => {
      const matchingLongerToken = longer[index] || longer.find(item => item.startsWith(token[0] || ''))
      return Boolean(matchingLongerToken && matchingLongerToken.startsWith(token[0] || ''))
    })
    if (queryTokens.length <= candidateTokens.length && initialsMatch(queryTokens, candidateTokens)) return candidate
    if (candidateTokens.length <= queryTokens.length && initialsMatch(candidateTokens, queryTokens)) return candidate
  }
  return null
}

export function mergeEnrichedAuthors(
  existing: Array<EnrichableAuthor | string> | null | undefined,
  incoming: Array<EnrichableAuthor | string> | null | undefined,
): Array<EnrichableAuthorWithExtra> {
  const existingNames: string[] = []
  const merged: Array<EnrichableAuthorWithExtra> = []
  const existingCount = existing?.length || 0
  for (const value of existing || []) {
    const author = typeof value === 'string' ? { name: value } : value
    if (!author?.name?.trim()) continue
    existingNames.push(author.name)
    merged.push({
      name: author.name,
      orcid: author.orcid ?? null,
      affiliations: [...new Set((author.affiliations || []).filter(Boolean))],
      email: author.email ?? null,
      is_corresponding: author.is_corresponding ?? null,
      scholar_id: author.scholar_id ?? null,
      interests: author.interests || [],
      citation_stats: author.citation_stats ?? null,
    })
  }

  for (const value of incoming || []) {
    const author = typeof value === 'string' ? { name: value } : value
    if (!author?.name?.trim()) continue
    const match = matchAuthor(author.name, existingNames)
    if (match) {
      const target = merged.find(candidate => candidate.name === match)
      if (target) {
        if (author.orcid && !target.orcid) target.orcid = author.orcid
        target.affiliations = [...new Set([...(target.affiliations || []), ...(author.affiliations || []).filter(Boolean)])]
        if (author.email && !target.email) target.email = author.email
        if (author.is_corresponding) target.is_corresponding = true
        if (author.scholar_id && !target.scholar_id) target.scholar_id = author.scholar_id
        if (author.interests?.length) target.interests = [...new Set([...(target.interests || []), ...author.interests])]
        if (author.citation_stats && !target.citation_stats) target.citation_stats = author.citation_stats
      }
      continue
    }
    if (existingCount === 0 || merged.length <= 1) {
      merged.push({
        name: author.name,
        orcid: author.orcid ?? null,
        affiliations: [...new Set((author.affiliations || []).filter(Boolean))],
        email: author.email ?? null,
        is_corresponding: author.is_corresponding ?? null,
        scholar_id: author.scholar_id ?? null,
        interests: author.interests || [],
        citation_stats: author.citation_stats ?? null,
      })
      existingNames.push(author.name)
    }
  }
  return merged
}

export function preferIncomingAuthors(
  existing: Array<EnrichableAuthor | string> | null | undefined,
  incoming: Array<EnrichableAuthor | string> | null | undefined,
): Array<EnrichableAuthorWithExtra> {
  const incomingAuthors = (incoming || []).flatMap(value => {
    const author = typeof value === 'string' ? { name: value } : value
    return author?.name?.trim() ? [{ name: author.name.trim(), orcid: author.orcid ?? null, affiliations: author.affiliations || [], email: author.email ?? null, is_corresponding: author.is_corresponding ?? null, scholar_id: author.scholar_id ?? null, interests: author.interests || [], citation_stats: author.citation_stats ?? null }] : []
  })
  if (!incomingAuthors.length) return []
  const existingAuthors = (existing || []).flatMap(value => {
    const author = typeof value === 'string' ? { name: value } : value
    return author?.name?.trim() ? [{ name: author.name.trim(), orcid: author.orcid ?? null, affiliations: author.affiliations || [], email: author.email ?? null, is_corresponding: author.is_corresponding ?? null, scholar_id: author.scholar_id ?? null, interests: author.interests || [], citation_stats: author.citation_stats ?? null }] : []
  })
  const existingNames = existingAuthors.map(author => author.name)
  return incomingAuthors.map(incomingAuthor => {
    const match = matchAuthor(incomingAuthor.name, existingNames)
    const existingAuthor = match ? existingAuthors.find(author => author.name === match) : null
    return {
      ...incomingAuthor,
      orcid: incomingAuthor.orcid || existingAuthor?.orcid || null,
      affiliations: [...new Set([...(existingAuthor?.affiliations || []), ...incomingAuthor.affiliations].filter(Boolean))],
      email: incomingAuthor.email || existingAuthor?.email || null,
      is_corresponding: incomingAuthor.is_corresponding || existingAuthor?.is_corresponding || null,
      scholar_id: incomingAuthor.scholar_id || existingAuthor?.scholar_id || null,
      interests: [...new Set([...(existingAuthor?.interests || []), ...incomingAuthor.interests])],
      citation_stats: incomingAuthor.citation_stats || existingAuthor?.citation_stats || null,
    }
  })
}

export function missingFields(paper: EnrichablePaper): string[] {
  const authors = paper.authors || []
  const institutionCount = new Set((paper.institutions || []).filter(Boolean)).size
  const authorsWithAffiliations = authors.filter(author => typeof author !== 'string' && (author.affiliations || []).length > 0).length
  const missing: string[] = []
  if (!paper.title?.trim()) missing.push('title')
  if (!authors.length) missing.push('authors')
  else if (authorsWithAffiliations === 0) missing.push('affiliations')
  else if (authorsWithAffiliations < authors.length * 0.5) missing.push(`affiliations(部分: ${authorsWithAffiliations}/${authors.length})`)
  if (!paper.abstract || paper.abstract.trim().length < 150) missing.push('abstract')
  if (!paper.doi?.trim()) missing.push('doi')
  if (!paper.year) missing.push('year')
  if (!paper.venue?.trim()) missing.push('venue')
  if (!institutionCount) missing.push('institutions')
  if (!paper.bibtex?.trim()) missing.push('bibtex')
  return missing
}

export function paperCompleteness(paper: EnrichablePaper): number {
  const authors = paper.authors || []
  const institutionCount = new Set((paper.institutions || []).filter(Boolean)).size
  const authorsWithAffiliations = authors.filter(author => typeof author !== 'string' && (author.affiliations || []).length > 0).length
  const checks: number[] = []
  checks.push(paper.title?.trim() ? 1 : 0)
  if (!authors.length) checks.push(0)
  else if (typeof authors[0] === 'object') checks.push(0.5 + 0.5 * (authorsWithAffiliations / authors.length))
  else checks.push(0.5)
  const abstract = paper.abstract?.trim() || ''
  if (!abstract) checks.push(0)
  else if (abstract.length > 300) checks.push(1)
  else if (abstract.length > 100) checks.push(0.6)
  else checks.push(0.3)
  checks.push(institutionCount ? Math.min(1, institutionCount / 3) : 0)
  checks.push(paper.venue?.trim() ? 1 : 0.3)
  checks.push(paper.doi?.trim() ? 1 : 0.2)
  checks.push(paper.year ? 1 : 0)
  checks.push(paper.bibtex?.trim() ? 1 : 0)
  return checks.reduce((sum, value) => sum + value, 0) / checks.length
}

export function backoff(attempt: number, options: {
  base?: number
  max_wait?: number
  jitter?: number
  random?: () => number
} = {}): number {
  const base = options.base ?? 2
  const maxWait = options.max_wait ?? 30
  const jitter = options.jitter ?? 0.3
  const random = options.random ?? Math.random
  const delay = Math.min(maxWait, base ** Math.max(0, attempt))
  return delay * (1 + Math.min(1, Math.max(0, random())) * jitter)
}
