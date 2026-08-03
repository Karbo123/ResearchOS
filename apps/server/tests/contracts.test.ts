import { describe, expect, it } from 'vitest'
import { chatRequest, experimentRequest, modelSettingsRequest } from '../src/contracts.js'
import { isAllowedModelUrl, isResponsesBaseUrl } from '../src/model-url.js'

describe('strict application contracts', () => {
  it('rejects hidden chat fields', () => expect(() => chatRequest.parse({ message: 'idea', command: 'whoami' })).toThrow())
  it('rejects arbitrary experiment execution controls', () => expect(() => experimentRequest.parse({
    project_id: crypto.randomUUID(), proposal_id: crypto.randomUUID(), experiment_type: 'python_analysis', config: { command: 'whoami' }, random_seeds: [1],
  })).toThrow(/arbitrary execution fields/))
  it('keeps three model tiers independent', () => {
    const tier = (model: string) => ({ model, url: 'http://127.0.0.1:3000/v1', key: 'secret', reasoning_effort: 'low' as const })
    const parsed = modelSettingsRequest.parse({ simple: tier('luna'), medium: { ...tier('terra'), reasoning_effort: 'medium' }, complex: { ...tier('sol'), reasoning_effort: 'high' } })
    expect(parsed.simple.model).toBe('luna')
    expect(parsed.complex.model).toBe('sol')
  })
  it('requires a Responses API base URL for model settings', () => {
    const tier = (url: string) => ({ model: 'model', url, key: 'secret', reasoning_effort: 'low' as const })
    for (const endpoint of ['/v1/chat/completions', '/v1/completions', '/v1/responses']) {
      const settings = { simple: tier(`http://127.0.0.1:3000${endpoint}`), medium: tier('http://127.0.0.1:3000/v1'), complex: tier('http://127.0.0.1:3000/v1') }
      expect(() => modelSettingsRequest.parse(settings)).toThrow()
    }
  })
  it('accepts only operation-free model bases for child processes', () => {
    expect(isResponsesBaseUrl('http://127.0.0.1:3000/v1')).toBe(true)
    expect(isResponsesBaseUrl('http://127.0.0.1:3000/v1/')).toBe(true)
    for (const endpoint of ['/v1/chat/completions', '/v1/completions', '/v1/responses', 'not-a-url']) {
      expect(isResponsesBaseUrl(endpoint.startsWith('http') ? `http://127.0.0.1:3000${endpoint}` : endpoint)).toBe(false)
    }
  })
  it('accepts only HTTPS or private HTTP model targets', () => {
    expect(isAllowedModelUrl('https://api.openai.com/v1')).toBe(true)
    expect(isAllowedModelUrl('http://127.0.0.1:3000/v1')).toBe(true)
    expect(isAllowedModelUrl('http://192.168.1.5/v1')).toBe(true)
    expect(isAllowedModelUrl('http://8.8.8.8/v1')).toBe(false)
    expect(isAllowedModelUrl('file:///tmp/model')).toBe(false)
    const tier = (url: string) => ({ model: 'model', url, key: 'secret', reasoning_effort: 'low' as const })
    expect(() => modelSettingsRequest.parse({ simple: tier('file:///tmp/model'), medium: tier('http://127.0.0.1:3000/v1'), complex: tier('http://127.0.0.1:3000/v1') })).toThrow()
  })
})
