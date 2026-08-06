import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FetchFunction } from '../src/model-catalog.js'

const savedEnvironment = new Map<string, string | undefined>()
function setEnvironment(name: string, value: string) {
  if (!savedEnvironment.has(name)) savedEnvironment.set(name, process.env[name])
  process.env[name] = value
}

afterEach(() => {
  for (const [name, value] of savedEnvironment) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  savedEnvironment.clear()
  vi.restoreAllMocks()
})

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('model catalog', () => {
  it('fetches and sorts OpenAI-compatible model ids', async () => {
    setEnvironment('RESEARCH_RUNTIME_DIR', `runtime/test-model-catalog-${process.pid}`)
    const { fetchModelCatalog } = await import('../src/model-catalog.js')
    const fetcher = vi.fn<FetchFunction>(async () => jsonResponse({
      data: [
        { id: 'gpt-5.6-terra' },
        { id: 'gpt-5.6-luna' },
        { id: 'gpt-5.6-sol' },
      ],
    }))
    const result = await fetchModelCatalog({ url: 'http://127.0.0.1:3000/v1', key: 'secret' }, '', fetcher)
    expect(result.models).toEqual(['gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra'])
    expect(result.reasoning_efforts).toEqual(['low', 'medium', 'high'])
    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer secret' }),
      }),
    )
  })

  it('uses a fallback key when the submitted key is blank', async () => {
    setEnvironment('RESEARCH_RUNTIME_DIR', `runtime/test-model-catalog-${process.pid}`)
    const { fetchModelCatalog } = await import('../src/model-catalog.js')
    const fetcher = vi.fn<FetchFunction>(async () => jsonResponse({ data: [{ id: 'gpt-5.6-luna' }] }))
    await fetchModelCatalog({ url: 'http://127.0.0.1:3000/v1', key: '' }, 'env-secret', fetcher)
    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/v1/models',
      expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer env-secret' }) }),
    )
  })

  it('keeps provider-specific reasoning efforts when advertised', async () => {
    setEnvironment('RESEARCH_RUNTIME_DIR', `runtime/test-model-catalog-${process.pid}`)
    const { fetchModelCatalog } = await import('../src/model-catalog.js')
    const fetcher = vi.fn<FetchFunction>(async () => jsonResponse({
      data: [
        { id: 'reasoning-model', supported_reasoning_efforts: ['high'] },
        { id: 'plain-model' },
      ],
    }))
    const result = await fetchModelCatalog({ url: 'https://api.example.com/v1', key: 'secret' }, '', fetcher)
    expect(result.reasoning_efforts).toEqual(['high'])
  })

  it('rejects non-loopback HTTP and blank keys before contacting upstream', async () => {
    setEnvironment('RESEARCH_RUNTIME_DIR', `runtime/test-model-catalog-${process.pid}`)
    const { fetchModelCatalog } = await import('../src/model-catalog.js')
    await expect(fetchModelCatalog({ url: 'http://example.com/v1', key: 'secret' }, ''))
      .rejects.toMatchObject({ code: 'model_catalog_invalid_url' })
    await expect(fetchModelCatalog({ url: 'http://127.0.0.1:3000/v1', key: '' }, ''))
      .rejects.toMatchObject({ code: 'model_catalog_missing_key' })
  })

  it('fails closed on upstream errors and malformed responses', async () => {
    setEnvironment('RESEARCH_RUNTIME_DIR', `runtime/test-model-catalog-${process.pid}`)
    const { fetchModelCatalog } = await import('../src/model-catalog.js')
    const upstream = vi.fn<FetchFunction>(async () => jsonResponse({ error: { message: 'bad key' } }, 401))
    await expect(fetchModelCatalog({ url: 'http://127.0.0.1:3000/v1', key: 'secret' }, '', upstream))
      .rejects.toMatchObject({ code: 'model_catalog_upstream_error', status: 502 })
    const malformed = vi.fn<FetchFunction>(async () => jsonResponse({ data: [] }))
    await expect(fetchModelCatalog({ url: 'http://127.0.0.1:3000/v1', key: 'secret' }, '', malformed))
      .rejects.toMatchObject({ code: 'model_catalog_invalid_response' })
  })

  it('reports unreachable upstreams as structured failures', async () => {
    setEnvironment('RESEARCH_RUNTIME_DIR', `runtime/test-model-catalog-${process.pid}`)
    const { fetchModelCatalog } = await import('../src/model-catalog.js')
    const broken = vi.fn<FetchFunction>(async () => { throw new TypeError('network down') })
    await expect(fetchModelCatalog({ url: 'http://127.0.0.1:3000/v1', key: 'secret' }, '', broken))
      .rejects.toMatchObject({ code: 'model_catalog_unreachable' })
  })
})
