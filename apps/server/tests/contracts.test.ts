import { describe, expect, it } from 'vitest'
import { chatRequest, experimentRequest, modelSettingsRequest } from '../src/contracts.js'

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
})
