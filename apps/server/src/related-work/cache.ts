import { createHash } from 'node:crypto'
import { audit, database, one } from '../database.js'
import type { RelatedWorkProvider, SourceAttempt } from './contracts.js'

export const RELATED_WORK_CACHE_SCHEMA_VERSION = 'related-work-request-v1'
const DEFAULT_TTL_SECONDS = 24 * 60 * 60
const MAX_TTL_SECONDS = 31 * 24 * 60 * 60

export type RelatedWorkCacheOperation = 'search' | 'references'

export type RelatedWorkCacheDescriptor = {
  project_id: string
  provider: RelatedWorkProvider
  operation: RelatedWorkCacheOperation
  query: string
  request_params: Record<string, unknown>
}

type CacheRow = {
  id: string
  project_id: string
  provider: RelatedWorkProvider
  operation: RelatedWorkCacheOperation
  request_hash: string
  schema_version: string
  request_url: string
  request_params: Record<string, unknown>
  response: unknown
  status: SourceAttempt['status']
  http_status: number | null
  result_count: number
  failure: unknown
  created_at: string
  expires_at: string
  last_hit_at: string | null
  hit_count: number
}

export type RelatedWorkCacheHit<T> = {
  value: T
  entry_id: string
  request_hash: string
  request_url: string
  created_at: string
  expires_at: string
  hit_count: number
}

export class RelatedWorkCacheError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RelatedWorkCacheError'
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(item => canonical(item))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonical(item)]))
}

function ttlSeconds(): number {
  const raw = process.env.RESEARCH_RELATED_WORK_CACHE_TTL_SECONDS
  if (!raw) return DEFAULT_TTL_SECONDS
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_TTL_SECONDS) throw new RelatedWorkCacheError('related_work_cache_ttl_invalid')
  return parsed
}

export function relatedWorkRequestHash(descriptor: RelatedWorkCacheDescriptor): string {
  return createHash('sha256').update(JSON.stringify(canonical({
    project_id: descriptor.project_id,
    provider: descriptor.provider,
    operation: descriptor.operation,
    query: descriptor.query,
    request_params: descriptor.request_params,
    schema_version: RELATED_WORK_CACHE_SCHEMA_VERSION,
  }))).digest('hex')
}

function cacheKeyParams(descriptor: RelatedWorkCacheDescriptor, requestHash: string) {
  return [descriptor.project_id, descriptor.provider, descriptor.operation, requestHash, RELATED_WORK_CACHE_SCHEMA_VERSION]
}

function successful(status: SourceAttempt['status']): boolean {
  return status === 'succeeded' || status === 'partial'
}

function expired(row: CacheRow): boolean {
  return new Date(row.expires_at).getTime() <= Date.now()
}

export async function readRelatedWorkCache<T>(
  descriptor: RelatedWorkCacheDescriptor,
  parse: (value: unknown) => T,
): Promise<RelatedWorkCacheHit<T> | null> {
  const requestHash = relatedWorkRequestHash(descriptor)
  const row = await one<CacheRow>(`SELECT * FROM related_work_request_cache
    WHERE project_id=$1 AND provider=$2 AND operation=$3 AND request_hash=$4 AND schema_version=$5
    LIMIT 1`, cacheKeyParams(descriptor, requestHash))
  if (!row) {
    const incompatible = await one<{ schema_version: string }>(`SELECT schema_version FROM related_work_request_cache
      WHERE project_id=$1 AND provider=$2 AND operation=$3 AND request_hash=$4
      ORDER BY created_at DESC LIMIT 1`, cacheKeyParams(descriptor, requestHash).slice(0, 4))
    await audit('related_work.cache_miss', descriptor.project_id, {
      provider: descriptor.provider,
      operation: descriptor.operation,
      request_hash: requestHash,
      reason: incompatible ? 'schema_mismatch' : 'not_found',
    })
    return null
  }
  if (expired(row)) {
    await audit('related_work.cache_miss', descriptor.project_id, {
      cache_id: row.id,
      provider: descriptor.provider,
      operation: descriptor.operation,
      request_hash: requestHash,
      reason: 'expired',
      expires_at: row.expires_at,
    })
    return null
  }
  let value: T
  try {
    value = parse(row.response)
  } catch (error) {
    await audit('related_work.cache_invalid', descriptor.project_id, {
      cache_id: row.id,
      provider: descriptor.provider,
      operation: descriptor.operation,
      request_hash: requestHash,
      reason: error instanceof Error ? error.message.slice(0, 500) : 'cache_response_invalid',
    })
    throw new RelatedWorkCacheError('related_work_cache_response_invalid')
  }
  await database.query('UPDATE related_work_request_cache SET last_hit_at=NOW(),hit_count=hit_count+1 WHERE id=$1 AND project_id=$2', [row.id, descriptor.project_id])
  await audit('related_work.cache_hit', descriptor.project_id, {
    cache_id: row.id,
    provider: descriptor.provider,
    operation: descriptor.operation,
    request_hash: requestHash,
    status: row.status,
    result_count: row.result_count,
    created_at: row.created_at,
    expires_at: row.expires_at,
  })
  return {
    value,
    entry_id: row.id,
    request_hash: requestHash,
    request_url: row.request_url,
    created_at: row.created_at,
    expires_at: row.expires_at,
    hit_count: row.hit_count + 1,
  }
}

