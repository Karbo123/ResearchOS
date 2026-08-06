import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/proxy-fetch.js', () => ({
  proxyFetch: () => globalThis.fetch as typeof fetch,
  createProxyFetch: () => globalThis.fetch as typeof fetch,
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('model connection tests', () => {
  it('sends a tiny WAV as multipart data to the transcription endpoint', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => jsonResponse({ text: '' }))
    vi.stubGlobal('fetch', fetchMock)
    const { testModelConnection } = await import('../src/model-test.js')

    await expect(testModelConnection('voice', {
      model: 'whisper-large-v3-turbo',
      url: 'https://api.groq.com/openai/v1',
      key: 'secret',
    })).resolves.toMatchObject({ ok: true })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.groq.com/openai/v1/audio/transcriptions',
      expect.objectContaining({ method: 'POST' }),
    )
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    const form = init.body as FormData
    const file = form.get('file') as File
    expect(form.get('model')).toBe('whisper-large-v3-turbo')
    expect(form.get('response_format')).toBe('json')
    expect(file).toBeInstanceOf(Blob)
    expect(file.name).toBe('connectivity-test.wav')
    expect(file.type).toBe('audio/wav')
    expect(file.size).toBe(4_044)
    const wav = Buffer.from(await file.arrayBuffer())
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE')
    expect(new Headers(init.headers).has('content-type')).toBe(false)
  })

  it('includes a minimal image when testing a vision model', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => jsonResponse({ output: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const { testModelConnection } = await import('../src/model-test.js')

    await testModelConnection('vision', {
      model: 'mimo-v2.5',
      url: 'http://10.31.107.77:3000/v1',
      key: 'secret',
    })

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    const request = JSON.parse(String(init.body)) as {
      input: Array<{ content: Array<{ type: string; image_url?: string; detail?: string }> }>
    }
    const image = request.input[0]?.content.find(item => item.type === 'input_image')
    expect(image?.image_url).toMatch(/^data:image\/png;base64,/)
    expect(image?.detail).toBe('low')
  })

  it('uses the minimum-cost image generation settings', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => jsonResponse({ data: [{ task_id: 'task-1' }] }))
    vi.stubGlobal('fetch', fetchMock)
    const { testModelConnection } = await import('../src/model-test.js')

    await testModelConnection('image', {
      model: 'gpt-image-2-official',
      url: 'https://api.apimart.ai/v1',
      key: 'secret',
    })

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(init.body))).toMatchObject({
      prompt: 'ping',
      size: '1:1',
      resolution: '1k',
      quality: 'low',
      n: 1,
    })
  })

  it('fails closed when a successful response has the wrong shape', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const { testModelConnection } = await import('../src/model-test.js')

    await expect(testModelConnection('voice', {
      model: 'whisper-large-v3-turbo',
      url: 'https://api.groq.com/openai/v1',
      key: 'secret',
    })).rejects.toMatchObject({ code: 'model_test_invalid_response' })
  })
})
