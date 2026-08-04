import { normalizeDoi } from './contracts.js'
import { normalizeText } from './paper-fields.js'

export type ParsedBibTeX = {
  title: string | null
  authors: string[]
  venue: string | null
  year: number | null
  doi: string | null
  abstract: string | null
  url: string | null
  publisher: string | null
  arxiv_id: string | null
  authors_truncated: boolean
}

function cleanBibValue(value: string): string {
  const normalized = normalizeText(value)
  return typeof normalized === 'string' ? normalized.trim() : value.trim()
}

function bibField(content: string, name: string): string | null {
  const match = new RegExp(`(?:^|[,\\s])${name}\\s*=\\s*(\\{|")`, 'i').exec(content)
  if (!match) return null
  const quote = match[1]
  const start = match.index + match[0].length - 1
  if (quote === '"') {
    let escaped = false
    for (let index = start + 1; index < content.length; index += 1) {
      const char = content[index]
      if (char === '\\') {
        escaped = !escaped
        continue
      }
      if (char === '"' && !escaped) return content.slice(start + 1, index)
      escaped = false
    }
    return null
  }

  let depth = 0
  for (let index = start; index < content.length; index += 1) {
    const char = content[index]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return content.slice(start + 1, index)
    }
  }
  return null
}

function parseAuthors(value: string): string[] {
  return value
    .split(/\s+and\s+/i)
    .map(author => author.trim())
    .filter(author => author && author.toLowerCase() !== 'others')
    .slice(0, 300)
}

export function parseBibTeX(content: string | null | undefined): ParsedBibTeX {
  if (!content?.trim()) return {
    title: null,
    authors: [],
    venue: null,
    year: null,
    doi: null,
    abstract: null,
    url: null,
    publisher: null,
    arxiv_id: null,
    authors_truncated: false,
  }
  const authorsRaw = bibField(content, 'author')
  const yearRaw = bibField(content, 'year')
  const eprint = bibField(content, 'eprint')
  const archivePrefix = bibField(content, 'archiveprefix')
  const arxivId = eprint && archivePrefix?.toLowerCase() === 'arxiv'
    ? eprint
    : /\barxiv\s*[:-]\s*(\d{4}\.\d{4,5}(?:v\d+)?)/i.exec(content)?.[1] || null
  const parsedYear = yearRaw ? Number(yearRaw.trim()) : Number.NaN
  return {
    title: cleanBibValue(bibField(content, 'title') || '') || null,
    authors: parseAuthors(authorsRaw || ''),
    venue: cleanBibValue(bibField(content, 'journal') || bibField(content, 'booktitle') || '') || null,
    year: Number.isInteger(parsedYear) && parsedYear >= 0 && parsedYear <= 3_000 ? parsedYear : null,
    doi: normalizeDoi(bibField(content, 'doi')),
    abstract: cleanBibValue(bibField(content, 'abstract') || '') || null,
    url: bibField(content, 'url')?.trim() || null,
    publisher: cleanBibValue(bibField(content, 'publisher') || '') || null,
    arxiv_id: arxivId?.trim() || null,
    authors_truncated: /\band\s+others\b/i.test(content),
  }
}
