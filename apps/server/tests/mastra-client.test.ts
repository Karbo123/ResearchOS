import { afterEach, describe, expect, it } from 'vitest'
import { ApiError } from '../src/http.js'
import { mastraJson } from '../src/mastra-client.js'

describe('Mastra client failure boundary', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('does not treat a non-JSON success body as a model result', async () => {
    globalThis.fetch = (async () => new Response('not-json', { status: 200 })) as typeof fetch
    await expect(mastraJson('/internal/agents/clarify', {})).rejects.toMatchObject<ApiError>({ code: 'llm_invalid_response', status: 502 })
  })

  it('does not treat a scalar success body as a structured result', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify(null), { status: 200 })) as typeof fetch
    await expect(mastraJson('/internal/agents/clarify', {})).rejects.toMatchObject<ApiError>({ code: 'llm_invalid_response', status: 502 })
  })

  it('preserves structured provider errors without creating assistant content', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ code: 'llm_provider_rejected', message: 'provider rejected request' }), { status: 502 })) as typeof fetch
    await expect(mastraJson('/internal/agents/clarify', {})).rejects.toMatchObject<ApiError>({ code: 'llm_provider_rejected', status: 502 })
  })
})
