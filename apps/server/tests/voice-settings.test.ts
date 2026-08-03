import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/proxy-fetch.js', () => ({
  proxyFetch: () => globalThis.fetch as typeof fetch,
}))

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
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('voice settings', () => {
  it('never returns the Groq key', async () => {
    setEnvironment('RESEARCH_RUNTIME_DIR', `runtime/test-voice-settings-${process.pid}`)
    setEnvironment('RESEARCH_VOICE_PROVIDER', 'groq')
    setEnvironment('GROQ_API_KEY', 'gsk-test-key')
    vi.resetModules()
    const { publicVoiceSettings, privateVoiceSettings } = await import('../src/voice-settings.js')
    expect(privateVoiceSettings().key).toBe('gsk-test-key')
    expect(publicVoiceSettings()).not.toHaveProperty('key')
    expect(publicVoiceSettings()).toMatchObject({ provider: 'groq', key_configured: true })
  })

  it('persists provider/model/url and never returns the key', async () => {
    setEnvironment('RESEARCH_RUNTIME_DIR', `runtime/test-voice-settings-${process.pid}`)
    setEnvironment('RESEARCH_VOICE_PROVIDER', 'browser')
    setEnvironment('GROQ_API_KEY', 'gsk-test-key')
    vi.resetModules()
    const { saveVoiceSettings, publicVoiceSettings } = await import('../src/voice-settings.js')
    const saved = saveVoiceSettings({
      provider: 'groq',
      model: 'whisper-large-v3-turbo',
      url: 'https://api.groq.com/openai/v1',
    })
    expect(saved).toMatchObject({ provider: 'groq', model: 'whisper-large-v3-turbo', key_configured: true })
    expect(publicVoiceSettings()).not.toHaveProperty('key')
  })

  it('overrides the default Groq key and keeps a blank one unchanged', async () => {
    setEnvironment('RESEARCH_RUNTIME_DIR', `runtime/test-voice-settings-key-${process.pid}`)
    setEnvironment('RESEARCH_VOICE_PROVIDER', 'groq')
    setEnvironment('GROQ_API_KEY', 'gsk-env-key')
    vi.resetModules()
    const { saveVoiceSettings, privateVoiceSettings, publicVoiceSettings } = await import('../src/voice-settings.js')
    saveVoiceSettings({
      provider: 'groq',
      model: 'whisper-large-v3-turbo',
      url: 'https://api.groq.com/openai/v1',
      key: 'gsk-runtime-key',
    })
    expect(privateVoiceSettings().key).toBe('gsk-runtime-key')
    expect(publicVoiceSettings()).not.toHaveProperty('key')

    saveVoiceSettings({
      provider: 'groq',
      model: 'whisper-large-v3-turbo',
      url: 'https://api.groq.com/openai/v1',
      key: '',
    })
    expect(privateVoiceSettings().key).toBe('gsk-runtime-key')
  })
})

describe('Groq voice transcription', () => {
  it('calls the OpenAI-compatible transcriptions endpoint and returns text', async () => {
    setEnvironment('RESEARCH_RUNTIME_DIR', `runtime/test-voice-transcribe-${process.pid}`)
    setEnvironment('RESEARCH_VOICE_PROVIDER', 'groq')
    setEnvironment('RESEARCH_VOICE_GROQ_MODEL', 'whisper-large-v3-turbo')
    setEnvironment('RESEARCH_VOICE_GROQ_URL', 'https://api.groq.com/openai/v1')
    setEnvironment('GROQ_API_KEY', 'gsk-test-key')
    vi.resetModules()
    const { transcribeWithGroq } = await import('../src/voice-transcription.js')
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ text: '你好，世界。' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await transcribeWithGroq({ name: 'voice.webm', type: 'audio/webm', arrayBuffer: async () => new ArrayBuffer(8) }, 'zh')
    expect(result).toBe('你好，世界。')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.groq.com/openai/v1/audio/transcriptions',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer gsk-test-key' },
      }),
    )
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    const form = init.body as FormData
    expect(form.get('model')).toBe('whisper-large-v3-turbo')
    expect(form.get('language')).toBe('zh')
    expect(form.get('file')).toBeInstanceOf(Blob)
  })

  it('fails closed when the Groq key is missing', async () => {
    setEnvironment('RESEARCH_RUNTIME_DIR', `runtime/test-voice-key-missing-${process.pid}`)
    setEnvironment('RESEARCH_VOICE_PROVIDER', 'groq')
    setEnvironment('GROQ_API_KEY', '')
    vi.resetModules()
    const { transcribeWithGroq } = await import('../src/voice-transcription.js')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { ApiError } = await import('../src/http.js')
    await expect(transcribeWithGroq({ name: 'voice.webm', type: 'audio/webm', arrayBuffer: async () => new ArrayBuffer(8) }))
      .rejects.toMatchObject({ status: 503, code: 'voice_key_missing' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps upstream auth and invalid responses to structured failures', async () => {
    setEnvironment('RESEARCH_RUNTIME_DIR', `runtime/test-voice-errors-${process.pid}`)
    setEnvironment('RESEARCH_VOICE_PROVIDER', 'groq')
    setEnvironment('GROQ_API_KEY', 'gsk-test-key')
    vi.resetModules()
    const { transcribeWithGroq } = await import('../src/voice-transcription.js')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 })))
    await expect(transcribeWithGroq({ name: 'voice.webm', type: 'audio/webm', arrayBuffer: async () => new ArrayBuffer(8) }))
      .rejects.toMatchObject({ status: 502, code: 'voice_auth_failed' })

    vi.stubGlobal('fetch', vi.fn(async () => new Response('not-json', { status: 200 })))
    await expect(transcribeWithGroq({ name: 'voice.webm', type: 'audio/webm', arrayBuffer: async () => new ArrayBuffer(8) }))
      .rejects.toMatchObject({ status: 502, code: 'voice_provider_invalid' })
  })
})
