import { describe, expect, it } from 'vitest'
import { requestJson, requestXml } from '../src/related-work/transport.js'

const base = {
  provider: 'crossref' as const,
  query: 'signals',
  request_url: 'https://api.example.test/works?query=signals',
  options: { limit: 10, timeout_ms: 50 },
}

function response(body: string, status = 200, contentType = 'application/json'): Response {
  return new Response(body, { status, headers: { 'content-type': contentType } })
}

describe('related-work transport failure contracts', () => {
  it('retries a transient 5xx and preserves the successful attempt', async () => {
    let calls = 0
    const result = await requestJson({
      ...base,
      fetch_impl: (async () => {
        calls += 1
        return calls === 1 ? response('temporary failure', 503) : response('{"message":{"items":[]}}')
      }) as typeof fetch,
    })

    expect(calls).toBe(2)
    expect(result.attempt.status).toBe('succeeded')
    expect(result.attempt.http_status).toBe(200)
    expect(result.attempt.failure).toBeNull()
  })

  it('returns rate_limited after bounded 429 retries instead of an empty success', async () => {
    let calls = 0
    const result = await requestJson({
      ...base,
      fetch_impl: (async () => {
        calls += 1
        return response('slow down', 429)
      }) as typeof fetch,
    })

    expect(calls).toBe(3)
    expect(result.value).toBeNull()
    expect(result.attempt.status).toBe('rate_limited')
    expect(result.attempt.failure).toMatchObject({ code: 'rate_limited', retryable: true, http_status: 429 })
  })

  it('records invalid JSON as invalid_response', async () => {
    const result = await requestJson({
      ...base,
      fetch_impl: (async () => response('<html>not json</html>')) as typeof fetch,
    })

    expect(result.value).toBeNull()
    expect(result.attempt.status).toBe('invalid_response')
    expect(result.attempt.failure).toMatchObject({ code: 'invalid_response', retryable: false, http_status: 200 })
  })

  it('records provider timeout without switching provider or returning XML success', async () => {
    const fetch_impl = (async () => {
      const error = new Error('provider timeout')
      error.name = 'TimeoutError'
      throw error
    }) as typeof fetch
    const result = await requestXml({
      ...base,
      fetch_impl,
      headers: { accept: 'application/xml' },
    })

    expect(result.value).toBeNull()
    expect(result.attempt.status).toBe('timed_out')
    expect(result.attempt.failure).toMatchObject({ code: 'timed_out', retryable: true })
  })

  it('records an explicit AbortSignal cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await requestJson({
      ...base,
      options: { ...base.options, signal: controller.signal },
      fetch_impl: (async () => response('{"unexpected":true}')) as typeof fetch,
    })

    expect(result.value).toBeNull()
    expect(result.attempt.status).toBe('cancelled')
    expect(result.attempt.failure).toMatchObject({ code: 'cancelled', retryable: false })
  })

  it('rejects a response body above the bounded size limit', async () => {
    const oversized = 'x'.repeat(5_000_001)
    const result = await requestJson({
      ...base,
      fetch_impl: (async () => response(oversized)) as typeof fetch,
    })

    expect(result.value).toBeNull()
    expect(result.attempt.status).toBe('invalid_response')
    expect(result.attempt.failure).toMatchObject({ code: 'invalid_response', retryable: false })
  })
})
