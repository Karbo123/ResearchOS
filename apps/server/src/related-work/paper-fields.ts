import { normalizeTitle } from './contracts.js'

export type EnrichableAuthor = {
  name: string
  affiliations?: string[]
}

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

export function missingFields(paper: EnrichablePaper): string[] {
  const authors = paper.authors || []
  const institutionCount = new Set((paper.institutions || []).filter(Boolean)).size
  const authorsWithAffiliations = authors.filter(author => typeof author !== 'string' && (author.affiliations || []).length > 0).length
  const missing: string[] = []
  if (!paper.title?.trim()) missing.push('title')
  if (!authors.length) missing.push('authors')
  if (!paper.abstract || paper.abstract.trim().length < 100) missing.push('abstract')
  if (!paper.doi?.trim()) missing.push('doi')
  if (!paper.year) missing.push('year')
  if (!paper.venue?.trim()) missing.push('venue')
  if (!institutionCount || (authors.length > 0 && authorsWithAffiliations / authors.length < 0.5)) missing.push('institutions')
  if (!paper.bibtex?.trim()) missing.push('bibtex')
  return missing
}

export function paperCompleteness(paper: EnrichablePaper): number {
  const authors = paper.authors || []
  const institutionCount = new Set((paper.institutions || []).filter(Boolean)).size
  const authorsWithAffiliations = authors.filter(author => typeof author !== 'string' && (author.affiliations || []).length > 0).length
  let score = 0
  if (paper.title?.trim()) score += 0.15
  if (authors.length) score += 0.1
  if (authors.length && authorsWithAffiliations / authors.length >= 0.5) score += 0.05
  if (paper.abstract?.trim()) score += Math.min(0.2, Math.max(0.05, paper.abstract.trim().length / 2_000 * 0.2))
  if (paper.doi?.trim()) score += 0.1
  if (paper.year) score += 0.1
  if (paper.venue?.trim()) score += 0.1
  if (institutionCount) score += 0.1
  if (paper.bibtex?.trim()) score += 0.1
  return Math.min(1, Math.max(0, score))
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
