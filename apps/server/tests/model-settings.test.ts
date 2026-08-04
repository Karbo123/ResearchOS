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

  it('saves the proxy through its own endpoint without touching model tiers', async () => {
    setEnvironment('RESEARCH_RUNTIME_DIR', `runtime/test-proxy-settings-${process.pid}`)
    vi.resetModules()
    const { privateModelSettings, saveProxySettings } = await import('../src/model-settings.js')
    const before = privateModelSettings()
    const saved = saveProxySettings({ enabled: true, url: 'http://127.0.0.1:7890' })
    const after = privateModelSettings()
    expect(saved).toEqual({ enabled: true, url: 'http://127.0.0.1:7890' })
    expect(after.proxy).toEqual(saved)
    expect(after.simple.model).toBe(before.simple.model)
    expect(after.simple.key).toBe(before.simple.key)
  })

  it('persists the document model settings without returning the key', async () => {
    setEnvironment('RESEARCH_RUNTIME_DIR', `runtime/test-document-settings-${process.pid}`)
    vi.resetModules()
    const { privateModelSettings, publicDocumentSettings, saveDocumentSettings } = await import('../src/model-settings.js')
    const saved = saveDocumentSettings({
      model: 'deepseek-v4-flash',
      url: 'http://127.0.0.1:3000/v1',
      key: 'document-key',
    })
    expect(saved).toMatchObject({
      model: 'deepseek-v4-flash',
      url: 'http://127.0.0.1:3000/v1',
      key_configured: true,
    })
    expect(publicDocumentSettings()).not.toHaveProperty('key')
    expect(privateModelSettings().document.key).toBe('document-key')

    saveDocumentSettings({
      model: 'deepseek-v4-flash',
      url: 'http://127.0.0.1:3000/v1',
      key: '',
    })
    expect(privateModelSettings().document.key).toBe('document-key')
  })

  it('persists the vision model settings without returning the key', async () => {
    setEnvironment('RESEARCH_RUNTIME_DIR', `runtime/test-vision-settings-${process.pid}`)
    vi.resetModules()
    const { privateModelSettings, publicVisionSettings, saveVisionSettings } = await import('../src/model-settings.js')
    const saved = saveVisionSettings({
      model: 'mimo-v2.5',
      url: 'http://10.31.107.77:3000/v1',
      key: 'vision-key',
    })
    expect(saved).toMatchObject({
      model: 'mimo-v2.5',
      url: 'http://10.31.107.77:3000/v1',
      key_configured: true,
    })
    expect(publicVisionSettings()).not.toHaveProperty('key')
    expect(privateModelSettings().vision.key).toBe('vision-key')
  })

  it('persists image generation settings and keeps a blank key unchanged', async () => {
    setEnvironment('RESEARCH_RUNTIME_DIR', `runtime/test-image-settings-${process.pid}`)
    vi.resetModules()
    const { privateModelSettings, publicImageGenerationSettings, saveImageGenerationSettings } = await import('../src/model-settings.js')
    const saved = saveImageGenerationSettings({
      model: 'gpt-image-2-official',
      url: 'https://api.apimart.ai/v1',
      key: 'image-key',
      resolution: '1k',
      quality: 'low',
    })
    expect(saved).toMatchObject({
      model: 'gpt-image-2-official',
      url: 'https://api.apimart.ai/v1',
      key_configured: true,
      resolution: '1k',
      quality: 'low',
    })
    expect(publicImageGenerationSettings()).not.toHaveProperty('key')
    expect(privateModelSettings().image_generation.key).toBe('image-key')

    saveImageGenerationSettings({
      model: 'gpt-image-2-official',
      url: 'https://api.apimart.ai/v1',
      key: '',
      resolution: '2k',
      quality: 'medium',
    })
    expect(privateModelSettings().image_generation).toMatchObject({ key: 'image-key', resolution: '2k', quality: 'medium' })
  })
})
