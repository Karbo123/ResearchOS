import { testProjectSlug } from './test-project.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { database, migrate, rows } from '../src/database.js'
import { readRelatedWorkCache, relatedWorkRequestHash, writeRelatedWorkCache } from '../src/related-work/cache.js'
import { paperCandidate, sourceAttempt, sourceSearchResult, type SourceAttempt, type SourceSearchResult } from '../src/related-work/contracts.js'

const projectId = testProjectSlug()
const otherProjectId = testProjectSlug()

function descriptor(scope: string, query = 'cache fixture') {
  return {
    project_id: scope,
    provider: 'crossref' as const,
    operation: 'search' as const,
    query,
    request_params: { limit: 10, timeout_ms: 15_000, user_agent: null },
  }
}

function attempt(status: SourceAttempt['status'] = 'succeeded'): SourceAttempt {
  const now = new Date().toISOString()
  return sourceAttempt.parse({
    provider: 'crossref',
    query: 'cache fixture',
    request_url: 'https://api.crossref.org/works?query.bibliographic=cache%20fixture',
    started_at: now,
    finished_at: now,
    status,
    http_status: status === 'succeeded' ? 200 : null,
    result_count: status === 'succeeded' ? 1 : 0,
    failure: status === 'succeeded' ? null : { code: 'timed_out', message: 'fixture timeout', retryable: true, http_status: null },
  })
}

function response(status: SourceAttempt['status'] = 'succeeded'): SourceSearchResult {
  const candidate = paperCandidate.parse({
    provider: 'crossref',
    stable_id: 'crossref:10.1000/cache-fixture',
    title: 'Cache Fixture Paper',
    authors: [],
    year: 2024,
    venue: null,
    doi: '10.1000/cache-fixture',
    abstract: null,
    pdf_url: null,
    html_url: 'https://doi.org/10.1000/cache-fixture',
    license: null,
    citation_count: null,
    open_access: null,
    source_url: 'https://doi.org/10.1000/cache-fixture',
    query: 'cache fixture',
    retrieved_at: new Date().toISOString(),
  })
  return sourceSearchResult.parse({
    provider: 'crossref',
    query: 'cache fixture',
    candidates: status === 'succeeded' ? [candidate] : [],
    attempt: attempt(status),
  })
}

