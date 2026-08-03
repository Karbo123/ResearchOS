import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const savedEnvironment = new Map<string, string | undefined>()
const modelEnvironment = {
  RESEARCH_ROOT: '/mnt/d/researchos',
  MODEL_SETTINGS_PATH: '/mnt/d/researchos/runtime/test-model-responses-missing.json',
  RESEARCH_MODEL_COMPLEX: 'openai/gpt-5.6-sol',
  RESEARCH_MODEL_URL_COMPLEX: 'http://127.0.0.1:3000/v1',
  RESEARCH_MODEL_KEY_COMPLEX: 'responses-test-key',
  RESEARCH_REASONING_COMPLEX: 'high',
}

function setEnvironment(name: string, value: string) {
  if (!savedEnvironment.has(name)) savedEnvironment.set(name, process.env[name])
  process.env[name] = value
}

function responseBody(text = '{"ok":true}') {
  return {
    id: 'resp_test',
    created_at: 1,
    model: 'gpt-5.6-sol',
    output: [{
      type: 'message',
      role: 'assistant',
      id: 'msg_test',
      content: [{ type: 'output_text', text, annotations: [] }],
    }],
    usage: { input_tokens: 1, output_tokens: 1 },
  }
}

function structuredCall(model: { doGenerate: (options: Record<string, unknown>) => Promise<unknown> }) {
  return model.doGenerate({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'Return JSON.' }] }],
    responseFormat: {
      type: 'json',
      name: 'test_result',
      schema: {
        type: 'object',
        properties: { ok: { type: 'boolean' } },
        required: ['ok'],
        additionalProperties: false,
      },
    },
  })
}

describe('Responses model contract', () => {
  let configuredModel: (tier: 'complex') => { provider: string; doGenerate: (options: Record<string, unknown>) => Promise<unknown> }
  let loadModelConfig: (tier: 'complex') => unknown
  let ModelConfigurationError: new (...args: never[]) => Error
  const originalFetch = globalThis.fetch

  beforeAll(async () => {
    for (const [name, value] of Object.entries(modelEnvironment)) setEnvironment(name, value)
    vi.resetModules()
    const module = await import('../../mastra/src/mastra/agents/research-agents.ts')
    const config = await import('../../mastra/src/mastra/model-config.ts')
    configuredModel = module.configuredModel as typeof configuredModel
    loadModelConfig = config.loadModelConfig as typeof loadModelConfig
    ModelConfigurationError = config.ModelConfigurationError as typeof ModelConfigurationError
  }, 30_000)

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  afterAll(() => {
    for (const [name, value] of savedEnvironment) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    savedEnvironment.clear()
  })

  it('sends structured generation to Responses with strict json_schema', async () => {
    const requests: Array<{ url: string; body: Record<string, any> }> = []
    globalThis.fetch = (async (input, init) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) })
      return new Response(JSON.stringify(responseBody()), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch

    const model = configuredModel('complex')
    await structuredCall(model)

    expect(model.provider).toBe('openai.responses')
    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe('http://127.0.0.1:3000/v1/responses')
    expect(requests[0]?.body.model).toBe('gpt-5.6-sol')
    expect(requests[0]?.body.text?.format).toMatchObject({ type: 'json_schema', strict: true, name: 'test_result' })
    expect(requests[0]?.body.text?.format?.schema).toMatchObject({ type: 'object', required: ['ok'] })
    expect(requests[0]?.body).not.toHaveProperty('response_format')
    expect(JSON.stringify(requests[0]?.body)).not.toContain('json_object')
  })

  it('rejects old operation URLs instead of constructing an invalid Responses URL', () => {
    for (const endpoint of ['/v1/chat/completions', '/v1/completions', '/v1/responses']) {
      setEnvironment('RESEARCH_MODEL_URL_COMPLEX', `http://127.0.0.1:3000${endpoint}`)
      expect(() => loadModelConfig('complex')).toThrow(ModelConfigurationError)
    }
    setEnvironment('RESEARCH_MODEL_URL_COMPLEX', 'http://127.0.0.1:3000/v1')
  })

  it.each([400, 401, 429, 500, 503])('surfaces provider HTTP %s as an error', async status => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: 'provider failure', type: 'invalid_request_error', code: 'provider_error' } }), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch

    await expect(structuredCall(configuredModel('complex'))).rejects.toThrow()
  })

  it('surfaces an aborted request instead of returning a fallback result', async () => {
    globalThis.fetch = (async (_input, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal
      if (!signal) return reject(new Error('test requires an abort signal'))
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    })) as typeof fetch

    const model = configuredModel('complex')
    await expect(model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Return JSON.' }] }],
      abortSignal: AbortSignal.timeout(10),
    })).rejects.toThrow()
  })

  it('rejects an invalid successful provider payload', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ output: [{ type: 'message' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch

    await expect(structuredCall(configuredModel('complex'))).rejects.toThrow()
  })
})
