import { afterEach, describe, expect, it, vi } from 'vitest'

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
})

describe('public model settings', () => {
  it('never returns model keys', async () => {
    const { publicModelSettings } = await import('../src/model-settings.js')
    for (const tier of Object.values(publicModelSettings())) {
      expect(tier).not.toHaveProperty('key')
      expect(tier).toHaveProperty('key_configured')
    }
  })

  it('does not inherit shared URL or key values', async () => {
    setEnvironment('RESEARCH_RUNTIME_DIR', `runtime/test-model-settings-${process.pid}`)
    setEnvironment('RESEARCH_MODEL_URL_SIMPLE', '')
    setEnvironment('RESEARCH_MODEL_KEY_SIMPLE', '')
    setEnvironment('OPENAI_BASE_URL', 'https://api.openai.com/v1')
    setEnvironment('OPENAI_API_KEY', 'shared-key-must-not-be-used')
    vi.resetModules()
    const { privateModelSettings } = await import('../src/model-settings.js')
    const settings = privateModelSettings()
    expect(settings.simple.url).toBe('')
    expect(settings.simple.key).toBe('')
  })

  it('Mastra rejects a missing tier URL/key instead of using a shared provider', async () => {
    setEnvironment('RESEARCH_MODEL_URL_SIMPLE', '')
    setEnvironment('RESEARCH_MODEL_KEY_SIMPLE', '')
    setEnvironment('OPENAI_BASE_URL', 'https://api.openai.com/v1')
    setEnvironment('OPENAI_API_KEY', 'shared-key-must-not-be-used')
    setEnvironment('MODEL_SETTINGS_PATH', `runtime/missing-model-settings-${process.pid}.json`)
    vi.resetModules()
    const { loadModelConfig, ModelConfigurationError } = await import('../../mastra/src/mastra/model-config.ts')
    expect(() => loadModelConfig('simple')).toThrow(ModelConfigurationError)
  })

  it('persists the global proxy setting without exposing it as a tier key', async () => {
    setEnvironment('RESEARCH_RUNTIME_DIR', `runtime/test-model-settings-${process.pid}`)
    vi.resetModules()
    const { saveModelSettings, publicProxySettings } = await import('../src/model-settings.js')
    const tier = (model: string) => ({ model, url: 'http://127.0.0.1:3000/v1', key: 'secret', reasoning_effort: 'low' as const })
    saveModelSettings({
      simple: tier('luna'),
      medium: { ...tier('terra'), reasoning_effort: 'medium' },
      complex: { ...tier('sol'), reasoning_effort: 'high' },
      proxy: { enabled: true, url: 'http://127.0.0.1:7890' },
    })
    expect(publicProxySettings()).toEqual({ enabled: true, url: 'http://127.0.0.1:7890' })
  })
})