export async function writeRelatedWorkCache(
  descriptor: RelatedWorkCacheDescriptor,
  response: unknown,
  attempt: SourceAttempt,
): Promise<{ request_hash: string; stored: boolean }> {
  const requestHash = relatedWorkRequestHash(descriptor)
  if (attempt.status === 'cancelled') {
    await audit('related_work.cache_write_skipped', descriptor.project_id, {
      provider: descriptor.provider,
      operation: descriptor.operation,
      request_hash: requestHash,
      reason: 'cancelled',
    })
    return { request_hash: requestHash, stored: false }
  }
  const existing = await one<CacheRow>(`SELECT * FROM related_work_request_cache
    WHERE project_id=$1 AND provider=$2 AND operation=$3 AND request_hash=$4 AND schema_version=$5
    LIMIT 1`, cacheKeyParams(descriptor, requestHash))
  if (existing && !successful(attempt.status) && successful(existing.status)) {
    await audit('related_work.cache_write_skipped', descriptor.project_id, {
      cache_id: existing.id,
      provider: descriptor.provider,
      operation: descriptor.operation,
      request_hash: requestHash,
      reason: 'failure_preserves_success',
      existing_status: existing.status,
      incoming_status: attempt.status,
    })
    return { request_hash: requestHash, stored: false }
  }
  const id = existing?.id || crypto.randomUUID()
  const ttl = ttlSeconds()
  if (existing) {
    await database.query(`UPDATE related_work_request_cache SET
      request_url=$2,request_params=$3,response=$4,status=$5,http_status=$6,result_count=$7,failure=$8,
      created_at=NOW(),expires_at=NOW()+($9::text||' seconds')::interval,last_hit_at=NULL,hit_count=0
      WHERE id=$1 AND project_id=$10`, [
      id, attempt.request_url, descriptor.request_params, response, attempt.status, attempt.http_status,
      attempt.result_count, attempt.failure, String(ttl), descriptor.project_id,
    ])
  } else {
    await database.query(`INSERT INTO related_work_request_cache
      (id,project_id,provider,operation,request_hash,schema_version,request_url,request_params,response,status,http_status,result_count,failure,expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW()+($14::text||' seconds')::interval)`, [
      id, descriptor.project_id, descriptor.provider, descriptor.operation, requestHash, RELATED_WORK_CACHE_SCHEMA_VERSION,
      attempt.request_url, descriptor.request_params, response, attempt.status, attempt.http_status, attempt.result_count, attempt.failure, String(ttl),
    ])
  }
  await audit('related_work.cache_write', descriptor.project_id, {
    cache_id: id,
    provider: descriptor.provider,
    operation: descriptor.operation,
    request_hash: requestHash,
    status: attempt.status,
    result_count: attempt.result_count,
    ttl_seconds: ttl,
  })
  return { request_hash: requestHash, stored: true }
}
