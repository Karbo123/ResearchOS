import { describe, expect, it } from 'vitest'
import { chatToResponsesRequest, forwardChatCompletion, responsesToChatCompletion, type ModelBridgeConfig } from '../src/model-gateway-bridge.js'

const config: ModelBridgeConfig = {
  targetBaseUrl: 'http://127.0.0.1:3000/v1',
  targetKey: 'bridge-test-key',
  model: 'gpt-5.6-terra',
  timeoutMs: 5_000,
}

function structuredChatRequest(responseFormat: Record<string, unknown> = {
  type: 'json_schema',
  json_schema: {
    name: 'memory_result',
    strict: true,
    schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
  },
}) {
  return {
    model: config.model,
    messages: [{ role: 'user', content: 'Extract the memory.' }],
    response_format: responseFormat,
  }
}

describe('Supermemory Responses bridge', () => {
  it('converts structured Chat input to Responses input and schema format', () => {
    const request = chatToResponsesRequest(structuredChatRequest())
    expect(request).not.toHaveProperty('response_format')
    expect(request.text?.format).toMatchObject({ type: 'json_schema', name: 'memory_result', strict: true })
    expect(request.text?.format).not.toHaveProperty('json_object')
    expect(JSON.stringify(request.input).toLowerCase()).toContain('json')
    expect(request.input).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'system' }),
      expect.objectContaining({ role: 'user' }),
    ]))
  })

  it('upgrades legacy json_object mode to a Responses JSON schema', () => {
    const request = chatToResponsesRequest(structuredChatRequest({ type: 'json_object' }))
    expect(request.text?.format).toMatchObject({ type: 'json_schema', name: 'generic_json_response', strict: false, schema: { type: 'object' } })
    expect(JSON.stringify(request.input).toLowerCase()).toContain('json')
  })

  it('maps tool calls in both directions without fabricating text', () => {
    const request = chatToResponsesRequest({
      model: config.model,
      messages: [
        { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'remember', arguments: '{"value":true}' } }] },
        { role: 'tool', tool_call_id: 'call-1', content: '{"stored":true}' },
      ],
    })
    expect(request.input).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'function_call', call_id: 'call-1', name: 'remember' }),
      expect.objectContaining({ type: 'function_call_output', call_id: 'call-1' }),
    ]))

    const result = responsesToChatCompletion({
      id: 'resp-1',
      model: config.model,
      created_at: 1,
      output: [{ type: 'function_call', call_id: 'call-1', name: 'remember', arguments: '{"value":true}' }],
    })
    expect(result.choices).toEqual([expect.objectContaining({ finish_reason: 'tool_calls' })])
    expect((result.choices as Array<Record<string, unknown>>)[0]?.message).toMatchObject({ role: 'assistant', content: null })
  })

  it('sends only Responses format to the fixed gateway and converts the response', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      capturedUrl = String(input)
      capturedInit = init
      return new Response(JSON.stringify({
        id: 'resp-1',
        model: config.model,
        created_at: 1,
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"ok":true}' }] }],
        usage: { input_tokens: 3, output_tokens: 2 },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }

    const result = await forwardChatCompletion(structuredChatRequest(), config, mockFetch)
    const body = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>
    expect(capturedUrl).toBe('http://127.0.0.1:3000/v1/responses')
    expect(capturedInit?.method).toBe('POST')
    expect(capturedInit?.headers).toMatchObject({ authorization: 'Bearer bridge-test-key' })
    expect(body).not.toHaveProperty('response_format')
    expect(JSON.stringify(body)).not.toContain('json_object')
    expect(result.choices).toEqual([expect.objectContaining({ finish_reason: 'stop' })])
    expect(result.usage).toEqual({ prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 })
  })

  it('surfaces gateway failures and refuses unsupported request modes', async () => {
    await expect(forwardChatCompletion(structuredChatRequest(), config, async () => new Response(JSON.stringify({ error: { message: 'gateway failure' } }), { status: 503 }))).rejects.toMatchObject({ code: 'model_bridge_upstream_error', status: 503 })
    expect(() => chatToResponsesRequest({ ...structuredChatRequest(), stream: true })).toThrowError(expect.objectContaining({ code: 'model_bridge_stream_unsupported' }))
  })
})
