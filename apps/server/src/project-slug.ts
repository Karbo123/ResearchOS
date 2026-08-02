import { one } from './database.js'

const MAX_SLUG_LENGTH = 120
const WORD_PATTERN = /^[a-z][a-z0-9]{1,31}$/

function normalizeWord(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('en-US')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')
}

export function normalizeProjectSlug(value: string): string {
  const words = value
    .trim()
    .toLocaleLowerCase('en-US')
    .split(/[-_\s]+/)
    .map(normalizeWord)
    .filter(Boolean)
  if (words.length !== 3 || words.some(word => !WORD_PATTERN.test(word)) || new Set(words).size !== 3) {
    throw new Error('project_slug_invalid')
  }
  return words.join('-').slice(0, MAX_SLUG_LENGTH)
}

export function normalizeProjectSlugKeywords(keywords: string[]): string {
  if (keywords.length !== 3) throw new Error('project_slug_invalid')
  return normalizeProjectSlug(keywords.join('-'))
}

export async function nextAvailableProjectSlug(base: string): Promise<string> {
  for (let suffix = 0; suffix < 10_000; suffix += 1) {
    const candidate = suffix === 0 ? base : `${base}-${suffix + 1}`.slice(0, MAX_SLUG_LENGTH)
    const existing = await one<{ id: string }>('SELECT id FROM projects WHERE slug=$1', [candidate])
    if (!existing) return candidate
  }
  throw new Error('project_slug_unavailable')
}
