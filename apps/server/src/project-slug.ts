import { createHash, randomBytes } from 'node:crypto'
import { one } from './database.js'

const WORD_PATTERN = /^[a-z]{2,32}$/
const SUFFIX_PATTERN = /^[a-z0-9]{4}$/
const BASE_PATTERN = /^[a-z]{2,32}-[a-z]{2,32}$/
const PROJECT_SLUG_PATTERN = /^[a-z]{2,32}-[a-z]{2,32}-[a-z0-9]{4}$/
const SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

function normalizeWord(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('en-US')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z]+/g, '')
}

function normalizeSuffix(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, '')
}

function normalizeBaseWords(words: string[]): string {
  if (words.length !== 2) throw new Error('project_slug_invalid')
  const normalized = words.map(normalizeWord)
  if (normalized.some(word => !WORD_PATTERN.test(word)) || new Set(normalized).size !== 2) {
    throw new Error('project_slug_invalid')
  }
  return normalized.join('-')
}

export function normalizeProjectSlug(value: string): string {
  const parts = value
    .trim()
    .toLocaleLowerCase('en-US')
    .split(/[-_\s]+/)
    .filter(Boolean)
  if (parts.length !== 3) throw new Error('project_slug_invalid')
  const base = normalizeBaseWords(parts.slice(0, 2))
  const suffix = normalizeSuffix(parts[2] || '')
  if (!SUFFIX_PATTERN.test(suffix)) throw new Error('project_slug_invalid')
  const slug = `${base}-${suffix}`
  if (!PROJECT_SLUG_PATTERN.test(slug)) throw new Error('project_slug_invalid')
  return slug
}

export function isCurrentProjectSlug(value: string): boolean {
  return PROJECT_SLUG_PATTERN.test(value)
}

/** Returns the two-word semantic base; the server adds the random suffix. */
export function normalizeProjectSlugKeywords(keywords: string[]): string {
  return normalizeBaseWords(keywords)
}

export function legacyProjectSlugBase(title: string, legacySlug: string): string {
  const candidates = `${title} ${legacySlug}`
    .split(/[-_\s]+/)
    .map(normalizeWord)
    .filter(word => WORD_PATTERN.test(word))
  const words = [...new Set(candidates)]
  while (words.length < 2) words.push(words.length === 0 ? 'research' : 'project')
  return normalizeBaseWords(words.slice(0, 2))
}

export function deterministicProjectSlugSuffix(projectId: string, legacySlug: string, attempt = 0): string {
  const input = `${projectId}:${legacySlug}:${attempt}`
  return createHash('sha256').update(input).digest('hex').slice(0, 4)
}

export function randomProjectSlugSuffix(): string {
  let suffix = ''
  while (suffix.length < 4) {
    for (const byte of randomBytes(8)) {
      if (byte >= 252) continue
      suffix += SUFFIX_ALPHABET[byte % SUFFIX_ALPHABET.length]
      if (suffix.length === 4) break
    }
  }
  return suffix
}

export async function nextAvailableProjectSlug(base: string, suffixFactory: () => string = randomProjectSlugSuffix): Promise<string> {
  if (!BASE_PATTERN.test(base)) throw new Error('project_slug_invalid')
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const suffix = suffixFactory()
    if (!SUFFIX_PATTERN.test(suffix)) throw new Error('project_slug_invalid')
    const candidate = `${base}-${suffix}`
    const existing = await one<{ id: string }>('SELECT id FROM projects WHERE slug=$1 UNION ALL SELECT project_id AS id FROM project_slug_aliases WHERE slug=$1 LIMIT 1', [candidate])
    if (!existing) return candidate
  }
  throw new Error('project_slug_unavailable')
}
