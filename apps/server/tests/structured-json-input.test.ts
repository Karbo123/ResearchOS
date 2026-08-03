import { describe, expect, it } from 'vitest'
import { structuredJsonInput, structuredJsonValue } from '../../mastra/src/mastra/structured-json-input.js'

describe('structured model input compatibility', () => {
  it('puts an explicit JSON instruction in the input message', () => {
    const input = structuredJsonInput('answer the supplied question')
    expect(input).toContain('JSON')
    expect(input).toContain('answer the supplied question')
  })

  it('serializes the request data after the JSON instruction', () => {
    const input = structuredJsonValue({ question: '2 + 2 = ?', answer_type: 'number' })
    expect(input.startsWith('Return a JSON object')).toBe(true)
    expect(input).toContain('"question":"2 + 2 = ?"')
  })
})
