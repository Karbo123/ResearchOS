import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const savedEnvironment = new Map<string, string | undefined>()
const modelEnvironment = {
  RESEARCH_ROOT: '/mnt/d/researchos',
  MODEL_SETTINGS_PATH: '/mnt/d/researchos/runtime/test-guardrails-settings-missing.json',
  RESEARCH_MODEL_COMPLEX: 'openai/gpt-5.6-sol',
  RESEARCH_MODEL_URL_COMPLEX: 'http://127.0.0.1:3000/v1',
  RESEARCH_MODEL_KEY_COMPLEX: 'guardrails-test-key',
  RESEARCH_REASONING_COMPLEX: 'high',
}

function setEnvironment(name: string, value: string) {
  if (!savedEnvironment.has(name)) savedEnvironment.set(name, process.env[name])
  process.env[name] = value
}

function responseBody(text = '{"categories":null,"reason":null}') {
  return {
    id: 'resp_guardrail_test',
    created_at: 1,
    model: 'gpt-5.6-sol',
    output: [{
      type: 'message',
      role: 'assistant',
      id: 'msg_guardrail_test',
      content: [{ type: 'output_text', text, annotations: [] }],
    }],
    usage: { input_tokens: 1, output_tokens: 1 },
  }
}

type InputProcessor = {
  processInput: (args: { messages: unknown[]; abort: (reason?: string) => never }) => Promise<unknown>
}

describe('strict guardrail failure boundary', () => {
  const originalFetch = globalThis.fetch
  let strictResearchProcessors: (tier: 'complex') => { inputProcessors: InputProcessor[] }

  beforeAll(async () => {
    for (const [name, value] of Object.entries(modelEnvironment)) setEnvironment(name, value)
    vi.resetModules()
    const module = await import('../../mastra/src/mastra/guardrails.ts')
    strictResearchProcessors = module.strictResearchProcessors as typeof strictResearchProcessors
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

  it('uses Responses structured JSON for prompt-injection detection', async () => {
    const requests: Array<{ url: string; body: Record<string, any> }> = []
    globalThis.fetch = (async (input, init) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) })
      return new Response(JSON.stringify(responseBody()), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch

    const processor = strictResearchProcessors('complex').inputProcessors[2]
    await processor.processInput({ messages: [{ role: 'user', content: 'untrusted text' }], abort: reason => { throw new Error(reason) } })

    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe('http://127.0.0.1:3000/v1/responses')
    expect(requests[0]?.body.text?.format).toMatchObject({ type: 'json_schema', strict: true })
    expect(requests[0]?.body).not.toHaveProperty('response_format')
    expect(JSON.stringify(requests[0]?.body)).not.toContain('json_object')
  })

  it('propagates detector provider failure instead of allowing the request through', async () => {
    globalThis.fetch = (async () => { throw new Error('detector provider unavailable') }) as typeof fetch

    const processor = strictResearchProcessors('complex').inputProcessors[2]
    await expect(processor.processInput({ messages: [{ role: 'user', content: 'untrusted text' }], abort: reason => { throw new Error(reason) } })).rejects.toThrow()
  })
})