describe('project-scoped related-work request cache', () => {
  beforeAll(async () => {
    await migrate()
    await database.query('INSERT INTO projects(id,slug,title) VALUES ($1,$2,$3),($4,$5,$6)', [
      projectId, `cache-${projectId.slice(0, 8)}`, 'Cache Fixture Project',
      otherProjectId, `cache-other-${otherProjectId.slice(0, 8)}`, 'Other Cache Fixture Project',
    ])
  }, 30_000)

  afterAll(async () => {
    await database.query('DELETE FROM related_work_request_cache WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM audit_events WHERE project_id IN ($1,$2)', [projectId, otherProjectId])
    await database.query('DELETE FROM projects WHERE id IN ($1,$2)', [projectId, otherProjectId])
  }, 30_000)

  it('records miss, stores the real response, replays a hit, and keeps request hash/params auditable', async () => {
    const request = descriptor(projectId)
    expect(await readRelatedWorkCache(request, value => sourceSearchResult.parse(value))).toBeNull()
    await writeRelatedWorkCache(request, response(), attempt())
    const hit = await readRelatedWorkCache(request, value => sourceSearchResult.parse(value))
    expect(hit?.value.candidates).toHaveLength(1)
    expect(hit?.request_hash).toBe(relatedWorkRequestHash(request))
    const stored = await rows<{ request_hash: string; request_params: Record<string, unknown>; status: string; hit_count: number }>(
      'SELECT request_hash,request_params,status,hit_count FROM related_work_request_cache WHERE project_id=$1 AND request_hash=$2',
      [projectId, relatedWorkRequestHash(request)],
    )
    expect(stored[0]).toMatchObject({ request_hash: relatedWorkRequestHash(request), request_params: request.request_params, status: 'succeeded', hit_count: 1 })
    const events = await rows<{ action: string }>("SELECT action FROM audit_events WHERE project_id=$1 AND action IN ('related_work.cache_miss','related_work.cache_hit','related_work.cache_write') ORDER BY created_at,id", [projectId])
    expect(events.map(item => item.action)).toEqual(expect.arrayContaining(['related_work.cache_miss', 'related_work.cache_write', 'related_work.cache_hit']))
  })

  it('does not let a later provider failure overwrite an earlier successful result', async () => {
    const request = descriptor(projectId, 'failure-after-success')
    await writeRelatedWorkCache(request, response(), attempt())
    await writeRelatedWorkCache(request, response('timed_out'), attempt('timed_out'))
    const stored = await rows<{ status: string; result_count: number }>('SELECT status,result_count FROM related_work_request_cache WHERE project_id=$1 AND request_hash=$2', [projectId, relatedWorkRequestHash(request)])
    expect(stored[0]).toEqual({ status: 'succeeded', result_count: 1 })
    const hit = await readRelatedWorkCache(request, value => sourceSearchResult.parse(value))
    expect(hit?.value.attempt.status).toBe('succeeded')
    expect(hit?.value.candidates).toHaveLength(1)
    const event = await rows<{ details: Record<string, unknown> }>("SELECT details FROM audit_events WHERE project_id=$1 AND action='related_work.cache_write_skipped' ORDER BY created_at DESC,id LIMIT 1", [projectId])
    expect(event[0]?.details).toEqual(expect.objectContaining({ reason: 'failure_preserves_success' }))
  })

  it('replays a failure as a failure and never turns it into an empty success', async () => {
    const request = descriptor(projectId, 'failure-only')
    await writeRelatedWorkCache(request, response('timed_out'), attempt('timed_out'))
    const hit = await readRelatedWorkCache(request, value => sourceSearchResult.parse(value))
    expect(hit?.value.attempt.status).toBe('timed_out')
    expect(hit?.value.candidates).toEqual([])
    const stored = await rows<{ status: string; failure: Record<string, unknown> }>('SELECT status,failure FROM related_work_request_cache WHERE project_id=$1 AND request_hash=$2', [projectId, relatedWorkRequestHash(request)])
    expect(stored[0]?.status).toBe('timed_out')
    expect(stored[0]?.failure).toEqual(expect.objectContaining({ code: 'timed_out' }))
  })

  it('keeps TTL and schema changes project-scoped and refuses expired/incompatible entries', async () => {
    const ttlRequest = descriptor(projectId, 'ttl-fixture')
    await writeRelatedWorkCache(ttlRequest, response(), attempt())
    await database.query('UPDATE related_work_request_cache SET expires_at=NOW()-INTERVAL \'1 second\' WHERE project_id=$1 AND request_hash=$2', [projectId, relatedWorkRequestHash(ttlRequest)])
    expect(await readRelatedWorkCache(ttlRequest, value => sourceSearchResult.parse(value))).toBeNull()

    const schemaRequest = descriptor(projectId, 'schema-fixture')
    await writeRelatedWorkCache(schemaRequest, response(), attempt())
    await database.query("UPDATE related_work_request_cache SET schema_version='old-schema' WHERE project_id=$1 AND request_hash=$2", [projectId, relatedWorkRequestHash(schemaRequest)])
    expect(await readRelatedWorkCache(schemaRequest, value => sourceSearchResult.parse(value))).toBeNull()

    const otherRequest = descriptor(otherProjectId)
    expect(relatedWorkRequestHash(otherRequest)).not.toBe(relatedWorkRequestHash(descriptor(projectId)))
    expect(await readRelatedWorkCache(otherRequest, value => sourceSearchResult.parse(value))).toBeNull()
    const events = await rows<{ details: Record<string, unknown> }>("SELECT details FROM audit_events WHERE project_id=$1 AND action='related_work.cache_miss' ORDER BY created_at DESC,id", [projectId])
    expect(events.map(item => item.details.reason)).toEqual(expect.arrayContaining(['expired', 'schema_mismatch']))
  })
})
