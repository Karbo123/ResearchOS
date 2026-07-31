import { describe, expect, it } from 'vitest'
import { publicModelSettings } from '../src/model-settings.js'

describe('public model settings', () => {
  it('never returns model keys', () => {
    for (const tier of Object.values(publicModelSettings())) {
      expect(tier).not.toHaveProperty('key')
      expect(tier).toHaveProperty('key_configured')
    }
  })
})
